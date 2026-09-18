# IT Tooools

離線開發工具箱。這個延伸模組處理 Hash、JSON、資料結構轉換、Diff、排班時間計算、密碼檢查與產生、檔案資訊，全部在本機運算，資料不會離開你的電腦。

線上工具站不會提醒的跨語言陷阱，這裡會一併標出來：同樣叫「MD5」，PHP 和 Java 算出來可能對不上；PHP 的 `crc32()` 和 `hash('crc32')` 其實是兩種演算法。算出值的同時，這裡也會把差異講清楚，並附上可以直接複製的 PHP／Java 等價程式碼。

原始碼與問題回報：<https://github.com/lazyjerry/it-tools-ext>

## 功能

- **Hash 對照表**：一次列出 md5、sha1、sha2、sha3、ripemd160、blake2、sm3，以及 crc32b／crc32／crc32c／adler32。每一列都能複製值，也能複製對應的 PHP 或 Java 程式碼。輸出可選 hex 小寫、HEX 大寫、Base64、Base64URL；輸入可選文字（UTF-8）、Hex 位元組、Base64。也支援 HMAC。
- **跨語言差異另外列出**：
  - PHP `hash('crc32')` 是 CRC-32/BZIP2，而且以小端序輸出，和 `crc32()`、`hash('crc32b')`、Java `CRC32` 都不同。
  - Java 常見寫法 `Integer.toHexString(b & 0xff)` 不會補零，會少字元；`BigInteger.toString(16)` 會吃掉開頭的 0。這兩種錯誤寫法的實際輸出都會各列一行。
  - 另外列出 Java `String.hashCode()`、32 位元 PHP `crc32()` 回傳負數的情況，以及 SHA-3 和 Keccak-256 的差別。
  - 貼上 bcrypt 雜湊（`$2y$10$...`）會解析版本、cost、salt，並說明 `$2y$` 和 `$2a$` 的相容性。
- **JSON 工具**：美化、壓縮、遞迴排序 key、去除跳脫字元（把 `"{\"a\":1}"` 這種被包成字串的 JSON 解回來）。可容忍註解與尾逗號，也接受 JSON Lines。**大整數不失真**：`12345678901234567890` 會原樣保留。語法錯誤會指出行與欄，可一鍵跳到錯誤位置。
- **JSON 搜尋**：可用 key 名稱、值內容（支援正則）或路徑（`$.a.b[0]`、`list[*].name`、`$..id`）搜尋，點結果會跳到對應位置。面板上是獨立的「JSON 搜尋」分頁，輸入內容與 JSON 分頁連動。
- **JSON 統計**：節點數、最大深度、型別分佈、key 出現次數，以及字串值的單詞頻率。中文一字算一詞。
- **JSON ⇄ 程式語言**：
  - JSON 可轉成 PHP（短陣列、`array()`、`(object)`）、JavaScript、Python、Go（`map` 或 struct 加 json tag）、Java（`Map.ofEntries` 或 Jackson POJO）、Swift（Dictionary 或 Codable struct）、Objective-C。
  - PHP array、Python dict、JS object literal 可以轉回 JSON。PHP 陣列比照 `json_encode` 的規則：key 剛好是 0..n-1 連號才輸出成陣列。
  - 遇到語言本身的限制會在輸出頂端加註解警告，例如 PHP 陣列分不出空物件與空陣列、JS 存不下超過 `MAX_SAFE_INTEGER` 的整數。
- **Diff 用 VS Code 原生比較**：兩段貼上的文字、選取文字與剪貼簿、兩段選取文字，都會用 VS Code 內建的並排 diff 編輯器開啟。也能產生 unified diff 文字，直接貼到 PR 或訊息裡。
- **排班時間計算**：移植自 time-date-converter 的五個區段，規則完全一致：
  - 時間 ⇄ 線性分鐘
  - 跨夜時差（起訖相同視為 1440 分鐘）
  - 週末天數與最早結束日
  - 週數與日期區間
  - 時間加減分鐘
- **密碼檢查與產生**：
  - 檢查項目有長度、大小寫、數字、符號、連續字元（abc、321）、重複字元、鍵盤序列（qwer、asdf），以及常見弱密碼 Top 1000（離線比對）。
  - 產生的密碼一定符合目前的規則。
  - 面板分成「密碼檢查」與「密碼產生」兩個分頁，規則直接在分頁上勾選，兩邊同步；「還原預設」回到設定頁的值。面板上的改動不會寫回設定。
  - 「密碼檢查」分頁附上等價的驗證程式碼，以頁籤切換：Laravel、CodeIgniter 3、CodeIgniter 4、Java、Go、Python、Kotlin（Android）、Swift（iOS）。程式碼跟著規則即時更新，只輸出有啟用的規則。
