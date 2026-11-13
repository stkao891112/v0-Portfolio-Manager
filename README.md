# Claude 個人投資決策與量化資產管理系統

一套可在 Windows 本機或 Vercel 雲端執行、結合**資產配置管理**與**量化策略決策**的個人專用投資終端。

本系統保留了優雅直覺的暗黑科技介面，並以 **Turso 雲端資料庫（與 SQLite 相容）+ Drizzle ORM** 儲存資料，具備**市場即時報價引擎**、**SOXL 熊市狙擊策略狀態機**、**BTC/MSTR 週期輪動**與**完整會計交易帳本**。

---

## 🚀 核心特色與架構

1. **電腦與手機共用同一份資料**：
   - 持倉與交易紀錄存在 Turso 雲端資料庫；電腦用 `start.bat`、手機用 Vercel 網址，看到的是同一份資料。
   - 本機沒有設定雲端資料庫時，會自動改用專案內的 `./data/portfolio.db`。
   - 部署在 Vercel 時需要輸入密碼才能進入（本機 `start.bat` 不需要）。
2. **預設標準資產配置**：
   - **台股主力 (25%)**：台積電 (2330.TW) 10%、野村臺灣新科技50 (00935.TW) 15%。（00830 停止定期定額，僅供歷史查詢）
   - **美股核心 (30%)**：富邦NASDAQ (00662.TW) 30%。
   - **SOXL 機會預備金 (10%)**：平常累積美元現金緩衝；SOXL 部位上限嚴格鎖定在總資產 5%，其餘至少 5% 為現金緩衝。
   - **加密貨幣 (25%)**：BTC 與 MSTR 依據牛熊週期手動動態配置。
   - **現金流工具 (10%)**：自訂流動性資產與貨幣市場活存。
3. **SOXL 熊市狙擊策略狀態機**：
   - 以半導體產業大盤 **SOXX** 作為週期回撤基準，不以高槓桿商品歷史高點誤判。
   - 計算 SOXX 週線自週期高點之回撤階梯：`-20%`（一般修正）、`-30%`（熊市警戒）、`-40%`（第 1 批候選）、`-45%`（第 2 批候選）、`-50%`（第 3 批候選）。
   - **四批次進場**（每批 1.25%，總部位最大 5%）搭配止跌條件；**三批次停利出場**（`+80%` 出場 1/3、`+150%` 累計出場 2/3、`+200%` 清空部位；連續 2 週跌破 40W MA 退場警示）。
   - **強制人工確認**：所有進出場訊號必須由使用者在介面點擊「人工確認」後方能寫入交易紀錄，系統絕不自動下單或臆測交易。
4. **BTC / MSTR 週期輪動**：
   - 提供市場階段手動設定：【牛市初期 70/30】、【牛市中期 50/50】、【牛市後期 30/70】、【熊市防禦 0/100】。
   - 即時追蹤 MSTR/BTC 價格比值與建議調倉數量。
5. **完整會計交易帳本**：
   - 記錄每筆買進、賣出、手續費與匯率，以加權平均成本法精準結轉已實現與未實現損益，支援一鍵匯出 CSV。
6. **舊版 LocalStorage 零遺失遷移**：
   - 自動偵測瀏覽器舊版 `localStorage['portfolio-storage']`，提供一鍵無損匯入資料庫並自動建立初始持倉交易。

---

## ☁️ 部署到 Vercel（手機也能用）

