[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [string]$ProductionRoot,
  [string]$EnvironmentFile,
  [string]$LegacyAvatarDirectory,
  [string]$RunnerRoot,
  [string]$ServiceAccount,
  [string]$BaselineReleasePath,
  [string]$BaselineSha,
  [switch]$RegisterBaseline,
  [switch]$SkipPm2Check,
  [switch]$ApplyAcl
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest
Import-Module (Join-Path $PSScriptRoot "ProductionDeploy.Common.psm1") -Force

$production = Assert-SafeProductionRoot -ProductionRoot $ProductionRoot
if ([string]::IsNullOrWhiteSpace($EnvironmentFile)) {
  $EnvironmentFile = Join-Path $production "config\production.env"
}
$environmentPath = Resolve-AbsolutePath -Path $EnvironmentFile
Assert-PathWithinRoot -Path $environmentPath -Root (Join-Path $production "config") `
  -Description "Arquivo de ambiente" | Out-Null

$directories = @(
  $production,
  (Join-Path $production "config"),
  (Join-Path $production "releases"),
  (Join-Path $production "shared\uploads\avatars"),
  (Join-Path $production "backups"),
  (Join-Path $production "logs"),
  (Join-Path $production "state")
)
foreach ($directory in $directories) {
  New-Item -ItemType Directory -Path $directory -Force | Out-Null
}
if (-not [string]::IsNullOrWhiteSpace($RunnerRoot)) {
  New-Item -ItemType Directory -Path (Resolve-AbsolutePath -Path $RunnerRoot) -Force | Out-Null
}

$bootstrapStatePath = Join-Path $production "state\bootstrap.json"
$firstBootstrap = -not (Test-Path -LiteralPath $bootstrapStatePath -PathType Leaf)
$environmentCreated = $false
if (-not (Test-Path -LiteralPath $environmentPath -PathType Leaf)) {
  $template = @"
# Preencha os segredos localmente. Nunca envie este arquivo ao GitHub.
NODE_ENV=production
PORT=3001
DATABASE_URL=
SESSION_SECRET=
INTERNAL_EVENTS_SECRET=
WEB_ORIGIN=
WEB_ORIGINS=
SESSION_COOKIE_SECURE=true
AUTO_DEPLOY_ENABLED=false
PRODUCTION_API_URL=
PRODUCTION_WEB_URL=
APP_RELEASE_SHA=bootstrap
AVATAR_UPLOAD_DIR=$((Join-Path $production "shared\uploads\avatars").Replace('\', '/'))
"@
  [IO.File]::WriteAllText($environmentPath, $template, (New-Object Text.UTF8Encoding($false)))
  $environmentCreated = $true
}
if ($firstBootstrap) {
  $maintenanceLock = Join-Path $production "state\auto-deploy.disabled"
  [IO.File]::WriteAllText(
    $maintenanceLock,
    "Bootstrap incompleto. Remova este arquivo somente depois do dry-run e do ensaio de rollback.`n",
    (New-Object Text.UTF8Encoding($false))
  )
}

