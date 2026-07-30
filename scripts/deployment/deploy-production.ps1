[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [string]$TargetSha,
  [Parameter(Mandatory = $true)]
  [string]$ManifestPath,
  [string]$SourceRoot = (Split-Path (Split-Path $PSScriptRoot -Parent) -Parent),
  [Parameter(Mandatory = $true)]
  [string]$ProductionRoot,
  [Parameter(Mandatory = $true)]
  [string]$EnvironmentFile,
  [Parameter(Mandatory = $true)]
  [string]$ApiUrl,
  [Parameter(Mandatory = $true)]
  [string]$WebUrl,
  [switch]$AllowMigration,
  [switch]$DryRun,
  [switch]$SkipPublicSmoke
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest
Import-Module (Join-Path $PSScriptRoot "ProductionDeploy.Common.psm1") -Force

function Test-ReleaseBuild {
  param([Parameter(Mandatory = $true)][string]$ReleasePath)

  foreach ($required in @(
      "ecosystem.config.cjs",
      "package-lock.json",
      "apps\api\dist\src\server.js",
      "apps\web\dist\index.html",
      "apps\web\scripts\serve-dist.mjs"
    )) {
    if (-not (Test-Path -LiteralPath (Join-Path $ReleasePath $required) -PathType Leaf)) {
      throw "Build de producao incompleto: $required"
    }
  }
}

function Assert-WebBundleApiUrl {
  param(
    [Parameter(Mandatory = $true)][string]$ReleasePath,
    [Parameter(Mandatory = $true)][string]$ExpectedApiUrl
  )

  $dist = Join-Path $ReleasePath "apps\web\dist"
  $matched = $false
  foreach ($file in @(Get-ChildItem -LiteralPath $dist -File -Recurse |
      Where-Object { $_.Extension -in @(".js", ".html", ".json") })) {
    $content = [IO.File]::ReadAllText($file.FullName)
    if ($content.Contains($ExpectedApiUrl)) {
      $matched = $true
    }
    if ($ExpectedApiUrl -notmatch 'localhost|127\.0\.0\.1' -and
        $content -match 'https?://(localhost|127\.0\.0\.1):3001') {
      throw "Bundle web contem URL local da API."
    }
  }
  if (-not $matched) {
    throw "Bundle web nao contem EXPO_PUBLIC_API_URL esperada."
  }
}

function Assert-AutoDeployStillEnabled {
  $currentEnvironment = Get-DotEnvValues -EnvironmentFile $script:environmentPath
  $currentStatus = Get-AutoDeployStatus -ProductionRoot $script:production `
    -Environment $currentEnvironment
  if (-not $currentStatus.Enabled) {
    throw "Auto deploy foi bloqueado durante a execucao."
  }
}

function Resume-ExtraWriters {
  param(
    [string[]]$StoppedNames,
    [Parameter(Mandatory = $true)][string]$WorkingDirectory
  )

  foreach ($name in @($StoppedNames | Where-Object { $_ -ne "bolao-api" })) {
    Invoke-Pm2Command -ArgumentList @("restart", $name) `
      -WorkingDirectory $WorkingDirectory -Description "retomada do writer $name"
  }
}

