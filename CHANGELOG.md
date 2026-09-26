# Changelog

本檔案記錄 IT Tooools 的版本變更，格式依循 [Keep a Changelog](https://keepachangelog.com/zh-TW/1.1.0/)，版本號依循 [Semantic Versioning](https://semver.org/lang/zh-TW/)。

## [Unreleased]

## [0.2.0] - 2026-09-26

### Changed

- 圖示改成兩支扳手交叉：Marketplace 圖示綠色扳手壓在灰色扳手上，面板圖示改為單色版 `resources/panel-wrenches.svg`；舊的扳手加鐮刀版本留在 `docs/`。

## [0.1.2] - 2026-09-19

### Security

安全性修正，一般輸入的輸出與先前完全相同。

- 轉換「Java POJO + Jackson」與「Go struct + json tag」：JSON key 原樣插進 `@JsonProperty("…")` 與 struct tag，含 `"` 或反引號、換行的 key 能跳出字串、在產出的程式碼裡多插一行。Java 改用與 Map 模式相同的字串跳脫；Go tag 內的 `"`、`\` 照 Go 字串跳脫，反引號與控制字元改成 `\xNN`（`reflect.StructTag` 解回來仍是原 key）。
- JWT：簽章段沒有檢查 base64url，`sig!!`、`sig=`、中間夾空白或非正規結尾字元的簽章也會「✓ 驗證通過」。現在簽章必須是正規 base64url 才驗簽，否則判定失敗並加註說明；不給密鑰時仍照常解碼。`exp` 等時間值超出 Date 範圍時顯示「無效時間」，不再讓整個解碼失敗。
- 密碼產生：面板長度欄的 256 上限可直接輸入繞過，host 端改把長度夾在 4–256、數量 1–50；`itTools.password.generateLength` 設定同樣限制。
- 密碼驗證程式碼：`itTools.password.minLength` 可在工作區 settings.json 設成字串，原樣插進八種語言的程式碼。讀設定與產生程式碼的入口都改成只接受整數（夾在 1–256），其他值用預設的 8。
- JSON 搜尋的正則（面板「正則」與命令「JSON：搜尋」的 `/…/`）改在 worker thread 執行，超過 2 秒中止並回報，災難性回溯不會再凍結整個 extension host；pattern 最長 500 字元。
- 常用工具「正則測試」（面板與命令「執行工具…」）同樣改在 worker thread 執行、2 秒逾時、pattern 最長 500 字元；報告內容與先前相同。
- 面板 RPC 只接受 handler 自己的方法名稱（`constructor`、`valueOf` 等原型上的名稱會被拒絕）；「在檔案總管顯示」與「開啟設定」訊息的參數要是字串。
- JWT 分頁的 token 不再寫進面板狀態（與密鑰、HMAC 密鑰、密碼相同），升級後第一次開啟會清掉舊版存下的 token。
- webview CSP nonce 改用 `crypto.randomBytes` 產生。
- `package.json` 明確宣告不支援未受信任的工作區（`capabilities.untrustedWorkspaces.supported: false`），與原本的預設行為相同。

## [0.1.1] - 2026-09-18

### Fixed

- Laravel 規則在「只要求大寫」或「只要求小寫」時，註解說改用 regex 卻沒有真的輸出那條 regex。
- JSON「還原轉義字串」對本來就是 JSON 的輸入會報「字串內不可有未跳脫的控制字元」或「值結束後還有多餘內容」；現在直接當成 JSON 輸出。

### Added

- 面板新增「JWT」與「時間戳」分頁（原本在常用工具裡）：輸入變動即解碼／轉換，JWT 密鑰不寫進面板狀態。
- 檔案資訊新增「摘要」：是否在工作區內、是否在 git repo 內、git 是否追蹤與目前內容是否已 add（另標示 add -N、合併衝突、assume-unchanged／skip-worktree）、目前使用者的讀取／編輯／執行權限。git 狀態只讀 `.git/` 底下的檔案，不呼叫 git、不用 VS Code Git API。
- 檔案資訊新增「複製相對路徑」（相對於專案根目錄：git repo 根，否則工作區資料夾）與「開啟資料夾」。
- 密碼檢查分頁的「Laravel 驗證規則」擴充為「驗證程式碼」：以頁籤切換 Laravel、CodeIgniter 3、CodeIgniter 4、Java、Go、Python、Kotlin（Android）、Swift（iOS），單一顯示區一次只看一種，會記住上次選的語言。除 Laravel 外都輸出完整的驗證函式（含連續字元、重複字元、鍵盤序列），並以 `npm run verify:rules` 實際執行 PHP／Python／Go／Swift 與面板檢查結果比對。

### Changed

- 「常用工具」分頁不再列出已有專屬分頁的工具（Hash 2 項、JSON 5 項、轉換 6 項、JWT、時間戳），剩編碼、文字、產生 ID 共 17 項；命令面板的「執行工具」清單不變。
- 檔案資訊的「複製路徑」改名「複製絕對路徑」；版面改成卡片式表格，位置滿版，摘要、編碼、內容、檔案屬性、時間在寬面板並排。移除與絕對路徑重複的「所在資料夾」列。
- 「密碼」分頁拆成「密碼檢查」與「密碼產生」；密碼規則改在分頁上直接勾選（最小長度、字元類別、符號集、四種禁止項目），兩個分頁同步，可一鍵還原預設。`itTools.password.*` 設定保留為面板的預設值與命令面板密碼指令的規則，面板上的調整不寫回設定。
- JSON 搜尋從 JSON 分頁拆成獨立的「JSON 搜尋」分頁（底部面板矮，原本在最下面會被切掉）；兩個分頁的輸入內容連動。
- 「還原轉義字串」改名「去除跳脫字元」，tooltip 補上範例。
- Hash 輸入框預設兩行，把高度讓給對照表，需要時自行拉大；「HMAC 密鑰」標籤旁加上 ? 說明。
- JSON 分頁的美化、壓縮、排序 key、去除跳脫字元、統計、開啟設定改為圖示按鈕，滑過顯示名稱與說明；複製結果、開在編輯器、結果放回輸入併到同一列右側。
- 語意不直觀的欄位與選項加上 ? 說明：Diff 的「忽略空白」「忽略大小寫」「前後文行數」、JSON 搜尋的「模式」「正則」、Hash 的「輸入模式」「密鑰模式」、時間計算的「線性分鐘」「週六／週日天數」「正負分鐘」。標記靠近面板右緣時，提示改往左展開。
- 時間計算的五個主題改為子分頁，一次只顯示一個主題的計算（原本九個計算全攤在同一頁）；會記住上次停留的主題。
- Marketplace 圖示：扳手不變，底下的螺絲起子換成鐮刀，整體呼應鎚子鐮刀的構圖。

## [0.1.0] - 2026-09-18

### Added

- **Hash 對照表**：Node crypto 可用的全部摘要演算法（執行期偵測），加上自行實作的 crc32b／crc32（PHP BZIP2 小端序）／crc32c／adler32。每列附相容性狀態與可複製的 PHP／Java 等價程式碼。支援四種輸出格式、三種輸入模式與 HMAC；以本機 PHP 8.4 交叉驗證 393 項輸出一致。
- **跨語言差異另外列出**：Java `toHexString` 不補零、`BigInteger.toString(16)` 吃掉開頭 0、`String.hashCode()`、32 位元 PHP `crc32()` 回傳負數、SHA-3 與 Keccak-256 的差別；bcrypt 雜湊結構解析與 `$2y$`／`$2a$` 相容性說明。
- **JSON 工具**：自寫帶位置的 parser，大整數不失真。可容忍註解、尾逗號與 JSON Lines。提供美化、壓縮、遞迴排序 key、轉義字串還原；可用 key、值（正則）、路徑搜尋並跳轉；統計結構與單詞頻率。
- **JSON ⇄ 程式語言**：JSON 可轉成 PHP（三種寫法）、JS、Python、Go（map／struct）、Java（Map／POJO）、Swift（Dictionary／Codable）、Objective-C；PHP／Python／JS literal 可轉回 JSON。遇到語言本身的限制會在輸出加警告。
- **Diff**：兩段文字以 VS Code 原生 `vscode.diff` 並排比較，可用選取文字、剪貼簿或面板輸入。也能產生 unified diff 文字（Myers）。
- **排班時間計算**：逐函式移植 time-date-converter 的九個計算，並以原站程式對 27000 筆隨機輸入差分比對，結果全數一致。
- **密碼檢查與產生**：規則可在設定調整，內建 Top 1000 常見弱密碼做離線比對；產生器保證輸出符合規則；附等價的 Laravel 驗證規則。
- **檔案資訊**：BOM、編碼（Big5／GBK 標示為推測）、行尾、縮排、最長行、權限、擁有者、大小與各種時間戳。只在按下重新整理時讀取。
- **常用工具**：Base64、URL（PHP `urlencode`／`rawurlencode`）、HTML（`htmlspecialchars`／`htmlentities`）、JWT 解碼與 HS 驗簽、PHP serialize ⇄ JSON、CSV ⇄ JSON、命名風格、進位轉換、行處理、文字統計、正則測試、UUID v4／v7、ULID、NanoID、時間戳轉換。
- 底部面板共 8 個分頁；指令 `IT Tooools: 執行工具…` 對選取文字就地處理，會記住最近使用的工具。
