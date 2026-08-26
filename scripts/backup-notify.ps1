<#
.SYNOPSIS
    JM SPAREPARTS — USB drive backup notifier.

.DESCRIPTION
    Monitors for USB drives being plugged in and shows a Windows
    notification asking if you want to backup now. Run this script
    in the background (or at Windows startup).

    Requires Windows 10/11 for toast notifications.

.PARAMETER DriveLetter
    Which drive letter to watch for. Default: E:

.EXAMPLE
    .\backup-notify.ps1
    .\backup-notify.ps1 -DriveLetter F:
#>

param(
    [string]$DriveLetter = "E:"
)

$ErrorActionPreference = "Stop"

$BackupScript = Join-Path $PSScriptRoot "backup.bat"
$AppTitle = "JM SPAREPARTS"
$TargetPath = "$DriveLetter\jm-backups"

# ── Load Windows Forms for popup ──────────────────
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

# ── Function: Show backup prompt ──────────────────
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
        # Fallback: balloon tip
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

    # Drive just inserted
    if ($isPresent -and -not $wasPresent) {
        $timestamp = Get-Date -Format "HH:mm:ss"
        Write-Host "[$timestamp] Drive $DriveLetter detected!" -ForegroundColor Green

        # Show toast notification
        Show-ToastNotification "External drive connected. Open JM SPAREPARTS backup tool to sync."

        # Show popup
        Show-BackupPrompt -DriveLetter $DriveLetter
    }

    # Drive just removed
    if (-not $isPresent -and $wasPresent) {
        $timestamp = Get-Date -Format "HH:mm:ss"
        Write-Host "[$timestamp] Drive $DriveLetter removed." -ForegroundColor Yellow
    }

    $wasPresent = $isPresent
}