function Start-PreviousRelease {
  param(
    [Parameter(Mandatory = $true)][string]$ReleasePath,
    [Parameter(Mandatory = $true)][string]$Sha,
    [Parameter(Mandatory = $true)][string[]]$StoppedNames
  )

  Start-ReleaseProcesses -ReleasePath $ReleasePath -ReleaseSha $Sha `
    -ProductionRoot $script:production `
    -EnvironmentFile $script:environmentPath `
    -AvatarUploadDirectory (Join-Path $script:production "shared\uploads\avatars") `
    -ApiPublicUrl $script:urls.Api -WebPublicUrl $script:urls.Web -ApiOnly
  Wait-EndpointSha -Uri "http://127.0.0.1:3001/ready" -ExpectedSha $Sha -RequireReady | Out-Null
  Start-ReleaseProcesses -ReleasePath $ReleasePath -ReleaseSha $Sha `
    -ProductionRoot $script:production `
    -EnvironmentFile $script:environmentPath `
    -AvatarUploadDirectory (Join-Path $script:production "shared\uploads\avatars") `
    -ApiPublicUrl $script:urls.Api -WebPublicUrl $script:urls.Web -WebOnly
  Test-ApplicationEndpoints -ApiBaseUrl "http://127.0.0.1:3001" `
    -WebBaseUrl "http://127.0.0.1:8080" -ExpectedSha $Sha | Out-Null
  if (-not $script:SkipPublicSmoke) {
    Wait-EndpointSha -Uri (Join-HealthUri -BaseUrl $script:urls.Api -Path "ready") `
      -ExpectedSha $Sha -RequireReady | Out-Null
    Wait-EndpointSha -Uri (Join-HealthUri -BaseUrl $script:urls.Web -Path "health") `
      -ExpectedSha $Sha | Out-Null
    Test-ApplicationEndpoints -ApiBaseUrl $script:urls.Api -WebBaseUrl $script:urls.Web `
      -ExpectedSha $Sha -TestCorsAndCsrf | Out-Null
  }
  Resume-ExtraWriters -StoppedNames $StoppedNames -WorkingDirectory $ReleasePath
  Assert-Pm2Online
  Invoke-Pm2Command -ArgumentList @("save") -WorkingDirectory $ReleasePath `
    -Description "persistencia do rollback no PM2"
}

function Invoke-ValidatedBackup {
  param(
    [Parameter(Mandatory = $true)][string]$ReleasePath,
    [Parameter(Mandatory = $true)][hashtable]$Environment
  )

  $backupScript = Join-Path $ReleasePath "scripts\backup-postgres.ps1"
  if (-not (Test-Path -LiteralPath $backupScript -PathType Leaf)) {
    throw "Script de backup nao existe na release."
  }
  $backupDirectory = Join-Path $script:production "backups"
  $started = (Get-Date).ToUniversalTime()
  $parameters = @{
    DatabaseUrl = [string]$Environment["DATABASE_URL"]
    BackupDir = $backupDirectory
    AvatarDir = (Join-Path $script:production "shared\uploads\avatars")
  }
  foreach ($mapping in @{
      PgDumpPath = "PG_DUMP_PATH"
      PgRestorePath = "PG_RESTORE_PATH"
      PgDumpAllPath = "PG_DUMPALL_PATH"
    }.GetEnumerator()) {
    if ($Environment.ContainsKey($mapping.Value) -and
        -not [string]::IsNullOrWhiteSpace([string]$Environment[$mapping.Value])) {
      $parameters[$mapping.Key] = [string]$Environment[$mapping.Value]
    }
  }
  & $backupScript @parameters
  if (-not $?) {
    throw "Backup de producao falhou."
  }
  $metadata = @(Get-ChildItem -LiteralPath $backupDirectory -Filter "*.dump.metadata.json" -File |
    Where-Object { $_.LastWriteTimeUtc -ge $started.AddSeconds(-2) } |
    Sort-Object LastWriteTimeUtc -Descending | Select-Object -First 1)
  if ($metadata.Count -ne 1) {
    throw "Backup terminou sem manifesto validado identificavel."
  }
  $manifest = Get-Content -LiteralPath $metadata[0].FullName -Raw | ConvertFrom-Json
  if (-not ($manifest.PSObject.Properties.Name -contains "globals") -or
      -not ($manifest.PSObject.Properties.Name -contains "avatars")) {
    throw "Backup nao contem globais e avatares validados."
  }
  return [pscustomobject]@{
    Id = [IO.Path]::GetFileNameWithoutExtension([IO.Path]::GetFileNameWithoutExtension($metadata[0].Name))
    MetadataFileName = $metadata[0].Name
  }
}

$target = Assert-CommitSha -Sha $TargetSha
$source = Resolve-AbsolutePath -Path $SourceRoot
$production = Assert-SafeProductionRoot -ProductionRoot $ProductionRoot
$environmentPath = Resolve-AbsolutePath -Path $EnvironmentFile
Assert-PathWithinRoot -Path $environmentPath -Root (Join-Path $production "config") `
  -Description "Arquivo de ambiente" | Out-Null
