[CmdletBinding()]
param()

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest
Import-Module (Join-Path $PSScriptRoot "ProductionDeploy.Common.psm1") -Force

$script:passed = 0

function Assert-True {
  param([bool]$Condition, [string]$Message)
  if (-not $Condition) {
    throw "ASSERT: $Message"
  }
}

function Assert-Equal {
  param($Expected, $Actual, [string]$Message)
  if ($Expected -ne $Actual) {
    throw "ASSERT: $Message (esperado=$Expected, atual=$Actual)"
  }
}

function Assert-Throws {
  param([scriptblock]$Action, [string]$Message)
  $threw = $false
  try {
    & $Action
  } catch {
    $threw = $true
  }
  if (-not $threw) {
    throw "ASSERT: $Message"
  }
}

function Invoke-Test {
  param([string]$Name, [scriptblock]$Test)
  & $Test
  $script:passed += 1
  Write-Output "ok $($script:passed) - $Name"
}

function Write-Utf8File {
  param([string]$Path, [string]$Value)
  $parent = Split-Path -Parent $Path
  if (-not (Test-Path -LiteralPath $parent)) {
    New-Item -ItemType Directory -Path $parent -Force | Out-Null
  }
  [IO.File]::WriteAllText($Path, $Value, (New-Object Text.UTF8Encoding($false)))
}

