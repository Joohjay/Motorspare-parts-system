<#
.SYNOPSIS
    JM SPAREPARTS — Copy backups to external drive.

.DESCRIPTION
    Copies new .dump backup files from the local backup directory to an
    external hard drive. Skips files already present (incremental sync).
    Designed to run automatically after backup.bat or manually.

.PARAMETER SourceDir
    Local backup directory. Default: ..\backups

.PARAMETER ExternalDrive
    Drive letter of the external HDD. Default: E:

.PARAMETER ExternalDir
    Folder on external drive. Default: jm-backups

.EXAMPLE
    .\backup-to-external.ps1
    .\backup-to-external.ps1 -ExternalDrive F:
    .\backup-to-external.ps1 -SourceDir "C:\backups" -ExternalDrive D:
#>

param(
    [string]$SourceDir = (Join-Path $PSScriptRoot "..\backups"),
    [string]$ExternalDrive = "E:",
    [string]$ExternalDir = "jm-backups"
)

$ErrorActionPreference = "Stop"

$destBase = Join-Path $ExternalDrive $ExternalDir

# ── Check source directory ──────────────────────────
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
if (-not (Test-Path "$ExternalDrive\")) {
    Write-Host "ERROR: External drive $ExternalDrive not found." -ForegroundColor Red
    Write-Host ""
    Write-Host "Please connect the external hard drive and try again." -ForegroundColor Yellow
    Write-Host "If your drive uses a different letter, run:" -ForegroundColor Yellow
    Write-Host "  .\backup-to-external.ps1 -ExternalDrive F:" -ForegroundColor White
    exit 1
}

# ── Create destination folder ──────────────────────
if (-not (Test-Path $destBase)) {
    New-Item -ItemType Directory -Path $destBase -Force | Out-Null
    Write-Host "Created directory: $destBase" -ForegroundColor Green
}

# ── Copy new backups (incremental) ─────────────────
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
