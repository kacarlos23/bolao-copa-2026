param(
  [string]$ApiBaseUrl = "http://127.0.0.1:3001",
  [string]$WebBaseUrl = "http://127.0.0.1:8080",
  [string]$ExpectedSha
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

function Get-JsonEndpoint {
  param([Parameter(Mandatory = $true)][string]$Uri)

  $response = Invoke-WebRequest -Uri $Uri -UseBasicParsing -TimeoutSec 10
  if ($response.StatusCode -ne 200) {
    throw "Healthcheck falhou em $Uri com HTTP $($response.StatusCode)."
  }
  try {
    return $response.Content | ConvertFrom-Json
  } catch {
    throw "Healthcheck em $Uri nao retornou JSON valido."
  }
}

$apiHealth = Get-JsonEndpoint -Uri ($ApiBaseUrl.TrimEnd("/") + "/health")
$apiReady = Get-JsonEndpoint -Uri ($ApiBaseUrl.TrimEnd("/") + "/ready")
$webHealth = Get-JsonEndpoint -Uri ($WebBaseUrl.TrimEnd("/") + "/health")

if ([string]$apiHealth.status -ne "ok" -or
    [string]$apiReady.status -ne "ready" -or
    [string]$webHealth.status -ne "ok") {
  throw "Aplicacao respondeu, mas nao esta saudavel e pronta."
}

if (-not [string]::IsNullOrWhiteSpace($ExpectedSha)) {
  $normalizedSha = $ExpectedSha.Trim().ToLowerInvariant()
  if ($normalizedSha -notmatch "^[a-f0-9]{40}$") {
    throw "ExpectedSha deve ser um SHA Git completo."
  }
  foreach ($actual in @($apiHealth.releaseSha, $apiReady.releaseSha, $webHealth.releaseSha)) {
    if ([string]$actual -ne $normalizedSha) {
      throw "Um endpoint nao corresponde ao SHA esperado."
    }
  }
}

Write-Output "Healthcheck OK: API viva/pronta e web ativa."
