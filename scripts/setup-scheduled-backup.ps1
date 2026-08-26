<#
.SYNOPSIS
    JM SPAREPARTS — Register daily backup task in Windows Task Scheduler.

.DESCRIPTION
    WHAT THIS SCRIPT DOES:
    ──────────────────────
    Registers a Windows Task Scheduler job that runs backup.bat
    every day at the specified time (default: 2:00 AM). The job
    runs whether or not you are logged in.

    HOW IT FITS INTO THE BACKUP SYSTEM:
    ─────────────────────────────────────
    This is the AUTOMATION layer. Without this script, you'd have
    to remember to run backup.bat manually every day. With it,
    backups happen automatically while you sleep.

    The flow:
      Windows Task Scheduler (daily at 2 AM)
        └── backup.bat
              ├── pg_dump → ..\backups\makire_motorparts_YYYYMMDD_HHMMSS.dump
              ├── Deletes .dump files older than 30 days
              └── If E: connected → copies to E:\jm-backups\

    This script is called by setup-all.ps1 during initial PC setup.
    You normally don't need to run this manually.

    WHAT THE TASK DOES:
    ────────────────────
    ✓ Runs backup.bat with output logged to ..\logs\backup.log
    ✓ Runs daily at 2:00 AM (configurable)
    ✓ Runs even if PC is asleep (StartWhenAvailable)
    ✓ Retries up to 3 times if it fails (5 min between retries)
    ✓ Runs for max 1 hour (then killed — backup should finish in minutes)
    ✓ Runs whether or not you're logged in

.PARAMETER Time
    Time to run the backup. Default: 02:00 (2:00 AM)
    Format: HH:MM (24-hour)

.PARAMETER Unregister
    Removes the scheduled task. Run: .\setup-scheduled-backup.ps1 -Unregister

.EXAMPLE
    .\setup-scheduled-backup.ps1
    .\setup-scheduled-backup.ps1 -Time "03:00"
    .\setup-scheduled-backup.ps1 -Unregister

.NOTES
    Requires: Administrator rights for Task Scheduler
    Task name: JM_Spareparts_DailyBackup
    Log file: ..\logs\backup.log
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
#  Removes the scheduled task. Use this to stop automatic backups.
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
#  The scheduled task needs backup.bat to exist in the scripts folder.
if (-not (Test-Path $BackupScript)) {
    Write-Host "ERROR: backup.bat not found at $BackupScript" -ForegroundColor Red
    exit 1
}

# ── Create log directory ──────────────────────────
#  Backup output is logged to ..\logs\backup.log for debugging.
if (-not (Test-Path $LogDir)) {
    New-Item -ItemType Directory -Path $LogDir -Force | Out-Null
}

# ── Remove existing task if any ───────────────────
#  If a task already exists with the same name, remove it first.
$existing = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
if ($existing) {
    Write-Host "Updating existing task '$TaskName'..." -ForegroundColor Yellow
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
}

# ── Create the scheduled task ─────────────────────
#  The task runs: cmd.exe /c "backup.bat >> backup.log 2>&1"
#  This redirects all output (stdout + stderr) to the log file.
$action = New-ScheduledTaskAction `
    -Execute "cmd.exe" `
    -Argument "/c `"`"$BackupScript`" >> `"$LogFile`" 2>&1`""

# Daily trigger at the specified time
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
