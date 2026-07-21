param(
  [string]$TaskName = "Bolao Copa 2026 - Inicializar"
)

$ErrorActionPreference = "Stop"

$root = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$batchFile = Join-Path $root "iniciar-bolao.bat"

if (-not (Test-Path -LiteralPath $batchFile)) {
  throw "Arquivo de inicializacao nao encontrado: $batchFile"
}

$userId = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
$quotedBatchFile = '"' + $batchFile + '"'
$action = New-ScheduledTaskAction `
  -Execute "$env:SystemRoot\System32\cmd.exe" `
  -Argument "/d /c $quotedBatchFile --silent" `
  -WorkingDirectory $root
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $userId
$principal = New-ScheduledTaskPrincipal `
  -UserId $userId `
  -LogonType Interactive `
  -RunLevel Limited
$settings = New-ScheduledTaskSettingsSet `
  -AllowStartIfOnBatteries `
  -DontStopIfGoingOnBatteries `
  -StartWhenAvailable `
  -RestartCount 3 `
  -RestartInterval (New-TimeSpan -Minutes 1) `
  -ExecutionTimeLimit (New-TimeSpan -Hours 1)
$settings.Hidden = $true

$task = Register-ScheduledTask `
  -TaskName $TaskName `
  -Action $action `
  -Trigger $trigger `
  -Principal $principal `
  -Settings $settings `
  -Description "Inicializa PostgreSQL, API, frontend e sincronizacao do Bolao Copa 2026 sem duplicar processos." `
  -Force

Write-Host "Tarefa automatica registrada: $($task.TaskName)"
Write-Host "Usuario: $userId"
Write-Host "Acao: $batchFile --silent"