function New-TestReleaseManifest {
  param(
    [Parameter(Mandatory = $true)][string]$Repository,
    [Parameter(Mandatory = $true)][string]$ManifestPath
  )

  $sha = (& git -C $Repository rev-parse HEAD).Trim().ToLowerInvariant()
  $tracked = @(& git -C $Repository ls-files)
  $entries = @()
  foreach ($relative in $tracked) {
    $entries += [ordered]@{
      path = ([string]$relative).Replace('\', '/')
      sha256 = Get-GitBlobSha256 -SourceRoot $Repository -CommitSha $sha `
        -GitPath ([string]$relative).Replace('\', '/')
    }
  }
  $payload = [ordered]@{
    formatVersion = 1
    suite = "release-candidate-manifest"
    status = "passed"
    pii = $false
    generatedAt = "2026-01-01T00:00:00.000Z"
    commitSha = $sha
    rcTags = @()
    files = $entries
  }
  $payloadObject = [pscustomobject]$payload
  $manifest = [ordered]@{}
  foreach ($item in $payload.GetEnumerator()) {
    $manifest[$item.Key] = $item.Value
  }
  $manifest["manifestSha256"] = Get-StringSha256 -Value (Get-ManifestPayload -Manifest $payloadObject)
  Write-Utf8File -Path $ManifestPath -Value ($manifest | ConvertTo-Json -Depth 20)
  return [pscustomobject]@{ Sha = $sha; Path = $ManifestPath }
}

$temporaryParent = [IO.Path]::GetTempPath().TrimEnd('\', '/')
$testRoot = Join-Path $temporaryParent "bolao-deployment-tests-$([Guid]::NewGuid().ToString('N'))"
New-Item -ItemType Directory -Path $testRoot | Out-Null
$originalAutoDeploy = [Environment]::GetEnvironmentVariable("AUTO_DEPLOY_ENABLED", "Process")

try {
  Invoke-Test "path containment rejects siblings and volume roots" {
    $root = Join-Path $testRoot "root"
    $child = Join-Path $root "state\deployment.json"
    $sibling = Join-Path $testRoot "root-other\deployment.json"
    Assert-True (Test-PathWithinRoot -Path $child -Root $root) "filho deveria estar contido"
    Assert-True (-not (Test-PathWithinRoot -Path $sibling -Root $root)) "prefixo irmao nao pode passar"
    Assert-Throws { Assert-SafeProductionRoot -ProductionRoot ([IO.Path]::GetPathRoot($testRoot)) } `
      "raiz do volume deve ser rejeitada"
  }

  Invoke-Test "kill switch requires workflow, local opt-in and no lock file" {
    $production = Join-Path $testRoot "kill-switch"
    New-Item -ItemType Directory -Path (Join-Path $production "state") -Force | Out-Null
    [Environment]::SetEnvironmentVariable("AUTO_DEPLOY_ENABLED", "true", "Process")
    $localFalse = @{ AUTO_DEPLOY_ENABLED = "false" }
    Assert-True (-not (Get-AutoDeployStatus -ProductionRoot $production -Environment $localFalse).Enabled) `
      "workflow nao pode sobrepor bloqueio local"
    $localTrue = @{ AUTO_DEPLOY_ENABLED = "true" }
    Assert-True (Get-AutoDeployStatus -ProductionRoot $production -Environment $localTrue).Enabled `
      "dois sinais true deveriam habilitar"
    Write-Utf8File -Path (Join-Path $production "state\auto-deploy.disabled") -Value "maintenance"
    Assert-True (-not (Get-AutoDeployStatus -ProductionRoot $production -Environment $localTrue).Enabled) `
      "lock local deve prevalecer"
  }

  Invoke-Test "local deployment mutex rejects concurrent holder" {
    $production = Join-Path $testRoot "mutex"
    $first = Enter-DeploymentLock -ProductionRoot $production
    try {
      Assert-Throws { Enter-DeploymentLock -ProductionRoot $production | Out-Null } `
        "segundo lock deveria falhar"
    } finally {
      Exit-DeploymentLock -Lock $first
    }
    $second = Enter-DeploymentLock -ProductionRoot $production
    Exit-DeploymentLock -Lock $second
  }

  Invoke-Test "atomic deployment state is valid JSON" {
    $production = Join-Path $testRoot "state"
    Write-DeploymentState -ProductionRoot $production -State ([ordered]@{
      formatVersion = 1
      status = "prepared"
      activeSha = ("a" * 40)
    })
    Write-DeploymentState -ProductionRoot $production -State ([ordered]@{
      formatVersion = 1
      status = "deployed"
      activeSha = ("b" * 40)
    })
    $state = Read-DeploymentState -ProductionRoot $production
    Assert-Equal "deployed" ([string]$state.status) "estado atomico incorreto"
    Assert-True (-not (Test-Path -LiteralPath (Join-Path $production "state\deployment.json.previous"))) `
      "backup temporario deveria ser removido"
  }

  Invoke-Test "avatar bootstrap is idempotent and rejects checksum conflict" {
    $source = Join-Path $testRoot "avatars-source"
    $destination = Join-Path $testRoot "avatars-destination"
    Write-Utf8File -Path (Join-Path $source "nested\avatar.png") -Value "avatar-a"
    $first = Copy-DirectoryValidated -Source $source -Destination $destination
    $second = Copy-DirectoryValidated -Source $source -Destination $destination
    Assert-Equal 1 $first.CopiedCount "primeira copia"
    Assert-Equal 0 $second.CopiedCount "segunda copia deveria ser idempotente"
    Write-Utf8File -Path (Join-Path $destination "nested\avatar.png") -Value "tampered"
    Assert-Throws { Copy-DirectoryValidated -Source $source -Destination $destination | Out-Null } `
      "conflito de checksum deve bloquear"
  }

  Invoke-Test "baseline copy excludes dependencies, mutable data and secrets" {
    $source = Join-Path $testRoot "baseline-source"
    $destination = Join-Path $testRoot "baseline-destination"
    Write-Utf8File -Path (Join-Path $source "apps\api\dist\server.js") -Value "built"
    Write-Utf8File -Path (Join-Path $source "node_modules\package\index.js") -Value "dependency"
    Write-Utf8File -Path (Join-Path $source "apps\api\uploads\avatar.png") -Value "mutable"
    $inventory = Copy-BaselineRelease -Source $source -Destination $destination
    Assert-True (Test-Path -LiteralPath (Join-Path $destination "apps\api\dist\server.js")) `
      "artefato construido deve ser copiado"
    Assert-True (-not (Test-Path -LiteralPath (Join-Path $destination "node_modules"))) `
      "node_modules deve ser reinstalado, nao copiado"
    Assert-True (-not (Test-Path -LiteralPath (Join-Path $destination "apps\api\uploads"))) `
      "uploads devem permanecer em shared"
    Assert-Equal 1 $inventory.FileCount "inventario sanitizado da baseline"
    Write-Utf8File -Path (Join-Path $source "apps\api\.env.production") -Value "SECRET=value"
    Assert-Throws {
      Copy-BaselineRelease -Source $source -Destination (Join-Path $testRoot "baseline-secret") | Out-Null
    } "arquivo de segredo deve bloquear baseline"
  }

  if ($env:OS -eq "Windows_NT") {
    Invoke-Test "recursive cleanup refuses junctions outside release root" {
      $releaseRoot = Join-Path $testRoot "junction-releases"
      $outside = Join-Path $testRoot "junction-outside"
      $junction = Join-Path $releaseRoot ("c" * 40 + ".partial")
      New-Item -ItemType Directory -Path $releaseRoot, $outside -Force | Out-Null
      Write-Utf8File -Path (Join-Path $outside "keep.txt") -Value "keep"
      New-Item -ItemType Junction -Path $junction -Target $outside | Out-Null
      Assert-Throws {
        Remove-ValidatedDirectory -Path $junction -Root $releaseRoot
      } "junction nao pode ser removida recursivamente"
      Assert-True (Test-Path -LiteralPath (Join-Path $outside "keep.txt")) `
        "conteudo externo deve permanecer intacto"
      [IO.Directory]::Delete($junction)
    }
  }

  Invoke-Test "failed activation always invokes application rollback" {
    $events = New-Object Collections.Generic.List[string]
    Assert-Throws {
      Invoke-ActivationWithRollback `
        -Activate { $events.Add("activate") | Out-Null } `
        -Validate { $events.Add("health") | Out-Null; throw "negative health" } `
        -Rollback { $events.Add("rollback") | Out-Null }
    } "health negativo deve falhar"
    Assert-Equal "activate,health,rollback" ($events -join ",") "sequencia de rollback incorreta"
  }

  Invoke-Test "backup and migration failures always recover the previous application" {
    $backupEvents = New-Object Collections.Generic.List[string]
    Assert-Throws {
      Invoke-MigrationWithRecovery `
        -Prepare {
          $backupEvents.Add("stop-writers") | Out-Null
          $backupEvents.Add("backup") | Out-Null
          throw "backup failed"
        } `
        -Migrate { $backupEvents.Add("migrate") | Out-Null } `
        -Verify { $backupEvents.Add("verify") | Out-Null } `
        -Recover { $backupEvents.Add("recover") | Out-Null }
    } "falha de backup deve falhar a transacao"
    Assert-Equal "stop-writers,backup,recover" ($backupEvents -join ",") `
      "backup falho nao pode migrar e deve recuperar"

    $migrationEvents = New-Object Collections.Generic.List[string]
    Assert-Throws {
      Invoke-MigrationWithRecovery `
        -Prepare {
          $migrationEvents.Add("stop-writers") | Out-Null
          $migrationEvents.Add("backup-validated") | Out-Null
        } `
        -Migrate {
          $migrationEvents.Add("migrate") | Out-Null
          throw "migration failed after command start"
        } `
        -Verify { $migrationEvents.Add("verify") | Out-Null } `
        -Recover { $migrationEvents.Add("recover") | Out-Null }
    } "falha de migration deve falhar a transacao"
    Assert-Equal "stop-writers,backup-validated,migrate,recover" ($migrationEvents -join ",") `
      "migration falha deve reiniciar aplicacao anterior sem verify"
  }

  Invoke-Test "retention only counts releases marked successful" {
    $production = Join-Path $testRoot "retention"
    $releaseRoot = Join-Path $production "releases"
    New-Item -ItemType Directory -Path $releaseRoot -Force | Out-Null
    $successfulShas = @()
    for ($index = 1; $index -le 4; $index += 1) {
      $sha = ([string]$index) * 40
      $successfulShas += $sha
      $release = Join-Path $releaseRoot $sha
      New-Item -ItemType Directory -Path $release | Out-Null
      Write-Utf8File -Path (Join-Path $release ".deployment-success.json") -Value "{}"
      (Get-Item -LiteralPath $release).LastWriteTimeUtc = (Get-Date).ToUniversalTime().AddMinutes($index)
    }
    $failedSha = "f" * 40
    New-Item -ItemType Directory -Path (Join-Path $releaseRoot $failedSha) | Out-Null
    Remove-OldReleases -ProductionRoot $production -Keep 3
    Assert-True (-not (Test-Path -LiteralPath (Join-Path $releaseRoot $successfulShas[0]))) `
      "release bem-sucedida mais antiga deveria sair"
    Assert-True (Test-Path -LiteralPath (Join-Path $releaseRoot $failedSha)) `
      "release sem marker nao deve influenciar nem ser apagada"
  }

  Invoke-Test "manifest is SHA-bound, blob-based and tamper evident" {
    $repository = Join-Path $testRoot "manifest-repository"
    New-Item -ItemType Directory -Path $repository | Out-Null
    $files = @(
      ".gitattributes",
      ".github/workflows/release-gates.yml",
      ".github/workflows/deploy-production.yml",
      "ecosystem.config.cjs",
      "package-lock.json",
      "apps/api/prisma/schema.prisma",
      "apps/api/prisma/migrations/001/migration.sql",
      "scripts/deployment/sentinel.ps1"
    )
    foreach ($relative in $files) {
      Write-Utf8File -Path (Join-Path $repository $relative) -Value "$relative`n"
    }
    & git -C $repository init --quiet
    & git -C $repository config user.email "deployment-tests@example.invalid"
    & git -C $repository config user.name "Deployment Tests"
    & git -C $repository config core.autocrlf false
    & git -C $repository add .
    & git -C $repository commit --quiet -m "fixture"
    if ($LASTEXITCODE -ne 0) {
      throw "Nao foi possivel criar repositorio de teste."
    }
    $sha = (& git -C $repository rev-parse HEAD).Trim().ToLowerInvariant()
    $entries = @()
    foreach ($relative in $files) {
      $entries += [ordered]@{
        path = $relative
        sha256 = Get-GitBlobSha256 -SourceRoot $repository -CommitSha $sha -GitPath $relative
      }
    }
    $payload = [ordered]@{
      formatVersion = 1
      suite = "release-candidate-manifest"
      status = "passed"
      pii = $false
      generatedAt = "2026-01-01T00:00:00.000Z"
      commitSha = $sha
      rcTags = @()
      files = $entries
    }
    $payloadObject = [pscustomobject]$payload
    $manifest = [ordered]@{}
    foreach ($item in $payload.GetEnumerator()) {
      $manifest[$item.Key] = $item.Value
    }
    $manifest["manifestSha256"] = Get-StringSha256 -Value (Get-ManifestPayload -Manifest $payloadObject)
    $manifestPath = Join-Path $testRoot "manifest.json"
    Write-Utf8File -Path $manifestPath -Value ($manifest | ConvertTo-Json -Depth 20)
    Test-ReleaseManifest -ManifestPath $manifestPath -TargetSha $sha -SourceRoot $repository | Out-Null

    Write-Utf8File -Path (Join-Path $repository "package-lock.json") -Value "working-tree-crlf`r`n"
    Test-ReleaseManifest -ManifestPath $manifestPath -TargetSha $sha -SourceRoot $repository | Out-Null

    $tampered = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
    $tampered.files[0].sha256 = "0" * 64
    $tampered.manifestSha256 = Get-StringSha256 -Value (Get-ManifestPayload -Manifest $tampered)
    Write-Utf8File -Path $manifestPath -Value ($tampered | ConvertTo-Json -Depth 20)
    Assert-Throws {
      Test-ReleaseManifest -ManifestPath $manifestPath -TargetSha $sha -SourceRoot $repository | Out-Null
    } "manifesto adulterado deve falhar"
    Assert-Throws {
      Test-ReleaseManifest -ManifestPath $manifestPath -TargetSha ("a" * 40) `
        -SourceRoot $repository | Out-Null
    } "SHA obsoleto deve falhar"
  }

  Invoke-Test "deploy script has guarded migration, immutable materialization and no destructive DB rollback" {
    $deploy = Get-Content -LiteralPath (Join-Path $PSScriptRoot "deploy-production.ps1") -Raw
    Assert-True ($deploy -match 'git[^\\r\\n]*archive|\"archive\"') "deploy precisa usar git archive"
    Assert-True (($deploy | Select-String -Pattern "Assert-OriginMainSha" -AllMatches).Matches.Count -ge 2) `
      "SHA da main precisa ser revalidado duas vezes"
    Assert-True ($deploy -match 'prisma:migrate:deploy') "migration de producao ausente"
    Assert-True ($deploy -match 'AllowMigration') "migration precisa de autorizacao explicita"
    Assert-True ($deploy -match 'Invoke-ActivationWithRollback') `
      "deploy deve usar a primitiva de ativacao exercitada por health negativo"
    Assert-True ($deploy -notmatch 'migrate\s+dev') "comando de desenvolvimento proibido"
    Assert-True ($deploy -notmatch '(?im)^\s*(npm\s+run\s+)?seed\b') "seed proibido"
    Assert-True ($deploy -notmatch 'restore-postgres\.ps1|prisma\s+migrate\s+reset|--clean') `
      "restore automatico de banco proibido"
    Assert-True ($deploy -match 'databaseRollback\s*=\s*\$false') "estado deve declarar ausencia de rollback DB"
  }

  Invoke-Test "bootstrap defaults to disabled and retains avatar source" {
    $production = Join-Path $testRoot "bootstrap"
    $legacy = Join-Path $testRoot "bootstrap-legacy"
    Write-Utf8File -Path (Join-Path $legacy "one.png") -Value "one"
    & (Join-Path $PSScriptRoot "bootstrap-production.ps1") `
      -ProductionRoot $production -LegacyAvatarDirectory $legacy | Out-Null
    $environmentFile = Join-Path $production "config\production.env"
    $environment = Get-DotEnvValues -EnvironmentFile $environmentFile
    Assert-Equal "false" $environment["AUTO_DEPLOY_ENABLED"] "bootstrap deve iniciar desabilitado"
    Assert-True (Test-Path -LiteralPath (Join-Path $production "state\auto-deploy.disabled")) `
      "bootstrap deve criar lock de manutencao"
    Assert-True (Test-Path -LiteralPath (Join-Path $legacy "one.png")) "origem de avatar deve ser mantida"
    Assert-Equal (Get-Sha256 -Path (Join-Path $legacy "one.png")) `
      (Get-Sha256 -Path (Join-Path $production "shared\uploads\avatars\one.png")) `
      "avatar compartilhado deve manter checksum"
  }

  Invoke-Test "dry-run executes immutable build with fakes and preserves active state on build failure" {
    $fixture = Join-Path $testRoot "deploy-fixture"
    $production = Join-Path $testRoot "deploy-production"
    $toolDirectory = Join-Path $testRoot "fake-tools"
    foreach ($directory in @($fixture, $production, $toolDirectory)) {
      New-Item -ItemType Directory -Path $directory -Force | Out-Null
    }
    foreach ($relative in @(
        ".gitattributes",
        ".github/workflows/release-gates.yml",
        ".github/workflows/deploy-production.yml",
        "ecosystem.config.cjs",
        "package-lock.json",
        "apps/api/prisma/schema.prisma",
        "apps/api/prisma/migrations/001/migration.sql",
        "apps/web/scripts/serve-dist.mjs"
      )) {
      Write-Utf8File -Path (Join-Path $fixture $relative) -Value "$relative`n"
    }
    New-Item -ItemType Directory -Path (Join-Path $fixture "scripts\deployment") -Force | Out-Null
    Copy-Item -LiteralPath (Join-Path $PSScriptRoot "ProductionDeploy.Common.psm1") `
      -Destination (Join-Path $fixture "scripts\deployment\ProductionDeploy.Common.psm1")
    Copy-Item -LiteralPath (Join-Path $PSScriptRoot "migration-inventory.ps1") `
      -Destination (Join-Path $fixture "scripts\deployment\migration-inventory.ps1")
    Copy-Item -LiteralPath (Join-Path (Split-Path $PSScriptRoot -Parent) "postgres-common.ps1") `
      -Destination (Join-Path $fixture "scripts\postgres-common.ps1")

    & git -C $fixture init --quiet
    & git -C $fixture config user.email "deployment-tests@example.invalid"
    & git -C $fixture config user.name "Deployment Tests"
    & git -C $fixture config core.autocrlf false
    & git -C $fixture add .
    & git -C $fixture commit --quiet -m "deploy fixture"
    if ($LASTEXITCODE -ne 0) {
      throw "Nao foi possivel criar fixture de deploy."
    }
    $candidate = New-TestReleaseManifest -Repository $fixture `
      -ManifestPath (Join-Path $testRoot "deploy-fixture-manifest.json")
    Assert-Throws {
      & (Join-Path $PSScriptRoot "deploy-production.ps1") `
        -TargetSha $candidate.Sha -ManifestPath $candidate.Path -SourceRoot $fixture `
        -ProductionRoot $production `
        -EnvironmentFile (Join-Path $production "config\missing.env") `
        -ApiUrl "http://api.example.test" -WebUrl "http://app.example.test" -DryRun | Out-Null
    } "entrypoint deve bloquear arquivo de ambiente ausente"
    Assert-True (-not (Test-Path -LiteralPath (Join-Path $production "state\deployment.json"))) `
      "env ausente nao pode criar estado de deployment"

    $fakeNpmScript = @'
$CommandArguments = @($args)
if ($CommandArguments.Count -ge 2 -and
    $CommandArguments[0] -eq "run" -and $CommandArguments[1] -eq "build") {
  if ($env:FAKE_NPM_FAIL_BUILD -eq "true") { exit 22 }
  New-Item -ItemType Directory -Path "apps/api/dist/src" -Force | Out-Null
  New-Item -ItemType Directory -Path "apps/web/dist" -Force | Out-Null
  [IO.File]::WriteAllText(
    (Join-Path (Get-Location) "apps/api/dist/src/server.js"),
    "server",
    (New-Object Text.UTF8Encoding($false))
  )
  [IO.File]::WriteAllText(
    (Join-Path (Get-Location) "apps/web/dist/index.html"),
    "<script>const api='$env:EXPO_PUBLIC_API_URL';</script>",
    (New-Object Text.UTF8Encoding($false))
  )
}
exit 0
'@
    $fakePsqlScript = @'
$CommandArguments = @($args)
$joined = $CommandArguments -join " "
if ($joined -match "server_version_num") { "180000"; exit 0 }
if ($joined -match "to_regclass") { "false"; exit 0 }
"[]"
exit 0
'@
    Write-Utf8File -Path (Join-Path $toolDirectory "fake-npm.ps1") -Value $fakeNpmScript
    Write-Utf8File -Path (Join-Path $toolDirectory "fake-psql.ps1") -Value $fakePsqlScript
    if ($env:OS -eq "Windows_NT") {
      Write-Utf8File -Path (Join-Path $toolDirectory "npm.cmd") `
        -Value "@echo off`r`npowershell.exe -NoLogo -NoProfile -File `"%~dp0fake-npm.ps1`" %*`r`n"
      Write-Utf8File -Path (Join-Path $toolDirectory "psql.cmd") `
        -Value "@echo off`r`npowershell.exe -NoLogo -NoProfile -File `"%~dp0fake-psql.ps1`" %*`r`n"
      $psqlPath = Join-Path $toolDirectory "psql.cmd"
    } else {
      Write-Utf8File -Path (Join-Path $toolDirectory "npm") `
        -Value "#!/bin/sh`nexec pwsh -NoProfile -File `"`$(dirname `"`$0`")/fake-npm.ps1`" `"`$@`"`n"
      Write-Utf8File -Path (Join-Path $toolDirectory "psql") `
        -Value "#!/bin/sh`nexec pwsh -NoProfile -File `"`$(dirname `"`$0`")/fake-psql.ps1`" `"`$@`"`n"
      & chmod +x (Join-Path $toolDirectory "npm") (Join-Path $toolDirectory "psql")
      $psqlPath = Join-Path $toolDirectory "psql"
    }

    New-Item -ItemType Directory -Path (Join-Path $production "config") -Force | Out-Null
    $environmentPath = Join-Path $production "config\production.env"
    Write-Utf8File -Path $environmentPath -Value @"
DATABASE_URL=postgresql://user:password@127.0.0.1:5432/fixture
SESSION_SECRET=fixture-session-secret-at-least-24
WEB_ORIGIN=http://app.example.test
SESSION_COOKIE_SECURE=true
AUTO_DEPLOY_ENABLED=false
PRODUCTION_API_URL=http://api.example.test
PRODUCTION_WEB_URL=http://app.example.test
PSQL_PATH=$($psqlPath.Replace('\', '/'))
"@
    $baselineState = [ordered]@{
      formatVersion = 1
      status = "deployed"
      activeSha = "a" * 40
      previousSha = "b" * 40
    }
    Write-DeploymentState -ProductionRoot $production -State $baselineState
    $stateBefore = Get-Content -LiteralPath (Join-Path $production "state\deployment.json") -Raw
    $previousPath = $env:PATH
    try {
      $env:PATH = $toolDirectory + [IO.Path]::PathSeparator + $previousPath
      & (Join-Path $PSScriptRoot "deploy-production.ps1") `
        -TargetSha $candidate.Sha -ManifestPath $candidate.Path -SourceRoot $fixture `
        -ProductionRoot $production -EnvironmentFile $environmentPath `
        -ApiUrl "http://api.example.test" -WebUrl "http://app.example.test" -DryRun | Out-Null
      Assert-True (-not (Test-Path -LiteralPath (Join-Path $production "releases\$($candidate.Sha).partial"))) `
        "dry-run deve limpar release parcial"
      $stateAfterSuccess = Get-Content -LiteralPath (Join-Path $production "state\deployment.json") -Raw
      Assert-Equal $stateBefore $stateAfterSuccess "dry-run nao pode alterar deployment.json"

      $activeRelease = Join-Path $production "releases\$($candidate.Sha)"
      New-Item -ItemType Directory -Path $activeRelease -Force | Out-Null
      Write-AtomicJson -Path (Join-Path $activeRelease ".deployment-success.json") -Value ([ordered]@{
        formatVersion = 1
        sha = $candidate.Sha
        status = "passed"
      })
      Write-DeploymentState -ProductionRoot $production -State ([ordered]@{
        formatVersion = 1
        status = "deployed"
        activeSha = $candidate.Sha
        previousSha = "a" * 40
      })
      $idempotentState = Get-Content -LiteralPath (Join-Path $production "state\deployment.json") -Raw
      $idempotentOutput = @(& (Join-Path $PSScriptRoot "deploy-production.ps1") `
        -TargetSha $candidate.Sha -ManifestPath $candidate.Path -SourceRoot $fixture `
        -ProductionRoot $production -EnvironmentFile $environmentPath `
        -ApiUrl "http://api.example.test" -WebUrl "http://app.example.test" -DryRun)
      $idempotentResult = ($idempotentOutput -join [Environment]::NewLine) | ConvertFrom-Json
      Assert-Equal "already-active" ([string]$idempotentResult.status) `
        "retry do mesmo SHA deveria ser idempotente"
      Assert-Equal $idempotentState `
        (Get-Content -LiteralPath (Join-Path $production "state\deployment.json") -Raw) `
        "already-active nao pode reescrever estado"
      Remove-ValidatedDirectory -Path $activeRelease -Root (Join-Path $production "releases")
      Write-DeploymentState -ProductionRoot $production -State $baselineState

      $env:FAKE_NPM_FAIL_BUILD = "true"
      Assert-Throws {
        & (Join-Path $PSScriptRoot "deploy-production.ps1") `
          -TargetSha $candidate.Sha -ManifestPath $candidate.Path -SourceRoot $fixture `
          -ProductionRoot $production -EnvironmentFile $environmentPath `
          -ApiUrl "http://api.example.test" -WebUrl "http://app.example.test" -DryRun | Out-Null
      } "falha de build fake deveria propagar"
      $stateAfterFailure = Get-Content -LiteralPath (Join-Path $production "state\deployment.json") -Raw
      Assert-Equal $stateBefore $stateAfterFailure "falha de build nao pode corromper estado ativo"
    } finally {
      Remove-Item Env:FAKE_NPM_FAIL_BUILD -ErrorAction SilentlyContinue
      $env:PATH = $previousPath
    }
  }

  Write-Output "1..$script:passed"
} finally {
  [Environment]::SetEnvironmentVariable("AUTO_DEPLOY_ENABLED", $originalAutoDeploy, "Process")
  $resolvedTestRoot = Resolve-AbsolutePath -Path $testRoot
  if (-not $resolvedTestRoot.StartsWith($temporaryParent + [IO.Path]::DirectorySeparatorChar,
      [StringComparison]::OrdinalIgnoreCase)) {
    throw "Diretorio temporario saiu da raiz esperada."
  }
  if (Test-Path -LiteralPath $resolvedTestRoot) {
    Remove-Item -LiteralPath $resolvedTestRoot -Recurse -Force
  }
}
