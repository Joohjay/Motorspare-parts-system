<#
.SYNOPSIS
    JM SPAREPARTS — Register drive monitor to start on Windows login.

.DESCRIPTION
    WHAT THIS SCRIPT DOES:
    ──────────────────────
    Registers backup-notify.ps1 to run automatically every time you
    log into Windows. The monitor runs silently in the background
    and shows a popup when you plug in the external hard drive.

    HOW IT FITS INTO THE BACKUP SYSTEM:
    ─────────────────────────────────────
    This script is called by setup-all.ps1 during initial PC setup.
    You normally don't need to run this manually.

    The flow:
      Windows login
        └── enable-backup-monitor.ps1 registered task starts
              └── backup-notify.ps1 runs (hidden, background)
                    └── Watches for E: drive every 3 seconds
                          └── Drive plugged in → Popup: "Backup now?"

    WHAT HAPPENS IN THE BACKGROUND:
    ────────────────────────────────
    When you log into Windows, a hidden PowerShell window starts
    running backup-notify.ps1. You won't see any window — it just
    sits in the background watching for the drive. When you plug
    in the external HDD, you get a toast notification and a popup.

    To stop the monitor: Close the background process or restart Windows.

.PARAMETER DriveLetter
    Drive letter to watch for. Default: E:

.PARAMETER Disable
    Removes the startup task. Run: .\enable-backup-monitor.ps1 -Disable

.EXAMPLE
    .\enable-backup-monitor.ps1
    .\enable-backup-monitor.ps1 -DriveLetter F:
    .\enable-backup-monitor.ps1 -Disable

.NOTES
    Requires: Windows 10/11, Administrator rights for Task Scheduler
    Task name: JM_Spareparts_BackupMonitor
#>

param(
    [string]$DriveLetter = "E:",
    [switch]$Disable
)

$ErrorActionPreference = "Stop"

$TaskName = "JM_Spareparts_BackupMonitor"
$ScriptPath = Join-Path $PSScriptRoot "backup-notify.ps1"

# ── Unregister if requested ───────────────────────
#  Removes the startup task so the monitor no longer runs on login.
if ($Disable) {
    try {
        Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
        Write-Host "Backup monitor disabled." -ForegroundColor Green
    } catch {
        Write-Host "Backup monitor was not registered." -ForegroundColor Yellow
    }
    exit 0
}

# ── Verify script exists ──────────────────────────
#  The monitor script must be in the same directory as this script.
if (-not (Test-Path $ScriptPath)) {
    Write-Host "ERROR: backup-notify.ps1 not found at $ScriptPath" -ForegroundColor Red
    exit 1
}

# ── Remove existing task ──────────────────────────
#  If a task already exists, remove it first to avoid duplicates.
$existing = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
if ($existing) {
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
}

# ── Register: runs at user logon, hidden window ───
#  The task starts when the user logs in. It runs PowerShell with
#  -WindowStyle Hidden so no console window appears. The monitor
#  runs until the user logs out (no time limit).
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
