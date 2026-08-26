<#
.SYNOPSIS
    JM SPAREPARTS — Copy backups to external hard drive.

.DESCRIPTION
    Copies new .dump backup files from the local backup directory to an
    external hard drive (or USB flash drive). This is the INCREMENTAL sync
    — it only copies files that aren't already on the external drive.

    HOW IT FITS INTO THE BACKUP SYSTEM:
    ─────────────────────────────────────
    This script provides the "off-site" backup layer. The backup system
    works in 3 layers:

      Layer 1: Local backup (backup.bat)
        → Runs daily at 2 AM via Task Scheduler
        → Saves to: C:\...\backups\

      Layer 2: External drive sync (THIS SCRIPT)
        → Runs automatically if E: is plugged in during backup.bat
        → Or run manually: .\backup-to-external.ps1
        → Saves to: E:\jm-backups\

      Layer 3: USB rotation (manual)
        → Copy E:\jm-backups\ to a second USB drive weekly
        → Store the second drive at a different location

    WHY EXTERNAL DRIVES MATTER:
    ────────────────────────────
    If your PC's hard drive dies, gets corrupted, or is stolen, the
    local backups are gone too. An external drive protects against:
      ✓ Hard drive failure
      ✓ Windows corruption / BSOD
      ✓ Ransomware / malware (if drive is disconnected after backup)
      ✓ Power surge
      ✓ Theft (if stored in a different location)

    WHAT HAPPENS ON THE EXTERNAL DRIVE:
    ────────────────────────────────────
    E:\
    └── jm-backups\
        ├── makire_motorparts_20260820_020000.dump   (8.2 MB)
        ├── makire_motorparts_20260821_020000.dump   (8.3 MB)
        ├── makire_motorparts_20260822_020000.dump   (8.4 MB)
        └── ... (up to 90 days, then auto-deleted)

    FILES OLDER THAN 90 DAYS ARE AUTOMATICALLY DELETED from the
    external drive (vs 30 days locally) to give you more recovery
    window off-site.

.PARAMETER SourceDir
    Local backup directory. Default: ..\backups (relative to this script)

.PARAMETER ExternalDrive
    Drive letter of the external HDD. Default: E:
    Change this if your drive uses a different letter.
    Find your drive letter: Open File Explorer → This PC → look for your drive.

.PARAMETER ExternalDir
    Folder name on external drive. Default: jm-backups

.EXAMPLE
    .\backup-to-external.ps1
    .\backup-to-external.ps1 -ExternalDrive F:
    .\backup-to-external.ps1 -SourceDir "C:\backups" -ExternalDrive D:

.NOTES
    Requires: PowerShell 5.1+ (built into Windows 10/11)
    Safe to run multiple times — skips files already present.
#>

param(
    [string]$SourceDir = (Join-Path $PSScriptRoot "..\backups"),
    [string]$ExternalDrive = "E:",
    [string]$ExternalDir = "jm-backups"
)

$ErrorActionPreference = "Stop"

$destBase = Join-Path $ExternalDrive $ExternalDir

# ── Check source directory ──────────────────────────
#  The source is where backup.bat saves .dump files.
#  If it doesn't exist, backup.bat hasn't been run yet.
if (-not (Test-Path $SourceDir)) {
    Write-Host "ERROR: Source directory not found: $SourceDir" -ForegroundColor Red
    Write-Host "Run backup.bat first to create backups." -ForegroundColor Yellow
    exit 1
}

$backups = Get-ChildItem -Path $SourceDir -Filter "*.dump" | Sort-Object LastWriteTime
if ($backups.Count -eq 0) {
    Write-Host "No backup files found in $SourceDir" -ForegroundColor Yellow
    exit 0
}

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host " JM SPAREPARTS — External Backup Sync" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "Source:  $SourceDir"
Write-Host "Dest:    $destBase"
Write-Host "Files:   $($backups.Count) backup(s)"
Write-Host ""

# ── Check external drive ───────────────────────────
#  Verifies the external drive is actually plugged in.
#  Common issue: drive letter might be different (F:, G:, etc.)
if (-not (Test-Path "$ExternalDrive\")) {
    Write-Host "ERROR: External drive $ExternalDrive not found." -ForegroundColor Red
    Write-Host ""
    Write-Host "Please connect the external hard drive and try again." -ForegroundColor Yellow
    Write-Host "If your drive uses a different letter, run:" -ForegroundColor Yellow
    Write-Host "  .\backup-to-external.ps1 -ExternalDrive F:" -ForegroundColor White
    exit 1
}

# ── Create destination folder ──────────────────────
#  Creates E:\jm-backups\ if it doesn't exist yet.
if (-not (Test-Path $destBase)) {
    New-Item -ItemType Directory -Path $destBase -Force | Out-Null
    Write-Host "Created directory: $destBase" -ForegroundColor Green
}

# ── Copy new backups (incremental) ─────────────────
#  Only copies files that are NEW or DIFFERENT from what's already
#  on the external drive. This saves time and USB bandwidth.
#  Compares by filename AND file size to detect partial copies.
$copied = 0
$skipped = 0

foreach ($file in $backups) {
    $dest = Join-Path $destBase $file.Name
    
    if (Test-Path $dest) {
        $destSize = (Get-Item $dest).Length
        if ($destSize -eq $file.Length) {
            $skipped++
            continue
        }
    }
    
    Copy-Item -Path $file.FullName -Destination $dest -Force
    $sizeMB = [math]::Round($file.Length / 1MB, 1)
    Write-Host "  Copied: $($file.Name) ($sizeMB MB)" -ForegroundColor Green
    $copied++
}

# ── Cleanup old backups on external drive (90 days) ──
#  External drive keeps backups longer (90 days vs 30 locally)
#  to provide a wider recovery window. Old files are auto-deleted.
$cleaned = 0
$cutoff = (Get-Date).AddDays(-90)
Get-ChildItem -Path $destBase -Filter "*.dump" | Where-Object { $_.LastWriteTime -lt $cutoff } | ForEach-Object {
    Remove-Item $_.FullName -Force
    $cleaned++
}

# ── Summary ────────────────────────────────────────
Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host " Sync complete!" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "  Copied:  $copied new backup(s)" -ForegroundColor Green
Write-Host "  Skipped: $skipped (already present)" -ForegroundColor Gray
if ($cleaned -gt 0) {
    Write-Host "  Cleaned: $cleaned old backup(s) (>90 days)" -ForegroundColor Yellow
}

# ── Show total size on external drive ──────────────
$totalSize = (Get-ChildItem -Path $destBase -Filter "*.dump" | Measure-Object -Property Length -Sum).Sum
$totalMB = [math]::Round($totalSize / 1MB, 1)
$totalGB = [math]::Round($totalSize / 1GB, 2)
$sizeDisplay = if ($totalGB -ge 1) { "$totalGB GB" } else { "$totalMB MB" }
Write-Host "  Total on drive: $sizeDisplay" -ForegroundColor Gray
Write-Host ""
