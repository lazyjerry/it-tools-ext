// 使用者輸入的正則（JSON 搜尋、正則測試工具）在 worker thread 裡跑：災難性回溯（例如 (a+)+$）會卡住整條執行緒，
// 放在 extension host 主執行緒會凍結所有延伸模組；worker 可以在逾時後直接 terminate。
import { Worker } from 'node:worker_threads';

export const MAX_PATTERN_LENGTH = 500;
export const REGEX_TIMEOUT_MS = 2000;

// eval 模式的 worker 不經 bundler，所以用字串。
// test：語意與主執行緒的 re.test 相同（沒有 g 旗標，lastIndex 不影響結果）。
// matchAll：全部匹配都要數，但只回傳前 limit 個的內容，避免空匹配在長文字上傳回大量資料。
const WORKER_SOURCE = `
const { parentPort, workerData } = require('node:worker_threads');
const re = new RegExp(workerData.pattern, workerData.flags);
if (workerData.op === 'test') {
  parentPort.postMessage(workerData.texts.map((text) => re.test(text)));
} else {
  let count = 0;
  const matches = [];
  for (const m of workerData.text.matchAll(re)) {
    if (count < workerData.limit) {
      matches.push({ index: m.index, values: [...m], groups: m.groups ? { ...m.groups } : undefined });
    }
    count += 1;
  }
  parentPort.postMessage({ count, matches });
}
`;

export interface IsolatedMatch {
  index: number;
  /** [0] 是整個匹配，其後是各群組；未參與的群組是 undefined。 */
  values: (string | undefined)[];
  groups?: Record<string, string | undefined>;
}

/** 長度與語法在主執行緒先檢查：編譯不會回溯，錯誤訊息也與直接 new RegExp 相同。 */
export function compileUserRegex(pattern: string, flags: string): RegExp {
  if (pattern.length > MAX_PATTERN_LENGTH) {
    throw new Error(`正則最長 ${MAX_PATTERN_LENGTH} 個字元，目前 ${pattern.length} 個`);
  }
  return new RegExp(pattern, flags);
}

/** 回傳與 texts 等長的布林陣列：第 i 個代表 texts[i] 是否符合。 */
export function regexTestAll(pattern: string, flags: string, texts: string[], timeoutMs = REGEX_TIMEOUT_MS): Promise<boolean[]> {
  compileUserRegex(pattern, flags);
  if (texts.length === 0) {
    return Promise.resolve([]);
  }
  return runWorker({ op: 'test', pattern, flags, texts }, timeoutMs);
}

/** 等同 text.matchAll(re)：flags 必須含 g。count 是全部匹配數，matches 只含前 limit 個。 */
export function regexMatchAll(
  pattern: string,
  flags: string,
  text: string,
  limit: number,
  timeoutMs = REGEX_TIMEOUT_MS,
): Promise<{ count: number; matches: IsolatedMatch[] }> {
  compileUserRegex(pattern, flags);
  return runWorker({ op: 'matchAll', pattern, flags, text, limit }, timeoutMs);
}

function runWorker<T>(workerData: Record<string, unknown>, timeoutMs: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(WORKER_SOURCE, { eval: true, workerData });
    let settled = false;
    const finish = (action: () => void) => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        action();
        void worker.terminate();
      }
    };
    const timer = setTimeout(
      () => finish(() => reject(new Error(`正則執行超過 ${timeoutMs / 1000} 秒已中止，可能是災難性回溯，請改寫 pattern`))),
      timeoutMs,
    );
    worker.once('message', (result: T) => finish(() => resolve(result)));
    worker.once('error', (error) => finish(() => reject(error)));
    worker.once('exit', (code) => finish(() => reject(new Error(`正則 worker 意外結束（exit ${code}）`))));
  });
}
