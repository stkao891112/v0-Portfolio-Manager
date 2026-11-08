@echo off
chcp 65001 >nul
title 投資決策與資產管理系統 (停止服務)

echo =========================================================
echo    正在關閉投資決策與資產管理系統服務 (Port 3000)...
echo =========================================================
echo.

set FOUND=0
for /f "tokens=5" %%a in ('netstat -ano ^| findstr /R /C:":3000 .*LISTENING"') do (
    echo [關閉] 發現行程 PID: %%a，正在強制終止...
    taskkill /F /PID %%a >nul 2>nul
    set FOUND=1
)

if %FOUND% equ 1 (
    echo.
    echo [成功] 系統服務已成功關閉！
) else (
    echo [資訊] 目前 Port 3000 並無執行的服務。
)

echo.
timeout /t 2 >nul
exit /b 0
