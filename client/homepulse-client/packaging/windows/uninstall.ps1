#Requires -RunAsAdministrator
<#
.SYNOPSIS
    Removes the homepulse-client Windows Service and installation files.

.DESCRIPTION
    Stops and unregisters the service via the binary's own `stop`/`uninstall`
    subcommands, then removes the installed executable. The config file
    under %ProgramData%\homepulse-client (which holds the API key) is kept
    by default, so an accidental reinstall doesn't require re-issuing a key
    — pass -RemoveConfig to delete it too.

.EXAMPLE
    .\uninstall.ps1
.EXAMPLE
    .\uninstall.ps1 -RemoveConfig
#>
param(
    [switch] $RemoveConfig
)

$ErrorActionPreference = "Stop"

$InstallDir = "$env:ProgramFiles\HomePulseClient"
$ConfigDir = "$env:ProgramData\homepulse-client"
$ExePath = "$InstallDir\homepulse-client.exe"

if (Test-Path $ExePath) {
    Write-Host "Stopping the HomePulseClient service..."
    & $ExePath stop
    Write-Host "Unregistering the HomePulseClient service..."
    & $ExePath uninstall
} else {
    Write-Warning "$ExePath not found; skipping service stop/uninstall."
}

Write-Host "Removing $InstallDir..."
Remove-Item -Recurse -Force -Path $InstallDir -ErrorAction SilentlyContinue

if ($RemoveConfig) {
    Write-Host "Removing $ConfigDir..."
    Remove-Item -Recurse -Force -Path $ConfigDir -ErrorAction SilentlyContinue
} else {
    Write-Host "Keeping config at $ConfigDir (pass -RemoveConfig to delete it too)."
}

Write-Host "Done."
