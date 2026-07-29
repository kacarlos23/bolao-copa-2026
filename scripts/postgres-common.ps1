Set-StrictMode -Version Latest

function Get-PgClusterMajor {
  param(
    [Parameter(Mandatory = $true)]
    [string]$DataDir
  )

  $versionFile = Join-Path $DataDir "PG_VERSION"
  if (-not (Test-Path -LiteralPath $versionFile)) {
    throw "PG_VERSION nao encontrado no cluster: $DataDir"
  }
  $version = (Get-Content -LiteralPath $versionFile -Raw).Trim()
  if ($version -notmatch "^(?<major>\d+)") {
    throw "Versao PostgreSQL invalida em ${versionFile}: $version"
  }
  return [int]$Matches["major"]
}

function Get-PgBinMajor {
  param(
    [Parameter(Mandatory = $true)]
    [string]$PgBin
  )

  $pgCtl = Join-Path $PgBin "pg_ctl.exe"
  if (-not (Test-Path -LiteralPath $pgCtl)) {
    throw "pg_ctl.exe nao encontrado em $PgBin"
  }
  $versionOutput = (& $pgCtl --version 2>&1) -join " "
  if ($LASTEXITCODE -ne 0 -or $versionOutput -notmatch "PostgreSQL\)?\s+(?<major>\d+)") {
    throw "Nao foi possivel identificar a versao PostgreSQL de $pgCtl"
  }
  return [int]$Matches["major"]
}

function Resolve-ProjectPgBin {
  param(
    [string]$ConfiguredPath,
    [Parameter(Mandatory = $true)]
    [string]$DataDir
  )

  $requiredMajor = Get-PgClusterMajor -DataDir $DataDir
  $candidates = @()
  if (-not [string]::IsNullOrWhiteSpace($ConfiguredPath)) {
    $candidates += $ConfiguredPath
  } else {
    if ($env:ProgramFiles) {
      $candidates += Join-Path $env:ProgramFiles "PostgreSQL\$requiredMajor\bin"
    }
    $pathCommand = Get-Command "pg_ctl.exe" -ErrorAction SilentlyContinue
    if ($null -ne $pathCommand) {
      $candidates += Split-Path -Parent $pathCommand.Source
    }
    if ($env:ProgramFiles) {
      $postgresRoot = Join-Path $env:ProgramFiles "PostgreSQL"
      if (Test-Path -LiteralPath $postgresRoot) {
        $candidates += Get-ChildItem -LiteralPath $postgresRoot -Directory -ErrorAction SilentlyContinue |
          Sort-Object { [int]($_.Name -replace '[^0-9].*$', '') } -Descending |
          ForEach-Object { Join-Path $_.FullName "bin" }
      }
    }
  }

  foreach ($candidate in ($candidates | Select-Object -Unique)) {
    if ([string]::IsNullOrWhiteSpace($candidate) -or -not (Test-Path -LiteralPath $candidate)) {
      continue
    }
    $resolvedCandidate = (Resolve-Path -LiteralPath $candidate).Path
    $requiredTools = @("pg_ctl.exe", "pg_isready.exe", "psql.exe")
    if ($requiredTools | Where-Object { -not (Test-Path -LiteralPath (Join-Path $resolvedCandidate $_)) }) {
      continue
    }
    $candidateMajor = Get-PgBinMajor -PgBin $resolvedCandidate
    if ($candidateMajor -eq $requiredMajor) {
      return $resolvedCandidate
    }
    if (-not [string]::IsNullOrWhiteSpace($ConfiguredPath)) {
      throw "Cluster PostgreSQL $requiredMajor nao pode usar binarios PostgreSQL $candidateMajor em $resolvedCandidate"
    }
  }

  throw "Binarios PostgreSQL $requiredMajor nao encontrados para o cluster $DataDir."
}

function Get-ProjectPgPort {
  param(
    [Parameter(Mandatory = $true)]
    [string]$DataDir,
    [int]$DefaultPort = 5432
  )

  $port = $DefaultPort
  foreach ($configName in @("postgresql.conf", "postgresql.auto.conf")) {
    $configPath = Join-Path $DataDir $configName
    if (-not (Test-Path -LiteralPath $configPath)) {
      continue
    }
    foreach ($line in Get-Content -LiteralPath $configPath) {
      if ($line -match "^\s*port\s*=\s*'?(?<port>\d+)'?") {
        $port = [int]$Matches["port"]
      }
    }
  }
  return $port
}

