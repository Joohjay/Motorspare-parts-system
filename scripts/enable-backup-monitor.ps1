<#
.SYNOPSIS
    JM SPAREPARTS — Start backup monitor on Windows login.

.DESCRIPTION
    Registers the backup-notify.ps1 script to run automatically
    when you log into Windows. Shows a popup whenever you plug
    in the external hard drive.

    Run this ONCE to enable auto-start. Run with -Disable to stop.

.EXAMPLE
    .\enable-backup-monitor.ps1          # Enable
    .\enable-backup-monitor.ps1 -Disable # Disable
#>

param(
    [string]$DriveLetter = "E:",
    [switch]$Disable
)

$ErrorActionPreference = "Stop"

$TaskName = "JM_Spareparts_BackupMonitor"
$ScriptPath = Join-Path $PSScriptRoot "backup-notify.ps1"

if ($Disable) {
    try {
        Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
        Write-Host "Backup monitor disabled." -ForegroundColor Green
    } catch {
        Write-Host "Backup monitor was not registered." -ForegroundColor Yellow
    }
    exit 0
}

# Verify script exists
if (-not (Test-Path $ScriptPath)) {
    Write-Host "ERROR: backup-notify.ps1 not found at $ScriptPath" -ForegroundColor Red
    exit 1
}

# Remove existing task
$existing = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
if ($existing) {
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
}

# Register: runs at user logon, hidden window
$action = New-ScheduledTaskAction `
    -Execute "powershell.exe" `
    -Argument "-WindowStyle Hidden -ExecutionPolicy Bypass -File `"$ScriptPath`" -DriveLetter $DriveLetter"

$trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME

$settings = New-ScheduledTaskSettingsSet `
    -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries `
    -StartWhenAvailable `
    -ExecutionTimeLimit (New-TimeSpan -Hours 0) ` # No limit — runs until logout
    -MultipleInstances IgnoreNew

$principal = New-ScheduledTaskPrincipal `
    -UserId "$env:USERDOMAIN\$env:USERNAME" `
    -LogonType Interactive `
    -RunLevel Limited

Register-ScheduledTask `
    -TaskName $TaskName `
    -Action $action `
    -Trigger $trigger `
    -Settings $settings `
    -Principal $principal `
    -Description "JM SPAREPARTS: Monitors for external drive and prompts for backup." `
    -Force

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host " Backup monitor enabled!" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "  Task name:  $TaskName"
Write-Host "  Watches:    $DriveLetter drive"
Write-Host "  Starts:     On Windows login"
Write-Host "  Script:     $ScriptPath"
Write-Host ""
Write-Host " When you plug in the external drive:" -ForegroundColor White
Write-Host "   A popup will ask if you want to backup now." -ForegroundColor Gray
Write-Host ""
Write-Host " To disable:" -ForegroundColor Yellow
Write-Host "   .\enable-backup-monitor.ps1 -Disable" -ForegroundColor White
Write-Host ""
