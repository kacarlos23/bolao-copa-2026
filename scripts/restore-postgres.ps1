param(
  [Parameter(Mandatory = $true)]
  [string]$BackupFile,
  [string]$MaintenanceDatabaseUrl = $env:RESTORE_MAINTENANCE_DATABASE_URL,
  [string]$TempDatabaseName = "bolao_restore_verify_$((Get-Date).ToUniversalTime().ToString('yyyyMMdd_HHmmss'))",
  [string]$ExpectedSnapshot,
  [string]$VerificationSnapshotFile,
  [string]$AvatarArchive,
  [string]$AvatarVerificationDir,
  [switch]$KeepTemporaryDatabase,
  [switch]$KeepAvatarVerificationDir,
  [string]$PgRestorePath = $env:PG_RESTORE_PATH,
  [string]$CreatedbPath = $env:CREATEDB_PATH,
  [string]$DropdbPath = $env:DROPDB_PATH
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest
. (Join-Path $PSScriptRoot "postgres-common.ps1")

if (-not (Test-Path -LiteralPath $BackupFile)) {
  throw "Arquivo de backup nao encontrado: $BackupFile"
}

if ([string]::IsNullOrWhiteSpace($MaintenanceDatabaseUrl)) {
  throw "RESTORE_MAINTENANCE_DATABASE_URL nao configurado."
}

if ($TempDatabaseName -notmatch '^bolao_restore_verify_[a-zA-Z0-9_]+$' -or $TempDatabaseName.Length -gt 63) {
  throw "O banco temporario deve comecar com bolao_restore_verify_, conter apenas letras, numeros ou _ e ter no maximo 63 caracteres."
}

if (-not [string]::IsNullOrWhiteSpace($ExpectedSnapshot) -and -not (Test-Path -LiteralPath $ExpectedSnapshot)) {
  throw "Snapshot esperado nao encontrado: $ExpectedSnapshot"
}

if ([string]::IsNullOrWhiteSpace($VerificationSnapshotFile)) {
  $VerificationSnapshotFile = "$BackupFile.restore-snapshot.json"
}

$backupMetadataFile = "$BackupFile.metadata.json"
if ([string]::IsNullOrWhiteSpace($AvatarArchive) -and (Test-Path -LiteralPath $backupMetadataFile)) {
  $backupMetadata = Get-Content -LiteralPath $backupMetadataFile -Raw | ConvertFrom-Json
  if ($backupMetadata.PSObject.Properties.Name -contains "avatars") {
    $AvatarArchive = Join-Path (Split-Path $BackupFile -Parent) ([string]$backupMetadata.avatars.archiveFileName)
  }
}
if ([string]::IsNullOrWhiteSpace($AvatarVerificationDir)) {
  $AvatarVerificationDir = "$BackupFile.restore-avatars"
}

$connection = Get-PgConnection -DatabaseUrl $MaintenanceDatabaseUrl
if ($connection.Database -eq $TempDatabaseName) {
  throw "O banco de manutencao nao pode ser o proprio banco temporario."
}

$pgRestore = Resolve-PgExecutable -ConfiguredPath $PgRestorePath -ToolName "pg_restore"
$createdb = Resolve-PgExecutable -ConfiguredPath $CreatedbPath -ToolName "createdb"
$dropdb = Resolve-PgExecutable -ConfiguredPath $DropdbPath -ToolName "dropdb"
$databaseCreated = $false
$avatarDirectoryCreated = $false

& (Join-Path $PSScriptRoot "validate-postgres-backup.ps1") `
  -BackupFile $BackupFile -PgRestorePath $pgRestore

try {
  Invoke-PgCommand -Executable $createdb -Connection $connection -Arguments @(
    "--host", $connection.Host,
    "--port", [string]$connection.Port,
    "--username", $connection.Username,
    "--maintenance-db", $connection.Database,
    $TempDatabaseName
  ) -FailureMessage "Nao foi possivel criar o banco temporario."
  $databaseCreated = $true

  $restoreConnectionArguments = Get-PgConnectionArguments -Connection $connection -DatabaseName $TempDatabaseName
  Invoke-PgCommand -Executable $pgRestore -Connection $connection -Arguments (@(
    "--exit-on-error",
    "--no-owner",
    "--no-privileges"
  ) + $restoreConnectionArguments + @($BackupFile)) -FailureMessage "pg_restore falhou no banco temporario."

  $previousSnapshotUrl = [Environment]::GetEnvironmentVariable("SNAPSHOT_DATABASE_URL", "Process")
  try {
    [Environment]::SetEnvironmentVariable(
      "SNAPSHOT_DATABASE_URL",
      (New-PgDatabaseUrl -DatabaseUrl $MaintenanceDatabaseUrl -DatabaseName $TempDatabaseName),
      "Process"
    )
    & node (Join-Path $PSScriptRoot "copa-snapshot.mjs") --output $VerificationSnapshotFile
    if ($LASTEXITCODE -ne 0) {
      throw "O snapshot de verificacao do banco restaurado falhou."
    }
  } finally {
    [Environment]::SetEnvironmentVariable("SNAPSHOT_DATABASE_URL", $previousSnapshotUrl, "Process")
  }

  if (-not [string]::IsNullOrWhiteSpace($ExpectedSnapshot)) {
    & node (Join-Path $PSScriptRoot "compare-copa-snapshots.mjs") $ExpectedSnapshot $VerificationSnapshotFile
    if ($LASTEXITCODE -ne 0) {
      throw "O snapshot restaurado diverge do snapshot esperado."
    }
  }

  if (-not [string]::IsNullOrWhiteSpace($AvatarArchive)) {
    & (Join-Path $PSScriptRoot "restore-avatar-backup.ps1") `
      -ArchiveFile $AvatarArchive -DestinationDir $AvatarVerificationDir
    $avatarDirectoryCreated = $true
  }

  Write-Output "Restore verificado no banco temporario: $TempDatabaseName"
  Write-Output "Snapshot restaurado: $VerificationSnapshotFile"
  if ($avatarDirectoryCreated) {
    Write-Output "Restore de avatares verificado: $AvatarVerificationDir"
  }
} finally {
  if ($databaseCreated -and -not $KeepTemporaryDatabase) {
    Invoke-PgCommand -Executable $dropdb -Connection $connection -Arguments @(
      "--host", $connection.Host,
      "--port", [string]$connection.Port,
      "--username", $connection.Username,
      "--maintenance-db", $connection.Database,
      "--force",
      $TempDatabaseName
    ) -FailureMessage "Falha ao remover o banco temporario. Remova-o manualmente antes de repetir."
    Write-Output "Banco temporario removido: $TempDatabaseName"
  } elseif ($databaseCreated) {
    Write-Warning "Banco temporario preservado por solicitacao do operador: $TempDatabaseName"
  }
  if ($avatarDirectoryCreated -and -not $KeepAvatarVerificationDir) {
    $resolvedAvatarVerificationDir = [IO.Path]::GetFullPath($AvatarVerificationDir)
    $resolvedBackupParent = [IO.Path]::GetFullPath((Split-Path $BackupFile -Parent))
    $backupParentPrefix = $resolvedBackupParent.TrimEnd('\', '/') + [IO.Path]::DirectorySeparatorChar
    if (-not $resolvedAvatarVerificationDir.StartsWith($backupParentPrefix, [StringComparison]::OrdinalIgnoreCase)) {
      throw "Diretorio de verificacao de avatares fora do diretorio de backup; remova-o manualmente: $resolvedAvatarVerificationDir"
    }
    Remove-Item -LiteralPath $resolvedAvatarVerificationDir -Recurse -Force
    Write-Output "Diretorio temporario de avatares removido: $resolvedAvatarVerificationDir"
  } elseif ($avatarDirectoryCreated) {
    Write-Warning "Diretorio de verificacao de avatares preservado: $AvatarVerificationDir"
  }
}
