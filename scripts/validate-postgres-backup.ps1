param(
  [Parameter(Mandatory = $true)]
  [string]$BackupFile,
  [string]$MetadataFile,
  [string]$PgRestorePath = $env:PG_RESTORE_PATH
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest
. (Join-Path $PSScriptRoot "postgres-common.ps1")

if (-not (Test-Path -LiteralPath $BackupFile -PathType Leaf)) {
  throw "Arquivo de backup nao encontrado: $BackupFile"
}

$backupInfo = Get-Item -LiteralPath $BackupFile
if ($backupInfo.Length -eq 0) {
  throw "O arquivo de backup esta vazio: $BackupFile"
}

if ([string]::IsNullOrWhiteSpace($MetadataFile)) {
  $MetadataFile = "$BackupFile.metadata.json"
}

$pgRestore = Resolve-PgExecutable -ConfiguredPath $PgRestorePath -ToolName "pg_restore"
Invoke-PgCommand -Executable $pgRestore -Arguments @("--list", $backupInfo.FullName) `
  -FailureMessage "O catalogo do backup nao pode ser lido." -SuppressOutput

$checksum = (Get-FileHash -LiteralPath $backupInfo.FullName -Algorithm SHA256).Hash.ToLowerInvariant()

if (Test-Path -LiteralPath $MetadataFile -PathType Leaf) {
  $metadata = Get-Content -LiteralPath $MetadataFile -Raw | ConvertFrom-Json
  if ($metadata.fileName -ne $backupInfo.Name) {
    throw "O nome do arquivo diverge do manifesto."
  }
  if ([int64]$metadata.sizeBytes -ne $backupInfo.Length) {
    throw "O tamanho do arquivo diverge do manifesto."
  }
  if ([string]$metadata.sha256 -ne $checksum) {
    throw "O checksum SHA-256 diverge do manifesto."
  }

  if ($metadata.PSObject.Properties.Name -contains "globals") {
    $globalsFile = Join-Path $backupInfo.DirectoryName ([string]$metadata.globals.fileName)
    if (-not (Test-Path -LiteralPath $globalsFile -PathType Leaf)) {
      throw "Inventario de objetos globais nao encontrado: $globalsFile"
    }
    $globalsInfo = Get-Item -LiteralPath $globalsFile
    $globalsChecksum = (Get-FileHash -LiteralPath $globalsFile -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($globalsInfo.Length -ne [int64]$metadata.globals.sizeBytes -or $globalsChecksum -ne [string]$metadata.globals.sha256) {
      throw "O inventario de objetos globais diverge do manifesto."
    }
  }

  if ($metadata.PSObject.Properties.Name -contains "avatars") {
    $avatarArchive = Join-Path $backupInfo.DirectoryName ([string]$metadata.avatars.archiveFileName)
    $avatarMetadata = Join-Path $backupInfo.DirectoryName ([string]$metadata.avatars.metadataFileName)
    & (Join-Path $PSScriptRoot "validate-avatar-backup.ps1") `
      -ArchiveFile $avatarArchive -MetadataFile $avatarMetadata
  }
} else {
  Write-Warning "Manifesto nao encontrado; catalogo e checksum foram calculados, mas nao comparados."
}

Write-Output "Backup valido: $($backupInfo.FullName)"
Write-Output "Tamanho (bytes): $($backupInfo.Length)"
Write-Output "SHA-256: $checksum"
