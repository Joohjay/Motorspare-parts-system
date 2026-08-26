@echo off
REM ====================================================================
REM  JM SPAREPARTS — Database Backup (Windows)
REM ====================================================================
REM
REM  WHAT THIS SCRIPT DOES:
REM    Creates a compressed PostgreSQL backup of the entire database.
REM    The backup is saved as a .dump file with a timestamp in the
REM    filename (e.g., makire_motorparts_20260826_020000.dump).
REM
REM  HOW IT FITS INTO THE BACKUP SYSTEM:
REM    This is the CORE backup script. It runs:
REM      1. Automatically at 2:00 AM daily (via Windows Task Scheduler)
REM      2. Manually when you run it: scripts\backup.bat
REM      3. Before deployments or database changes (run manually)
REM
REM    After creating the backup, it also:
REM      - Cleans up backups older than 30 days (local)
REM      - Copies the backup to external drive E: (if connected)
REM
REM  BACKUP FLOW:
REM    backup.bat
REM      ├── Finds pg_dump.exe (PostgreSQL 14-18 on Windows)
REM      ├── Runs: pg_dump -Fc (compressed format)
REM      ├── Saves to: ..\backups\makire_motorparts_YYYYMMDD_HHMMSS.dump
REM      ├── Deletes .dump files older than 30 days
REM      └── If E: drive connected → copies to E:\jm-backups\
REM
REM  PREREQUISITES:
REM    - PostgreSQL installed on Windows (provides pg_dump.exe)
REM    - Default credentials: user=makire, password=makire, DB=makire_motorparts
REM    - Override with env vars: DB_HOST, DB_PORT, DB_NAME, DB_USER, DB_PWD
REM
REM  RELATED SCRIPTS:
REM    restore.bat              — Restore a backup (never touches production)
REM    backup-to-external.ps1   — Manually sync backups to external drive
REM    setup-scheduled-backup.ps1 — Register daily Task Scheduler job
REM    backup-notify.ps1        — Popup when external drive is plugged in
REM    setup-all.ps1            — One-time setup on a new PC
REM
REM  USAGE:
REM    scripts\backup.bat                          (default settings)
REM    set DB_PWD=mypassword && scripts\backup.bat  (custom password)
REM    set PG_BIN=C:\PostgreSQL\17\bin && scripts\backup.bat  (custom PG path)
REM
REM ====================================================================

setlocal enabledelayedexpansion

REM ── Configuration (override with env vars) ──────
REM  These are the database connection defaults. Change the env vars
REM  above this script if your PostgreSQL uses different credentials.
if "%DB_HOST%"=="" set DB_HOST=localhost
if "%DB_PORT%"=="" set DB_PORT=5432
if "%DB_NAME%"=="" set DB_NAME=makire_motorparts
if "%DB_USER%"=="" set DB_USER=makire
if "%BACKUP_DIR%"=="" set BACKUP_DIR=%~dp0..\backups
if "%PG_BIN%"=="" set PG_BIN=

REM ── Find pg_dump.exe ───────────────────────────
REM  Auto-detects PostgreSQL installation by checking common Windows
REM  install paths for versions 14 through 18. If not found, checks
REM  the system PATH. Set PG_BIN env var to skip auto-detection.

if "%PG_BIN%"=="" (
    REM Check standard paths (PostgreSQL 14-18)
    for %%V in (18 17 16 15 14) do (
        if exist "C:\Program Files\PostgreSQL\%%V\bin\pg_dump.exe" (
            set PG_BIN=C:\Program Files\PostgreSQL\%%V\bin
            goto :found_pg
        )
    )
    REM Check PATH
    where pg_dump.exe >nul 2>&1
    if !errorlevel! equ 0 (
        for /f "delims=" %%i in ('where pg_dump.exe') do (
            set PG_BIN=%%~dpi
            goto :found_pg
        )
    )
    echo ERROR: pg_dump.exe not found.
    echo.
    echo Install PostgreSQL from https://www.postgresql.org/download/windows/
    echo or set PG_BIN to the bin directory, e.g.:
    echo   set PG_BIN=C:\Program Files\PostgreSQL\17\bin
    exit /b 1
)