function Resolve-PgExecutable {
  param(
    [string]$ConfiguredPath,
    [Parameter(Mandatory = $true)]
    [string]$ToolName
  )

  if (-not [string]::IsNullOrWhiteSpace($ConfiguredPath)) {
    $configuredCommand = Get-Command $ConfiguredPath -ErrorAction SilentlyContinue
    if ($null -eq $configuredCommand) {
      throw "$ToolName nao encontrado no caminho configurado: $ConfiguredPath"
    }
    return $configuredCommand.Source
  }

  $pathCommand = Get-Command $ToolName -ErrorAction SilentlyContinue
  if ($null -ne $pathCommand) {
    return $pathCommand.Source
  }

  if ($env:ProgramFiles) {
    $postgresRoot = Join-Path $env:ProgramFiles "PostgreSQL"
    if (Test-Path -LiteralPath $postgresRoot) {
      $candidate = Get-ChildItem -Path (Join-Path $postgresRoot "*\bin\$ToolName.exe") -ErrorAction SilentlyContinue |
        Sort-Object { [int]($_.Directory.Parent.Name -replace '[^0-9].*$', '') } -Descending |
        Select-Object -First 1
      if ($null -ne $candidate) {
        return $candidate.FullName
      }
    }
  }

  throw "$ToolName nao encontrado. Configure o caminho correspondente ou adicione o PostgreSQL ao PATH."
}

function Get-PgConnection {
  param(
    [Parameter(Mandatory = $true)]
    [string]$DatabaseUrl
  )

  try {
    $uri = [Uri]$DatabaseUrl
  } catch {
    throw "URL do PostgreSQL invalida."
  }

  if ($uri.Scheme -notin @("postgres", "postgresql")) {
    throw "A URL deve usar o protocolo postgres:// ou postgresql://."
  }

  $userInfo = $uri.UserInfo -split ":", 2
  if ($userInfo.Count -lt 1 -or [string]::IsNullOrWhiteSpace($userInfo[0])) {
    throw "A URL do PostgreSQL deve informar o usuario."
  }

  $database = [Uri]::UnescapeDataString($uri.AbsolutePath.TrimStart("/"))
  if ([string]::IsNullOrWhiteSpace($database)) {
    throw "A URL do PostgreSQL deve informar o banco."
  }

  $password = if ($userInfo.Count -eq 2) { [Uri]::UnescapeDataString($userInfo[1]) } else { "" }
  $sslMode = $null
  foreach ($item in $uri.Query.TrimStart("?") -split "&") {
    if ([string]::IsNullOrWhiteSpace($item)) { continue }
    $pair = $item -split "=", 2
    if ([Uri]::UnescapeDataString($pair[0]) -eq "sslmode" -and $pair.Count -eq 2) {
      $sslMode = [Uri]::UnescapeDataString($pair[1])
    }
  }

  return [PSCustomObject]@{
    RawUrl = $DatabaseUrl
    Host = $uri.Host
    Port = if ($uri.IsDefaultPort) { 5432 } else { $uri.Port }
    Username = [Uri]::UnescapeDataString($userInfo[0])
    Password = $password
    Database = $database
    SslMode = $sslMode
  }
}

function Get-PgConnectionArguments {
  param(
    [Parameter(Mandatory = $true)]
    [PSCustomObject]$Connection,
    [string]$DatabaseName = $Connection.Database
  )

  return @(
    "--host", $Connection.Host,
    "--port", [string]$Connection.Port,
    "--username", $Connection.Username,
    "--dbname", $DatabaseName
  )
}

function Invoke-PgCommand {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Executable,
    [Parameter(Mandatory = $true)]
    [string[]]$Arguments,
    [PSCustomObject]$Connection,
    [Parameter(Mandatory = $true)]
    [string]$FailureMessage,
    [switch]$SuppressOutput
  )

  $previousPassword = [Environment]::GetEnvironmentVariable("PGPASSWORD", "Process")
  $previousSslMode = [Environment]::GetEnvironmentVariable("PGSSLMODE", "Process")
  $exitCode = -1

  try {
    if ([string]::IsNullOrWhiteSpace($previousSslMode)) {
      Remove-Item Env:PGSSLMODE -ErrorAction SilentlyContinue
    }
    if ($null -ne $Connection) {
      [Environment]::SetEnvironmentVariable("PGPASSWORD", $Connection.Password, "Process")
      if (-not [string]::IsNullOrWhiteSpace($Connection.SslMode)) {
        [Environment]::SetEnvironmentVariable("PGSSLMODE", $Connection.SslMode, "Process")
      } else {
        Remove-Item Env:PGSSLMODE -ErrorAction SilentlyContinue
      }
    }

    if ($SuppressOutput) {
      & $Executable @Arguments | Out-Null
    } else {
      & $Executable @Arguments
    }
    $exitCode = $LASTEXITCODE
  } finally {
    [Environment]::SetEnvironmentVariable("PGPASSWORD", $previousPassword, "Process")
    if ([string]::IsNullOrWhiteSpace($previousSslMode)) {
      Remove-Item Env:PGSSLMODE -ErrorAction SilentlyContinue
    } else {
      [Environment]::SetEnvironmentVariable("PGSSLMODE", $previousSslMode, "Process")
    }
  }

  if ($exitCode -ne 0) {
    throw "$FailureMessage Codigo: $exitCode."
  }
}

function New-PgDatabaseUrl {
  param(
    [Parameter(Mandatory = $true)]
    [string]$DatabaseUrl,
    [Parameter(Mandatory = $true)]
    [string]$DatabaseName
  )

  $builder = [UriBuilder]$DatabaseUrl
  $builder.Path = "/$DatabaseName"
  return $builder.Uri.AbsoluteUri
}
