@echo off
chcp 65001 >nul
title 同步至 GitHub (https://github.com/stkao891112/v0-Portfolio-Manager)

echo =========================================================
echo    正在同步專案至 GitHub...
echo =========================================================
echo.

where git >nul 2>nul
if %errorlevel% neq 0 (
    echo [錯誤] 找不到 git 指令，請確認 Git 已安裝並加入 PATH。
    pause
    exit /b 1
)

if not exist ".git" (
    echo [初始化] 初始化本地 Git 儲存庫...
    git init
    git branch -M main
    git remote add origin https://github.com/stkao891112/v0-Portfolio-Manager.git
) else (
    git remote set-url origin https://github.com/stkao891112/v0-Portfolio-Manager.git 2>nul
)

echo [準備] 加入所有檔案至暫存區...
git add .

echo [提交] 建立 Git Commit...
git commit -m "feat: 完成個人投資決策系統與資產管理整合 (Phase 1 ~ 7)^

- 整合 SQLite + Drizzle ORM 本機持久化^
- 建立預設五大資產配置 (台股 25%%, 美股 30%%, SOXL 預備金 10%%, 加密 25%%, 現金流 10%%)^
- 實作 SOXL 熊市狙擊策略 (SOXX 回撤階梯、4批進場、3批停利、人工確認機制)^
- 實作 BTC/MSTR 週期輪動與動態配比建議^
- 實作交易明細帳本與加權平均成本損益結算^
- 實作 LocalStorage 零遺失遷移 API^
- 建立 Windows 一鍵啟動 (start.bat) 與停止 (stop.bat)^

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"

echo.
echo [推送] 正在推送到 GitHub 遠端儲存庫 (main)...
git push -u origin main

if %errorlevel% equ 0 (
    echo.
    echo =========================================================
    echo   [成功] 程式碼已成功同步至:
    echo   https://github.com/stkao891112/v0-Portfolio-Manager
    echo =========================================================
) else (
    echo.
    echo [提示] 若需要 GitHub 身分驗證 (Personal Access Token 或 SSH)，請在提示視窗登入。
)

echo.
timeout /t 5 >nul
exit /b 0
