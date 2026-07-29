param(
  [int]$ApiPort = 3001,
  [int]$WebPort = 8080,
  [string]$PgBin = "",
  [string]$DataDir = ".\.postgres-data",
  [switch]$FullValidation,
  [switch]$NoGeLoop,
  [switch]$Combined
)

$ErrorActionPreference = "Stop"

$Root = Resolve-Path (Join-Path $PSScriptRoot "..")
. (Join-Path $PSScriptRoot "postgres-common.ps1")
$dataPath = if ([IO.Path]::IsPathRooted($DataDir)) { $DataDir } else { Join-Path $Root $DataDir }
$ResolvedDataDir = (Resolve-Path -LiteralPath $dataPath).Path
$PgBin = Resolve-ProjectPgBin -ConfiguredPath $PgBin -DataDir $ResolvedDataDir
$PgPort = Get-ProjectPgPort -DataDir $ResolvedDataDir
$ApiDir = Join-Path $Root "apps\api"
$WebDist = Join-Path $Root "apps\web\dist"
$LogsDir = Join-Path $Root "logs"
$ApiLog = Join-Path $LogsDir "api-$ApiPort.log"
$ApiErrLog = Join-Path $LogsDir "api-$ApiPort-error.log"
$WebLog = Join-Path $LogsDir "web-$WebPort.log"
$WebErrLog = Join-Path $LogsDir "web-$WebPort-error.log"
$CombinedApiLog = Join-Path $LogsDir "api-$WebPort.log"
$CombinedApiErrLog = Join-Path $LogsDir "api-$WebPort-error.log"
$GeLog = Join-Path $LogsDir "ge-score-sync.log"
$GeErrLog = Join-Path $LogsDir "ge-score-sync-error.log"
$HealthUrl = "http://127.0.0.1:$ApiPort/health"
$WebUrl = "http://127.0.0.1:$WebPort/"

New-Item -ItemType Directory -Force -Path $LogsDir | Out-Null

function Write-Step([string]$Message) {
  Write-Host "==> $Message"
}

function Read-DotEnv([string]$Path) {
  $values = @{}
  if (-not (Test-Path -LiteralPath $Path)) {
    return $values
  }

  Get-Content -LiteralPath $Path | ForEach-Object {
    $line = $_.Trim()
    if (-not $line -or $line.StartsWith("#") -or $line -notmatch "=") {
      return
    }

    $parts = $line.Split("=", 2)
    $key = $parts[0].Trim()
    $value = $parts[1].Trim().Trim('"').Trim("'")
    $values[$key] = $value
  }

  return $values
}

function Test-Url([string]$Url, [int]$TimeoutSec = 8) {
  try {
    $response = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec $TimeoutSec
    return [pscustomobject]@{ Ok = ($response.StatusCode -ge 200 -and $response.StatusCode -lt 400); StatusCode = $response.StatusCode; Error = $null }
  } catch {
    return [pscustomobject]@{ Ok = $false; StatusCode = $null; Error = $_.Exception.Message }
  }
}

function Test-ApiHealth([string]$Url) {
  try {
    $response = Invoke-RestMethod -Uri $Url -TimeoutSec 8
    return [pscustomobject]@{ Ok = ($response.ok -eq $true); Error = $null }
  } catch {
    return [pscustomobject]@{ Ok = $false; Error = $_.Exception.Message }
  }
}

function Wait-Url([string]$Url, [int]$TimeoutSec = 45) {
  $deadline = (Get-Date).AddSeconds($TimeoutSec)
  do {
    $result = Test-Url -Url $Url -TimeoutSec 5
    if ($result.Ok) {
      return $true
    }
    Start-Sleep -Seconds 2
  } while ((Get-Date) -lt $deadline)

  return $false
}

function Get-PortProcess([int]$ListenPort) {
  $connection = Get-NetTCPConnection -LocalPort $ListenPort -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
  if (-not $connection) {
    return $null
  }

  return Get-Process -Id $connection.OwningProcess -ErrorAction SilentlyContinue
}

