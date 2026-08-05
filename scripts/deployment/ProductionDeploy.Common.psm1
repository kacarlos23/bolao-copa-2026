Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Get-UtcTimestamp {
  return (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ss.fffZ")
}

function Resolve-AbsolutePath {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Path,
    [string]$BasePath = (Get-Location).Path
  )

  if ([IO.Path]::IsPathRooted($Path)) {
    return [IO.Path]::GetFullPath($Path).TrimEnd('\', '/')
  }
  return [IO.Path]::GetFullPath((Join-Path $BasePath $Path)).TrimEnd('\', '/')
}

function Test-PathWithinRoot {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Path,
    [Parameter(Mandatory = $true)]
    [string]$Root,
    [switch]$AllowRoot
  )

  $candidate = Resolve-AbsolutePath -Path $Path
  $resolvedRoot = Resolve-AbsolutePath -Path $Root
  if ($AllowRoot -and $candidate.Equals($resolvedRoot, [StringComparison]::OrdinalIgnoreCase)) {
    return $true
  }
  $prefix = $resolvedRoot + [IO.Path]::DirectorySeparatorChar
  return $candidate.StartsWith($prefix, [StringComparison]::OrdinalIgnoreCase)
}

function Assert-PathWithinRoot {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Path,
    [Parameter(Mandatory = $true)]
    [string]$Root,
    [switch]$AllowRoot,
    [string]$Description = "caminho"
  )

  if (-not (Test-PathWithinRoot -Path $Path -Root $Root -AllowRoot:$AllowRoot)) {
    throw "$Description fora da raiz permitida."
  }
  return Resolve-AbsolutePath -Path $Path
}

function Assert-SafeProductionRoot {
  param([Parameter(Mandatory = $true)][string]$ProductionRoot)

  $root = Resolve-AbsolutePath -Path $ProductionRoot
  # Keep the separator in a Unix volume root (/). Trimming it produced an
  # empty string, making every Linux path look like the volume root.
  $driveRoot = [IO.Path]::GetPathRoot($root)
  if ([string]::IsNullOrWhiteSpace($driveRoot) -or
      $root.Equals($driveRoot, [StringComparison]::OrdinalIgnoreCase)) {
    throw "PRODUCTION_ROOT nao pode ser a raiz de um volume."
  }
  if ((Split-Path -Leaf $root).Length -lt 3) {
    throw "PRODUCTION_ROOT e amplo demais para operacoes de deploy."
  }
  return $root
}

function Assert-CommitSha {
  param([Parameter(Mandatory = $true)][string]$Sha)

  $normalized = $Sha.Trim().ToLowerInvariant()
  if ($normalized -notmatch '^[a-f0-9]{40}$') {
    throw "SHA de release invalido."
  }
  return $normalized
}

function Get-Sha256 {
  param([Parameter(Mandatory = $true)][string]$Path)

  if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
    throw "Arquivo nao encontrado para checksum: $Path"
  }
  return (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant()
}

function Get-StringSha256 {
  param([Parameter(Mandatory = $true)][string]$Value)

  $sha = [Security.Cryptography.SHA256]::Create()
  try {
    $bytes = [Text.Encoding]::UTF8.GetBytes($Value)
    return ([BitConverter]::ToString($sha.ComputeHash($bytes))).Replace("-", "").ToLowerInvariant()
  } finally {
    $sha.Dispose()
  }
}

function Get-GitBlobSha256 {
  param(
    [Parameter(Mandatory = $true)][string]$SourceRoot,
    [Parameter(Mandatory = $true)][string]$CommitSha,
    [Parameter(Mandatory = $true)][string]$GitPath
  )

  $sha = Assert-CommitSha -Sha $CommitSha
  if ($GitPath -match '["\r\n]' -or $GitPath.StartsWith("/") -or
      ($GitPath -split '/' -contains "..")) {
    throw "Caminho Git inseguro."
  }
  $escapedRoot = (Resolve-AbsolutePath -Path $SourceRoot).Replace('"', '\"')
  $objectSpec = "$sha`:$GitPath"
  $startInfo = New-Object Diagnostics.ProcessStartInfo
  $startInfo.FileName = (Resolve-NativeTool -Candidates @("git.exe", "git"))
  $startInfo.Arguments = "-C `"$escapedRoot`" cat-file blob `"$objectSpec`""
  $startInfo.UseShellExecute = $false
  $startInfo.RedirectStandardOutput = $true
  $startInfo.RedirectStandardError = $true
  $startInfo.CreateNoWindow = $true
  $process = New-Object Diagnostics.Process
  $process.StartInfo = $startInfo
  $hash = [Security.Cryptography.SHA256]::Create()
  try {
    if (-not $process.Start()) {
      throw "Nao foi possivel iniciar git cat-file."
    }
    $digest = $hash.ComputeHash($process.StandardOutput.BaseStream)
    $errorOutput = $process.StandardError.ReadToEnd()
    $process.WaitForExit()
    if ($process.ExitCode -ne 0) {
      throw "Blob registrado no manifesto nao existe no commit."
    }
    return ([BitConverter]::ToString($digest)).Replace("-", "").ToLowerInvariant()
  } finally {
    $hash.Dispose()
    $process.Dispose()
  }
}

