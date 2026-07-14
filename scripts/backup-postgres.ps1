param(
  [string]$DatabaseUrl = $env:BACKUP_DATABASE_URL,
  [string]$BackupDir = $env:BACKUP_DIR,
  [string]$AvatarDir = $env:BACKUP_AVATAR_DIR,
  [string]$PgDumpPath = $env:PG_DUMP_PATH,
  [string]$PgRestorePath = $env:PG_RESTORE_PATH,
  [string]$PgDumpAllPath = $env:PG_DUMPALL_PATH
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
$pgDumpAll = Resolve-PgExecutable -ConfiguredPath $PgDumpAllPath -ToolName "pg_dumpall"
$timestamp = (Get-Date).ToUniversalTime().ToString("yyyyMMdd-HHmmssfffZ")
$target = Join-Path $BackupDir "bolao-world-cup-2026-$timestamp.dump"
$partialTarget = "$target.partial"
$metadataFile = "$target.metadata.json"
$backupBase = [IO.Path]::GetFileNameWithoutExtension($target)
$globalsFile = Join-Path $BackupDir "$backupBase.globals.sql"
$partialGlobalsFile = "$globalsFile.partial"
$avatarArchive = Join-Path $BackupDir "$backupBase.avatars.zip"
$avatarMetadataFile = "$avatarArchive.metadata.json"
$connectionArguments = Get-PgConnectionArguments -Connection $connection
$targetCreated = $false
$globalsCreated = $false
$avatarsCreated = $false

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

  Invoke-PgCommand -Executable $pgDumpAll -Connection $connection -Arguments @(
    "--globals-only",
    "--no-role-passwords",
    "--host", $connection.Host,
    "--port", [string]$connection.Port,
    "--username", $connection.Username,
    "--file", $partialGlobalsFile
  ) -FailureMessage "pg_dumpall falhou ao exportar os objetos globais."
  if (-not (Test-Path -LiteralPath $partialGlobalsFile) -or (Get-Item -LiteralPath $partialGlobalsFile).Length -eq 0) {
    throw "pg_dumpall nao produziu o inventario de objetos globais."
  }
  Move-Item -LiteralPath $partialGlobalsFile -Destination $globalsFile
  $globalsCreated = $true

  & (Join-Path $PSScriptRoot "backup-avatars.ps1") `
    -ArchiveFile $avatarArchive -AvatarDir $AvatarDir
  $avatarsCreated = $true

  $backupInfo = Get-Item -LiteralPath $target
  $globalsInfo = Get-Item -LiteralPath $globalsFile
  $avatarInfo = Get-Item -LiteralPath $avatarArchive
  $avatarMetadata = Get-Content -LiteralPath $avatarMetadataFile -Raw | ConvertFrom-Json
  $checksum = (Get-FileHash -LiteralPath $target -Algorithm SHA256).Hash.ToLowerInvariant()
  $metadata = [ordered]@{
    formatVersion = 1
    scope = "world-cup-2026"
    createdAtUtc = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ss.fffZ")
    fileName = $backupInfo.Name
    sizeBytes = $backupInfo.Length
    sha256 = $checksum
    pgDumpFormat = "custom"
    globals = [ordered]@{
      fileName = $globalsInfo.Name
      sizeBytes = $globalsInfo.Length
      sha256 = (Get-FileHash -LiteralPath $globalsFile -Algorithm SHA256).Hash.ToLowerInvariant()
      includesRolePasswords = $false
    }
    avatars = [ordered]@{
      archiveFileName = $avatarInfo.Name
      metadataFileName = (Split-Path $avatarMetadataFile -Leaf)
      sizeBytes = $avatarInfo.Length
      sha256 = [string]$avatarMetadata.sha256
      fileCount = [int]$avatarMetadata.fileCount
    }
  }
  $metadata | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $metadataFile -Encoding UTF8

  & (Join-Path $PSScriptRoot "validate-postgres-backup.ps1") `
    -BackupFile $target -MetadataFile $metadataFile -PgRestorePath $pgRestore
} catch {
  if (Test-Path -LiteralPath $partialTarget) {
    Remove-Item -LiteralPath $partialTarget -Force
  }
  if (Test-Path -LiteralPath $partialGlobalsFile) {
    Remove-Item -LiteralPath $partialGlobalsFile -Force
  }
  if ($targetCreated -and (Test-Path -LiteralPath $target)) {
    Remove-Item -LiteralPath $target -Force
  }
  if ($targetCreated -and (Test-Path -LiteralPath $metadataFile)) {
    Remove-Item -LiteralPath $metadataFile -Force
  }
  if ($globalsCreated -and (Test-Path -LiteralPath $globalsFile)) {
    Remove-Item -LiteralPath $globalsFile -Force
  }
  if ($avatarsCreated -and (Test-Path -LiteralPath $avatarArchive)) {
    Remove-Item -LiteralPath $avatarArchive -Force
  }
  if ($avatarsCreated -and (Test-Path -LiteralPath $avatarMetadataFile)) {
    Remove-Item -LiteralPath $avatarMetadataFile -Force
  }
  throw
}

Write-Output "Backup completo criado: $target"
Write-Output "Manifesto: $metadataFile"
Write-Output "Objetos globais sem senhas: $globalsFile"
Write-Output "Avatares: $avatarArchive"
