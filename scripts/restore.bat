@echo off
REM ============================================
REM  JM SPAREPARTS — Database Restore (Windows)
REM ============================================
REM  Usage:  restore.bat backup_file.dump
REM
REM  Restores a PostgreSQL backup to a RECOVERY
REM  database — NEVER directly into production.
REM  Verify the restore before using it.
REM ============================================

setlocal enabledelayedexpansion

REM ── Check argument ──────────────────────────────
if "%~1"=="" (
    echo Usage: restore.bat ^<backup_file.dump^>
    echo.
    echo Example:
    echo   restore.bat C:\jm-spareparts\backups\makire_motorparts_20260826_020000.dump
    exit /b 1
)

set BACKUP_FILE=%~1
set RECOVERY_DB=makire_motorparts_recovery

REM ── Configuration ───────────────────────────────
if "%DB_HOST%"=="" set DB_HOST=localhost
if "%DB_PORT%"=="" set DB_PORT=5432
if "%DB_USER%"=="" set DB_USER=makire
if "%DB_PWD%"=="" set DB_PWD=makire
if "%PG_BIN%"=="" set PG_BIN=

REM ── Find pg tools ───────────────────────────────
if "%PG_BIN%"=="" (
    for %%V in (18 17 16 15 14) do (
        if exist "C:\Program Files\PostgreSQL\%%V\bin\pg_dump.exe" (
            set PG_BIN=C:\Program Files\PostgreSQL\%%V\bin
            goto :found_pg
        )
    )
    where psql.exe >nul 2>&1
    if !errorlevel! equ 0 (
        for /f "delims=" %%i in ('where psql.exe') do (
            set PG_BIN=%%~dpi
            goto :found_pg
        )
    )
    echo ERROR: PostgreSQL client tools not found.
    echo Install PostgreSQL or set PG_BIN.
    exit /b 1
)

:found_pg
echo Using PostgreSQL tools: %PG_BIN%

REM ── Verify backup file exists ───────────────────
if not exist "%BACKUP_FILE%" (
    echo ERROR: Backup file not found:
    echo   %BACKUP_FILE%
    exit /b 1
)

REM ── Show backup info ────────────────────────────
for %%F in ("%BACKUP_FILE%") do set SIZE=%%~zF
set /a SIZE_MB=%SIZE% / 1048576

echo =============================================
echo  JM SPAREPARTS — Database Restore (Recovery)
echo =============================================
echo.
echo  Backup file:      %BACKUP_FILE%
echo  Backup size:      %SIZE_MB% MB
echo  Recovery database: %RECOVERY_DB%
echo.
echo  WARNING: This will DROP and recreate %RECOVERY_DB%.
echo  Production database is NOT affected.
echo.

set /p CONFIRM="Continue? (Y/N): "
if /i not "%CONFIRM%"=="Y" (
    echo Restore cancelled.
    exit /b 0
)

set PGPASSWORD=%DB_PWD%

REM ── Step 1: Create recovery database ────────────
echo.
echo [1/3] Creating recovery database...

"%PG_BIN%\psql.exe" -h "%DB_HOST%" -p "%DB_PORT%" -U "%DB_USER%" -d postgres -c "DROP DATABASE IF EXISTS %RECOVERY_DB%;" 2>nul
"%PG_BIN%\psql.exe" -h "%DB_HOST%" -p "%DB_PORT%" -U "%DB_USER%" -d postgres -c "CREATE DATABASE %RECOVERY_DB%;"

if %errorlevel% neq 0 (
    echo ERROR: Failed to create recovery database.
    exit /b 1
)
echo  Database %RECOVERY_DB% created.

REM ── Step 2: Restore backup ──────────────────────
echo.
echo [2/3] Restoring backup (this may take a while)...

"%PG_BIN%\pg_restore.exe" -h "%DB_HOST%" -p "%DB_PORT%" -U "%DB_USER%" -d "%RECOVERY_DB%" --no-owner --no-privileges "%BACKUP_FILE%"

if %errorlevel% neq 0 (
    echo WARNING: pg_restore reported some errors (non-fatal warnings are normal).
)

REM ── Step 3: Verify ──────────────────────────────
echo.
echo [3/3] Verifying restore...

for /f "tokens=*" %%A in ('"%PG_BIN%\psql.exe" -h "%DB_HOST%" -p "%DB_PORT%" -U "%DB_USER%" -d "%RECOVERY_DB%" -t -A -c "SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public';"') do set TABLE_COUNT=%%A
echo  Tables found: %TABLE_COUNT%

for /f "tokens=*" %%A in ('"%PG_BIN%\psql.exe" -h "%DB_HOST%" -p "%DB_PORT%" -U "%DB_USER%" -d "%RECOVERY_DB%" -t -A -c "SELECT count(*) FROM users;"') do set USER_COUNT=%%A
echo  Users found:  %USER_COUNT%

echo.
echo =============================================
echo  Restore complete!
echo =============================================
echo.
echo  Recovery database: %RECOVERY_DB%
echo.
echo  To verify with the application:
echo    1. Edit server\.env and change DATABASE_URL:
echo       DATABASE_URL=postgresql://makire:%DB_PWD%@%DB_HOST%:%DB_PORT%/%RECOVERY_DB%
echo    2. Start the server:  npm run dev
echo    3. Test login and check data
echo    4. Restore DATABASE_URL back to production
echo.
echo  To clean up recovery database:
echo    "%PG_BIN%\psql.exe" -h %DB_HOST% -p %DB_PORT% -U %DB_USER% -d postgres -c "DROP DATABASE %RECOVERY_DB%;"