- **檔案資訊**：
  - 編碼判斷：有沒有 BOM、BOM 種類、是否為合法 UTF-8。Big5／GBK 只能推測，會標成「推測」。
  - 行尾（LF／CRLF／混合）、縮排、最長行。
  - 路徑、權限、擁有者、大小，以及建立、修改、存取時間。可複製絕對路徑、複製相對於專案根目錄的路徑（git repo 根，不在 repo 內時用工作區資料夾）、在 Finder／檔案總管開啟所在資料夾。
  - 摘要：是否在工作區內、是否在 git repo 內、git 是否追蹤與目前內容是否已 add、目前使用者的讀取／編輯／執行權限。git 狀態只讀 `.git/` 底下的檔案（index 版本 2–4、SHA-256 repo、worktree 與 submodule 的 `gitdir:`），不呼叫 git，也不用 VS Code 的 Git API。
  - **只在按下重新整理時才讀取**，切換檔案不會自動讀檔。
- **常用工具**：
  - 編碼：Base64／Base64URL；URL 編碼分 PHP `urlencode` 與 `rawurlencode`；HTML 分 `htmlspecialchars` 與 `htmlentities`。
  - JWT 解碼與 HS256 驗簽、PHP serialize ⇄ JSON、CSV ⇄ JSON。
  - 命名風格轉換、進位轉換、行處理、文字統計、正則測試（附與 PCRE 的差異說明）。
  - 產生 UUID v4／v7、ULID、NanoID、Token；Unix 時間戳 ⇄ 日期。

## 使用方式

1. **面板**：底部面板的「IT Tooools」分頁，或從命令面板執行「IT Tooools: 開啟工具面板」。左側可切換 Hash、JSON、JSON 搜尋、轉換、Diff、時間計算、密碼檢查、密碼產生、JWT、時間戳、檔案資訊、常用工具。「常用工具」只列沒有專屬分頁的工具（編碼、文字、產生 ID）；Hash、JSON、轉換、JWT、時間戳、密碼檢查請用各自的分頁，命令面板的「執行工具」仍列出全部，用來就地處理編輯器的選取文字。
2. **對選取文字直接處理**：選取文字後按右鍵選「IT Tooools: 執行工具…」，或從命令面板執行，挑一個工具。沒有選取時會處理整份文件。
   - **就地轉換類**（JSON 美化、Base64、命名風格…）：直接取代選取文字，可 `Cmd+Z` 復原。
   - **報告類**（Hash 對照表、統計、JWT、語言轉換）：在旁邊開新編輯器顯示結果。
3. **Diff**：
   - 選一段文字，右鍵選「Diff：選取文字設為比較左側」。
   - 再選另一段，右鍵選「Diff：與左側比較」。
   - 要和剪貼簿比較，執行「Diff：選取文字與剪貼簿比較」。

### 指令

| 指令 | 說明 |
|---|---|
| IT Tooools: 開啟工具面板 | 開啟底部面板 |
| IT Tooools: 執行工具… | 從完整工具清單挑一個，套用在選取文字上（會記住最近使用） |
| IT Tooools: Hash：計算選取文字 | 開新編輯器顯示含相容性說明的 Hash 對照表 |
| IT Tooools: JSON：美化／壓縮／統計／搜尋 | 對選取文字或整份文件操作；搜尋時上下移動可預覽位置 |
| IT Tooools: 轉換：JSON → 程式語言 | 選目標語言後開新編輯器 |
| IT Tooools: 轉換：PHP／Python／JS → JSON | 自動偵測來源語言 |
| IT Tooools: Diff：選取文字設為比較左側／與左側比較 | 兩段選取文字以原生 diff 並排比較 |
| IT Tooools: Diff：選取文字與剪貼簿比較 | 剪貼簿在左、選取文字在右 |
| IT Tooools: Diff：產生 unified diff 文字 | 與左側（或剪貼簿）比較，輸出可貼上的 diff |
| IT Tooools: 時間計算 | 開啟面板的時間計算分頁 |
| IT Tooools: 密碼：檢查／產生 | 檢查時用密碼輸入框，內容不會被記錄；產生後直接複製到剪貼簿 |
| IT Tooools: 檔案資訊：顯示／重新整理 | 重新整理才會讀取目前檔案 |

### 設定