function Ensure-Postgres() {
  $pgCtl = Join-Path $PgBin "pg_ctl.exe"
  $pgIsReady = Join-Path $PgBin "pg_isready.exe"

  if (-not (Test-Path -LiteralPath $pgCtl)) {
    throw "pg_ctl.exe nao encontrado em $pgCtl"
  }

  if (-not (Test-Path -LiteralPath $pgIsReady)) {
    throw "pg_isready.exe nao encontrado em $pgIsReady"
  }

  Write-Step "Verificando PostgreSQL do projeto em $ResolvedDataDir"
  $statusOutput = & $pgCtl -D $ResolvedDataDir status 2>&1
  if ($LASTEXITCODE -ne 0) {
    Write-Step "PostgreSQL do projeto parado. Iniciando na porta configurada do cluster"
    $postgresLog = Join-Path $LogsDir "postgres-project.log"
    # Nao canalize a saida do pg_ctl: o postgres filho pode herdar o pipe e
    # impedir que uma inicializacao automatica com log redirecionado termine.
    & $pgCtl -D $ResolvedDataDir -l $postgresLog start
    if ($LASTEXITCODE -ne 0) {
      throw "Falha ao iniciar PostgreSQL do projeto. Veja $postgresLog"
    }
  } else {
    Write-Host ($statusOutput -join "`n")
  }

  $ready = & $pgIsReady -h localhost -p $PgPort 2>&1
  if ($LASTEXITCODE -ne 0) {
    throw "PostgreSQL nao respondeu em localhost:$PgPort. Saida: $ready"
  }
  Write-Host $ready
}

function Test-Database() {
  Write-Step "Validando conexao com o banco"
  $psql = Join-Path $PgBin "psql.exe"
  if (-not (Test-Path -LiteralPath $psql)) {
    throw "psql.exe nao encontrado em $psql"
  }

  $envValues = Read-DotEnv (Join-Path $ApiDir ".env")
  if (-not $envValues.ContainsKey("DATABASE_URL")) {
    throw "DATABASE_URL nao encontrada em apps/api/.env"
  }

  $dbUri = [Uri]$envValues["DATABASE_URL"]
  $userInfo = $dbUri.UserInfo.Split(":", 2)
  $dbUser = [System.Uri]::UnescapeDataString($userInfo[0])
  $dbPassword = if ($userInfo.Length -gt 1) { [System.Uri]::UnescapeDataString($userInfo[1]) } else { "" }
  $dbName = $dbUri.AbsolutePath.TrimStart("/")
  $dbPort = if ($dbUri.Port -gt 0) { $dbUri.Port } else { 5432 }

  $oldPgPassword = $env:PGPASSWORD
  $env:PGPASSWORD = $dbPassword
  try {
    $query = 'select current_database() as database, current_user as "user", (select count(*) from public.\"User\") as users, (select count(*) from public.\"Match\") as matches;'
    $output = & $psql -h $dbUri.Host -p $dbPort -U $dbUser -d $dbName -w -t -A -F "," -c $query 2>&1
    if ($LASTEXITCODE -ne 0) {
      throw "Falha ao validar DB com psql: $output"
    }
  } finally {
    $env:PGPASSWORD = $oldPgPassword
  }

  Write-Host $output
}

function Run-FullValidation() {
  if (-not $FullValidation) {
    return
  }

  Write-Step "Executando validacao completa: lint, test e build"
  Push-Location $Root
  try {
    npm run lint
    if ($LASTEXITCODE -ne 0) { throw "npm run lint falhou" }
    npm run test
    if ($LASTEXITCODE -ne 0) { throw "npm run test falhou" }
    npm run build
    if ($LASTEXITCODE -ne 0) { throw "npm run build falhou" }
  } finally {
    Pop-Location
  }
}

function Ensure-DatabaseMigrations() {
  Write-Step "Aplicando migrations pendentes"
  Push-Location $Root
  try {
    npm --workspace @bolao/api exec -- prisma migrate deploy
    if ($LASTEXITCODE -ne 0) {
      throw "prisma migrate deploy falhou"
    }
  } finally {
    Pop-Location
  }
}

function Get-GeLoopProcesses() {
  return @(
    Get-CimInstance Win32_Process | Where-Object {
      $_.CommandLine -and (
        $_.CommandLine -match "scrape-ge-scores\.ts --watch" -or
        $_.CommandLine -match "scrape:ge-scores:watch" -or
        $_.CommandLine -match "iniciar-atualizacao-ge-loop\.bat"
      )
    }
  )
}

