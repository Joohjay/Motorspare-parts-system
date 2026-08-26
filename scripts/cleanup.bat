@echo off
REM ====================================================================
REM  JM SPAREPARTS — Database Cleanup (Delete all sales data)
REM ====================================================================
REM
REM  WHAT THIS SCRIPT DOES:
REM    Deletes ALL products, sales, purchases, inventory, suppliers,
REM    customers, and expenses. Prepares the system for a fresh start.
REM
REM  WHAT IS KEPT:
REM    Users, settings, document sequences (reset to 0)
REM
REM  ⚠️  WARNING: THIS DELETES ALL DATA. MAKE A BACKUP FIRST!
REM    Run: scripts\backup.bat
REM
REM  USAGE:
REM    scripts\cleanup.bat
REM
REM ====================================================================

setlocal enabledelayedexpansion

REM ── Configuration ───────────────────────────────
if "%DB_HOST%"=="" set DB_HOST=localhost
if "%DB_PORT%"=="" set DB_PORT=5432
if "%DB_NAME%"=="" set DB_NAME=makire_motorparts
if "%DB_USER%"=="" set DB_USER=makire
if "%DB_PWD%"=="" set DB_PWD=makire
if "%PG_BIN%"=="" set PG_BIN=

REM ── Find psql.exe ───────────────────────────────
if "%PG_BIN%"=="" (
    for %%V in (18 17 16 15 14) do (
        if exist "C:\Program Files\PostgreSQL\%%V\bin\psql.exe" (
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
    echo ERROR: psql.exe not found.
    echo Install PostgreSQL or set PG_BIN.
    exit /b 1
)

:found_pg

REM ── Find cleanup.sql ────────────────────────────
set SQL_FILE=%~dp0cleanup.sql
if not exist "%SQL_FILE%" (
    echo ERROR: cleanup.sql not found at %SQL_FILE%
    exit /b 1
)

REM ── Warning ─────────────────────────────────────
echo.
echo =============================================
echo  JM SPAREPARTS — Database Cleanup
echo =============================================
echo.
echo  WARNING: This will DELETE ALL:
echo    - Products, categories, brands
echo    - Sales, purchases, returns
echo    - Inventory records
echo    - Suppliers, customers
echo    - Expenses
echo.
echo  Users and settings will be KEPT.
echo.
echo  Database: %DB_NAME%
echo  Server:   %DB_HOST%:%DB_PORT%
echo.

set /p CONFIRM="Type YES to continue: "
if /i not "%CONFIRM%"=="YES" (
    echo Cleanup cancelled.
    exit /b 0
)

REM ── Run cleanup ─────────────────────────────────
echo.
echo Running cleanup...

set PGPASSWORD=%DB_PWD%
"%PG_BIN%\psql.exe" -h "%DB_HOST%" -p "%DB_PORT%" -U "%DB_USER%" -d "%DB_NAME%" -f "%SQL_FILE%"

if %errorlevel% neq 0 (
    echo.
    echo ERROR: Cleanup failed.
    exit /b %errorlevel%
)

echo.
echo =============================================
echo  Cleanup complete!
echo =============================================
echo.
echo  The system is now ready for fresh data.
echo  You can start adding products and making sales.
echo.
