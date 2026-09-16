#Requires -RunAsAdministrator
<#
.SYNOPSIS
    Installs homepulse-client as an auto-starting Windows Service.

.DESCRIPTION
    Mirrors packaging/install.sh for Windows. Expects to be run from inside
    the extracted homepulse-client-windows-x86_64.zip, alongside the
    homepulse-client.exe it installs: copies it into place, writes the
    config file, and registers + starts the Windows Service via the
    binary's own `install`/`start` subcommands (see src/windows_service.rs).

    HouseholdId and ApiKey come from the app's Client screen. The three
    Cloud Function URLs are this deployment's endpoints, from
    `terraform output` (see
    backend/homepulse-notification-server/terraform/outputs.tf: whoami_url,
    ingest_heartbeat_url, ingest_speedtest_url).

.EXAMPLE
    .\install.ps1 -HouseholdId <id> -ApiKey <key> -WhoamiUrl <url> `
        -HeartbeatUrl <url> -SpeedtestUrl <url>
#>
param(
    [Parameter(Mandatory = $true)] [string] $HouseholdId,
    [Parameter(Mandatory = $true)] [string] $ApiKey,
    [Parameter(Mandatory = $true)] [string] $WhoamiUrl,
    [Parameter(Mandatory = $true)] [string] $HeartbeatUrl,
    [Parameter(Mandatory = $true)] [string] $SpeedtestUrl
)

$ErrorActionPreference = "Stop"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$InstallDir = "$env:ProgramFiles\HomePulseClient"
$ConfigDir = "$env:ProgramData\homepulse-client"
$ConfigPath = "$ConfigDir\config.json"
$ExePath = "$InstallDir\homepulse-client.exe"

Write-Host "Installing homepulse-client..."
New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null
Copy-Item -Path "$ScriptDir\homepulse-client.exe" -Destination $ExePath -Force

Write-Host "Writing $ConfigPath..."
New-Item -ItemType Directory -Force -Path $ConfigDir | Out-Null
$Config = @{
    heartbeat = @{
        interval_minutes = 1
        whoami_url       = $WhoamiUrl
    }
    speedtest = @{
        binary_path      = "speedtest.exe"
        timeout_seconds  = 60
        interval_minutes = 60
        whoami_url       = $WhoamiUrl
    }
    ingest = @{
        api_key       = $ApiKey
        household_id  = $HouseholdId
        heartbeat_url = $HeartbeatUrl
        speedtest_url = $SpeedtestUrl
    }
}
$Config | ConvertTo-Json -Depth 5 | Set-Content -Path $ConfigPath -Encoding utf8

Write-Host "Registering the HomePulseClient Windows Service..."
& $ExePath install --config $ConfigPath
if ($LASTEXITCODE -ne 0) { throw "homepulse-client.exe install failed with exit code $LASTEXITCODE" }

& $ExePath start
if ($LASTEXITCODE -ne 0) { throw "homepulse-client.exe start failed with exit code $LASTEXITCODE" }

Write-Host "Done. Check status with: Get-Service HomePulseClient"
Write-Host "Logs: Event Viewer > Windows Logs > Application, source 'HomePulseClient'."
