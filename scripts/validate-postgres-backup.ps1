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
} else {
  Write-Warning "Manifesto nao encontrado; catalogo e checksum foram calculados, mas nao comparados."
}

Write-Output "Backup valido: $($backupInfo.FullName)"
Write-Output "Tamanho (bytes): $($backupInfo.Length)"
Write-Output "SHA-256: $checksum"