function Start-GeLoop() {
  Write-Step "Iniciando scraper GE em watch"
  Start-Process -FilePath "cmd.exe" `
    -ArgumentList @("/d", "/c", "scripts\iniciar-atualizacao-ge-loop.bat") `
    -WorkingDirectory $Root `
    -WindowStyle Hidden `
    -RedirectStandardOutput $GeLog `
    -RedirectStandardError $GeErrLog

  $deadline = (Get-Date).AddSeconds(20)
  do {
    Start-Sleep -Seconds 1
    $loop = Get-GeLoopProcesses | Select-Object -First 1
    if ($loop) {
      Write-Host "Loop GE iniciado: PID $($loop.ProcessId)"
      return
    }
  } while ((Get-Date) -lt $deadline)

  throw "Loop GE nao iniciou. Veja $GeLog e $GeErrLog"
}

function Stop-GeLoopForPrisma() {
  $processes = @(Get-GeLoopProcesses)
  if ($processes.Count -eq 0) {
    return $false
  }

  Write-Step "Pausando loop GE para liberar o Prisma Engine"
  $processIds = $processes | Select-Object -ExpandProperty ProcessId -Unique
  Stop-Process -Id $processIds -Force -ErrorAction SilentlyContinue

  $deadline = (Get-Date).AddSeconds(15)
  do {
    Start-Sleep -Milliseconds 500
  } while (@(Get-GeLoopProcesses).Count -gt 0 -and (Get-Date) -lt $deadline)

  if (@(Get-GeLoopProcesses).Count -gt 0) {
    throw "Nao foi possivel pausar o loop GE para regenerar o Prisma Client."
  }
  return $true
}

function Ensure-PrismaClient() {
  Write-Step "Gerando Prisma Client"
  $restartGeLoop = Stop-GeLoopForPrisma
  try {
    Push-Location $Root
    try {
      npm run prisma:generate
      if ($LASTEXITCODE -ne 0) {
        throw "prisma:generate falhou"
      }
    } finally {
      Pop-Location
    }
  } finally {
    if ($restartGeLoop) {
      Start-GeLoop
    }
  }
}

function Stop-LegacyCombinedServer() {
  $legacyHealthUrl = "http://127.0.0.1:$WebPort/health"
  $legacyHealth = Test-ApiHealth -Url $legacyHealthUrl
  if (-not $legacyHealth.Ok) {
    return
  }

  $legacyProcess = Get-PortProcess -ListenPort $WebPort
  if (-not $legacyProcess) {
    return
  }

  $processInfo = Get-CimInstance Win32_Process -Filter "ProcessId = $($legacyProcess.Id)"
  if (
    $legacyProcess.ProcessName -ne "node" -or
    -not $processInfo.CommandLine -or
    $processInfo.CommandLine -notmatch "dist[\\/]src[\\/]server\.js"
  ) {
    throw "A porta $WebPort responde como API, mas o processo PID $($legacyProcess.Id) nao foi reconhecido como o servidor legado do Bolao."
  }

  Write-Step "Encerrando servidor legado combinado na porta $WebPort (PID $($legacyProcess.Id))"
  Stop-Process -Id $legacyProcess.Id
  $deadline = (Get-Date).AddSeconds(15)
  do {
    Start-Sleep -Milliseconds 500
  } while ((Get-PortProcess -ListenPort $WebPort) -and (Get-Date) -lt $deadline)

  if (Get-PortProcess -ListenPort $WebPort) {
    throw "O servidor legado nao liberou a porta $WebPort."
  }
}

function Get-WebOrigins() {
  $origins = @(
    "http://localhost:$WebPort",
    "http://127.0.0.1:$WebPort"
  )

  Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
    Where-Object {
      $_.IPAddress -notlike "127.*" -and
      $_.IPAddress -notlike "169.254.*"
    } |
    ForEach-Object {
      $origins += "http://$($_.IPAddress):$WebPort"
    }

  return ($origins | Select-Object -Unique) -join ","
}

function Ensure-Api() {
  Write-Step "Verificando API na porta $ApiPort"
  $health = Test-ApiHealth -Url $HealthUrl
  if ($health.Ok) {
    Write-Host "API OK: $HealthUrl"
    return
  }

  $existing = Get-PortProcess -ListenPort $ApiPort
  if ($existing) {
    throw "Porta $ApiPort ocupada por PID $($existing.Id) ($($existing.ProcessName)), mas o healthcheck da API falhou. Erro: $($health.Error)"
  }

  Ensure-PrismaClient
  $webOrigins = Get-WebOrigins
  Write-Step "Iniciando backend em $HealthUrl"
  $command = "set PORT=$ApiPort&& set WEB_ORIGIN=http://localhost:$WebPort&& set WEB_ORIGINS=$webOrigins&& set SESSION_COOKIE_SECURE=auto&& set SERVE_WEB_DIST=false&& npm run dev:api"
  Start-Process -FilePath "cmd.exe" `
    -ArgumentList @("/d", "/c", $command) `
    -WorkingDirectory $Root `
    -WindowStyle Hidden `
    -RedirectStandardOutput $ApiLog `
    -RedirectStandardError $ApiErrLog

  $deadline = (Get-Date).AddSeconds(60)
  do {
    $health = Test-ApiHealth -Url $HealthUrl
    if ($health.Ok) {
      Write-Host "API iniciada: $HealthUrl"
      return
    }
    Start-Sleep -Seconds 2
  } while ((Get-Date) -lt $deadline)

  throw "API nao respondeu em $HealthUrl. Veja $ApiLog e $ApiErrLog"
}