if ((Test-PathWithinRoot -Path $source -Root $production -AllowRoot) -or
    (Test-PathWithinRoot -Path $production -Root $source -AllowRoot)) {
  throw "Checkout e raiz persistente de producao precisam ser separados."
}
$environment = Get-DotEnvValues -EnvironmentFile $environmentPath
$autoDeploy = Get-AutoDeployStatus -ProductionRoot $production -Environment $environment
if (-not $DryRun -and -not $autoDeploy.Enabled) {
  throw "Auto deploy bloqueado pelo kill switch local ou pelo sinal do workflow."
}
$urls = Assert-ProductionUrls -ApiUrl $ApiUrl -WebUrl $WebUrl -AllowHttp:$DryRun
if (-not $environment.ContainsKey("DATABASE_URL") -or
    [string]::IsNullOrWhiteSpace([string]$environment["DATABASE_URL"])) {
  throw "DATABASE_URL local ausente."
}
if (-not $environment.ContainsKey("WEB_ORIGIN") -or
    ([string]$environment["WEB_ORIGIN"]).TrimEnd("/") -ne $urls.Web) {
  throw "WEB_ORIGIN local deve ser exatamente a origem publica do web."
}
if (-not $DryRun -and
    (-not $environment.ContainsKey("SESSION_COOKIE_SECURE") -or
      -not ([string]$environment["SESSION_COOKIE_SECURE"]).Equals(
        "true",
        [StringComparison]::OrdinalIgnoreCase
      ))) {
  throw "SESSION_COOKIE_SECURE deve ser true em producao HTTPS."
}
if ($environment.ContainsKey("PORT") -and [string]$environment["PORT"] -ne "3001") {
  throw "A API de producao deve permanecer na porta interna 3001."
}
foreach ($urlSetting in @{ PRODUCTION_API_URL = $urls.Api; PRODUCTION_WEB_URL = $urls.Web }.GetEnumerator()) {
  if ($environment.ContainsKey($urlSetting.Key) -and
      -not [string]::IsNullOrWhiteSpace([string]$environment[$urlSetting.Key]) -and
      ([string]$environment[$urlSetting.Key]).TrimEnd("/") -ne $urlSetting.Value) {
    throw "$($urlSetting.Key) local diverge do environment do GitHub."
  }
}
$manifestObject = Test-ReleaseManifest -ManifestPath $ManifestPath -TargetSha $target -SourceRoot $source

$releaseRoot = Join-Path $production "releases"
$releasePath = Join-Path $releaseRoot $target
$partialPath = Join-Path $releaseRoot "$target.partial"
$statePath = Join-Path $production "state\deployment.json"
$lock = $null
$stage = "preflight"
$startedAt = Get-UtcTimestamp
$previousSha = ""
$existingPreviousSha = ""
$previousRelease = ""
$migration = $null
$migrationAttempted = $false
$migrationOutcome = "not-required"
$backup = $null
$rolledBack = $false
$stoppedWriters = @()
$existingState = $null
$failureStateSafe = $false
$stateMutationStarted = $false

