param(
  [string]$PgBin = "C:\Program Files\PostgreSQL\18\bin",
  [string]$DataDir = ".\.postgres-data",
  [string]$LogFile = ".\logs\postgres-project.log"
)

$ErrorActionPreference = "Stop"

if (-not (Test-Path -LiteralPath $DataDir)) {
  throw "Cluster do projeto nao encontrado em $DataDir."
}

New-Item -ItemType Directory -Force -Path (Split-Path $LogFile) | Out-Null

& "$PgBin\pg_ctl.exe" -D $DataDir -l $LogFile start

if ($LASTEXITCODE -ne 0) {
  throw "Falha ao iniciar PostgreSQL do projeto: codigo $LASTEXITCODE."
}

& "$PgBin\pg_isready.exe" -h localhost -p 5433
