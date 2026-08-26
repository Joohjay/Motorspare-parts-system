<#
.SYNOPSIS
    JM SPAREPARTS — USB drive backup notifier (popup when drive is plugged in).

.DESCRIPTION
    WHAT THIS SCRIPT DOES:
    ──────────────────────
    Watches for an external USB hard drive to be plugged into your PC.
    When it detects the drive, it shows:
      1. A Windows toast notification (Windows 10/11)
      2. A popup dialog asking "Do you want to backup now?"

    If you click YES, it runs backup.bat automatically.
    If you click NO, it keeps watching for the next time.

    HOW IT FITS INTO THE BACKUP SYSTEM:
    ─────────────────────────────────────
    This is the USER INTERFACE layer of the backup system. It makes
    backups easy by prompting you when you plug in the external drive.

    The full backup flow:
      backup.bat (daily 2 AM)          ← Creates the backup
        └── If E: connected            ← Auto-syncs to external drive

      backup-notify.ps1 (THIS SCRIPT)  ← Prompts you when drive is plugged in
        └── You click Yes              ← Runs backup.bat on demand

    WHY THIS EXISTS:
    ─────────────────
    The daily 2 AM backup only syncs to the external drive if it's
    already plugged in. But most people unplug their drive at night.
    This script catches the case where you plug in the drive DURING
    the day and offers to backup right then.

    WHAT HAPPENS WHEN YOU PLUG IN THE DRIVE:
    ─────────────────────────────────────────
    Drive plugged in
      └── backup-notify.ps1 detects it (polls every 3 seconds)
            ├── Windows toast notification: "External drive connected"
            └── Popup dialog:
                  ┌─────────────────────────────────────┐
                  │  JM SPAREPARTS                       │
                  │                                      │
                  │  External drive (E:) detected!        │
                  │                                      │
                  │  Do you want to backup the           │
                  │  database now?                       │
                  │                                      │
                  │        [Yes]     [No]                │
                  └─────────────────────────────────────┘

    This runs in the background on Windows login. You don't need
    to start it manually — it's registered as a startup task by
    enable-backup-monitor.ps1.

.PARAMETER DriveLetter
    Which drive letter to watch for. Default: E:
    Find your drive letter: Open File Explorer → This PC → look for your drive.

.EXAMPLE
    .\backup-notify.ps1
    .\backup-notify.ps1 -DriveLetter F:

.NOTES
    Requires: Windows 10/11 (for toast notifications)
    Falls back to balloon tip on older Windows versions.
    Runs silently in background when registered as startup task.
#>

param(
    [string]$DriveLetter = "E:"
)

$ErrorActionPreference = "Stop"

$BackupScript = Join-Path $PSScriptRoot "backup.bat"
$AppTitle = "JM SPAREPARTS"
$TargetPath = "$DriveLetter\jm-backups"

# ── Load Windows Forms for popup ──────────────────
#  System.Windows.Forms provides the MessageBox dialog.
#  System.Drawing provides the icon for the notification.
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

# ── Function: Show backup prompt ──────────────────
#  Displays a Yes/No dialog box. If Yes, runs backup.bat.
#  If No, does nothing and keeps watching.
function Show-BackupPrompt {
    param([string]$DriveLetter)

    $result = [System.Windows.Forms.MessageBox]::Show(
        "External drive ($DriveLetter) detected!`n`n" +
        "Do you want to backup the database now?`n`n" +
        "Click YES to backup now.`n" +
        "Click NO to skip.",
        $AppTitle,
        [System.Windows.Forms.MessageBoxButtons]::YesNo,
        [System.Windows.Forms.MessageBoxIcon]::Question
    )

    if ($result -eq [System.Windows.Forms.DialogResult]::Yes) {
        Write-Host "[$(Get-Date -Format 'HH:mm:ss')] Running backup..." -ForegroundColor Green
        Start-Process -FilePath "cmd.exe" -ArgumentList "/c `"$BackupScript`"" -Wait -NoNewWindow
        Write-Host "[$(Get-Date -Format 'HH:mm:ss')] Backup complete." -ForegroundColor Green
    } else {
        Write-Host "[$(Get-Date -Format 'HH:mm:ss')] Backup skipped." -ForegroundColor Yellow
    }
}

# ── Function: Show toast notification (Windows 10/11) ──
#  Shows a modern Windows toast notification in the bottom-right corner.
#  Falls back to a balloon tip on older Windows versions.
function Show-ToastNotification {
    param([string]$Message)

    try {
        [Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] | Out-Null
        [Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom, ContentType = WindowsRuntime] | Out-Null

        $template = @"
<toast>
    <visual>
        <binding template="ToastGeneric">
            <text>$AppTitle</text>
            <text>$Message</text>
        </binding>
    </visual>
    <audio src="ms-winsoundevent:Notification.Default"/>
</toast>
"@

        $xml = New-Object Windows.Data.Xml.Dom.XmlDocument
        $xml.LoadXml($template)

        $toast = [Windows.UI.Notifications.ToastNotification]::new($xml)
        [Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier($AppTitle).Show($toast)
    } catch {
        # Fallback: balloon tip (works on all Windows versions)
        $notify = New-Object System.Windows.Forms.NotifyIcon
        $notify.Icon = [System.Drawing.SystemIcons]::Information
        $notify.BalloonTipTitle = $AppTitle
        $notify.BalloonTipText = $Message
        $notify.Visible = $true
        $notify.ShowBalloonTip(10000)
        Start-Sleep -Seconds 11
        $notify.Dispose()
    }
}

# ── Main loop: watch for drive insertion ──────────
#  Polls every 3 seconds to check if the drive letter exists.
#  When the drive appears (was not there before), triggers the popup.
#  When the drive disappears, logs it and keeps watching.
Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host " JM SPAREPARTS — Drive Monitor" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""
Write-Host " Watching for drive $DriveLetter ..." -ForegroundColor Gray
Write-Host " Press Ctrl+C to stop."
Write-Host ""

$wasPresent = Test-Path "$DriveLetter\"

while ($true) {
    Start-Sleep -Seconds 3

    $isPresent = Test-Path "$DriveLetter\"

    # Drive just inserted — trigger notification + popup
    if ($isPresent -and -not $wasPresent) {
        $timestamp = Get-Date -Format "HH:mm:ss"
        Write-Host "[$timestamp] Drive $DriveLetter detected!" -ForegroundColor Green

        # Show toast notification
        Show-ToastNotification "External drive connected. Open JM SPAREPARTS backup tool to sync."

        # Show popup
        Show-BackupPrompt -DriveLetter $DriveLetter
    }

    # Drive just removed — log it
    if (-not $isPresent -and $wasPresent) {
        $timestamp = Get-Date -Format "HH:mm:ss"
        Write-Host "[$timestamp] Drive $DriveLetter removed." -ForegroundColor Yellow
    }

    $wasPresent = $isPresent
}
