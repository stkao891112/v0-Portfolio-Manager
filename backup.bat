@echo off
chcp 65001 >nul
title SQLite 本機資料庫備份

echo =========================================================
echo    正在備份 SQLite 資料庫至 data\backups...
echo =========================================================
echo.

if not exist "data\portfolio.db" (
    echo [錯誤] 找不到 data\portfolio.db，尚無資料庫可備份。
    pause
    exit /b 1
)

if not exist "data\backups" mkdir "data\backups"

set DT=%date:~0,4%%date:~5,2%%date:~8,2%_%time:~0,2%%time:~3,2%%time:~6,2%
set DT=%DT: =0%

copy /Y "data\portfolio.db" "data\backups\portfolio_%DT%.db" >nul

if %errorlevel% equ 0 (
    echo [成功] 資料庫已成功備份為:
    echo        data\backups\portfolio_%DT%.db
) else (
    echo [錯誤] 備份失敗！
)

echo.
timeout /t 3 >nul
exit /b 0
