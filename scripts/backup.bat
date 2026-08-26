@echo off
REM ============================================
REM  JM SPAREPARTS — Database Backup (Windows)
REM ============================================
REM  Usage:  backup.bat
REM  Creates a compressed PostgreSQL backup with
REM  timestamp. Cleans up backups older than 30 days.
REM
REM  Configure via environment variables or edit
REM  the defaults below.
REM ============================================

setlocal enabledelayedexpansion

REM ── Configuration (override with env vars) ──────
if "%DB_HOST%"=="" set DB_HOST=localhost
if "%DB_PORT%"=="" set DB_PORT=5432
if "%DB_NAME%"=="" set DB_NAME=makire_motorparts
if "%DB_USER%"=="" set DB_USER=makire
if "%BACKUP_DIR%"=="" set BACKUP_DIR=%~dp0..\backups
if "%PG_BIN%"=="" set PG_BIN=

REM ── Find pg_dump.exe ───────────────────────────
REM  Checks common PostgreSQL install paths on Windows.
REM  Set PG_BIN env var to skip auto-detection.

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
for /f "tokens=2 delims==" %%I in ('wmic os get localdatetime /value 2^>nul') do set DT=%%I
set TIMESTAMP=%DT:~0,4%%DT:~4,2%%DT:~6,2%_%DT:~8,2%%DT:~10,2%%DT:~12,2%

REM ── Create backup directory ─────────────────────
if not exist "%BACKUP_DIR%" mkdir "%BACKUP_DIR%"

set BACKUP_FILE=%BACKUP_DIR%\%DB_NAME%_%TIMESTAMP%.dump

REM ── Run pg_dump ─────────────────────────────────
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
