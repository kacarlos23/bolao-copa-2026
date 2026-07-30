[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [string]$ProductionRoot,
  [Parameter(Mandatory = $true)]
  [string]$EnvironmentFile,
  [Parameter(Mandatory = $true)]
  [string]$ApiUrl,
  [Parameter(Mandatory = $true)]
  [string]$WebUrl,
  [string]$TargetSha,
  [switch]$SkipPublicSmoke,
  [switch]$DryRun
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest
Import-Module (Join-Path $PSScriptRoot "ProductionDeploy.Common.psm1") -Force

$production = Assert-SafeProductionRoot -ProductionRoot $ProductionRoot
$environmentPath = Resolve-AbsolutePath -Path $EnvironmentFile
Assert-PathWithinRoot -Path $environmentPath -Root (Join-Path $production "config") `
  -Description "Arquivo de ambiente" | Out-Null
Get-DotEnvValues -EnvironmentFile $environmentPath | Out-Null
$urls = Assert-ProductionUrls -ApiUrl $ApiUrl -WebUrl $WebUrl -AllowHttp:$DryRun

$lock = $null
try {
  $lock = Enter-DeploymentLock -ProductionRoot $production
  $state = Read-DeploymentState -ProductionRoot $production
  if ($null -eq $state) {
    throw "Nao existe estado de deployment para orientar rollback."
  }
  $activeSha = if ($state.PSObject.Properties.Name -contains "activeSha" -and
      -not [string]::IsNullOrWhiteSpace([string]$state.activeSha)) {
    Assert-CommitSha -Sha ([string]$state.activeSha)
  } else {
    ""
  }
  if ([string]::IsNullOrWhiteSpace($TargetSha)) {
    if (-not ($state.PSObject.Properties.Name -contains "previousSha") -or
        [string]::IsNullOrWhiteSpace([string]$state.previousSha)) {
      throw "Estado nao registra uma release anterior."
    }
    $target = Assert-CommitSha -Sha ([string]$state.previousSha)
  } else {
    $target = Assert-CommitSha -Sha $TargetSha
  }
  $releasePath = Join-Path $production "releases\$target"
  Assert-PathWithinRoot -Path $releasePath -Root (Join-Path $production "releases") `
    -Description "Release de rollback" | Out-Null
  if (-not (Test-Path -LiteralPath (Join-Path $releasePath "ecosystem.config.cjs") -PathType Leaf)) {
    throw "Release de rollback nao existe ou esta incompleta."
  }
  $successMarkerPath = Join-Path $releasePath ".deployment-success.json"
  if (-not (Test-Path -LiteralPath $successMarkerPath -PathType Leaf)) {
    throw "Release de rollback nao possui marker de sucesso."
  }
  $successMarker = Get-Content -LiteralPath $successMarkerPath -Raw | ConvertFrom-Json
  if (([string]$successMarker.sha).ToLowerInvariant() -ne $target -or
      [string]$successMarker.status -notin @("passed", "baseline-imported")) {
    throw "Marker da release de rollback e invalido."
  }

  if ($DryRun) {
    [ordered]@{
      status = "dry-run"
      activeSha = $activeSha
      rollbackTargetSha = $target
      checkedAtUtc = Get-UtcTimestamp
    } | ConvertTo-Json
    return
  }

  $startedAt = Get-UtcTimestamp
  try {
    Start-ReleaseProcesses -ReleasePath $releasePath -ReleaseSha $target `
      -ProductionRoot $production `
      -EnvironmentFile $environmentPath `
      -AvatarUploadDirectory (Join-Path $production "shared\uploads\avatars") `
      -ApiPublicUrl $urls.Api -WebPublicUrl $urls.Web -ApiOnly
    Wait-EndpointSha -Uri "http://127.0.0.1:3001/ready" -ExpectedSha $target -RequireReady | Out-Null
    Start-ReleaseProcesses -ReleasePath $releasePath -ReleaseSha $target `
      -ProductionRoot $production `
      -EnvironmentFile $environmentPath `
      -AvatarUploadDirectory (Join-Path $production "shared\uploads\avatars") `
      -ApiPublicUrl $urls.Api -WebPublicUrl $urls.Web -WebOnly
    Test-ApplicationEndpoints -ApiBaseUrl "http://127.0.0.1:3001" `
      -WebBaseUrl "http://127.0.0.1:8080" -ExpectedSha $target | Out-Null
    if (-not $SkipPublicSmoke) {
      Test-ApplicationEndpoints -ApiBaseUrl $urls.Api -WebBaseUrl $urls.Web `
        -ExpectedSha $target -TestCorsAndCsrf | Out-Null
    }
    Assert-Pm2Online
    Invoke-Pm2Command -ArgumentList @("save") -WorkingDirectory $releasePath `
      -Description "persistencia do PM2"
  } catch {
    $rollbackError = $_
    $originalRestored = $false
    if (-not [string]::IsNullOrWhiteSpace($activeSha) -and $activeSha -ne $target) {
      $originalRelease = Join-Path $production "releases\$activeSha"
      try {
        Start-ReleaseProcesses -ReleasePath $originalRelease -ReleaseSha $activeSha `
          -ProductionRoot $production -EnvironmentFile $environmentPath `
          -AvatarUploadDirectory (Join-Path $production "shared\uploads\avatars") `
          -ApiPublicUrl $urls.Api -WebPublicUrl $urls.Web -ApiOnly
        Wait-EndpointSha -Uri "http://127.0.0.1:3001/ready" -ExpectedSha $activeSha -RequireReady | Out-Null
        Start-ReleaseProcesses -ReleasePath $originalRelease -ReleaseSha $activeSha `
          -ProductionRoot $production -EnvironmentFile $environmentPath `
          -AvatarUploadDirectory (Join-Path $production "shared\uploads\avatars") `
          -ApiPublicUrl $urls.Api -WebPublicUrl $urls.Web -WebOnly
        Test-ApplicationEndpoints -ApiBaseUrl "http://127.0.0.1:3001" `
          -WebBaseUrl "http://127.0.0.1:8080" -ExpectedSha $activeSha | Out-Null
        if (-not $SkipPublicSmoke) {
          Test-ApplicationEndpoints -ApiBaseUrl $urls.Api -WebBaseUrl $urls.Web `
            -ExpectedSha $activeSha -TestCorsAndCsrf | Out-Null
        }
        Invoke-Pm2Command -ArgumentList @("save") -WorkingDirectory $originalRelease `
          -Description "persistencia da recuperacao do rollback"
        $originalRestored = $true
      } catch {
        $originalRestored = $false
      }
    }
    Write-DeploymentState -ProductionRoot $production -State ([ordered]@{
      formatVersion = 1
      status = "rollback-failed"
      activeSha = $activeSha
      previousSha = $target
      startedAtUtc = $startedAt
      finishedAtUtc = Get-UtcTimestamp
      failure = [ordered]@{
        stage = "application-rollback"
        sanitized = $true
        originalReleaseRestored = $originalRestored
      }
    })
    throw $rollbackError
  }

  $result = [ordered]@{
    formatVersion = 1
    status = "rolled-back"
    activeSha = $target
    previousSha = $activeSha
    startedAtUtc = $startedAt
    finishedAtUtc = Get-UtcTimestamp
    databaseRollback = $false
    health = [ordered]@{ local = "passed"; public = if ($SkipPublicSmoke) { "skipped" } else { "passed" } }
  }
  Write-DeploymentState -ProductionRoot $production -State $result
  $result | ConvertTo-Json -Depth 8
} finally {
  Exit-DeploymentLock -Lock $lock
}