function Ensure-ApiBuild() {
  $apiServer = Join-Path $ApiDir "dist\src\server.js"
  if (Test-Path -LiteralPath $apiServer) {
    return
  }

  Write-Step "Build da API ausente. Gerando build local"
  Push-Location $Root
  try {
    npm run build:shared
    if ($LASTEXITCODE -ne 0) {
      throw "build:shared falhou"
    }
    npm run build:api
    if ($LASTEXITCODE -ne 0) {
      throw "build:api falhou"
    }
  } finally {
    Pop-Location
  }
}

function Ensure-WebBuild() {
  $webIndex = Join-Path $WebDist "index.html"
  if (Test-Path -LiteralPath $webIndex) {
    return
  }

  Write-Step "Build do frontend ausente. Gerando build local"
  Push-Location $Root
  try {
    $oldExpoOffline = $env:EXPO_OFFLINE
    $env:EXPO_OFFLINE = "1"
    npm run build:web
    if ($LASTEXITCODE -ne 0) {
      throw "build:web falhou"
    }
  } finally {
    $env:EXPO_OFFLINE = $oldExpoOffline
    Pop-Location
  }
}

function Ensure-CombinedApp() {
  $combinedHealthUrl = "http://127.0.0.1:$WebPort/health"
  Write-Step "Verificando API/Web combinados na porta $WebPort"
  $health = Test-ApiHealth -Url $combinedHealthUrl
  if ($health.Ok) {
    Write-Host "API/Web OK: $combinedHealthUrl"
    return
  }

  $existing = Get-PortProcess -ListenPort $WebPort
  if ($existing) {
    throw "Porta $WebPort ocupada por PID $($existing.Id) ($($existing.ProcessName)), mas o healthcheck combinado falhou. Erro: $($health.Error)"
  }

  Ensure-PrismaClient
  Ensure-ApiBuild
  Ensure-WebBuild
  Write-Step "Iniciando API e frontend combinados na porta $WebPort"
  $command = "set PORT=$WebPort&& set SERVE_WEB_DIST=true&& set WEB_DIST_PATH=../web/dist&& node dist/src/server.js"
  Start-Process -FilePath "cmd.exe" `
    -ArgumentList @("/d", "/c", $command) `
    -WorkingDirectory $ApiDir `
    -WindowStyle Hidden `
    -RedirectStandardOutput $CombinedApiLog `
    -RedirectStandardError $CombinedApiErrLog

  $deadline = (Get-Date).AddSeconds(60)
  do {
    $health = Test-ApiHealth -Url $combinedHealthUrl
    if ($health.Ok) {
      Write-Host "API/Web iniciados: $combinedHealthUrl"
      return
    }
    Start-Sleep -Seconds 2
  } while ((Get-Date) -lt $deadline)

  throw "API/Web nao responderam em $combinedHealthUrl. Veja $CombinedApiLog e $CombinedApiErrLog"
}

function Ensure-Web() {
  Write-Step "Verificando frontend na porta $WebPort"
  $web = Test-Url -Url $WebUrl
  if ($web.Ok) {
    Write-Host "Frontend OK: $WebUrl"
    return
  }

  $existing = Get-PortProcess -ListenPort $WebPort
  if ($existing) {
    throw "Porta $WebPort ocupada por PID $($existing.Id) ($($existing.ProcessName)), mas o frontend nao respondeu. Erro: $($web.Error)"
  }

  Ensure-WebBuild
  Write-Step "Iniciando frontend local estavel em $WebUrl"
  $command = "set PORT=$WebPort&& set HOST=0.0.0.0&& npm --workspace @bolao/web run serve:dist"
  Start-Process -FilePath "cmd.exe" `
    -ArgumentList @("/d", "/c", $command) `
    -WorkingDirectory $Root `
    -WindowStyle Hidden `
    -RedirectStandardOutput $WebLog `
    -RedirectStandardError $WebErrLog

  if (-not (Wait-Url -Url $WebUrl -TimeoutSec 45)) {
    throw "Frontend nao respondeu em $WebUrl. Veja $WebLog e $WebErrLog"
  }
  Write-Host "Frontend iniciado: $WebUrl"
}