:found_pg
echo Using pg_dump: %PG_BIN%\pg_dump.exe

REM ── Timestamp ──────────────────────────────────
REM  Creates a unique timestamp for the backup filename.
REM  Format: YYYYMMDD_HHMMSS (e.g., 20260826_020000)
for /f "tokens=2 delims==" %%I in ('wmic os get localdatetime /value 2^>nul') do set DT=%%I
set TIMESTAMP=%DT:~0,4%%DT:~4,2%%DT:~6,2%_%DT:~8,2%%DT:~10,2%%DT:~12,2%

REM ── Create backup directory ─────────────────────
REM  Creates the backups folder if it doesn't exist.
REM  Default location: ..\backups\ (relative to this script)
if not exist "%BACKUP_DIR%" mkdir "%BACKUP_DIR%"

set BACKUP_FILE=%BACKUP_DIR%\%DB_NAME%_%TIMESTAMP%.dump

REM ── Run pg_dump ─────────────────────────────────
REM  Creates a compressed backup using PostgreSQL's custom format (-Fc).
REM  This format is compact, supports compression, and can be restored
REM  with pg_restore. The -f flag specifies the output file.
echo.
echo Backing up %DB_NAME% to:
echo   %BACKUP_FILE%
echo.

set PGPASSWORD=%DB_PWD%
if "%DB_PWD%"=="" set PGPASSWORD=makire

"%PG_BIN%\pg_dump.exe" ^
    -h "%DB_HOST%" ^
    -p "%DB_PORT%" ^
    -U "%DB_USER%" ^
    -d "%DB_NAME%" ^
    -Fc ^
    -f "%BACKUP_FILE%"

if %errorlevel% neq 0 (
    echo.
    echo ERROR: pg_dump failed with exit code %errorlevel%
    echo Check credentials and database connection.
    exit /b %errorlevel%
)

REM ── Show backup size ────────────────────────────
for %%F in ("%BACKUP_FILE%") do set SIZE=%%~zF
set /a SIZE_MB=%SIZE% / 1048576
echo Backup complete: %BACKUP_FILE%
echo Size: %SIZE_MB% MB

REM ── Cleanup old backups (older than 30 days) ────
REM  Automatically deletes .dump files older than 30 days to prevent
REM  disk space from filling up. Uses Windows forfiles command.
echo.
echo Cleaning up backups older than 30 days...
set CLEANED=0
forfiles /p "%BACKUP_DIR%" /m "%DB_NAME%_*.dump" /d -30 /c "cmd /c del @path" 2>nul
if %errorlevel% equ 0 set CLEANED=1
if %CLEANED% equ 1 echo Old backups cleaned up.

REM ── Count remaining backups ─────────────────────
set COUNT=0
for %%F in ("%BACKUP_DIR%\%DB_NAME%_*.dump") do set /a COUNT+=1
echo Backups on disk: %COUNT%

REM ── Sync to external drive (if connected) ──────
REM  Checks if external drive E: is plugged in. If yes, copies the
REM  new backup to E:\jm-backups\. If not, skips silently.
REM  This provides off-site backup protection.
REM
REM  To use a different drive letter, set: set EXT_DRIVE=F:
set EXT_DRIVE=E:
if exist "%EXT_DRIVE%\" (
    echo.
    echo External drive detected — syncing backups...
    if not exist "%EXT_DRIVE%\jm-backups" mkdir "%EXT_DRIVE%\jm-backups"
    copy /Y "%BACKUP_FILE%" "%EXT_DRIVE%\jm-backups\" >nul 2>&1
    if !errorlevel! equ 0 (
        echo Synced to %EXT_DRIVE%\jm-backups\
    ) else (
        echo WARNING: External drive copy failed — check drive is writable.
    )
) else (
    echo.
    echo No external drive detected at %EXT_DRIVE% — skipping sync.
    echo Connect the external drive and run: scripts\backup-to-external.ps1
)

echo.
echo Done.
