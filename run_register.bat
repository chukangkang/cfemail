@echo off
chcp 65001 >nul

REM count, default 100
set "COUNT=%~1"
if "%COUNT%"=="" set "COUNT=100"

node .\register_windsurf.js %COUNT%

pause
