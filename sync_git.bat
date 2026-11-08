@echo off
chcp 65001 >nul
title 同步專案至 GitHub 倉庫

echo =========================================================
echo    正在初始化並同步專案至 GitHub...
echo    遠端倉庫: https://github.com/stkao891112/v0-Portfolio-Manager
echo =========================================================
echo.

:: 1. 初始化 Git 倉庫 (若未初始化)
if not exist ".git" (
    echo [資訊] 初始化 Git 倉庫...
    git init
    git branch -M main
)

:: 2. 設定 Remote Origin
git remote remove origin 2>nul
git remote add origin https://github.com/stkao891112/v0-Portfolio-Manager.git

:: 3. 加入全部異動檔案
echo [資訊] 暫存程式碼變更 (git add .)...
git add .

:: 4. 提交 Commit
echo [資訊] 建立版本提交 (git commit)...
git commit -m "feat: complete portfolio decision system with SQLite, SOXL sniper, BTC rotation, and backtest

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"

:: 5. 推送至遠端
echo [資訊] 正在推送至 GitHub main 分支 (git push)...
git push -u origin main

if %errorlevel% equ 0 (
    echo.
    echo =========================================================
    echo [成功] 專案已成功同步至 GitHub！
    echo 網址: https://github.com/stkao891112/v0-Portfolio-Manager
    echo =========================================================
) else (
    echo.
    echo [提示] 推送時若需要登入 GitHub 憑證，請依畫面提示授權。
)

echo.
pause
