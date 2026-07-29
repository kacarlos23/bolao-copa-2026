param(
  [string]$PgBin = "",
  [string]$DataDir = ".\.postgres-data",
  [string]$LogFile = ".\logs\postgres-project.log"
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
$pgPort = Get-ProjectPgPort -DataDir $resolvedDataDir
$resolvedLogFile = if ([IO.Path]::IsPathRooted($LogFile)) { $LogFile } else { Join-Path $Root $LogFile }

New-Item -ItemType Directory -Force -Path (Split-Path $resolvedLogFile) | Out-Null

& (Join-Path $resolvedPgBin "pg_ctl.exe") -D $resolvedDataDir -l $resolvedLogFile start

if ($LASTEXITCODE -ne 0) {
  throw "Falha ao iniciar PostgreSQL do projeto: codigo $LASTEXITCODE."
}

& (Join-Path $resolvedPgBin "pg_isready.exe") -h localhost -p $pgPort