function Get-DotEnvValues {
  param([Parameter(Mandatory = $true)][string]$EnvironmentFile)

  if (-not (Test-Path -LiteralPath $EnvironmentFile -PathType Leaf)) {
    throw "Arquivo de ambiente de producao nao encontrado."
  }

  $values = @{}
  $lineNumber = 0
  foreach ($rawLine in Get-Content -LiteralPath $EnvironmentFile) {
    $lineNumber += 1
    $line = $rawLine.Trim()
    if (-not $line -or $line.StartsWith("#")) {
      continue
    }
    if ($line.StartsWith("export ")) {
      $line = $line.Substring(7).Trim()
    }
    $separator = $line.IndexOf("=")
    if ($separator -le 0) {
      throw "Linha invalida no arquivo de ambiente: $lineNumber"
    }
    $name = $line.Substring(0, $separator).Trim()
    if ($name -notmatch '^[A-Za-z_][A-Za-z0-9_]*$') {
      throw "Nome de variavel invalido no arquivo de ambiente: linha $lineNumber"
    }
    $value = $line.Substring($separator + 1).Trim()
    if ($value.Length -ge 2 -and $value[0] -eq '"' -and $value[$value.Length - 1] -eq '"') {
      $value = $value.Substring(1, $value.Length - 2)
      $value = $value.Replace('\"', '"').Replace('\n', "`n").Replace('\\', '\')
    } elseif ($value.Length -ge 2 -and $value[0] -eq "'" -and $value[$value.Length - 1] -eq "'") {
      $value = $value.Substring(1, $value.Length - 2)
    } else {
      $comment = $value.IndexOf(" #")
      if ($comment -ge 0) {
        $value = $value.Substring(0, $comment).TrimEnd()
      }
    }
    $values[$name] = $value
  }
  return $values
}

function Get-DeploymentSetting {
  param(
    [Parameter(Mandatory = $true)][hashtable]$Environment,
    [Parameter(Mandatory = $true)][string]$Name,
    [string]$DefaultValue
  )

  $processValue = [Environment]::GetEnvironmentVariable($Name, "Process")
  if (-not [string]::IsNullOrWhiteSpace($processValue)) {
    return $processValue
  }
  if ($Environment.ContainsKey($Name)) {
    return [string]$Environment[$Name]
  }
  return $DefaultValue
}

function ConvertTo-StrictBoolean {
  param(
    [string]$Value,
    [bool]$Default = $false,
    [string]$Name = "valor"
  )

  if ([string]::IsNullOrWhiteSpace($Value)) {
    return $Default
  }
  if ($Value.Trim().Equals("true", [StringComparison]::OrdinalIgnoreCase)) {
    return $true
  }
  if ($Value.Trim().Equals("false", [StringComparison]::OrdinalIgnoreCase)) {
    return $false
  }
  throw "$Name deve ser true ou false."
}

function Get-RegistrableSiteHint {
  param([Parameter(Mandatory = $true)][string]$HostName)

  $labels = @($HostName.Trim(".").ToLowerInvariant().Split(".") | Where-Object { $_ })
  if ($labels.Count -lt 2) {
    return $HostName.ToLowerInvariant()
  }
  $twoPartPublicSuffixes = @(
    "com.br", "net.br", "org.br", "app.br",
    "co.uk", "org.uk", "com.au", "co.nz"
  )
  $suffix = "$($labels[$labels.Count - 2]).$($labels[$labels.Count - 1])"
  if ($twoPartPublicSuffixes -contains $suffix -and $labels.Count -ge 3) {
    return "$($labels[$labels.Count - 3]).$suffix"
  }
  return $suffix
}

function Assert-ProductionUrls {
  param(
    [Parameter(Mandatory = $true)][string]$ApiUrl,
    [Parameter(Mandatory = $true)][string]$WebUrl,
    [switch]$AllowHttp
  )

  try {
    $api = [Uri]$ApiUrl
    $web = [Uri]$WebUrl
  } catch {
    throw "URLs publicas de producao invalidas."
  }
  if (-not $api.IsAbsoluteUri -or -not $web.IsAbsoluteUri) {
    throw "URLs publicas de producao devem ser absolutas."
  }
  if (-not $AllowHttp -and ($api.Scheme -ne "https" -or $web.Scheme -ne "https")) {
    throw "URLs publicas de producao devem usar HTTPS."
  }
  if ($api.Scheme -notin @("http", "https") -or $web.Scheme -notin @("http", "https")) {
    throw "URLs publicas devem usar HTTP ou HTTPS."
  }
  if ((Get-RegistrableSiteHint -HostName $api.DnsSafeHost) -ne
      (Get-RegistrableSiteHint -HostName $web.DnsSafeHost)) {
    throw "API e web precisam pertencer ao mesmo site registravel."
  }
  return [pscustomobject]@{
    Api = $api.GetLeftPart([UriPartial]::Authority).TrimEnd("/")
    Web = $web.GetLeftPart([UriPartial]::Authority).TrimEnd("/")
  }
}

function Get-AutoDeployStatus {
  param(
    [Parameter(Mandatory = $true)][string]$ProductionRoot,
    [Parameter(Mandatory = $true)][hashtable]$Environment
  )

  $workflowValue = [Environment]::GetEnvironmentVariable("AUTO_DEPLOY_ENABLED", "Process")
  $workflowEnabled = ConvertTo-StrictBoolean -Value $workflowValue -Default $false `
    -Name "AUTO_DEPLOY_ENABLED do workflow"
  $localValue = if ($Environment.ContainsKey("AUTO_DEPLOY_ENABLED")) {
    [string]$Environment["AUTO_DEPLOY_ENABLED"]
  } else {
    "false"
  }
  $localEnabled = ConvertTo-StrictBoolean -Value $localValue -Default $false `
    -Name "AUTO_DEPLOY_ENABLED local"
  $lockFile = Join-Path $ProductionRoot "state\auto-deploy.disabled"
  $maintenanceLocked = Test-Path -LiteralPath $lockFile -PathType Leaf
  return [pscustomobject]@{
    Enabled = ($workflowEnabled -and $localEnabled -and -not $maintenanceLocked)
    WorkflowEnabled = $workflowEnabled
    LocalEnabled = $localEnabled
    MaintenanceLocked = $maintenanceLocked
    LockFile = $lockFile
  }
}

function Get-ManifestPayload {
  param([Parameter(Mandatory = $true)]$Manifest)

  # ConvertFrom-Json represents an empty JSON array differently between
  # Windows PowerShell and PowerShell Core. Build typed collections explicitly
  # so [] is always hashed as [], never as [null] or null.
  $rcTags = New-Object Collections.Generic.List[string]
  foreach ($tag in $Manifest.rcTags) {
    if ($null -ne $tag) {
      $rcTags.Add([string]$tag)
    }
  }
  $files = New-Object Collections.Generic.List[object]
  foreach ($file in $Manifest.files) {
    if ($null -ne $file) {
      $files.Add([ordered]@{
        path = [string]$file.path
        sha256 = [string]$file.sha256
      })
    }
  }
  $payload = [ordered]@{
    formatVersion = [int]$Manifest.formatVersion
    suite = [string]$Manifest.suite
    status = [string]$Manifest.status
    pii = [bool]$Manifest.pii
    generatedAt = [string]$Manifest.generatedAt
    commitSha = [string]$Manifest.commitSha
    rcTags = [string[]]$rcTags.ToArray()
    files = [object[]]$files.ToArray()
  }
  return ($payload | ConvertTo-Json -Depth 20 -Compress)
}

function Get-ManifestPayloadSha256FromFile {
  param([Parameter(Mandatory = $true)][string]$ManifestPath)

  if (-not (Test-Path -LiteralPath $ManifestPath -PathType Leaf)) {
    throw "Manifesto de release nao encontrado."
  }
  $nodeScript = @'
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

const manifest = JSON.parse(readFileSync(process.argv[1], 'utf8'));
const { manifestSha256, ...payload } = manifest;
process.stdout.write(createHash('sha256').update(JSON.stringify(payload)).digest('hex'));
'@
  $node = Resolve-NativeTool -Candidates @("node.exe", "node")
  $hash = @(& $node --input-type=module -e $nodeScript $ManifestPath)
  if ($LASTEXITCODE -ne 0 -or @($hash).Count -ne 1 -or [string]$hash[0] -notmatch '^[a-f0-9]{64}$') {
    throw "Nao foi possivel calcular o checksum do manifesto."
  }
  return ([string]$hash[0]).Trim().ToLowerInvariant()
}

function Test-ReleaseManifest {
  param(
    [Parameter(Mandatory = $true)][string]$ManifestPath,
    [Parameter(Mandatory = $true)][string]$TargetSha,
    [Parameter(Mandatory = $true)][string]$SourceRoot,
    [switch]$SkipGitCheck
  )

  $expectedSha = Assert-CommitSha -Sha $TargetSha
  $source = Resolve-AbsolutePath -Path $SourceRoot
  if (-not (Test-Path -LiteralPath $source -PathType Container)) {
    throw "Checkout do candidato nao encontrado."
  }
  if (-not (Test-Path -LiteralPath $ManifestPath -PathType Leaf)) {
    throw "Manifesto de release nao encontrado."
  }
  try {
    $manifest = Get-Content -LiteralPath $ManifestPath -Raw | ConvertFrom-Json
  } catch {
    throw "Manifesto de release nao e JSON valido."
  }

  if ([int]$manifest.formatVersion -ne 1 -or
      [string]$manifest.suite -ne "release-candidate-manifest" -or
      [string]$manifest.status -ne "passed") {
    throw "Manifesto nao representa um release candidate aprovado."
  }
  if ([bool]$manifest.pii) {
    throw "Manifesto de release nao pode conter PII."
  }
  $manifestSha = Assert-CommitSha -Sha ([string]$manifest.commitSha)
  if ($manifestSha -ne $expectedSha) {
    throw "SHA do manifesto diverge do SHA alvo."
  }
  if ([string]::IsNullOrWhiteSpace([string]$manifest.manifestSha256) -or
      [string]$manifest.manifestSha256 -notmatch '^[a-fA-F0-9]{64}$') {
    throw "Checksum do manifesto ausente ou invalido."
  }
  $calculatedManifestSha = Get-ManifestPayloadSha256FromFile -ManifestPath $ManifestPath
  if ($calculatedManifestSha -ne ([string]$manifest.manifestSha256).ToLowerInvariant()) {
    throw "Checksum do manifesto diverge do conteudo."
  }

  $seen = @{}
  foreach ($file in @($manifest.files)) {
    $relative = ([string]$file.path).Replace("/", [IO.Path]::DirectorySeparatorChar)
    if ([string]::IsNullOrWhiteSpace($relative) -or [IO.Path]::IsPathRooted($relative) -or
        ($relative -split '[\\/]' -contains "..")) {
      throw "Manifesto contem caminho de arquivo inseguro."
    }
    $normalizedKey = $relative.Replace('\', '/').ToLowerInvariant()
    if ($seen.ContainsKey($normalizedKey)) {
      throw "Manifesto contem arquivo duplicado."
    }
    $seen[$normalizedKey] = $true
    $absolute = Join-Path $source $relative
    Assert-PathWithinRoot -Path $absolute -Root $source -Description "Arquivo do manifesto" | Out-Null
    if (-not (Test-Path -LiteralPath $absolute -PathType Leaf)) {
      throw "Arquivo registrado no manifesto nao existe: $normalizedKey"
    }
    $expectedFileSha = ([string]$file.sha256).ToLowerInvariant()
    $actualFileSha = if ($SkipGitCheck) {
      Get-Sha256 -Path $absolute
    } else {
      Get-GitBlobSha256 -SourceRoot $source -CommitSha $expectedSha `
        -GitPath $relative.Replace('\', '/')
    }
    if ($expectedFileSha -notmatch '^[a-f0-9]{64}$' -or $actualFileSha -ne $expectedFileSha) {
      throw "Checksum de arquivo diverge do manifesto: $normalizedKey"
    }
  }

  foreach ($required in @(
      ".gitattributes",
      ".github/workflows/release-gates.yml",
      ".github/workflows/deploy-production.yml",
      "ecosystem.config.cjs",
      "package-lock.json",
      "apps/api/prisma/schema.prisma"
    )) {
    if (-not $seen.ContainsKey($required)) {
      throw "Manifesto nao contem arquivo obrigatorio: $required"
    }
  }
  $migrationRoot = Join-Path $source "apps\api\prisma\migrations"
  foreach ($migration in @(Get-ChildItem -LiteralPath $migrationRoot -File -Recurse)) {
    $relativeMigration = $migration.FullName.Substring($source.Length).TrimStart('\', '/').Replace('\', '/').ToLowerInvariant()
    if (-not $seen.ContainsKey($relativeMigration)) {
      throw "Manifesto nao cobre migration: $relativeMigration"
    }
  }
  $deploymentRoot = Join-Path $source "scripts\deployment"
  foreach ($deploymentFile in @(Get-ChildItem -LiteralPath $deploymentRoot -File -Recurse)) {
    $relativeDeployment = $deploymentFile.FullName.Substring($source.Length).TrimStart('\', '/').Replace('\', '/').ToLowerInvariant()
    if (-not $seen.ContainsKey($relativeDeployment)) {
      throw "Manifesto nao cobre script de deployment: $relativeDeployment"
    }
  }

  if (-not $SkipGitCheck) {
    $gitOutput = & git -C $source rev-parse HEAD 2>&1
    if ($LASTEXITCODE -ne 0) {
      throw "Nao foi possivel validar o checkout Git."
    }
    if (([string]$gitOutput).Trim().ToLowerInvariant() -ne $expectedSha) {
      throw "Checkout local diverge do SHA alvo."
    }
  }
  return $manifest
}

function Assert-OriginMainSha {
  param(
    [Parameter(Mandatory = $true)][string]$SourceRoot,
    [Parameter(Mandatory = $true)][string]$TargetSha
  )

  $expected = Assert-CommitSha -Sha $TargetSha
  $output = @(& git -C $SourceRoot ls-remote --exit-code origin refs/heads/main 2>&1)
  if ($LASTEXITCODE -ne 0 -or $output.Count -eq 0) {
    throw "Nao foi possivel revalidar origin/main."
  }
  $actual = (([string]$output[0]) -split '\s+')[0].Trim().ToLowerInvariant()
  if ($actual -ne $expected) {
    throw "Candidato obsoleto: origin/main ja aponta para outro SHA."
  }
  return $actual
}

function Invoke-WithEnvironment {
  param(
    [Parameter(Mandatory = $true)][hashtable]$Values,
    [Parameter(Mandatory = $true)][scriptblock]$ScriptBlock
  )

  $previous = @{}
  foreach ($name in $Values.Keys) {
    $previous[$name] = [Environment]::GetEnvironmentVariable($name, "Process")
    [Environment]::SetEnvironmentVariable($name, [string]$Values[$name], "Process")
  }
  try {
    return & $ScriptBlock
  } finally {
    foreach ($name in $Values.Keys) {
      [Environment]::SetEnvironmentVariable($name, $previous[$name], "Process")
    }
  }
}

function Invoke-CheckedCommand {
  param(
    [Parameter(Mandatory = $true)][string]$FilePath,
    [string[]]$ArgumentList = @(),
    [Parameter(Mandatory = $true)][string]$WorkingDirectory,
    [string]$Description = $FilePath
  )

  Write-Host "Executando: $Description"
  Push-Location -LiteralPath $WorkingDirectory
  try {
    & $FilePath @ArgumentList
    if ($LASTEXITCODE -ne 0) {
      throw "$Description falhou com codigo $LASTEXITCODE."
    }
  } finally {
    Pop-Location
  }
}

function Invoke-CapturedCommand {
  param(
    [Parameter(Mandatory = $true)][string]$FilePath,
    [string[]]$ArgumentList = @(),
    [Parameter(Mandatory = $true)][string]$WorkingDirectory,
    [string]$Description = $FilePath
  )

  Push-Location -LiteralPath $WorkingDirectory
  try {
    $output = @(& $FilePath @ArgumentList 2>&1)
    if ($LASTEXITCODE -ne 0) {
      throw "$Description falhou."
    }
    return ($output -join [Environment]::NewLine)
  } finally {
    Pop-Location
  }
}

function Resolve-NativeTool {
  param([Parameter(Mandatory = $true)][string[]]$Candidates)

  foreach ($candidate in $Candidates) {
    $command = Get-Command $candidate -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($null -ne $command) {
      return $command.Source
    }
  }
  throw "Ferramenta obrigatoria nao encontrada: $($Candidates -join ', ')"
}

function Get-MigrationInspection {
  param(
    [Parameter(Mandatory = $true)][string]$SourceRoot,
    [Parameter(Mandatory = $true)][hashtable]$Environment,
    [Parameter(Mandatory = $true)][string]$TargetSha,
    [switch]$SkipDatabaseCheck
  )

  if ($SkipDatabaseCheck) {
    return [pscustomobject]@{
      status = "skipped"
      migrationRequired = $false
      pending = @()
      appliedCount = 0
    }
  }
  if (-not $Environment.ContainsKey("DATABASE_URL") -or
      [string]::IsNullOrWhiteSpace([string]$Environment["DATABASE_URL"])) {
    throw "DATABASE_URL ausente no arquivo de ambiente."
  }
  $helper = Join-Path $SourceRoot "scripts\deployment\migration-inventory.ps1"
  if (-not (Test-Path -LiteralPath $helper -PathType Leaf)) {
    throw "Helper de inventario de migrations nao encontrado."
  }
  $psqlPath = if ($Environment.ContainsKey("PSQL_PATH")) { [string]$Environment["PSQL_PATH"] } else { "" }
  $json = & $helper -SourceRoot $SourceRoot -TargetSha $TargetSha `
    -DatabaseUrl ([string]$Environment["DATABASE_URL"]) -PgSqlPath $psqlPath
  try {
    return ($json -join [Environment]::NewLine) | ConvertFrom-Json
  } catch {
    throw "Inventario de migrations retornou resposta invalida."
  }
}

function Enter-DeploymentLock {
  param(
    [Parameter(Mandatory = $true)][string]$ProductionRoot,
    [int]$TimeoutSeconds = 0
  )

  $stateDir = Join-Path $ProductionRoot "state"
  New-Item -ItemType Directory -Path $stateDir -Force | Out-Null
  $lockPath = Join-Path $stateDir "deployment.lock"
  $deadline = (Get-Date).AddSeconds([Math]::Max(0, $TimeoutSeconds))
  do {
    try {
      $stream = [IO.File]::Open($lockPath, [IO.FileMode]::OpenOrCreate, [IO.FileAccess]::ReadWrite, [IO.FileShare]::None)
      $stream.SetLength(0)
      $content = [Text.Encoding]::UTF8.GetBytes("pid=$PID`nacquiredAt=$(Get-UtcTimestamp)`n")
      $stream.Write($content, 0, $content.Length)
      $stream.Flush()
      return $stream
    } catch [IO.IOException] {
      if ((Get-Date) -ge $deadline) {
        throw "Outro deploy ja esta em execucao nesta maquina."
      }
      Start-Sleep -Milliseconds 250
    }
  } while ($true)
}

function Exit-DeploymentLock {
  param($Lock)

  if ($null -ne $Lock) {
    $Lock.Dispose()
  }
}

function Write-AtomicJson {
  param(
    [Parameter(Mandatory = $true)][string]$Path,
    [Parameter(Mandatory = $true)]$Value
  )

  $absolute = Resolve-AbsolutePath -Path $Path
  $directory = Split-Path -Parent $absolute
  New-Item -ItemType Directory -Path $directory -Force | Out-Null
  $temporary = Join-Path $directory (".$([IO.Path]::GetFileName($absolute)).$([Guid]::NewGuid().ToString('N')).partial")
  $backup = "$absolute.previous"
  $json = ($Value | ConvertTo-Json -Depth 20)
  [IO.File]::WriteAllText($temporary, "$json`n", (New-Object Text.UTF8Encoding($false)))
  try {
    if (Test-Path -LiteralPath $absolute -PathType Leaf) {
      [IO.File]::Replace($temporary, $absolute, $backup, $true)
      if (Test-Path -LiteralPath $backup) {
        Remove-Item -LiteralPath $backup -Force
      }
    } else {
      Move-Item -LiteralPath $temporary -Destination $absolute
    }
  } finally {
    if (Test-Path -LiteralPath $temporary) {
      Remove-Item -LiteralPath $temporary -Force
    }
  }
}

function Read-DeploymentState {
  param([Parameter(Mandatory = $true)][string]$ProductionRoot)

  $path = Join-Path $ProductionRoot "state\deployment.json"
  if (-not (Test-Path -LiteralPath $path -PathType Leaf)) {
    return $null
  }
  try {
    return Get-Content -LiteralPath $path -Raw | ConvertFrom-Json
  } catch {
    throw "deployment.json esta corrompido."
  }
}

function Write-DeploymentState {
  param(
    [Parameter(Mandatory = $true)][string]$ProductionRoot,
    [Parameter(Mandatory = $true)]$State
  )

  Write-AtomicJson -Path (Join-Path $ProductionRoot "state\deployment.json") -Value $State
}

function Write-GitHubOutputValue {
  param(
    [string]$OutputPath,
    [Parameter(Mandatory = $true)][string]$Name,
    [Parameter(Mandatory = $true)][string]$Value
  )

  if ([string]::IsNullOrWhiteSpace($OutputPath)) {
    return
  }
  if ($Name -notmatch '^[a-z_][a-z0-9_]*$' -or $Value -match "[`r`n]") {
    throw "Output de workflow invalido."
  }
  Add-Content -LiteralPath $OutputPath -Value "$Name=$Value" -Encoding UTF8
}

function Remove-ValidatedDirectory {
  param(
    [Parameter(Mandatory = $true)][string]$Path,
    [Parameter(Mandatory = $true)][string]$Root
  )

  $resolved = Assert-PathWithinRoot -Path $Path -Root $Root -Description "Diretorio a remover"
  if (-not (Test-Path -LiteralPath $resolved -PathType Container)) {
    return
  }
  $resolvedRoot = Resolve-AbsolutePath -Path $Root
  $cursor = $resolved
  while (-not $cursor.Equals($resolvedRoot, [StringComparison]::OrdinalIgnoreCase)) {
    $item = Get-Item -LiteralPath $cursor -Force
    if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
      throw "Remocao recusada: caminho contem reparse point."
    }
    $cursor = Split-Path -Parent $cursor
  }
  $nestedReparsePoints = @(Get-ChildItem -LiteralPath $resolved -Force -Recurse |
    Where-Object { ($_.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0 })
  if ($nestedReparsePoints.Count -gt 0) {
    throw "Remocao recusada: diretorio contem reparse point."
  }
  Remove-Item -LiteralPath $resolved -Recurse -Force
}

function Remove-OldReleases {
  param(
    [Parameter(Mandatory = $true)][string]$ProductionRoot,
    [string[]]$ProtectedShas = @(),
    [int]$Keep = 3
  )

  $releaseRoot = Join-Path $ProductionRoot "releases"
  if (-not (Test-Path -LiteralPath $releaseRoot -PathType Container)) {
    return
  }
  $protected = @{}
  foreach ($sha in $ProtectedShas) {
    if ($sha -match '^[a-fA-F0-9]{40}$') {
      $protected[$sha.ToLowerInvariant()] = $true
    }
  }
  $successful = @(Get-ChildItem -LiteralPath $releaseRoot -Directory |
    Where-Object {
      $_.Name -match '^[a-fA-F0-9]{40}$' -and
      (Test-Path -LiteralPath (Join-Path $_.FullName ".deployment-success.json") -PathType Leaf)
    } |
    Sort-Object LastWriteTimeUtc -Descending)
  $keepNames = @{}
  foreach ($release in @($successful | Select-Object -First ([Math]::Max(0, $Keep)))) {
    $keepNames[$release.Name.ToLowerInvariant()] = $true
  }
  foreach ($release in $successful) {
    $name = $release.Name.ToLowerInvariant()
    if (-not $keepNames.ContainsKey($name) -and -not $protected.ContainsKey($name)) {
      Remove-ValidatedDirectory -Path $release.FullName -Root $releaseRoot
    }
  }
}

function Get-DirectoryInventory {
  param([Parameter(Mandatory = $true)][string]$Directory)

  $root = Resolve-AbsolutePath -Path $Directory
  if (-not (Test-Path -LiteralPath $root -PathType Container)) {
    return @()
  }
  return @(Get-ChildItem -LiteralPath $root -File -Recurse | Sort-Object FullName | ForEach-Object {
    [pscustomobject]@{
      Path = $_.FullName.Substring($root.Length).TrimStart('\', '/').Replace('\', '/')
      SizeBytes = [int64]$_.Length
      Sha256 = Get-Sha256 -Path $_.FullName
    }
  })
}

function Copy-DirectoryValidated {
  param(
    [Parameter(Mandatory = $true)][string]$Source,
    [Parameter(Mandatory = $true)][string]$Destination
  )

  $sourceRoot = Resolve-AbsolutePath -Path $Source
  $destinationRoot = Resolve-AbsolutePath -Path $Destination
  if (-not (Test-Path -LiteralPath $sourceRoot -PathType Container)) {
    return [pscustomobject]@{ FileCount = 0; CopiedCount = 0; SourcePresent = $false }
  }
  New-Item -ItemType Directory -Path $destinationRoot -Force | Out-Null
  $sourceInventory = @(Get-DirectoryInventory -Directory $sourceRoot)
  $copied = 0
  foreach ($item in $sourceInventory) {
    $destinationFile = Join-Path $destinationRoot ($item.Path.Replace("/", [IO.Path]::DirectorySeparatorChar))
    Assert-PathWithinRoot -Path $destinationFile -Root $destinationRoot `
      -Description "Destino de arquivo compartilhado" | Out-Null
    $parent = Split-Path -Parent $destinationFile
    New-Item -ItemType Directory -Path $parent -Force | Out-Null
    if (Test-Path -LiteralPath $destinationFile -PathType Leaf) {
      if ((Get-Sha256 -Path $destinationFile) -ne $item.Sha256) {
        throw "Arquivo compartilhado existente diverge da origem: $($item.Path)"
      }
    } else {
      Copy-Item -LiteralPath (Join-Path $sourceRoot ($item.Path.Replace("/", [IO.Path]::DirectorySeparatorChar))) `
        -Destination $destinationFile
      $copied += 1
    }
  }
  $destinationInventory = @(Get-DirectoryInventory -Directory $destinationRoot)
  $destinationByPath = @{}
  foreach ($item in $destinationInventory) {
    $destinationByPath[$item.Path.ToLowerInvariant()] = $item
  }
  foreach ($item in $sourceInventory) {
    $key = $item.Path.ToLowerInvariant()
    if (-not $destinationByPath.ContainsKey($key) -or
        $destinationByPath[$key].Sha256 -ne $item.Sha256 -or
        $destinationByPath[$key].SizeBytes -ne $item.SizeBytes) {
      throw "Validacao da copia compartilhada falhou: $($item.Path)"
    }
  }
  return [pscustomobject]@{
    FileCount = $sourceInventory.Count
    CopiedCount = $copied
    SourcePresent = $true
  }
}

function Copy-BaselineRelease {
  param(
    [Parameter(Mandatory = $true)][string]$Source,
    [Parameter(Mandatory = $true)][string]$Destination
  )

  $sourceRoot = Resolve-AbsolutePath -Path $Source
  $destinationRoot = Resolve-AbsolutePath -Path $Destination
  if (-not (Test-Path -LiteralPath $sourceRoot -PathType Container)) {
    throw "Origem da baseline nao existe."
  }
  New-Item -ItemType Directory -Path $destinationRoot -Force | Out-Null
  $excludedDirectories = @(
    ".git", "node_modules", "uploads", "logs", "backups", "output", "_work", "_diag"
  )
  $excludedFiles = @(".runner", ".credentials", ".credentials_rsaparams")
  $queue = New-Object Collections.Generic.Queue[string]
  $queue.Enqueue($sourceRoot)
  $fileCount = 0
  $sizeBytes = [int64]0
  while ($queue.Count -gt 0) {
    $current = $queue.Dequeue()
    foreach ($entry in Get-ChildItem -LiteralPath $current -Force) {
      if ($entry.PSIsContainer -and $excludedDirectories -contains $entry.Name.ToLowerInvariant()) {
        continue
      }
      if (($entry.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
        throw "Baseline contem reparse point; importacao recusada."
      }
      $relative = $entry.FullName.Substring($sourceRoot.Length).TrimStart('\', '/')
      if ($entry.PSIsContainer) {
        $destinationDirectory = Join-Path $destinationRoot $relative
        Assert-PathWithinRoot -Path $destinationDirectory -Root $destinationRoot `
          -Description "Diretorio da baseline" | Out-Null
        New-Item -ItemType Directory -Path $destinationDirectory -Force | Out-Null
        $queue.Enqueue($entry.FullName)
        continue
      }
      if ($excludedFiles -contains $entry.Name.ToLowerInvariant()) {
        continue
      }
      if (($entry.Name -eq ".env" -or $entry.Name.StartsWith(".env.")) -and
          $entry.Name -ne ".env.example") {
        throw "Baseline contem arquivo de ambiente; importacao recusada."
      }
      $destinationFile = Join-Path $destinationRoot $relative
      Assert-PathWithinRoot -Path $destinationFile -Root $destinationRoot `
        -Description "Arquivo da baseline" | Out-Null
      New-Item -ItemType Directory -Path (Split-Path -Parent $destinationFile) -Force | Out-Null
      Copy-Item -LiteralPath $entry.FullName -Destination $destinationFile
      $fileCount += 1
      $sizeBytes += [int64]$entry.Length
    }
  }
  return [pscustomobject]@{ FileCount = $fileCount; SizeBytes = $sizeBytes }
}

function Test-ReleaseSuccessMarker {
  param(
    [Parameter(Mandatory = $true)][string]$ReleasePath,
    [Parameter(Mandatory = $true)][string]$ExpectedSha
  )

  $sha = Assert-CommitSha -Sha $ExpectedSha
  $markerPath = Join-Path $ReleasePath ".deployment-success.json"
  if (-not (Test-Path -LiteralPath $markerPath -PathType Leaf)) {
    return $false
  }
  try {
    $marker = Get-Content -LiteralPath $markerPath -Raw | ConvertFrom-Json
    return (([string]$marker.sha).ToLowerInvariant() -eq $sha -and
      [string]$marker.status -in @("passed", "baseline-imported"))
  } catch {
    return $false
  }
}

function Get-ReleaseShaFromBody {
  param($Body)

  foreach ($property in @("releaseSha", "sha", "appReleaseSha")) {
    if ($null -ne $Body -and $Body.PSObject.Properties.Name -contains $property) {
      return ([string]$Body.$property).ToLowerInvariant()
    }
  }
  return ""
}

function Invoke-JsonRequest {
  param(
    [Parameter(Mandatory = $true)][string]$Uri,
    [ValidateSet("GET", "POST", "OPTIONS")][string]$Method = "GET",
    [hashtable]$Headers = @{},
    [int]$TimeoutSeconds = 15,
    [int[]]$AllowedStatus = @(200)
  )

  try {
    $response = Invoke-WebRequest -Uri $Uri -Method $Method -Headers $Headers -UseBasicParsing `
      -TimeoutSec $TimeoutSeconds -MaximumRedirection 0
    $status = [int]$response.StatusCode
  } catch [Net.WebException] {
    if ($null -eq $_.Exception.Response) {
      throw "Falha de rede em healthcheck."
    }
    $response = $_.Exception.Response
    $status = [int]$response.StatusCode
  }
  if ($AllowedStatus -notcontains $status) {
    throw "Healthcheck retornou HTTP $status."
  }
  $body = $null
  if ($response.PSObject.Properties.Name -contains "Content" -and
      -not [string]::IsNullOrWhiteSpace([string]$response.Content)) {
    try {
      $body = ([string]$response.Content) | ConvertFrom-Json
    } catch {
      $body = $null
    }
  }
  return [pscustomobject]@{ Status = $status; Body = $body; Headers = $response.Headers }
}

function Invoke-ExpectedWebStatus {
  param(
    [Parameter(Mandatory = $true)][string]$Uri,
    [ValidateSet("GET", "POST", "OPTIONS")][string]$Method = "GET",
    [hashtable]$Headers = @{},
    [Microsoft.PowerShell.Commands.WebRequestSession]$WebSession,
    [int[]]$AllowedStatus = @(200)
  )

  $parameters = @{
    Uri = $Uri
    Method = $Method
    Headers = $Headers
    UseBasicParsing = $true
    TimeoutSec = 15
    MaximumRedirection = 0
  }
  if ($null -ne $WebSession) {
    $parameters["WebSession"] = $WebSession
  }
  try {
    $response = Invoke-WebRequest @parameters
    $status = [int]$response.StatusCode
  } catch [Net.WebException] {
    if ($null -eq $_.Exception.Response) {
      throw "Falha de rede no teste de sessao."
    }
    $response = $_.Exception.Response
    $status = [int]$response.StatusCode
  }
  if ($AllowedStatus -notcontains $status) {
    throw "Teste de sessao retornou HTTP $status."
  }
  return [pscustomobject]@{ Status = $status; Response = $response }
}

function Join-HealthUri {
  param(
    [Parameter(Mandatory = $true)][string]$BaseUrl,
    [Parameter(Mandatory = $true)][string]$Path
  )

  return $BaseUrl.TrimEnd("/") + "/" + $Path.TrimStart("/")
}

function Test-ApplicationEndpoints {
  param(
    [Parameter(Mandatory = $true)][string]$ApiBaseUrl,
    [Parameter(Mandatory = $true)][string]$WebBaseUrl,
    [Parameter(Mandatory = $true)][string]$ExpectedSha,
    [switch]$TestCorsAndCsrf
  )

  $sha = Assert-CommitSha -Sha $ExpectedSha
  $health = Invoke-JsonRequest -Uri (Join-HealthUri -BaseUrl $ApiBaseUrl -Path "health")
  $ready = Invoke-JsonRequest -Uri (Join-HealthUri -BaseUrl $ApiBaseUrl -Path "ready")
  $web = Invoke-JsonRequest -Uri (Join-HealthUri -BaseUrl $WebBaseUrl -Path "health")
  if ((Get-ReleaseShaFromBody -Body $health.Body) -ne $sha) {
    throw "API /health nao esta no SHA esperado."
  }
  if ((Get-ReleaseShaFromBody -Body $ready.Body) -ne $sha) {
    throw "API /ready nao esta no SHA esperado."
  }
  if ($null -eq $ready.Body -or
      ($ready.Body.PSObject.Properties.Name -contains "ready" -and -not [bool]$ready.Body.ready)) {
    throw "API nao esta pronta para trafego."
  }
  if ((Get-ReleaseShaFromBody -Body $web.Body) -ne $sha) {
    throw "Web /health nao esta no SHA esperado."
  }

  if ($TestCorsAndCsrf) {
    $origin = ([Uri]$WebBaseUrl).GetLeftPart([UriPartial]::Authority)
    $cors = Invoke-JsonRequest -Uri (Join-HealthUri -BaseUrl $ApiBaseUrl -Path "api/auth/csrf") `
      -Method "OPTIONS" -Headers @{
        Origin = $origin
        "Access-Control-Request-Method" = "GET"
      } -AllowedStatus @(200, 204)
    $allowedOrigin = [string]$cors.Headers["Access-Control-Allow-Origin"]
    if ($allowedOrigin -ne $origin) {
      throw "CORS nao autorizou exatamente a origem web esperada."
    }
    $session = New-Object Microsoft.PowerShell.Commands.WebRequestSession
    $csrfResponse = Invoke-ExpectedWebStatus `
      -Uri (Join-HealthUri -BaseUrl $ApiBaseUrl -Path "api/auth/csrf") `
      -Headers @{ Origin = $origin } -WebSession $session
    try {
      $csrfBody = ([string]$csrfResponse.Response.Content) | ConvertFrom-Json
      $csrfToken = [string]$csrfBody.csrfToken
    } catch {
      throw "Endpoint CSRF nao retornou token valido."
    }
    if ($csrfToken.Length -lt 32) {
      throw "Endpoint CSRF retornou token invalido."
    }
    Invoke-ExpectedWebStatus `
      -Uri (Join-HealthUri -BaseUrl $ApiBaseUrl -Path "api/auth/logout") `
      -Method "POST" -Headers @{ Origin = $origin; "x-csrf-token" = $csrfToken } `
      -WebSession $session -AllowedStatus @(401) | Out-Null
    Invoke-ExpectedWebStatus `
      -Uri (Join-HealthUri -BaseUrl $ApiBaseUrl -Path "api/auth/logout") `
      -Method "POST" -Headers @{
        Origin = "https://cross-site.invalid"
        "Sec-Fetch-Site" = "cross-site"
        "x-csrf-token" = $csrfToken
      } -WebSession $session -AllowedStatus @(403) | Out-Null
  }
  return [pscustomobject]@{
    ApiHealth = $health.Status
    ApiReady = $ready.Status
    WebHealth = $web.Status
    Sha = $sha
    CorsCsrf = [bool]$TestCorsAndCsrf
  }
}

function Assert-Pm2Online {
  param([string[]]$ProcessNames = @("bolao-api", "bolao-web"))

  $json = Invoke-CapturedCommand -FilePath "pm2" -ArgumentList @("jlist") `
    -WorkingDirectory (Get-Location).Path -Description "consulta PM2"
  try {
    $processes = @($json | ConvertFrom-Json)
  } catch {
    throw "PM2 retornou inventario invalido."
  }
  foreach ($name in $ProcessNames) {
    $process = @($processes | Where-Object { $_.name -eq $name }) | Select-Object -First 1
    if ($null -eq $process -or [string]$process.pm2_env.status -ne "online") {
      throw "Processo PM2 nao esta online: $name"
    }
  }
}

function Invoke-Pm2Command {
  param(
    [Parameter(Mandatory = $true)][string[]]$ArgumentList,
    [Parameter(Mandatory = $true)][string]$WorkingDirectory,
    [string]$Description = "PM2"
  )

  $pm2 = Resolve-NativeTool -Candidates @("pm2.cmd", "pm2")
  Invoke-CheckedCommand -FilePath $pm2 -ArgumentList $ArgumentList `
    -WorkingDirectory $WorkingDirectory -Description $Description
}

function Test-Pm2ProcessExists {
  param(
    [Parameter(Mandatory = $true)][string]$Name,
    [Parameter(Mandatory = $true)][string]$WorkingDirectory
  )

  $pm2 = Resolve-NativeTool -Candidates @("pm2.cmd", "pm2")
  Push-Location -LiteralPath $WorkingDirectory
  try {
    & $pm2 describe $Name *> $null
    return $LASTEXITCODE -eq 0
  } finally {
    Pop-Location
  }
}

function Wait-EndpointSha {
  param(
    [Parameter(Mandatory = $true)][string]$Uri,
    [Parameter(Mandatory = $true)][string]$ExpectedSha,
    [int]$TimeoutSeconds = 60,
    [switch]$RequireReady
  )

  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  $lastReason = "sem resposta"
  do {
    try {
      $response = Invoke-JsonRequest -Uri $Uri
      $actualSha = Get-ReleaseShaFromBody -Body $response.Body
      $isReady = -not $RequireReady -or
        ($null -ne $response.Body -and
          (-not ($response.Body.PSObject.Properties.Name -contains "ready") -or [bool]$response.Body.ready))
      if ($actualSha -eq (Assert-CommitSha -Sha $ExpectedSha) -and $isReady) {
        return $response
      }
      $lastReason = "SHA ou readiness divergente"
    } catch {
      $lastReason = "endpoint indisponivel"
    }
    Start-Sleep -Milliseconds 500
  } while ((Get-Date) -lt $deadline)
  throw "Healthcheck excedeu o tempo limite ($lastReason)."
}

function Start-ReleaseProcesses {
  param(
    [Parameter(Mandatory = $true)][string]$ReleasePath,
    [Parameter(Mandatory = $true)][string]$ReleaseSha,
    [Parameter(Mandatory = $true)][string]$ProductionRoot,
    [Parameter(Mandatory = $true)][string]$EnvironmentFile,
    [Parameter(Mandatory = $true)][string]$AvatarUploadDirectory,
    [Parameter(Mandatory = $true)][string]$ApiPublicUrl,
    [Parameter(Mandatory = $true)][string]$WebPublicUrl,
    [switch]$ApiOnly,
    [switch]$WebOnly
  )

  $ecosystem = Join-Path $ReleasePath "ecosystem.config.cjs"
  if (-not (Test-Path -LiteralPath $ecosystem -PathType Leaf)) {
    throw "ecosystem.config.cjs ausente na release."
  }
  $runtimeEnvironment = @{
    NODE_ENV = "production"
    DOTENV_CONFIG_PATH = $EnvironmentFile
    APP_RELEASE_SHA = (Assert-CommitSha -Sha $ReleaseSha)
    AVATAR_UPLOAD_DIR = $AvatarUploadDirectory
    PRODUCTION_API_URL = $ApiPublicUrl
    PRODUCTION_WEB_URL = $WebPublicUrl
    PRODUCTION_ROOT = $ProductionRoot
  }
  Invoke-WithEnvironment -Values $runtimeEnvironment -ScriptBlock {
    if (-not $WebOnly) {
      Invoke-Pm2Command -ArgumentList @("startOrReload", $ecosystem, "--only", "bolao-api", "--update-env") `
        -WorkingDirectory $ReleasePath -Description "ativacao da API no PM2"
    }
    if (-not $ApiOnly) {
      Invoke-Pm2Command -ArgumentList @("startOrReload", $ecosystem, "--only", "bolao-web", "--update-env") `
        -WorkingDirectory $ReleasePath -Description "ativacao do web no PM2"
    }
  }
}

function Invoke-ActivationWithRollback {
  param(
    [Parameter(Mandatory = $true)][scriptblock]$Activate,
    [Parameter(Mandatory = $true)][scriptblock]$Validate,
    [Parameter(Mandatory = $true)][scriptblock]$Rollback
  )

  try {
    & $Activate
    & $Validate
  } catch {
    $activationError = $_
    try {
      & $Rollback
    } catch {
      throw "Ativacao falhou e o rollback da aplicacao tambem falhou."
    }
    throw $activationError
  }
}

function Invoke-MigrationWithRecovery {
  param(
    [Parameter(Mandatory = $true)][scriptblock]$Prepare,
    [Parameter(Mandatory = $true)][scriptblock]$Migrate,
    [Parameter(Mandatory = $true)][scriptblock]$Verify,
    [Parameter(Mandatory = $true)][scriptblock]$Recover
  )

  try {
    & $Prepare
    & $Migrate
    & $Verify
  } catch {
    $migrationError = $_
    try {
      & $Recover
    } catch {
      throw "Operacao de migration falhou e a recuperacao da aplicacao anterior tambem falhou."
    }
    throw $migrationError
  }
}

Export-ModuleMember -Function *