function Test-WebRuntime() {
  Write-Step "Validando bundle do frontend"
  $page = Invoke-WebRequest -Uri $WebUrl -UseBasicParsing -TimeoutSec 15
  $scriptMatch = [regex]::Match($page.Content, '<script[^>]+src="([^"]+)"')
  if (-not $scriptMatch.Success) {
    throw "O frontend respondeu, mas nao publicou o bundle JavaScript."
  }

  $bundleUrl = [Uri]::new([Uri]$WebUrl, $scriptMatch.Groups[1].Value).AbsoluteUri
  $bundle = Invoke-WebRequest -Uri $bundleUrl -UseBasicParsing -TimeoutSec 120
  if ($bundle.StatusCode -ne 200 -or $bundle.RawContentLength -lt 1000) {
    throw "Bundle do frontend invalido em $bundleUrl."
  }
  Write-Host "Bundle frontend OK: $($bundle.RawContentLength) bytes"
}

function Test-FrontendBackendConnection() {
  Write-Step "Validando conexao frontend -> backend"
  $origin = "http://localhost:$WebPort"
  try {
    $response = Invoke-WebRequest `
      -Uri $HealthUrl `
      -Headers @{ Origin = $origin } `
      -UseBasicParsing `
      -TimeoutSec 10
  } catch {
    throw "Frontend nao conseguiu validar a API em $HealthUrl. Erro: $($_.Exception.Message)"
  }

  if ($response.Headers["Access-Control-Allow-Origin"] -ne $origin) {
    throw "A API respondeu, mas nao autorizou a origem $origin via CORS."
  }

  try {
    $csrfResponse = Invoke-WebRequest `
      -Uri "http://127.0.0.1:$ApiPort/api/auth/csrf" `
      -Headers @{ Origin = $origin } `
      -UseBasicParsing `
      -TimeoutSec 15
    $csrfBody = $csrfResponse.Content | ConvertFrom-Json
  } catch {
    throw "A API respondeu ao healthcheck, mas o endpoint de sessao falhou. Erro: $($_.Exception.Message)"
  }

  if (-not $csrfBody.csrfToken) {
    throw "A API nao retornou o token de sessao esperado."
  }
  Write-Host "Conexao frontend/backend e sessao OK: $origin -> http://127.0.0.1:$ApiPort"
}

function Wait-ForExistingStartup([int]$TimeoutSec = 180) {
  Write-Host "Outra inicializacao do Bolao esta em andamento. Aguardando os servicos ficarem prontos..."
  $deadline = (Get-Date).AddSeconds($TimeoutSec)
  $lastError = $null

  do {
    $apiReady = (Test-ApiHealth -Url $HealthUrl).Ok
    $webReady = (Test-Url -Url $WebUrl -TimeoutSec 5).Ok
    if ($apiReady -and $webReady) {
      try {
        Test-WebRuntime
        Test-FrontendBackendConnection
        return $true
      } catch {
        $lastError = $_.Exception.Message
      }
    }
    Start-Sleep -Seconds 2
  } while ((Get-Date) -lt $deadline)

  if ($lastError) {
    Write-Host "Ultima falha observada: $lastError"
  }
  return $false
}

