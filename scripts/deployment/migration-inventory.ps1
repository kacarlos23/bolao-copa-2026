[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [string]$SourceRoot,
  [Parameter(Mandatory = $true)]
  [string]$TargetSha,
  [Parameter(Mandatory = $true)]
  [string]$DatabaseUrl,
  [string]$PgSqlPath
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest
Import-Module (Join-Path $PSScriptRoot "ProductionDeploy.Common.psm1") -Force
. (Join-Path (Split-Path $PSScriptRoot -Parent) "postgres-common.ps1")

$root = [IO.Path]::GetFullPath($SourceRoot).TrimEnd('\', '/')
$targetCommit = Assert-CommitSha -Sha $TargetSha
$migrationRoot = Join-Path $root "apps\api\prisma\migrations"
if (-not (Test-Path -LiteralPath $migrationRoot -PathType Container)) {
  throw "Diretorio de migrations nao encontrado."
}

$target = @()
foreach ($directory in @(Get-ChildItem -LiteralPath $migrationRoot -Directory | Sort-Object Name)) {
  $migrationFile = Join-Path $directory.FullName "migration.sql"
  if (-not (Test-Path -LiteralPath $migrationFile -PathType Leaf)) {
    continue
  }
  $target += [pscustomobject]@{
    Name = $directory.Name
    Checksum = Get-GitBlobSha256 -SourceRoot $root -CommitSha $targetCommit `
      -GitPath "apps/api/prisma/migrations/$($directory.Name)/migration.sql"
  }
}

$connection = Get-PgConnection -DatabaseUrl $DatabaseUrl
$psql = Resolve-PgExecutable -ConfiguredPath $PgSqlPath -ToolName "psql"
$baseArguments = @(
  "--no-psqlrc", "--set", "ON_ERROR_STOP=1", "--tuples-only", "--no-align", "--quiet",
  "--host", $connection.Host, "--port", [string]$connection.Port,
  "--username", $connection.Username, "--dbname", $connection.Database
)
$previousPassword = [Environment]::GetEnvironmentVariable("PGPASSWORD", "Process")
$previousSslMode = [Environment]::GetEnvironmentVariable("PGSSLMODE", "Process")
try {
  [Environment]::SetEnvironmentVariable("PGPASSWORD", $connection.Password, "Process")
  if ([string]::IsNullOrWhiteSpace($connection.SslMode)) {
    [Environment]::SetEnvironmentVariable("PGSSLMODE", $null, "Process")
  } else {
    [Environment]::SetEnvironmentVariable("PGSSLMODE", $connection.SslMode, "Process")
  }
  $serverVersionOutput = @(& $psql @baseArguments --command "SHOW server_version_num;" 2>&1)
  if ($LASTEXITCODE -ne 0) {
    throw "Consulta da versao PostgreSQL falhou."
  }
  $serverVersion = 0
  if (-not [int]::TryParse(($serverVersionOutput -join "").Trim(), [ref]$serverVersion) -or
      $serverVersion -lt 180000 -or $serverVersion -ge 190000) {
    throw "Producao exige PostgreSQL 18.x."
  }
  $tableExistsOutput = @(& $psql @baseArguments --command `
    "SELECT CASE WHEN to_regclass('public.`"_prisma_migrations`"') IS NULL THEN 'false' ELSE 'true' END;" 2>&1)
  if ($LASTEXITCODE -ne 0) {
    throw "Consulta de existencia da tabela de migrations falhou."
  }
  $tableExists = ($tableExistsOutput -join "").Trim() -eq "true"
  if ($tableExists) {
    $query = @'
SELECT COALESCE(
  json_agg(
    json_build_object(
      'migrationName', migration_name,
      'checksum', checksum,
      'startedAt', started_at,
      'finishedAt', finished_at,
      'rolledBackAt', rolled_back_at,
      'appliedStepsCount', applied_steps_count
    )
    ORDER BY started_at
  ),
  '[]'::json
)
FROM "_prisma_migrations";
'@
    $databaseJson = @(& $psql @baseArguments --command $query 2>&1)
    if ($LASTEXITCODE -ne 0) {
      throw "Consulta ao inventario de migrations falhou."
    }
  } else {
    $databaseJson = @("[]")
  }
} finally {
  [Environment]::SetEnvironmentVariable("PGPASSWORD", $previousPassword, "Process")
  [Environment]::SetEnvironmentVariable("PGSSLMODE", $previousSslMode, "Process")
}

try {
  $parsedRows = ($databaseJson -join [Environment]::NewLine).Trim() | ConvertFrom-Json
  [object[]]$rows = if ($null -eq $parsedRows) {
    @()
  } elseif ($parsedRows -is [Array]) {
    $parsedRows
  } else {
    @($parsedRows)
  }
} catch {
  throw "PostgreSQL retornou inventario de migrations invalido."
}
$targetByName = @{}
foreach ($migration in $target) {
  $targetByName[$migration.Name] = $migration
}
$completed = @{}
$partial = @()
foreach ($row in $rows) {
  $rolledBack = $null -ne $row.rolledBackAt
  $finished = $null -ne $row.finishedAt
  if (-not $finished -and -not $rolledBack) {
    $partial += [string]$row.migrationName
  }
  if ($finished -and -not $rolledBack) {
    $completed[[string]$row.migrationName] = $row
  }
}
if ($partial.Count -gt 0) {
  throw "Migration parcialmente aplicada: $(($partial | Select-Object -Unique) -join ', ')"
}

$databaseOnly = @($completed.Keys | Where-Object { -not $targetByName.ContainsKey($_) } | Sort-Object)
if ($databaseOnly.Count -gt 0) {
  throw "Drift: migrations aplicadas ausentes do candidato: $($databaseOnly -join ', ')"
}
$modified = @()
foreach ($name in $completed.Keys) {
  if (([string]$completed[$name].checksum).ToLowerInvariant() -ne $targetByName[$name].Checksum) {
    $modified += $name
  }
}
if ($modified.Count -gt 0) {
  throw "Drift: checksum alterado em migrations aplicadas: $(($modified | Sort-Object) -join ', ')"
}
$pending = @($target | Where-Object { -not $completed.ContainsKey($_.Name) } | ForEach-Object { $_.Name })

[ordered]@{
  status = "valid"
  migrationRequired = $pending.Count -gt 0
  pending = $pending
  appliedCount = $completed.Count
  targetCount = $target.Count
} | ConvertTo-Json -Depth 5 -Compress
