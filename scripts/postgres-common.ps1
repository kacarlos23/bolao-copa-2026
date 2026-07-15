Set-StrictMode -Version Latest

function Resolve-PgExecutable {
  param(
    [string]$ConfiguredPath,
    [Parameter(Mandatory = $true)]
    [string]$ToolName
  )

  if (-not [string]::IsNullOrWhiteSpace($ConfiguredPath)) {
    $configuredCommand = Get-Command $ConfiguredPath -ErrorAction SilentlyContinue
    if ($null -eq $configuredCommand) {
      throw "$ToolName nao encontrado no caminho configurado: $ConfiguredPath"
    }
    return $configuredCommand.Source
  }

  $pathCommand = Get-Command $ToolName -ErrorAction SilentlyContinue
  if ($null -ne $pathCommand) {
    return $pathCommand.Source
  }

  if ($env:ProgramFiles) {
    $postgresRoot = Join-Path $env:ProgramFiles "PostgreSQL"
    if (Test-Path -LiteralPath $postgresRoot) {
      $candidate = Get-ChildItem -Path (Join-Path $postgresRoot "*\bin\$ToolName.exe") -ErrorAction SilentlyContinue |
        Sort-Object { [int]($_.Directory.Parent.Name -replace '[^0-9].*$', '') } -Descending |
        Select-Object -First 1
      if ($null -ne $candidate) {
        return $candidate.FullName
      }
    }
  }

  throw "$ToolName nao encontrado. Configure o caminho correspondente ou adicione o PostgreSQL ao PATH."
}

function Get-PgConnection {
  param(
    [Parameter(Mandatory = $true)]
    [string]$DatabaseUrl
  )

  try {
    $uri = [Uri]$DatabaseUrl
  } catch {
    throw "URL do PostgreSQL invalida."
  }

  if ($uri.Scheme -notin @("postgres", "postgresql")) {
    throw "A URL deve usar o protocolo postgres:// ou postgresql://."
  }

  $userInfo = $uri.UserInfo -split ":", 2
  if ($userInfo.Count -lt 1 -or [string]::IsNullOrWhiteSpace($userInfo[0])) {
    throw "A URL do PostgreSQL deve informar o usuario."
  }

  $database = [Uri]::UnescapeDataString($uri.AbsolutePath.TrimStart("/"))
  if ([string]::IsNullOrWhiteSpace($database)) {
    throw "A URL do PostgreSQL deve informar o banco."
  }

  $password = if ($userInfo.Count -eq 2) { [Uri]::UnescapeDataString($userInfo[1]) } else { "" }
  $sslMode = $null
  foreach ($item in $uri.Query.TrimStart("?") -split "&") {
    if ([string]::IsNullOrWhiteSpace($item)) { continue }
    $pair = $item -split "=", 2
    if ([Uri]::UnescapeDataString($pair[0]) -eq "sslmode" -and $pair.Count -eq 2) {
      $sslMode = [Uri]::UnescapeDataString($pair[1])
    }
  }

  return [PSCustomObject]@{
    RawUrl = $DatabaseUrl
    Host = $uri.Host
    Port = if ($uri.IsDefaultPort) { 5432 } else { $uri.Port }
    Username = [Uri]::UnescapeDataString($userInfo[0])
    Password = $password
    Database = $database
    SslMode = $sslMode
  }
}

function Get-PgConnectionArguments {
  param(
    [Parameter(Mandatory = $true)]
    [PSCustomObject]$Connection,
    [string]$DatabaseName = $Connection.Database
  )

  return @(
    "--host", $Connection.Host,
    "--port", [string]$Connection.Port,
    "--username", $Connection.Username,
    "--dbname", $DatabaseName
  )
}

function Invoke-PgCommand {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Executable,
    [Parameter(Mandatory = $true)]
    [string[]]$Arguments,
    [PSCustomObject]$Connection,
    [Parameter(Mandatory = $true)]
    [string]$FailureMessage,
    [switch]$SuppressOutput
  )

  $previousPassword = [Environment]::GetEnvironmentVariable("PGPASSWORD", "Process")
  $previousSslMode = [Environment]::GetEnvironmentVariable("PGSSLMODE", "Process")
  $exitCode = -1

  try {
    if ($null -ne $Connection) {
      [Environment]::SetEnvironmentVariable("PGPASSWORD", $Connection.Password, "Process")
      if (-not [string]::IsNullOrWhiteSpace($Connection.SslMode)) {
        [Environment]::SetEnvironmentVariable("PGSSLMODE", $Connection.SslMode, "Process")
      } else {
        [Environment]::SetEnvironmentVariable("PGSSLMODE", $null, "Process")
      }
    }

    if ($SuppressOutput) {
      & $Executable @Arguments | Out-Null
    } else {
      & $Executable @Arguments
    }
    $exitCode = $LASTEXITCODE
  } finally {
    [Environment]::SetEnvironmentVariable("PGPASSWORD", $previousPassword, "Process")
    [Environment]::SetEnvironmentVariable(
      "PGSSLMODE",
      $(if ([string]::IsNullOrWhiteSpace($previousSslMode)) { $null } else { $previousSslMode }),
      "Process"
    )
  }

  if ($exitCode -ne 0) {
    throw "$FailureMessage Codigo: $exitCode."
  }
}

function New-PgDatabaseUrl {
  param(
    [Parameter(Mandatory = $true)]
    [string]$DatabaseUrl,
    [Parameter(Mandatory = $true)]
    [string]$DatabaseName
  )

  $builder = [UriBuilder]$DatabaseUrl
  $builder.Path = "/$DatabaseName"
  return $builder.Uri.AbsoluteUri
}
