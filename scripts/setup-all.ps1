<#
.SYNOPSIS
    JM SPAREPARTS — One-time setup on a new PC.

.DESCRIPTION
    Registers the daily backup task and the drive monitor on a new computer.
    Run this once after transferring the system folder to a new PC.

    What it does:
      1. Checks PostgreSQL is installed (pg_dump.exe)
      2. Registers daily backup task (2 AM)
      3. Registers drive monitor on login
      4. Creates backup and log directories

    Requirements:
      - Run as Administrator (for Task Scheduler)
      - PostgreSQL installed (pg_dump.exe on PATH)

.EXAMPLE
    .\setup-all.ps1
    .\setup-all.ps1 -DriveLetter F:
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

# ── Step 1: Check PostgreSQL ──────────────────────
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
Write-Host ""
Write-Host "[3/4] Registering daily backup task (at $BackupTime)..." -ForegroundColor White

try {
    & $SetupBackup -Time $BackupTime
} catch {
    Write-Host "  Failed to register backup task: $_" -ForegroundColor Red
    Write-Host "  Run as Administrator and try again." -ForegroundColor Yellow
}

# ── Step 4: Register drive monitor ────────────────
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
