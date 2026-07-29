param(
  [string]$PgBin = "",
  [string]$DataDir = ".\.postgres-data"
)

$ErrorActionPreference = "Stop"
$Root = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
. (Join-Path $PSScriptRoot "postgres-common.ps1")

$dataPath = if ([IO.Path]::IsPathRooted($DataDir)) { $DataDir } else { Join-Path $Root $DataDir }
if (-not (Test-Path -LiteralPath $dataPath)) {
  throw "Cluster do projeto nao encontrado em $dataPath."
}
$resolvedDataDir = (Resolve-Path -LiteralPath $dataPath).Path
$resolvedPgBin = Resolve-ProjectPgBin -ConfiguredPath $PgBin -DataDir $resolvedDataDir

& (Join-Path $resolvedPgBin "pg_ctl.exe") -D $resolvedDataDir stop -m fast

if ($LASTEXITCODE -ne 0) {
  throw "Falha ao parar PostgreSQL do projeto: codigo $LASTEXITCODE."
}
