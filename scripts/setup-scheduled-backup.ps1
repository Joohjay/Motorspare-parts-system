<#
.SYNOPSIS
    JM SPAREPARTS — Set up automated daily backups.

.DESCRIPTION
    Registers a Windows Task Scheduler job that runs backup.bat daily
    at 2:00 AM. The job runs whether or not the user is logged in.

    Run this script ONCE to set up scheduled backups.

.EXAMPLE
    .\setup-scheduled-backup.ps1
    .\setup-scheduled-backup.ps1 -Time "03:00"
    .\setup-scheduled-backup.ps1 -Unregister
#>

param(
    [string]$Time = "02:00",
    [switch]$Unregister
)

$ErrorActionPreference = "Stop"

$TaskName = "JM_Spareparts_DailyBackup"
$BackupScript = Join-Path $PSScriptRoot "backup.bat"
$LogDir = Join-Path $PSScriptRoot "..\logs"
$LogFile = Join-Path $LogDir "backup.log"

# ── Unregister if requested ───────────────────────
if ($Unregister) {
    try {
        Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
        Write-Host "Task '$TaskName' removed." -ForegroundColor Green
    } catch {
        Write-Host "Task '$TaskName' was not registered." -ForegroundColor Yellow
    }
    exit 0
}

# ── Verify backup script exists ───────────────────
if (-not (Test-Path $BackupScript)) {
    Write-Host "ERROR: backup.bat not found at $BackupScript" -ForegroundColor Red
    exit 1
}

# ── Create log directory ──────────────────────────
if (-not (Test-Path $LogDir)) {
    New-Item -ItemType Directory -Path $LogDir -Force | Out-Null
}

# ── Remove existing task if any ───────────────────
$existing = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
if ($existing) {
    Write-Host "Updating existing task '$TaskName'..." -ForegroundColor Yellow
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
}

# ── Create the scheduled task ─────────────────────
$action = New-ScheduledTaskAction `
    -Execute "cmd.exe" `
    -Argument "/c `"`"$BackupScript`" >> `"$LogFile`" 2>&1`""

$trigger = New-ScheduledTaskTrigger `
    -Daily `
    -At $Time

$settings = New-ScheduledTaskSettingsSet `
    -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries `
    -StartWhenAvailable `
    -RunOnlyIfNetworkAvailable `
    -ExecutionTimeLimit (New-TimeSpan -Hours 1) `
    -RestartCount 3 `
    -RestartInterval (New-TimeSpan -Minutes 5) `
    -MultipleInstances IgnoreNew

# Run as the current user with highest privileges
$principal = New-ScheduledTaskPrincipal `
    -UserId "$env:USERDOMAIN\$env:USERNAME" `
    -LogonType Interactive `
    -RunLevel Highest

Register-ScheduledTask `
    -TaskName $TaskName `
    -Action $action `
    -Trigger $trigger `
    -Settings $settings `
    -Principal $principal `
    -Description "JM SPAREPARTS: Daily database backup at $Time. Runs pg_dump, cleans old backups, syncs to external drive." `
    -Force

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host " Scheduled backup configured!" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "  Task name:    $TaskName"
Write-Host "  Schedule:     Daily at $Time"
Write-Host "  Script:       $BackupScript"
Write-Host "  Log file:     $LogFile"
Write-Host "  Runs as:      $env:USERDOMAIN\$env:USERNAME"
Write-Host ""
Write-Host " The task will:" -ForegroundColor White
Write-Host "   1. Run pg_dump to create a compressed backup" -ForegroundColor Gray
Write-Host "   2. Clean up backups older than 30 days" -ForegroundColor Gray
Write-Host "   3. Copy to external drive (if connected)" -ForegroundColor Gray
Write-Host ""
Write-Host " To test it now:" -ForegroundColor Yellow
Write-Host "   Start-ScheduledTask -TaskName '$TaskName'" -ForegroundColor White
Write-Host ""
Write-Host " To remove it:" -ForegroundColor Yellow
Write-Host "   .\setup-scheduled-backup.ps1 -Unregister" -ForegroundColor White
Write-Host ""
Write-Host " To change the time (e.g., 3:00 AM):" -ForegroundColor Yellow
Write-Host "   .\setup-scheduled-backup.ps1 -Time '03:00'" -ForegroundColor White
Write-Host ""
