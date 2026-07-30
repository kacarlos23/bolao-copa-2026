[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [string]$TargetSha,
  [Parameter(Mandatory = $true)]
  [string]$ManifestPath,
  [string]$SourceRoot = (Split-Path (Split-Path $PSScriptRoot -Parent) -Parent),
  [Parameter(Mandatory = $true)]
  [string]$ProductionRoot,
  [Parameter(Mandatory = $true)]
  [string]$EnvironmentFile,
  [string]$GithubOutput = $env:GITHUB_OUTPUT,
  [switch]$SkipDatabaseCheck
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest
Import-Module (Join-Path $PSScriptRoot "ProductionDeploy.Common.psm1") -Force

$target = Assert-CommitSha -Sha $TargetSha
$source = Resolve-AbsolutePath -Path $SourceRoot
$production = Assert-SafeProductionRoot -ProductionRoot $ProductionRoot
$environmentPath = Resolve-AbsolutePath -Path $EnvironmentFile

if (-not (Test-Path -LiteralPath $production -PathType Container)) {
  throw "Estrutura de producao ainda nao foi inicializada."
}
Assert-PathWithinRoot -Path $environmentPath -Root (Join-Path $production "config") `
  -Description "Arquivo de ambiente" | Out-Null
$environment = Get-DotEnvValues -EnvironmentFile $environmentPath
$autoDeploy = Get-AutoDeployStatus -ProductionRoot $production -Environment $environment

Test-ReleaseManifest -ManifestPath $ManifestPath -TargetSha $target -SourceRoot $source | Out-Null

$releasePath = Join-Path $production "releases\$target"
$releaseExists = Test-Path -LiteralPath $releasePath -PathType Container
if ($autoDeploy.Enabled -or $SkipDatabaseCheck) {
  $migration = Get-MigrationInspection -SourceRoot $source -Environment $environment -TargetSha $target `
    -SkipDatabaseCheck:$SkipDatabaseCheck
} else {
  $migration = [pscustomobject]@{
    status = "kill-switch"
    migrationRequired = $false
    pending = @()
    appliedCount = 0
    targetCount = 0
  }
}

$inspection = [ordered]@{
  formatVersion = 1
  inspectedAtUtc = Get-UtcTimestamp
  targetSha = $target
  autoDeployEnabled = [bool]$autoDeploy.Enabled
  maintenanceLocked = [bool]$autoDeploy.MaintenanceLocked
  releaseExists = [bool]$releaseExists
  migrations = [ordered]@{
    status = [string]$migration.status
    required = [bool]$migration.migrationRequired
    pending = @($migration.pending)
    appliedCount = [int]$migration.appliedCount
    targetCount = if ($migration.PSObject.Properties.Name -contains "targetCount") {
      [int]$migration.targetCount
    } else {
      0
    }
  }
}
$inspectionPath = Join-Path $production "state\inspection-$target.json"
Write-AtomicJson -Path $inspectionPath -Value $inspection

Write-GitHubOutputValue -OutputPath $GithubOutput -Name "target_sha" -Value $target
Write-GitHubOutputValue -OutputPath $GithubOutput -Name "migration_required" `
  -Value ([bool]$migration.migrationRequired).ToString().ToLowerInvariant()
Write-GitHubOutputValue -OutputPath $GithubOutput -Name "auto_deploy_enabled" `
  -Value ([bool]$autoDeploy.Enabled).ToString().ToLowerInvariant()
Write-GitHubOutputValue -OutputPath $GithubOutput -Name "release_exists" `
  -Value ([bool]$releaseExists).ToString().ToLowerInvariant()
Write-GitHubOutputValue -OutputPath $GithubOutput -Name "inspection_json" -Value $inspectionPath

$inspection | ConvertTo-Json -Depth 8
