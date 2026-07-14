param(
  [Parameter(Mandatory = $true)]
  [string]$ArchiveFile,
  [string]$MetadataFile
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

if (-not (Test-Path -LiteralPath $ArchiveFile -PathType Leaf)) {
  throw "Arquivo de avatares nao encontrado: $ArchiveFile"
}
if ([string]::IsNullOrWhiteSpace($MetadataFile)) {
  $MetadataFile = "$ArchiveFile.metadata.json"
}
if (-not (Test-Path -LiteralPath $MetadataFile -PathType Leaf)) {
  throw "Manifesto de avatares nao encontrado: $MetadataFile"
}

Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem

$archiveInfo = Get-Item -LiteralPath $ArchiveFile
$metadata = Get-Content -LiteralPath $MetadataFile -Raw | ConvertFrom-Json
$checksum = (Get-FileHash -LiteralPath $ArchiveFile -Algorithm SHA256).Hash.ToLowerInvariant()
if ($metadata.archiveFileName -ne $archiveInfo.Name) {
  throw "O nome do arquivo de avatares diverge do manifesto."
}
if ([int64]$metadata.sizeBytes -ne $archiveInfo.Length) {
  throw "O tamanho do arquivo de avatares diverge do manifesto."
}
if ([string]$metadata.sha256 -ne $checksum) {
  throw "O checksum do arquivo de avatares diverge do manifesto."
}

$expected = @{}
foreach ($file in @($metadata.files)) {
  $expected[[string]$file.path] = $file
}

$zip = [IO.Compression.ZipFile]::OpenRead($archiveInfo.FullName)
try {
  if ($zip.Entries.Count -ne [int]$metadata.fileCount) {
    throw "A quantidade de avatares diverge do manifesto."
  }

  foreach ($entry in $zip.Entries) {
    $entryPath = $entry.FullName.Replace('\', '/')
    $segments = $entryPath -split '/'
    if ([IO.Path]::IsPathRooted($entryPath) -or $segments -contains "..") {
      throw "Caminho inseguro no arquivo de avatares: $entryPath"
    }
    if (-not $expected.ContainsKey($entryPath)) {
      throw "Avatar nao registrado no manifesto: $entryPath"
    }

    $stream = $entry.Open()
    $sha = [Security.Cryptography.SHA256]::Create()
    try {
      $entryHash = ([BitConverter]::ToString($sha.ComputeHash($stream))).Replace("-", "").ToLowerInvariant()
    } finally {
      $sha.Dispose()
      $stream.Dispose()
    }

    $manifestEntry = $expected[$entryPath]
    if ([int64]$manifestEntry.sizeBytes -ne $entry.Length) {
      throw "Tamanho divergente para o avatar: $entryPath"
    }
    if ([string]$manifestEntry.sha256 -ne $entryHash) {
      throw "Checksum divergente para o avatar: $entryPath"
    }
  }
} finally {
  $zip.Dispose()
}

Write-Output "Backup de avatares valido: $($archiveInfo.FullName)"
Write-Output "Avatares: $($metadata.fileCount)"
Write-Output "SHA-256: $checksum"