function Ensure-GeLoop() {
  Write-Step "Verificando loop de atualizacao GE"
  $loop = Get-GeLoopProcesses | Select-Object -First 1

  if ($loop) {
    Write-Host "Loop GE ativo: PID $($loop.ProcessId)"
    return
  }

  if ($NoGeLoop) {
    Write-Host "Loop GE ignorado por -NoGeLoop"
    return
  }

  Start-GeLoop
}

function Show-Summary() {
  $apiProcess = Get-PortProcess -ListenPort $ApiPort
  $webProcess = Get-PortProcess -ListenPort $WebPort
  $postgresReady = & (Join-Path $PgBin "pg_isready.exe") -h localhost -p $PgPort 2>&1
  $geLoop = Get-GeLoopProcesses | Select-Object -First 1

  Write-Host ""
  Write-Host "Resumo:"
  Write-Host "- PostgreSQL ${PgPort}: $postgresReady"
  if ($Combined) {
    if ($webProcess) {
      Write-Host "- API/Web ${WebPort}: PID $($webProcess.Id) ($($webProcess.ProcessName))"
    } else {
      Write-Host "- API/Web ${WebPort}: nao encontrados"
    }
  } else {
    if ($apiProcess) {
      Write-Host "- API ${ApiPort}: PID $($apiProcess.Id) ($($apiProcess.ProcessName))"
    } else {
      Write-Host "- API ${ApiPort}: nao encontrada"
    }
    if ($webProcess) {
      Write-Host "- Frontend ${WebPort}: PID $($webProcess.Id) ($($webProcess.ProcessName))"
    } else {
      Write-Host "- Frontend ${WebPort}: nao encontrado"
    }
  }
  if ($geLoop) {
    Write-Host "- Loop GE: PID $($geLoop.ProcessId)"
  } else {
    Write-Host "- Loop GE: nao encontrado"
  }
  if ($Combined) {
    Write-Host "- Health: http://127.0.0.1:$WebPort/health"
  } else {
    Write-Host "- Health: $HealthUrl"
  }
  Write-Host "- Site: http://localhost:$WebPort"
  if ($Combined) {
    Write-Host "- Logs API/Web: $CombinedApiLog"
  } else {
    Write-Host "- Logs API: $ApiLog"
    Write-Host "- Logs Web: $WebLog"
  }
  Write-Host "- Logs GE: $GeLog"
}

$startupMutex = [System.Threading.Mutex]::new($false, "Local\BolaoCopa2026Startup")
$ownsMutex = $false

try {
  try {
    $ownsMutex = $startupMutex.WaitOne(0)
  } catch [System.Threading.AbandonedMutexException] {
    $ownsMutex = $true
  }

  if (-not $ownsMutex) {
    if (Wait-ForExistingStartup -TimeoutSec 180) {
      Show-Summary
      exit 0
    }
    throw "A inicializacao em andamento nao deixou API e frontend prontos dentro do prazo."
  }

  $envValues = Read-DotEnv (Join-Path $ApiDir ".env")
  if ($envValues.ContainsKey("DATABASE_URL")) {
    try {
      $dbUri = [Uri]$envValues["DATABASE_URL"]
      Write-Host "DB configurado: $($dbUri.Host):$($dbUri.Port)$($dbUri.AbsolutePath) usuario $($dbUri.UserInfo.Split(':')[0])"
    } catch {
      Write-Host "DB configurado, mas nao foi possivel resumir a URL."
    }
  }

  Ensure-Postgres
  Test-Database
  if (-not $Combined) {
    Stop-LegacyCombinedServer
  }
  Ensure-DatabaseMigrations
  Run-FullValidation
  if ($Combined) {
    Ensure-CombinedApp
  } else {
    Ensure-Api
    Ensure-Web
  }
  Test-WebRuntime
  if (-not $Combined) {
    Test-FrontendBackendConnection
  }
  Ensure-GeLoop
  Show-Summary
} finally {
  if ($ownsMutex) {
    $startupMutex.ReleaseMutex()
  }
  $startupMutex.Dispose()
}
