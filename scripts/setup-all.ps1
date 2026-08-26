<#
.SYNOPSIS
    JM SPAREPARTS — One-time setup on a new PC (run this first after transfer).

.DESCRIPTION
    WHAT THIS SCRIPT DOES:
    ──────────────────────
    This is the FIRST script to run when you transfer the JM SPAREPARTS
    system to a new computer. It sets up everything needed for automated
    backups with one command.

    It performs 4 steps:
      1. Checks if PostgreSQL is installed (needed for pg_dump.exe)
      2. Creates backup and log directories (..\backups\ and ..\logs\)
      3. Registers daily backup task (runs at 2 AM via Task Scheduler)
      4. Registers drive monitor (shows popup when external drive is plugged in)

    HOW IT FITS INTO THE BACKUP SYSTEM:
    ─────────────────────────────────────
    When you copy the project folder to a new PC, the backup SCRIPTS
    come with it, but the Windows TASK SCHEDULER jobs don't — they're
    stored in the Windows registry, not in files.

    This script bridges that gap. It registers the tasks on the new PC
    so backups work automatically.

    WHAT TRANSFERS vs WHAT DOESN'T:
    ────────────────────────────────
    Component                    Transfers?    Action needed
    ─────────────────────────    ──────────    ─────────────
    Scripts (.bat, .ps1)         ✅ Yes        None
    Task Scheduler (daily)       ❌ No         Run this script
    Drive monitor (popup)        ❌ No         Run this script
    Backups on external HDD      ✅ Yes        Just plug it in

    AFTER RUNNING THIS SCRIPT:
    ───────────────────────────
    ✓ Backups run automatically at 2 AM every day
    ✓ When you plug in the external drive, you get a popup
    ✓ You can test immediately: .\backup.bat

    PREREQUISITES:
    ──────────────
    - Run as Administrator (Task Scheduler requires admin rights)
    - PostgreSQL installed (download from https://www.postgresql.org/download/windows/)
    - The JM SPAREPARTS project folder already on this PC

.PARAMETER DriveLetter
    Drive letter of your external hard drive. Default: E:
    Find your drive letter: Open File Explorer → This PC → look for your drive.

.PARAMETER BackupTime
    Time for daily backups. Default: 02:00 (2:00 AM)
    Format: HH:MM (24-hour)

.EXAMPLE
    .\setup-all.ps1
    .\setup-all.ps1 -DriveLetter F:
    .\setup-all.ps1 -BackupTime "03:00" -DriveLetter F:

.NOTES
    Safe to run multiple times — re-registers tasks without errors.
    To undo everything: .\setup-all.ps1 -Unregister (not implemented, use individual scripts)
#>

param(
    [string]$DriveLetter = "E:",
    [string]$BackupTime = "02:00"
)

$ErrorActionPreference = "Stop"

$ScriptsDir = $PSScriptRoot
$BackupScript = Join-Path $ScriptsDir "backup.bat"
$NotifyScript = Join-Path $ScriptsDir "backup-notify.ps1"
$SetupBackup = Join-Path $ScriptsDir "setup-scheduled-backup.ps1"
$SetupMonitor = Join-Path $ScriptsDir "enable-backup-monitor.ps1"
$BackupDir = Join-Path $ScriptsDir "..\backups"
$LogDir = Join-Path $ScriptsDir "..\logs"

Write-Host ""
Write-Host "============================================" -ForegroundColor Cyan
Write-Host " JM SPAREPARTS — Initial PC Setup" -ForegroundColor Cyan
Write-Host "============================================" -ForegroundColor Cyan
Write-Host ""
Write-Host " Run this once after transferring the system to a new PC." -ForegroundColor Gray
Write-Host ""

# ── Step 1: Check PostgreSQL ──────────────────────
#  PostgreSQL must be installed for pg_dump.exe to work.
#  Checks common install paths (versions 14-18) and system PATH.
Write-Host "[1/4] Checking PostgreSQL..." -ForegroundColor White

$pgFound = $false
foreach ($V in @(18, 17, 16, 15, 14)) {
    $pgPath = "C:\Program Files\PostgreSQL\$V\bin\pg_dump.exe"
    if (Test-Path $pgPath) {
        Write-Host "  Found: PostgreSQL $V" -ForegroundColor Green
        $pgFound = $true
        break
    }
}

if (-not $pgFound) {
    try {
        $null = & where.exe pg_dump.exe 2>$null
        Write-Host "  Found: pg_dump.exe on PATH" -ForegroundColor Green
        $pgFound = $true
    } catch {
        Write-Host "  NOT FOUND" -ForegroundColor Red
    }
}

if (-not $pgFound) {
    Write-Host ""
    Write-Host "  ERROR: PostgreSQL not installed!" -ForegroundColor Red
    Write-Host "  Install from: https://www.postgresql.org/download/windows/" -ForegroundColor Yellow
    Write-Host "  Or set PG_BIN env var to the PostgreSQL bin directory." -ForegroundColor Yellow
    Write-Host ""
    $continue = Read-Host "  Continue anyway? (Y/N)"
    if ($continue -ne "Y") { exit 1 }
}

# ── Step 2: Create directories ────────────────────
#  Creates the backups folder (where .dump files are saved)
#  and the logs folder (where backup.log is written).
Write-Host ""
Write-Host "[2/4] Creating directories..." -ForegroundColor White

if (-not (Test-Path $BackupDir)) {
    New-Item -ItemType Directory -Path $BackupDir -Force | Out-Null
    Write-Host "  Created: $BackupDir" -ForegroundColor Green
} else {
    Write-Host "  Exists:  $BackupDir" -ForegroundColor Gray
}

if (-not (Test-Path $LogDir)) {
    New-Item -ItemType Directory -Path $LogDir -Force | Out-Null
    Write-Host "  Created: $LogDir" -ForegroundColor Green
} else {
    Write-Host "  Exists:  $LogDir" -ForegroundColor Gray
}

# ── Step 3: Register daily backup task ────────────
#  Calls setup-scheduled-backup.ps1 to register a Windows Task Scheduler
#  job that runs backup.bat every day at the specified time.
Write-Host ""
Write-Host "[3/4] Registering daily backup task (at $BackupTime)..." -ForegroundColor White

try {
    & $SetupBackup -Time $BackupTime
} catch {
    Write-Host "  Failed to register backup task: $_" -ForegroundColor Red
    Write-Host "  Run as Administrator and try again." -ForegroundColor Yellow
}

# ── Step 4: Register drive monitor ────────────────
#  Calls enable-backup-monitor.ps1 to register backup-notify.ps1
#  to run on Windows login. This shows a popup when the external
#  drive is plugged in.
Write-Host ""
Write-Host "[4/4] Registering drive monitor ($DriveLetter)..." -ForegroundColor White

try {
    & $SetupMonitor -DriveLetter $DriveLetter
} catch {
    Write-Host "  Failed to register drive monitor: $_" -ForegroundColor Red
    Write-Host "  Run as Administrator and try again." -ForegroundColor Yellow
}

# ── Done ──────────────────────────────────────────
Write-Host ""
Write-Host "============================================" -ForegroundColor Cyan
Write-Host " Setup complete!" -ForegroundColor Green
Write-Host "============================================" -ForegroundColor Cyan
Write-Host ""
Write-Host " What's configured:" -ForegroundColor White
Write-Host "   - Daily backup at $BackupTime via Task Scheduler" -ForegroundColor Gray
Write-Host "   - Drive monitor on login (watches $DriveLetter)" -ForegroundColor Gray
Write-Host "   - Backup directory: $BackupDir" -ForegroundColor Gray
Write-Host "   - Log directory: $LogDir" -ForegroundColor Gray
Write-Host ""
Write-Host " Test it now:" -ForegroundColor Yellow
Write-Host "   .\backup.bat" -ForegroundColor White
Write-Host ""
