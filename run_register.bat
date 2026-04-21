@echo off
chcp 65001 >nul
setlocal enabledelayedexpansion

REM loop count, default 100
set "COUNT=%~1"
if "%COUNT%"=="" set "COUNT=100"

echo ================================================
echo   Windsurf Auto Register
echo   Count: %COUNT%
echo ================================================

set "SUCCESS=0"
set "FAIL=0"

for /L %%i in (1,1,%COUNT%) do (
    echo.
    echo [%%i/%COUNT%] Registering...
    node .\register_windsurf.js

    if !errorlevel! equ 0 (
        set /a SUCCESS+=1
        echo [%%i] OK ^^^(success: !SUCCESS!^^^)
    ) else (
        set /a FAIL+=1
        echo [%%i] FAIL ^^^(fail: !FAIL!^^^)
    )

    REM wait 3 seconds
    timeout /t 3 /nobreak >nul
)

echo.
echo ================================================
echo   Done
echo   Success: !SUCCESS!
echo   Fail: !FAIL!
echo ================================================

pause
