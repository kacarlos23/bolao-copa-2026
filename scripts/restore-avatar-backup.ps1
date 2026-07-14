param(
  [Parameter(Mandatory = $true)]
  [string]$ArchiveFile,
  [Parameter(Mandatory = $true)]
  [string]$DestinationDir,
  [string]$MetadataFile
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

& (Join-Path $PSScriptRoot "validate-avatar-backup.ps1") `
  -ArchiveFile $ArchiveFile -MetadataFile $MetadataFile

$destinationFullPath = [IO.Path]::GetFullPath($DestinationDir)
$destinationCreated = $false
if (Test-Path -LiteralPath $destinationFullPath) {
  $existing = @(Get-ChildItem -LiteralPath $destinationFullPath -Force)
  if ($existing.Count -gt 0) {
    throw "O destino dos avatares deve estar vazio ou nao existir: $destinationFullPath"
  }
} else {
  New-Item -ItemType Directory -Force -Path $destinationFullPath | Out-Null
  $destinationCreated = $true
}

try {
  Add-Type -AssemblyName System.IO.Compression.FileSystem
  [IO.Compression.ZipFile]::ExtractToDirectory([IO.Path]::GetFullPath($ArchiveFile), $destinationFullPath)

  if ([string]::IsNullOrWhiteSpace($MetadataFile)) {
    $MetadataFile = "$ArchiveFile.metadata.json"
  }
  $metadata = Get-Content -LiteralPath $MetadataFile -Raw | ConvertFrom-Json
  $restoredFiles = @(Get-ChildItem -LiteralPath $destinationFullPath -File -Recurse)
  if ($restoredFiles.Count -ne [int]$metadata.fileCount) {
    throw "A quantidade de avatares restaurados diverge do manifesto."
  }

  foreach ($file in @($metadata.files)) {
    $relativePath = ([string]$file.path).Replace('/', [IO.Path]::DirectorySeparatorChar)
    $target = Join-Path $destinationFullPath $relativePath
    if (-not (Test-Path -LiteralPath $target -PathType Leaf)) {
      throw "Avatar nao restaurado: $($file.path)"
    }
    $checksum = (Get-FileHash -LiteralPath $target -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($checksum -ne [string]$file.sha256) {
      throw "Checksum divergente apos restaurar o avatar: $($file.path)"
    }
  }
} catch {
  if ($destinationCreated -and (Test-Path -LiteralPath $destinationFullPath)) {
    Remove-Item -LiteralPath $destinationFullPath -Recurse -Force
  }
  throw
}

Write-Output "Avatares restaurados e verificados em: $destinationFullPath"
