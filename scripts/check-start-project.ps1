param(
  [int]$Port = 8080,
  [string]$PgBin = "C:\Program Files\PostgreSQL\18\bin",
  [string]$DataDir = ".\.postgres-data",
  [switch]$FullValidation,
  [switch]$NoGeLoop
)

$ErrorActionPreference = "Stop"

$Root = Resolve-Path (Join-Path $PSScriptRoot "..")
$ApiDir = Join-Path $Root "apps\api"
$WebDist = Join-Path $Root "apps\web\dist"
$LogsDir = Join-Path $Root "logs"
$ApiLog = Join-Path $LogsDir "api-8080.log"
$ApiErrLog = Join-Path $LogsDir "api-8080-error.log"
$GeLog = Join-Path $LogsDir "ge-score-sync.log"
$GeErrLog = Join-Path $LogsDir "ge-score-sync-error.log"
$HealthUrl = "http://127.0.0.1:$Port/health"
$WebUrl = "http://127.0.0.1:$Port/"

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
  $resolvedDataDir = Resolve-Path (Join-Path $Root $DataDir)

  if (-not (Test-Path -LiteralPath $pgCtl)) {
    throw "pg_ctl.exe nao encontrado em $pgCtl"
  }

  if (-not (Test-Path -LiteralPath $pgIsReady)) {
    throw "pg_isready.exe nao encontrado em $pgIsReady"
  }

  Write-Step "Verificando PostgreSQL do projeto em $resolvedDataDir"
  $statusOutput = & $pgCtl -D $resolvedDataDir status 2>&1
  if ($LASTEXITCODE -ne 0) {
    Write-Step "PostgreSQL do projeto parado. Iniciando na porta configurada do cluster"
    $postgresLog = Join-Path $LogsDir "postgres-project.log"
    # Nao canalize a saida do pg_ctl: o postgres filho pode herdar o pipe e
    # impedir que uma inicializacao automatica com log redirecionado termine.
    & $pgCtl -D $resolvedDataDir -l $postgresLog start
    if ($LASTEXITCODE -ne 0) {
      throw "Falha ao iniciar PostgreSQL do projeto. Veja $postgresLog"
    }
  } else {
    Write-Host ($statusOutput -join "`n")
  }

  $ready = & $pgIsReady -h localhost -p 5433 2>&1
  if ($LASTEXITCODE -ne 0) {
    throw "PostgreSQL nao respondeu em localhost:5433. Saida: $ready"
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

function Ensure-Builds() {
  $apiServer = Join-Path $ApiDir "dist\src\server.js"
  $webIndex = Join-Path $WebDist "index.html"

  if (-not (Test-Path -LiteralPath $apiServer) -or -not (Test-Path -LiteralPath $webIndex)) {
    Write-Step "Build ausente. Executando npm run build"
    Push-Location $Root
    try {
      npm run build
      if ($LASTEXITCODE -ne 0) {
        throw "npm run build falhou"
      }
    } finally {
      Pop-Location
    }
  }
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

function Ensure-App8080() {
  Write-Step "Verificando API/Web na porta $Port"
  $health = Test-Url -Url $HealthUrl
  if ($health.Ok) {
    Write-Host "API OK: $HealthUrl"
  } else {
    $existing = Get-PortProcess -ListenPort $Port
    if ($existing) {
      throw "Porta $Port ocupada por PID $($existing.Id) ($($existing.ProcessName)), mas o healthcheck falhou. Inicializacao cancelada para evitar processo duplicado. Erro: $($health.Error)"
    } else {
      Write-Step "Nada escutando na porta $Port. Iniciando API com web dist"
    }

    $command = "set PORT=$Port&& set SERVE_WEB_DIST=true&& set WEB_DIST_PATH=../web/dist&& set WEB_ORIGIN=http://localhost:$Port&& node dist/src/server.js"
    Start-Process -FilePath "cmd.exe" `
      -ArgumentList @("/c", $command) `
      -WorkingDirectory $ApiDir `
      -WindowStyle Hidden `
      -RedirectStandardOutput $ApiLog `
      -RedirectStandardError $ApiErrLog

    if (-not (Wait-Url -Url $HealthUrl -TimeoutSec 60)) {
      throw "API nao respondeu em $HealthUrl. Veja $ApiLog e $ApiErrLog"
    }
    Write-Host "API iniciada: $HealthUrl"
  }

  $web = Test-Url -Url $WebUrl
  if (-not $web.Ok) {
    throw "Frontend servido pela API falhou em $WebUrl. Erro: $($web.Error)"
  }
  Write-Host "Frontend OK: $WebUrl"
}

function Ensure-GeLoop() {
  if ($NoGeLoop) {
    Write-Host "Loop GE ignorado por -NoGeLoop"
    return
  }

  Write-Step "Verificando loop de atualizacao GE"
  $loop = Get-CimInstance Win32_Process | Where-Object {
    $_.CommandLine -and $_.CommandLine -match "scrape-ge-scores\.ts --watch"
  } | Select-Object -First 1

  if ($loop) {
    Write-Host "Loop GE ativo: PID $($loop.ProcessId)"
    return
  }

  Write-Step "Loop GE parado. Iniciando scraper em watch"
  Start-Process -FilePath "cmd.exe" `
    -ArgumentList @("/c", "scripts\iniciar-atualizacao-ge-loop.bat") `
    -WorkingDirectory $Root `
    -WindowStyle Hidden `
    -RedirectStandardOutput $GeLog `
    -RedirectStandardError $GeErrLog

  Start-Sleep -Seconds 5
  $loop = Get-CimInstance Win32_Process | Where-Object {
    $_.CommandLine -and $_.CommandLine -match "scrape-ge-scores\.ts --watch"
  } | Select-Object -First 1

  if (-not $loop) {
    throw "Loop GE nao iniciou. Veja $GeLog e $GeErrLog"
  }

  Write-Host "Loop GE iniciado: PID $($loop.ProcessId)"
}

function Show-Summary() {
  $apiProcess = Get-PortProcess -ListenPort $Port
  $postgresReady = & (Join-Path $PgBin "pg_isready.exe") -h localhost -p 5433 2>&1
  $geLoop = Get-CimInstance Win32_Process | Where-Object {
    $_.CommandLine -and $_.CommandLine -match "scrape-ge-scores\.ts --watch"
  } | Select-Object -First 1

  Write-Host ""
  Write-Host "Resumo:"
  Write-Host "- PostgreSQL 5433: $postgresReady"
  if ($apiProcess) {
    Write-Host "- API/Web ${Port}: PID $($apiProcess.Id) ($($apiProcess.ProcessName))"
  } else {
    Write-Host "- API/Web ${Port}: nao encontrado"
  }
  if ($geLoop) {
    Write-Host "- Loop GE: PID $($geLoop.ProcessId)"
  } else {
    Write-Host "- Loop GE: nao encontrado"
  }
  Write-Host "- Health: $HealthUrl"
  Write-Host "- Site: http://localhost:$Port"
  Write-Host "- Logs API: $ApiLog"
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
    Write-Host "Outra inicializacao do Bolao ja esta em andamento. Nenhuma nova instancia sera criada."
    exit 0
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
  Run-FullValidation
  Ensure-Builds
  Ensure-App8080
  Ensure-GeLoop
  Show-Summary
} finally {
  if ($ownsMutex) {
    $startupMutex.ReleaseMutex()
  }
  $startupMutex.Dispose()
}
