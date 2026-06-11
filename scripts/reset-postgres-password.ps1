param(
  [Parameter(Mandatory = $true)]
  [string]$NewPassword,

  [string]$ServiceName = 'postgresql-x64-18',
  [string]$DataDir = 'C:\Program Files\PostgreSQL\18\data',
  [string]$PsqlPath = 'C:\Program Files\PostgreSQL\18\bin\psql.exe',
  [int]$Port = 5433
)

$ErrorActionPreference = 'Stop'

$hba = Join-Path $DataDir 'pg_hba.conf'
$backup = Join-Path $DataDir ('pg_hba.conf.reset-backup-' + (Get-Date -Format 'yyyyMMddHHmmss'))

$principal = [Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()
$isAdmin = $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) {
  throw 'Abra o PowerShell como Administrador e rode este script novamente.'
}

$originalContent = Get-Content -LiteralPath $hba
Copy-Item -LiteralPath $hba -Destination $backup -Force

$temporaryTrustRules = @(
  '# TEMPORARIO para redefinir senha local. Removido automaticamente pelo script.',
  'host    all             postgres        127.0.0.1/32            trust',
  'host    all             postgres        ::1/128                 trust',
  'host    all             all             127.0.0.1/32            trust',
  'host    all             all             ::1/128                 trust',
  ''
)

function Wait-PostgresServiceRunning {
  param([int]$TimeoutSeconds = 30)

  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  do {
    $service = Get-Service $ServiceName
    if ($service.Status -eq 'Running') {
      return
    }
    Start-Sleep -Seconds 1
  } while ((Get-Date) -lt $deadline)

  throw "O servico $ServiceName nao ficou Running dentro de $TimeoutSeconds segundos."
}

try {
  Set-Content -LiteralPath $hba -Value ($temporaryTrustRules + $originalContent) -Encoding ascii
  Restart-Service $ServiceName -Force
  Wait-PostgresServiceRunning
  Start-Sleep -Seconds 3

  $escapedPassword = $NewPassword.Replace("'", "''")
  & $PsqlPath -h 127.0.0.1 -p $Port -U postgres -d postgres -w -c "ALTER USER postgres WITH PASSWORD '$escapedPassword';"
  if ($LASTEXITCODE -ne 0) {
    throw "ALTER USER falhou com codigo $LASTEXITCODE"
  }
} finally {
  Copy-Item -LiteralPath $backup -Destination $hba -Force
  Restart-Service $ServiceName -Force
  Wait-PostgresServiceRunning
  Start-Sleep -Seconds 3
}

$env:PGPASSWORD = $NewPassword
try {
  & $PsqlPath -h 127.0.0.1 -p $Port -U postgres -d postgres -c "SELECT current_user, inet_server_port();"
  if ($LASTEXITCODE -ne 0) {
    throw "Teste de login falhou com codigo $LASTEXITCODE"
  }
} finally {
  Remove-Item Env:\PGPASSWORD -ErrorAction SilentlyContinue
}

Write-Host "Senha do usuario postgres alterada com sucesso."
Write-Host "Backup do pg_hba.conf: $backup"