1. **建立雲端資料庫**：到 Vercel 專案的 **Storage** 頁籤，建立 Turso 資料庫並連結到這個專案，Vercel 會自動加入 `TURSO_DATABASE_URL` 與 `TURSO_AUTH_TOKEN` 兩個環境變數。
   - 若自動產生的變數名稱不同，或是直接在 [turso.tech](https://turso.tech) 建立資料庫，請到 **Settings → Environment Variables** 手動新增這兩個變數。
2. **設定登入密碼**：在 **Settings → Environment Variables** 新增 `APP_PASSWORD`（自訂一組密碼）；可選填 `AUTH_SECRET`（一組長亂數）。
   - 沒設定 `APP_PASSWORD` 時，網站會整個擋住，不會變成公開。
   - 改密碼後，所有裝置都要重新登入。
3. **重新部署**：到 **Deployments** 對最新一筆按 **Redeploy**，讓環境變數生效。
4. **手機使用**：打開 Vercel 網址、輸入密碼（30 天內不用再輸入），可用瀏覽器的「加入主畫面」當 App 使用。

第一次打開時，雲端資料庫會自動建立資料表與預設的五大資產配置。

### 讓本機也連同一個雲端資料庫

把 `.env.example` 複製成 `.env.local`，填入 `TURSO_DATABASE_URL` 與 `TURSO_AUTH_TOKEN`（從 Vercel 的環境變數複製，或執行 `vercel env pull .env.local`）。之後用 `start.bat` 開的本機版就會讀寫雲端資料。`.env.local` 不會被上傳到 GitHub。

---

## ⚡ 快速啟動指南 (Windows)

本專案提供 Windows 一鍵批次檔，操作極其簡單：

### 1. 一鍵啟動 (`start.bat`)
在專案根目錄中，直接雙擊執行 **`start.bat`**：
- 自動檢查 Node.js 環境。
- 若缺少套件，自動執行安裝。
- 自動建立本機資料庫目錄 `./data/`。
- 自動於 `http://localhost:3000` 啟動服務並於 3 秒後自動開啟預設瀏覽器。

### 2. 安全關閉 (`stop.bat`)
欲結束執行，可直接關閉啟動視窗，或雙擊執行 **`stop.bat`**，自動釋放 Port 3000 處理程序。

### 3. 一鍵資料庫備份 (`backup.bat`)
雙擊執行 **`backup.bat`**，即可將本機模式的 `portfolio.db` 自動備份並打上時間戳記至 `./data/backups/`。使用雲端資料庫時，備份請到 Turso 後台處理。

---

## 🛠 技術架構與模組劃分

- **前端框架**：Next.js 16 (App Router) + React 19 + TypeScript
- **樣式與介面**：Tailwind CSS v4 + shadcn/ui + Lucide Icons + Recharts
- **狀態管理**：Zustand (持久化快取與樂觀更新)
- **資料庫**：Turso（libSQL，與 SQLite 相容）+ Drizzle ORM；本機未設定時使用 `./data/portfolio.db`
- **登入保護**：`proxy.ts` + 密碼（環境變數 `APP_PASSWORD`），只在正式環境（Vercel）啟用
- **報價來源**：Pluggable MarketDataProvider 架構，預設串接 Yahoo Finance API（支援台股、美股、加密幣）
- **單元測試**：Vitest 現代化測試套件

### 核心目錄架構
```
v0-Portfolio-Manager/
├── app/
│   ├── api/
│   │   ├── portfolio/route.ts      # 資產與設定總覽聚合 API
│   │   ├── categories/route.ts     # 分類 CRUD
│   │   ├── assets/route.ts         # 標的 CRUD
│   │   ├── transactions/route.ts   # 交易帳本 API
│   │   ├── market-data/            # 即時報價與週K線歷史
│   │   ├── strategy/soxl/route.ts  # SOXL 策略運算與人工確認
│   │   ├── strategy/btc/route.ts   # BTC/MSTR 策略狀態
│   │   ├── backtest/route.ts       # 歷史回測模擬 API
│   │   ├── auth/login/route.ts     # 密碼登入 API
│   │   └── migrate/route.ts        # LocalStorage 遷移至資料庫
│   ├── login/page.tsx              # 登入頁
│   ├── globals.css                 # 暗黑科技霓虹主題 (Cyan Glow)
│   └── page.tsx                    # 主應用多頁籤入口
├── components/
│   ├── navigation/main-nav.tsx     # 全域 6 大核心頁籤導航
│   ├── dashboard/                  # 戰略總覽儀表板
│   ├── portfolio-manager.tsx       # 既有資產配置管理 (保留並增強)
│   ├── strategies/soxl/            # SOXL 熊市狙擊專屬儀表
│   ├── strategies/btc/             # BTC/MSTR 週期輪動專屬儀表
│   ├── ledger/trade-ledger.tsx     # 交易紀錄帳本與 CSV 匯出
│   └── settings/system-settings.tsx# 系統參數與備份設定
├── lib/
│   ├── db/
│   │   ├── schema.ts               # Drizzle 資料庫 Schema
│   │   ├── client.ts               # 資料庫連線（Turso 雲端 / 本機檔案）
│   │   └── init.ts                 # 建表與預設配置種子資料
│   ├── auth.ts                     # 登入憑證簽章與驗證
│   ├── market-data/                # 報價與週線 Provider
│   └── strategies/                 # 技術指標、SOXL狀態機、回測引擎
├── tests/                          # Vitest 單元測試
├── proxy.ts                        # 未登入時導向登入頁（Vercel 上才啟用）
├── .env.example                    # 環境變數範本
├── start.bat                       # Windows 一鍵啟動腳本
├── stop.bat                        # Windows 停止腳本
└── backup.bat                      # Windows 備份腳本
```

---

## 🔒 風險守則與免責聲明

1. 本系統所有產生的買賣建議均來自預先定義的明確程式規則（如 SOXX 週期回撤深度、均線穿越），**絕無 AI 隨機臆測**。
2. SOXL 為每日三倍重置槓桿 ETF，具備顯著的波動耗損與路徑依賴特性。本策略強制限制持倉不超過 5%，並嚴格保留現金緩衝。
3. 嚴格隔離生活緊急預備金，禁止投入任何高風險或槓桿投資策略。
4. 本系統僅供個人投資紀錄與策略輔助決策參考，非任何形式之投資邀約或下單委任。
