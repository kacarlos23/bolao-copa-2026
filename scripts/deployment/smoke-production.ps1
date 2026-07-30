[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [string]$ExpectedSha,
  [Parameter(Mandatory = $true)]
  [string]$ApiUrl,
  [Parameter(Mandatory = $true)]
  [string]$WebUrl,
  [string]$LocalApiUrl = "http://127.0.0.1:3001",
  [string]$LocalWebUrl = "http://127.0.0.1:8080",
  [switch]$SkipPublic,
  [switch]$SkipPm2,
  [switch]$SkipSecurityChecks
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest
Import-Module (Join-Path $PSScriptRoot "ProductionDeploy.Common.psm1") -Force

$sha = Assert-CommitSha -Sha $ExpectedSha
$publicUrls = Assert-ProductionUrls -ApiUrl $ApiUrl -WebUrl $WebUrl
$local = Test-ApplicationEndpoints -ApiBaseUrl $LocalApiUrl -WebBaseUrl $LocalWebUrl -ExpectedSha $sha

$public = $null
if (-not $SkipPublic) {
  $public = Test-ApplicationEndpoints -ApiBaseUrl $publicUrls.Api -WebBaseUrl $publicUrls.Web `
    -ExpectedSha $sha -TestCorsAndCsrf:(-not $SkipSecurityChecks)
}
if (-not $SkipPm2) {
  Assert-Pm2Online
}

[ordered]@{
  checkedAtUtc = Get-UtcTimestamp
  sha = $sha
  local = $local
  public = $public
  pm2 = if ($SkipPm2) { "skipped" } else { "online" }
} | ConvertTo-Json -Depth 8
