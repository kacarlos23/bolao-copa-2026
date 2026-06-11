param(
  [string]$PgBin = "C:\Program Files\PostgreSQL\18\bin",
  [string]$DataDir = ".\.postgres-data"
)

$ErrorActionPreference = "Stop"

if (-not (Test-Path -LiteralPath $DataDir)) {
  throw "Cluster do projeto nao encontrado em $DataDir."
}

& "$PgBin\pg_ctl.exe" -D $DataDir status
& "$PgBin\pg_isready.exe" -h localhost -p 5433
