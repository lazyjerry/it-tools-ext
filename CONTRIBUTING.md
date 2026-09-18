# 開發指南

## 需求

- Node.js 22+
- macOS（`scripts/make-icon.sh` 依賴 sips；其他平台可略過）
- PHP CLI（選用，`npm run verify:php` 與 `scripts/gen-html-entities.sh` 需要）

## 常用指令

| 指令 | 說明 |
|---|---|
| `npm run build` | typecheck + esbuild 兩份 bundle：`out/extension.js`（Node）與 `media/main.js`（webview） |
| `npm run lint` | eslint flat config |
| `npm run test:unit` | tsc 編譯後以 mocha 跑 `test/unit/`（純 Node，不開 VSCode） |
| `npm run test:integration` | 下載測試用 VSCode 跑 `test/integration/` |
| `npm run check` | lint + build + 全部測試 |
| `npm run verify:php` | 以本機 PHP 逐項比對 hash／HMAC／URL／HTML／serialize 輸出，不一致就失敗 |
| `./scripts/gen-html-entities.sh` | 由 PHP `get_html_translation_table()` 重新產生 `src/core/encode/htmlEntities.ts` |
| `npm run package:vsix` | check 後以 vsce 打包（`--no-dependencies`，extension 已 bundle） |
| `./scripts/install-local.sh` | 打包並安裝到本機 VS Code（`--fast` 跳過 lint 與測試） |
| `./scripts/publish.sh patch\|minor\|major` / `./scripts/publish.sh` | 升版、發布到 Marketplace |

## 結構原則

- `src/core/` 是純 Node 純函式，**絕不 import vscode**，單元測試靠它。`src/shared/` 與 `src/webview/` 也不能 import vscode 或 Node 模組；webview 只能 `import type` core 的型別，運算一律透過 RPC（`shared/protocol.ts` 的 `CallMap`）交給 host 端的 `host/handlers.ts`。
- **零 runtime 依賴**：只用 Node 內建 `crypto`。crc32 系列、JSON parser、Myers diff、各語言轉換都是自己實作，所以 `vsce package --no-dependencies` 不會漏東西。
- **JSON 用自寫的 `core/json/ast.ts`，不用 `JSON.parse`**：`JSON.parse` 會讓大整數失真、沒有節點位置（搜尋跳轉要用）、錯誤訊息格式也會隨 V8 版本變動。數字一律保留原文 `raw`。
- **Hash 以 PHP 為準**：新增演算法或改輸出格式後跑 `npm run verify:php`。本機沒有 JVM，Java 端的變體（漏補零、BigInteger）是用手工推導的位元組寫死在單元測試裡。
- **時間計算的規則以 time-date-converter 的 `app.js` 為準**，驗證規則與輸出文字都要保持一致；要改行為先確認原站是否同步改。
- **檔案資訊只在收到重新整理指令時讀檔**：`extension.ts` 監聽編輯器切換只轉送檔名，讓面板標示「資訊已過期」，不能在這裡呼叫 `collectFileInfo`。
- 新增一般文字工具：在 `core/registry.ts` 的 `TOOLS` 加一筆，指令 `itTools.run` 與面板「常用工具」會一起出現。

## 環境注意事項

- 整合測試噴 `bad option: --disable-extensions` = 環境繼承了 `ELECTRON_RUN_AS_NODE`；`test/runTest.ts` 已處理，勿移除。
- 整合測試 `listen EINVAL ...main.sock` = 專案路徑太長；`test/runTest.ts` 已改用 `/private/tmp` 下的短路徑，勿移除。
- 測試跑的是 `out/` 下的 tsc 產物，改完 code 要先編譯（`npm run test:unit` 已包含）。
