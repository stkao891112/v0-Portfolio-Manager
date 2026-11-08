@echo off
chcp 65001 >nul
title 投資決策與資產管理系統 (啟動中...)

echo =========================================================
echo    Claude 本機個人投資管理與決策系統
echo =========================================================
echo.

:: 1. 檢查 Node.js 是否已安裝
where node >nul 2>nul
if %errorlevel% neq 0 (
    echo [錯誤] 找不到 Node.js！請先安裝 Node.js (https://nodejs.org)
    pause
    exit /b 1
)

:: 2. 確保資料庫目錄存在
if not exist "data" mkdir "data"
if not exist "data\backups" mkdir "data\backups"

:: 3. 檢查 node_modules 與關鍵套件
if not exist "node_modules\better-sqlite3" (
    echo [資訊] 偵測到尚未安裝 SQLite 或相關相依套件，正在自動安裝中...
    call npm install
)

:: 4. 檢查 Port 3000 是否被佔用
netstat -ano | findstr /R /C:":3000 .*LISTENING" >nul 2>nul
if %errorlevel% equ 0 (
    echo [提示] 偵測到 Port 3000 已有服務在執行。
)

echo [啟動] 正在啟動 Next.js 本機伺服器 (http://localhost:3000)...
echo [提示] 瀏覽器即將自動開啟。欲關閉系統，請直接關閉此視窗或執行 stop.bat。
echo.

:: 延遲 3 秒後自動開啟預設瀏覽器
start /b cmd /c "timeout /t 3 /nobreak >nul & start http://localhost:3000"

:: 啟動 Next.js 伺服器
call npm run dev
