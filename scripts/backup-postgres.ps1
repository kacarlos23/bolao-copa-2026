param(
  [string]$DatabaseUrl = $env:BACKUP_DATABASE_URL,
  [string]$BackupDir = $env:BACKUP_DIR,
  [string]$PgDumpPath = $env:PG_DUMP_PATH,
  [string]$PgRestorePath = $env:PG_RESTORE_PATH
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest
. (Join-Path $PSScriptRoot "postgres-common.ps1")

if ([string]::IsNullOrWhiteSpace($DatabaseUrl)) {
  throw "BACKUP_DATABASE_URL nao configurado."
}

if ([string]::IsNullOrWhiteSpace($BackupDir)) {
  $BackupDir = Join-Path (Get-Location) "backups"
}

New-Item -ItemType Directory -Force -Path $BackupDir | Out-Null

$connection = Get-PgConnection -DatabaseUrl $DatabaseUrl
$pgDump = Resolve-PgExecutable -ConfiguredPath $PgDumpPath -ToolName "pg_dump"
$pgRestore = Resolve-PgExecutable -ConfiguredPath $PgRestorePath -ToolName "pg_restore"
$timestamp = (Get-Date).ToUniversalTime().ToString("yyyyMMdd-HHmmssfffZ")
$target = Join-Path $BackupDir "bolao-world-cup-2026-$timestamp.dump"
$partialTarget = "$target.partial"
$metadataFile = "$target.metadata.json"
$connectionArguments = Get-PgConnectionArguments -Connection $connection
$targetCreated = $false

try {
  Invoke-PgCommand -Executable $pgDump -Connection $connection -Arguments (@(
    "--format=custom",
    "--compress=9",
    "--no-owner",
    "--no-privileges",
    "--file", $partialTarget
  ) + $connectionArguments) -FailureMessage "pg_dump falhou."

  if (-not (Test-Path -LiteralPath $partialTarget) -or (Get-Item -LiteralPath $partialTarget).Length -eq 0) {
    throw "pg_dump nao produziu um arquivo valido."
  }

  Invoke-PgCommand -Executable $pgRestore -Arguments @("--list", $partialTarget) `
    -FailureMessage "A leitura do catalogo do backup falhou." -SuppressOutput

  Move-Item -LiteralPath $partialTarget -Destination $target
  $targetCreated = $true

  $backupInfo = Get-Item -LiteralPath $target
  $checksum = (Get-FileHash -LiteralPath $target -Algorithm SHA256).Hash.ToLowerInvariant()
  $metadata = [ordered]@{
    formatVersion = 1
    scope = "world-cup-2026"
    createdAtUtc = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ss.fffZ")
    fileName = $backupInfo.Name
    sizeBytes = $backupInfo.Length
    sha256 = $checksum
    pgDumpFormat = "custom"
  }
  $metadata | ConvertTo-Json | Set-Content -LiteralPath $metadataFile -Encoding UTF8

  & (Join-Path $PSScriptRoot "validate-postgres-backup.ps1") `
    -BackupFile $target -MetadataFile $metadataFile -PgRestorePath $pgRestore
} catch {
  if (Test-Path -LiteralPath $partialTarget) {
    Remove-Item -LiteralPath $partialTarget -Force
  }
  if ($targetCreated -and (Test-Path -LiteralPath $target)) {
    Remove-Item -LiteralPath $target -Force
  }
  if ($targetCreated -and (Test-Path -LiteralPath $metadataFile)) {
    Remove-Item -LiteralPath $metadataFile -Force
  }
  throw
}

Write-Output "Backup completo criado: $target"
Write-Output "Manifesto: $metadataFile"