| 設定 | 預設 | 說明 |
|---|---|---|
| `itTools.inPlaceEdit` | `true` | 就地轉換類工具直接取代選取文字；關閉後改開新編輯器 |
| `itTools.json.indent` | `2` | JSON 美化與語言轉換的縮排（`2`／`4`／`tab`） |
| `itTools.password.*` | | 以下密碼設定是面板規則的**預設值**，也是命令面板「密碼：檢查／產生」使用的規則；面板上可臨時調整 |
| `itTools.password.minLength` | `8` | 密碼最小長度 |
| `itTools.password.requireUppercase`／`requireLowercase`／`requireDigit`／`requireSymbol` | `true` | 必須包含的字元類別 |
| `itTools.password.symbolSet` | ``!@#$%^&*()-_=+[]{};:,.<>?`` | 算作特殊符號的字元，產生密碼時也從這裡取 |
| `itTools.password.forbidSequential`／`forbidRepeated`／`forbidKeyboard`／`forbidCommon` | `true` | 禁止連續字元、重複字元、鍵盤序列、常見弱密碼 |
| `itTools.password.generateLength` | `16` | 產生密碼的長度 |
| `itTools.password.excludeAmbiguous` | `false` | 產生時排除 `0 O 1 l I` |
| `itTools.fileInfo.resolveOwnerName` | `true` | 重新整理時執行一次 `id -un` 把 uid 轉成使用者名稱 |

## 已知限制

- **文字一律以 UTF-8 編碼後雜湊**。Java 沒有指定 charset 時會用平台預設編碼（Windows 繁中為 MS950），結果會不同。要重現，請在 Java 端取 `s.getBytes()` 的 hex，再用「Hex 位元組」模式貼上。
- 不支援 PHP 的 whirlpool、tiger、snefru、gost、haval、ripemd128／256／320、fnv、joaat、murmur、xxhash；面板會列出這些演算法，避免你以為已經算過。md4、whirlpool 要看這台機器上 Node 的 OpenSSL 有沒有提供，沒有就自動隱藏。
- bcrypt 只解析結構，不產生也不驗證。
- 語言 → JSON 只接受 PHP、Python、JS 的純資料 literal，遇到變數或函式呼叫會直接報錯。
- 檔案資訊的 git 狀態只比對工作區與 index（是否已 add），不讀 HEAD 的 tree，所以分不出「已 add 但還沒 commit」；`.gitignore` 也不判斷。有 clean filter（例如 Git LFS）的檔案可能被誤判成有未 add 的修改。
- 密碼的弱密碼比對用內建的 Top 1000 清單，不會連線查 Have I Been Pwned。輸出的驗證程式碼不含這份清單，需自備。
- 驗證程式碼中 CodeIgniter 3／4、Python、Go、Swift 以實際執行與面板檢查結果差分比對（`npm run verify:rules`）；Java 與 Kotlin 因本機沒有 JDK／kotlinc 未實跑。重複字元規則在 PHP、Python、Java、Kotlin 用正則（`.` 不含換行），Go 與 Swift 用迴圈，只有密碼含連續換行時結果才會不同。

## 專案結構

```
src/
├── extension.ts          # 進入點：組裝面板、Diff 虛擬文件、指令
├── core/                 # 純 Node 純函式，不 import vscode（單元測試主體）
│   ├── hash/             # 摘要、校驗和、Java 變體、相容性矩陣、bcrypt 解析
│   ├── json/             # 帶位置的 parser、搜尋、統計
│   ├── convert/          # JSON ⇄ 各語言、型別推導
│   ├── diff/             # Myers diff 與 unified 輸出
│   ├── encode/           # Base64、URL、HTML、JWT、PHP serialize、CSV
│   ├── timecalc/         # 排班時間計算
│   ├── password/         # 密碼規則、產生器、弱密碼清單
│   ├── fileprobe/        # BOM、編碼、行尾、縮排判斷
│   ├── text/ gen/        # 命名風格、進位、統計；UUID／ULID／時間戳
│   └── registry.ts       # 常用工具清單（指令與面板共用）
├── host/handlers.ts      # 面板 RPC 實作
├── commands/             # 指令註冊
├── views/                # 底部面板 WebviewViewProvider
├── diff/                 # 原生 vscode.diff 的虛擬文件
├── fileinfo/             # fs.stat 與擁有者解析（只在重新整理時執行）
├── shared/protocol.ts    # extension ⇄ webview 訊息協定
└── webview/              # 面板前端（零框架）
```

## 授權

Apache-2.0。內建的常見密碼清單來自 [SecLists](https://github.com/danielmiessler/SecLists)（MIT），詳見 `THIRD_PARTY_NOTICES.md`。
