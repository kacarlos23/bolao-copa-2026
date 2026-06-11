param(
  [Parameter(Mandatory = $true)]
  [string]$BackupFile,
  [string]$DatabaseUrl = $env:BACKUP_DATABASE_URL,
  [string]$PgRestorePath = $env:PG_RESTORE_PATH
)

$ErrorActionPreference = "Stop"

if (-not (Test-Path -LiteralPath $BackupFile)) {
  throw "Arquivo de backup nao encontrado: $BackupFile"
}

if ([string]::IsNullOrWhiteSpace($DatabaseUrl)) {
  throw "BACKUP_DATABASE_URL nao configurado."
}

if ([string]::IsNullOrWhiteSpace($PgRestorePath)) {
  $PgRestorePath = "pg_restore"
}

& $PgRestorePath --clean --if-exists --no-owner --dbname=$DatabaseUrl $BackupFile

if ($LASTEXITCODE -ne 0) {
  throw "pg_restore falhou com codigo $LASTEXITCODE."
}

Write-Output "Restore concluido: $BackupFile"
