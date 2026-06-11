param(
  [string]$DatabaseUrl = $env:BACKUP_DATABASE_URL,
  [string]$BackupDir = $env:BACKUP_DIR,
  [string]$PgDumpPath = $env:PG_DUMP_PATH
)

$ErrorActionPreference = "Stop"

if ([string]::IsNullOrWhiteSpace($DatabaseUrl)) {
  throw "BACKUP_DATABASE_URL nao configurado."
}

if ([string]::IsNullOrWhiteSpace($BackupDir)) {
  $BackupDir = Join-Path (Get-Location) "backups"
}

if ([string]::IsNullOrWhiteSpace($PgDumpPath)) {
  $PgDumpPath = "pg_dump"
}

New-Item -ItemType Directory -Force -Path $BackupDir | Out-Null

$timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
$target = Join-Path $BackupDir "bolao-$timestamp.dump"

& $PgDumpPath --format=custom --file=$target $DatabaseUrl

if ($LASTEXITCODE -ne 0) {
  throw "pg_dump falhou com codigo $LASTEXITCODE."
}

Write-Output "Backup criado: $target"
