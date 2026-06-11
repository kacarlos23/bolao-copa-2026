param(
  [string]$ApiUrl = "http://localhost:3001/health",
  [string]$WebUrl = "http://localhost:8080"
)

$ErrorActionPreference = "Stop"

$api = Invoke-WebRequest -Uri $ApiUrl -UseBasicParsing -TimeoutSec 10
if ($api.StatusCode -ne 200) {
  throw "API healthcheck falhou: $($api.StatusCode)"
}

$web = Invoke-WebRequest -Uri $WebUrl -UseBasicParsing -TimeoutSec 10
if ($web.StatusCode -lt 200 -or $web.StatusCode -gt 399) {
  throw "Web healthcheck falhou: $($web.StatusCode)"
}

Write-Output "Healthcheck OK"