$avatarResult = [pscustomobject]@{ FileCount = 0; CopiedCount = 0; SourcePresent = $false }
if (-not [string]::IsNullOrWhiteSpace($LegacyAvatarDirectory)) {
  $avatarResult = Copy-DirectoryValidated -Source $LegacyAvatarDirectory `
    -Destination (Join-Path $production "shared\uploads\avatars")
}

$baselineRegistered = $false
if ($RegisterBaseline) {
  if ([string]::IsNullOrWhiteSpace($BaselineReleasePath) -or
      [string]::IsNullOrWhiteSpace($BaselineSha)) {
    throw "BaselineReleasePath e BaselineSha sao obrigatorios para registrar o rollback inicial."
  }
  $baseline = Assert-CommitSha -Sha $BaselineSha
  $baselineSource = Resolve-AbsolutePath -Path $BaselineReleasePath
  if (-not (Test-Path -LiteralPath (Join-Path $baselineSource "ecosystem.config.cjs") -PathType Leaf) -or
      -not (Test-Path -LiteralPath (Join-Path $baselineSource "apps\api\dist\src\server.js") -PathType Leaf) -or
      -not (Test-Path -LiteralPath (Join-Path $baselineSource "apps\web\dist") -PathType Container)) {
    throw "Release baseline nao contem os artefatos obrigatorios."
  }
  $releaseRoot = Join-Path $production "releases"
  $baselineTarget = Join-Path $releaseRoot $baseline
  if (-not $baselineSource.Equals($baselineTarget, [StringComparison]::OrdinalIgnoreCase) -and
      ((Test-PathWithinRoot -Path $baselineSource -Root $production -AllowRoot) -or
       (Test-PathWithinRoot -Path $production -Root $baselineSource -AllowRoot))) {
    throw "A origem da baseline nao pode conter nem estar contida na raiz de producao."
  }
  $baselineInventory = [pscustomobject]@{ FileCount = 0; SizeBytes = 0 }
  if (-not $baselineSource.Equals($baselineTarget, [StringComparison]::OrdinalIgnoreCase)) {
    if (Test-Path -LiteralPath $baselineTarget) {
      throw "Destino da baseline ja existe; nao sera sobrescrito."
    }
    $baselinePartial = "$baselineTarget.partial"
    if (Test-Path -LiteralPath $baselinePartial) {
      Remove-ValidatedDirectory -Path $baselinePartial -Root $releaseRoot
    }
    New-Item -ItemType Directory -Path $baselinePartial | Out-Null
    try {
      $baselineInventory = Copy-BaselineRelease -Source $baselineSource -Destination $baselinePartial
      $npm = Resolve-NativeTool -Candidates @("npm.cmd", "npm")
      Invoke-CheckedCommand -FilePath $npm -ArgumentList @("ci") `
        -WorkingDirectory $baselinePartial -Description "dependencias da baseline"
      Invoke-CheckedCommand -FilePath $npm -ArgumentList @("run", "prisma:generate") `
        -WorkingDirectory $baselinePartial -Description "Prisma generate da baseline"
      Move-Item -LiteralPath $baselinePartial -Destination $baselineTarget
    } catch {
      if (Test-Path -LiteralPath $baselinePartial) {
        Remove-ValidatedDirectory -Path $baselinePartial -Root $releaseRoot
      }
      throw
    }
  } else {
    $baselineFiles = @(Get-ChildItem -LiteralPath $baselineTarget -File -Recurse -Force)
    $baselineInventory = [pscustomobject]@{
      FileCount = $baselineFiles.Count
      SizeBytes = [int64](($baselineFiles | Measure-Object -Property Length -Sum).Sum)
    }
  }
  if (-not $SkipPm2Check) {
    Assert-Pm2Online
    Test-ApplicationEndpoints -ApiBaseUrl "http://127.0.0.1:3001" `
      -WebBaseUrl "http://127.0.0.1:8080" -ExpectedSha $baseline | Out-Null
  }
  Write-AtomicJson -Path (Join-Path $baselineTarget ".deployment-success.json") -Value ([ordered]@{
    formatVersion = 1
    sha = $baseline
    status = "baseline-imported"
    registeredAtUtc = Get-UtcTimestamp
    inventory = [ordered]@{
      fileCount = [int]$baselineInventory.FileCount
      sizeBytes = [int64]$baselineInventory.SizeBytes
    }
  })
  Write-DeploymentState -ProductionRoot $production -State ([ordered]@{
    formatVersion = 1
    status = "baseline-registered"
    activeSha = $baseline
    previousSha = $null
    startedAtUtc = Get-UtcTimestamp
    finishedAtUtc = Get-UtcTimestamp
    baseline = $true
  })
  $baselineRegistered = $true
}

if ($ApplyAcl) {
  if ($env:OS -ne "Windows_NT") {
    throw "Aplicacao de ACL esta disponivel somente no Windows."
  }
  if ([string]::IsNullOrWhiteSpace($ServiceAccount)) {
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
    $ServiceAccount = $identity.Name
  }
  $icacls = Resolve-NativeTool -Candidates @("icacls.exe", "icacls")
  & $icacls $environmentPath "/inheritance:r" "/grant:r" `
    "${ServiceAccount}:(M)" "SYSTEM:(F)" "BUILTIN\Administrators:(F)" | Out-Null
  if ($LASTEXITCODE -ne 0) {
    throw "Nao foi possivel proteger production.env com ACL."
  }
  foreach ($protectedDirectory in @(
      (Join-Path $production "config"),
      (Join-Path $production "backups"),
      (Join-Path $production "state"),
      (Join-Path $production "shared"),
      (Join-Path $production "logs"),
      (Join-Path $production "releases")
    )) {
    & $icacls $protectedDirectory "/inheritance:r" "/grant:r" `
      "${ServiceAccount}:(OI)(CI)(M)" "SYSTEM:(OI)(CI)(F)" `
      "BUILTIN\Administrators:(OI)(CI)(F)" | Out-Null
    if ($LASTEXITCODE -ne 0) {
      throw "Nao foi possivel proteger um diretorio persistente com ACL."
    }
  }
}

$result = [ordered]@{
  formatVersion = 1
  status = if ($environmentCreated) { "requires-configuration" } else { "ready-for-dry-run" }
  bootstrappedAtUtc = Get-UtcTimestamp
  environmentCreated = $environmentCreated
  environmentAclApplied = [bool]$ApplyAcl
  autoDeployMaintenanceLock = Test-Path -LiteralPath (Join-Path $production "state\auto-deploy.disabled")
  avatars = [ordered]@{
    sourcePresent = [bool]$avatarResult.SourcePresent
    fileCount = [int]$avatarResult.FileCount
    copiedCount = [int]$avatarResult.CopiedCount
    sourceRetained = $true
  }
  baselineRegistered = $baselineRegistered
}
Write-AtomicJson -Path $bootstrapStatePath -Value $result
$result | ConvertTo-Json -Depth 8