try {
  $lock = Enter-DeploymentLock -ProductionRoot $production
  $existingState = Read-DeploymentState -ProductionRoot $production
  if ($null -ne $existingState -and
      $existingState.PSObject.Properties.Name -contains "activeSha" -and
      -not [string]::IsNullOrWhiteSpace([string]$existingState.activeSha)) {
    $previousSha = Assert-CommitSha -Sha ([string]$existingState.activeSha)
    $failureStateSafe = $true
    if ($existingState.PSObject.Properties.Name -contains "previousSha" -and
        -not [string]::IsNullOrWhiteSpace([string]$existingState.previousSha)) {
      $existingPreviousSha = Assert-CommitSha -Sha ([string]$existingState.previousSha)
    }
  }
  if (-not [string]::IsNullOrWhiteSpace($previousSha) -and $previousSha -eq $target) {
    if (-not (Test-ReleaseSuccessMarker -ReleasePath $releasePath -ExpectedSha $target)) {
      throw "Estado ativo aponta para release sem marker de sucesso valido."
    }
    if (-not $DryRun) {
      Test-ApplicationEndpoints -ApiBaseUrl "http://127.0.0.1:3001" `
        -WebBaseUrl "http://127.0.0.1:8080" -ExpectedSha $target | Out-Null
      Assert-Pm2Online
      if (-not $SkipPublicSmoke) {
        Test-ApplicationEndpoints -ApiBaseUrl $urls.Api -WebBaseUrl $urls.Web `
          -ExpectedSha $target -TestCorsAndCsrf | Out-Null
      }
    }
    [ordered]@{
      status = "already-active"
      targetSha = $target
      checkedAtUtc = Get-UtcTimestamp
    } | ConvertTo-Json
    return
  }

  if (Test-Path -LiteralPath $partialPath) {
    Remove-ValidatedDirectory -Path $partialPath -Root $releaseRoot
  }
  if (-not (Test-Path -LiteralPath $releasePath -PathType Container)) {
    $stage = "materialize"
    New-Item -ItemType Directory -Path $partialPath | Out-Null
    $archivePath = Join-Path $production "state\$target.partial.zip"
    Assert-PathWithinRoot -Path $archivePath -Root (Join-Path $production "state") `
      -Description "Arquivo temporario da release" | Out-Null
    if (Test-Path -LiteralPath $archivePath -PathType Leaf) {
      Remove-Item -LiteralPath $archivePath -Force
    }
    try {
      $git = Resolve-NativeTool -Candidates @("git.exe", "git")
      Invoke-CheckedCommand -FilePath $git `
        -ArgumentList @("archive", "--format=zip", "--output=$archivePath", $target) `
        -WorkingDirectory $source -Description "materializacao imutavel do candidato"
      Expand-Archive -LiteralPath $archivePath -DestinationPath $partialPath
    } finally {
      if (Test-Path -LiteralPath $archivePath) {
        Remove-Item -LiteralPath $archivePath -Force
      }
    }

    $stage = "build"
    Test-ReleaseManifest -ManifestPath $ManifestPath -TargetSha $target `
      -SourceRoot $partialPath -SkipGitCheck | Out-Null
    $npm = Resolve-NativeTool -Candidates @("npm.cmd", "npm")
    Invoke-CheckedCommand -FilePath $npm -ArgumentList @("ci") `
      -WorkingDirectory $partialPath -Description "npm ci"
    Invoke-WithEnvironment -Values @{
      EXPO_PUBLIC_API_URL = $urls.Api
      APP_RELEASE_SHA = $target
    } -ScriptBlock {
      Invoke-CheckedCommand -FilePath $npm -ArgumentList @("run", "prisma:generate") `
        -WorkingDirectory $partialPath -Description "Prisma generate"
      Invoke-CheckedCommand -FilePath $npm -ArgumentList @("run", "build") `
        -WorkingDirectory $partialPath -Description "build compartilhado, API e web"
    }
    Invoke-CheckedCommand -FilePath $npm -ArgumentList @("run", "test:budget") `
      -WorkingDirectory $partialPath -Description "validacao do budget de bundle"
    Test-ReleaseBuild -ReleasePath $partialPath
    Assert-WebBundleApiUrl -ReleasePath $partialPath -ExpectedApiUrl $urls.Api
    Write-AtomicJson -Path (Join-Path $partialPath ".deployment-build.json") -Value ([ordered]@{
      formatVersion = 1
      status = "built"
      sha = $target
      manifestSha256 = ([string]$manifestObject.manifestSha256).ToLowerInvariant()
      publicApiUrl = $urls.Api
      builtAtUtc = Get-UtcTimestamp
    })
    $migration = Get-MigrationInspection -SourceRoot $source -Environment $environment -TargetSha $target
  } else {
    $buildMarkerPath = Join-Path $releasePath ".deployment-build.json"
    if (-not (Test-Path -LiteralPath $buildMarkerPath -PathType Leaf)) {
      throw "Release existente nao possui marker de build validado."
    }
    $buildMarker = Get-Content -LiteralPath $buildMarkerPath -Raw | ConvertFrom-Json
    if ([string]$buildMarker.status -ne "built" -or
        ([string]$buildMarker.sha).ToLowerInvariant() -ne $target -or
        ([string]$buildMarker.manifestSha256).ToLowerInvariant() -ne
          ([string]$manifestObject.manifestSha256).ToLowerInvariant() -or
        ([string]$buildMarker.publicApiUrl).TrimEnd("/") -ne $urls.Api) {
      throw "Marker de build da release existente diverge do candidato."
    }
    Test-ReleaseBuild -ReleasePath $releasePath
    Assert-WebBundleApiUrl -ReleasePath $releasePath -ExpectedApiUrl $urls.Api
    Test-ReleaseManifest -ManifestPath $ManifestPath -TargetSha $target `
      -SourceRoot $releasePath -SkipGitCheck | Out-Null
    $migration = Get-MigrationInspection -SourceRoot $source -Environment $environment -TargetSha $target
  }

  if ([bool]$migration.migrationRequired) {
    $migrationOutcome = "pending"
  }
  if ([bool]$migration.migrationRequired -and -not $AllowMigration -and -not $DryRun) {
    throw "Ha migration pendente; use somente o job protegido production-migration."
  }
  if ($DryRun) {
    $dryRunResult = [ordered]@{
      formatVersion = 1
      status = "dry-run-passed"
      targetSha = $target
      migrationRequired = [bool]$migration.migrationRequired
      pendingMigrations = @($migration.pending)
      finishedAtUtc = Get-UtcTimestamp
      reloadPerformed = $false
      databaseChanged = $false
    }
    Write-AtomicJson -Path (Join-Path $production "state\dry-run-$target.json") -Value $dryRunResult
    if (Test-Path -LiteralPath $partialPath) {
      Remove-ValidatedDirectory -Path $partialPath -Root $releaseRoot
    }
    $dryRunResult | ConvertTo-Json -Depth 6
    return
  }

  if ($null -eq $existingState -or
      -not ($existingState.PSObject.Properties.Name -contains "activeSha") -or
      [string]::IsNullOrWhiteSpace([string]$existingState.activeSha)) {
    throw "Baseline de rollback ausente; registre a release atual com bootstrap-production.ps1."
  }
  $previousRelease = Join-Path $releaseRoot $previousSha
  if (-not (Test-Path -LiteralPath (Join-Path $previousRelease ".deployment-success.json") -PathType Leaf) -or
      -not (Test-Path -LiteralPath (Join-Path $previousRelease "ecosystem.config.cjs") -PathType Leaf)) {
    throw "Baseline de rollback nao e uma release validada."
  }
  if (-not (Test-ReleaseSuccessMarker -ReleasePath $previousRelease -ExpectedSha $previousSha)) {
    throw "Marker da baseline de rollback diverge do estado ativo."
  }

  if (-not (Test-Path -LiteralPath $releasePath -PathType Container)) {
    Move-Item -LiteralPath $partialPath -Destination $releasePath
  }
  $stage = "prepared"
  Write-DeploymentState -ProductionRoot $production -State ([ordered]@{
    formatVersion = 1
    status = "prepared"
    targetSha = $target
    activeSha = $previousSha
    previousSha = $existingPreviousSha
    startedAtUtc = $startedAt
    migration = [ordered]@{
      required = [bool]$migration.migrationRequired
      pending = @($migration.pending)
      attempted = $false
      outcome = $migrationOutcome
    }
  })
  $stateMutationStarted = $true

  if ([bool]$migration.migrationRequired) {
    $stage = "backup"
    $writerNames = @("bolao-api")
    if ($environment.ContainsKey("KNOWN_PM2_WRITERS")) {
      $writerNames += @(([string]$environment["KNOWN_PM2_WRITERS"]).Split(",") |
        ForEach-Object { $_.Trim() } | Where-Object { $_ })
    }
    Invoke-MigrationWithRecovery -Prepare {
      Assert-AutoDeployStillEnabled
      Assert-OriginMainSha -SourceRoot $source -TargetSha $target | Out-Null
      foreach ($writerName in $writerNames | Select-Object -Unique) {
        if (Test-Pm2ProcessExists -Name $writerName -WorkingDirectory $previousRelease) {
          Invoke-Pm2Command -ArgumentList @("stop", $writerName) `
            -WorkingDirectory $previousRelease -Description "pausa do writer $writerName"
          $script:stoppedWriters += $writerName
        }
      }
      $script:backup = Invoke-ValidatedBackup -ReleasePath $releasePath -Environment $environment
    } -Migrate {
      Assert-AutoDeployStillEnabled
      Assert-OriginMainSha -SourceRoot $source -TargetSha $target | Out-Null
      $script:stage = "migration"
      $npm = Resolve-NativeTool -Candidates @("npm.cmd", "npm")
      $script:migrationAttempted = $true
      $script:migrationOutcome = "attempted-unknown"
      Invoke-WithEnvironment -Values @{ DATABASE_URL = [string]$environment["DATABASE_URL"] } -ScriptBlock {
        Invoke-CheckedCommand -FilePath $npm -ArgumentList @("run", "prisma:migrate:deploy") `
          -WorkingDirectory $releasePath -Description "Prisma migrate deploy"
      }
      $script:migrationOutcome = "command-succeeded"
    } -Verify {
      $postMigration = Get-MigrationInspection -SourceRoot $source -Environment $environment -TargetSha $target
      if ([bool]$postMigration.migrationRequired) {
        throw "Migration terminou, mas ainda ha migrations pendentes."
      }
      $script:migrationOutcome = "verified"
    } -Recover {
      if ($migrationAttempted -and $migrationOutcome -ne "verified") {
        $script:migrationOutcome = "failed-or-unverified"
      }
      Start-PreviousRelease -ReleasePath $previousRelease -Sha $previousSha `
        -StoppedNames $stoppedWriters
      $script:rolledBack = $true
    }
  }

  $stage = "activation"
  $successMarkerPath = Join-Path $releasePath ".deployment-success.json"
  Invoke-ActivationWithRollback -Activate {
    Assert-AutoDeployStillEnabled
    Assert-OriginMainSha -SourceRoot $source -TargetSha $target | Out-Null
    Start-ReleaseProcesses -ReleasePath $releasePath -ReleaseSha $target `
      -ProductionRoot $production `
      -EnvironmentFile $environmentPath `
      -AvatarUploadDirectory (Join-Path $production "shared\uploads\avatars") `
      -ApiPublicUrl $urls.Api -WebPublicUrl $urls.Web -ApiOnly
    Wait-EndpointSha -Uri "http://127.0.0.1:3001/ready" -ExpectedSha $target -RequireReady | Out-Null
    Start-ReleaseProcesses -ReleasePath $releasePath -ReleaseSha $target `
      -ProductionRoot $production `
      -EnvironmentFile $environmentPath `
      -AvatarUploadDirectory (Join-Path $production "shared\uploads\avatars") `
      -ApiPublicUrl $urls.Api -WebPublicUrl $urls.Web -WebOnly
    Wait-EndpointSha -Uri "http://127.0.0.1:8080/health" -ExpectedSha $target | Out-Null
  } -Validate {
    $script:localHealth = Test-ApplicationEndpoints -ApiBaseUrl "http://127.0.0.1:3001" `
      -WebBaseUrl "http://127.0.0.1:8080" -ExpectedSha $target
    if (-not $SkipPublicSmoke) {
      Wait-EndpointSha -Uri (Join-HealthUri -BaseUrl $urls.Api -Path "ready") `
        -ExpectedSha $target -RequireReady | Out-Null
      Wait-EndpointSha -Uri (Join-HealthUri -BaseUrl $urls.Web -Path "health") `
        -ExpectedSha $target | Out-Null
      Test-ApplicationEndpoints -ApiBaseUrl $urls.Api -WebBaseUrl $urls.Web `
        -ExpectedSha $target -TestCorsAndCsrf | Out-Null
    }
    Resume-ExtraWriters -StoppedNames $stoppedWriters -WorkingDirectory $releasePath
    Assert-Pm2Online
    Invoke-Pm2Command -ArgumentList @("save") -WorkingDirectory $releasePath `
      -Description "persistencia do PM2"
    Write-AtomicJson -Path $successMarkerPath -Value ([ordered]@{
      formatVersion = 1
      sha = $target
      status = "passed"
      activatedAtUtc = Get-UtcTimestamp
    })
    $script:result = [ordered]@{
      formatVersion = 1
      status = "deployed"
      targetSha = $target
      activeSha = $target
      previousSha = $previousSha
      startedAtUtc = $startedAt
      finishedAtUtc = Get-UtcTimestamp
      migration = [ordered]@{
        required = [bool]$migration.migrationRequired
        attempted = $migrationAttempted
        outcome = $migrationOutcome
        pending = @($migration.pending)
        backupId = if ($null -eq $backup) { $null } else { $backup.Id }
      }
      health = [ordered]@{
        local = "passed"
        public = if ($SkipPublicSmoke) { "skipped" } else { "passed" }
        api = [int]$localHealth.ApiHealth
        ready = [int]$localHealth.ApiReady
        web = [int]$localHealth.WebHealth
      }
      rollback = [ordered]@{ required = $false; databaseRollback = $false }
    }
    Write-DeploymentState -ProductionRoot $production -State $result
  } -Rollback {
    if (Test-Path -LiteralPath $successMarkerPath) {
      Remove-Item -LiteralPath $successMarkerPath -Force
    }
    Start-PreviousRelease -ReleasePath $previousRelease -Sha $previousSha `
      -StoppedNames $stoppedWriters
    $script:rolledBack = $true
  }
  try {
    Remove-OldReleases -ProductionRoot $production -ProtectedShas @($target, $previousSha) -Keep 3
  } catch {
    Write-Warning "Deploy concluido; limpeza de releases antigas sera tentada no proximo deploy."
  }
  $result | ConvertTo-Json -Depth 10
} catch {
  if (Test-Path -LiteralPath $partialPath) {
    Remove-ValidatedDirectory -Path $partialPath -Root $releaseRoot
  }
  $failure = [ordered]@{
    formatVersion = 1
    status = "failed"
    targetSha = $target
    activeSha = $previousSha
    previousSha = $existingPreviousSha
    startedAtUtc = $startedAt
    finishedAtUtc = Get-UtcTimestamp
    migration = [ordered]@{
      required = if ($null -eq $migration) { $false } else { [bool]$migration.migrationRequired }
      attempted = $migrationAttempted
      outcome = $migrationOutcome
      backupId = if ($null -eq $backup) { $null } else { $backup.Id }
      databaseRollback = $false
    }
    rollback = [ordered]@{ applicationRestored = $rolledBack; databaseRollback = $false }
    failure = [ordered]@{ stage = $stage; sanitized = $true }
  }
  $attemptFailurePath = Join-Path $production "state\deployment-attempt-$target.json"
  Write-AtomicJson -Path $attemptFailurePath -Value $failure
  if (-not $DryRun -and $failureStateSafe -and $stateMutationStarted -and
      (Test-Path -LiteralPath (Split-Path -Parent $statePath))) {
    Write-DeploymentState -ProductionRoot $production -State $failure
  }
  throw
} finally {
  Exit-DeploymentLock -Lock $lock
}
