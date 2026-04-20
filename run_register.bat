@echo off
chcp 65001 >nul
setlocal enabledelayedexpansion

:: 参数1: 循环次数（默认100）
set "COUNT=%~1"
if "%COUNT%"=="" set "COUNT=100"

echo ================================================
echo   Windurf 自动注册脚本
echo   循环次数: %COUNT%
echo ================================================

set "SUCCESS=0"
set "FAIL=0"

for /L %%i in (1,1,%COUNT%) do (
    echo.
    echo [%%i/%COUNT%] 开始注册...
    node .\register_windsurf.js
    
    if !errorlevel! equ 0 (
        set /a SUCCESS+=1
        echo [%%i] 注册成功 ^^^(成功: !SUCCESS!^^^)
    ) else (
        set /a FAIL+=1
        echo [%%i] 注册失败 ^^^(失败: !FAIL!^^^)
    )
    
    :: 间隔 3 秒再继续
    timeout /t 3 /nobreak >nul
)

echo.
echo ================================================
echo   执行完成
echo   成功: !SUCCESS!
echo   失败: !FAIL!
echo ================================================

pause
