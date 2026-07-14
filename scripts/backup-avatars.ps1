param(
  [Parameter(Mandatory = $true)]
  [string]$ArchiveFile,
  [string]$AvatarDir = $env:BACKUP_AVATAR_DIR
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

if ([string]::IsNullOrWhiteSpace($AvatarDir)) {
  $repositoryRoot = Split-Path $PSScriptRoot -Parent
  $AvatarDir = Join-Path $repositoryRoot "apps\api\uploads\avatars"
}

$archiveFullPath = [IO.Path]::GetFullPath($ArchiveFile)
$archiveDirectory = Split-Path $archiveFullPath -Parent
$partialArchive = "$archiveFullPath.partial"
$metadataFile = "$archiveFullPath.metadata.json"
$archiveCreated = $false

New-Item -ItemType Directory -Force -Path $archiveDirectory | Out-Null
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem

$files = @()
if (Test-Path -LiteralPath $AvatarDir -PathType Container) {
  $avatarRoot = [IO.Path]::GetFullPath($AvatarDir).TrimEnd('\', '/')
  $files = @(Get-ChildItem -LiteralPath $avatarRoot -File -Recurse | Sort-Object FullName)
} else {
  $avatarRoot = [IO.Path]::GetFullPath($AvatarDir).TrimEnd('\', '/')
}

try {
  if (Test-Path -LiteralPath $partialArchive) {
    Remove-Item -LiteralPath $partialArchive -Force
  }

  $archive = [IO.Compression.ZipFile]::Open($partialArchive, [IO.Compression.ZipArchiveMode]::Create)
  try {
    $fileEntries = @()
    foreach ($file in $files) {
      $relativePath = $file.FullName.Substring($avatarRoot.Length).TrimStart('\', '/').Replace('\', '/')
      [IO.Compression.ZipFileExtensions]::CreateEntryFromFile(
        $archive,
        $file.FullName,
        $relativePath,
        [IO.Compression.CompressionLevel]::Optimal
      ) | Out-Null
      $fileEntries += [ordered]@{
        path = $relativePath
        sizeBytes = $file.Length
        sha256 = (Get-FileHash -LiteralPath $file.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
      }
    }
  } finally {
    $archive.Dispose()
  }

  Move-Item -LiteralPath $partialArchive -Destination $archiveFullPath
  $archiveCreated = $true
  $archiveInfo = Get-Item -LiteralPath $archiveFullPath
  $metadata = [ordered]@{
    formatVersion = 1
    scope = "world-cup-2026-avatars"
    createdAtUtc = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ss.fffZ")
    archiveFileName = $archiveInfo.Name
    sizeBytes = $archiveInfo.Length
    sha256 = (Get-FileHash -LiteralPath $archiveFullPath -Algorithm SHA256).Hash.ToLowerInvariant()
    fileCount = $fileEntries.Count
    files = $fileEntries
  }
  $metadata | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $metadataFile -Encoding UTF8

  & (Join-Path $PSScriptRoot "validate-avatar-backup.ps1") `
    -ArchiveFile $archiveFullPath -MetadataFile $metadataFile
} catch {
  if (Test-Path -LiteralPath $partialArchive) {
    Remove-Item -LiteralPath $partialArchive -Force
  }
  if ($archiveCreated -and (Test-Path -LiteralPath $archiveFullPath)) {
    Remove-Item -LiteralPath $archiveFullPath -Force
  }
  if ($archiveCreated -and (Test-Path -LiteralPath $metadataFile)) {
    Remove-Item -LiteralPath $metadataFile -Force
  }
  throw
}

Write-Output "Backup de avatares criado: $archiveFullPath"
Write-Output "Manifesto de avatares: $metadataFile"
