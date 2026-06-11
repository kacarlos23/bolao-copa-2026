param(
  [string]$PgBin = "C:\Program Files\PostgreSQL\18\bin",
  [string]$DataDir = ".\.postgres-data"
)

$ErrorActionPreference = "Stop"

if (-not (Test-Path -LiteralPath $DataDir)) {
  throw "Cluster do projeto nao encontrado em $DataDir."
}

& "$PgBin\pg_ctl.exe" -D $DataDir stop -m fast

if ($LASTEXITCODE -ne 0) {
  throw "Falha ao parar PostgreSQL do projeto: codigo $LASTEXITCODE."
}
