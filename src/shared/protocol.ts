// extension ⇄ webview 訊息協定（兩端共用型別）。webview 需要回傳值的操作走 call／reply 的 RPC。
import type { HashRow } from '../core/hash/compat';
import type { InputMode, OutputFormat } from '../core/hash/bytes';
import type { BcryptInfo } from '../core/hash/bcrypt';
import type { SearchMode } from '../core/json/tools';
import type { RuleSnippet } from '../core/password/codegen';
import type { PasswordCheck, PasswordPolicy } from '../core/password/policy';
import type { ToolInfo } from '../core/registry';
import type { TimeCalcOp } from '../core/timecalc/timecalc';
import type { TargetMode } from '../core/convert/toLang';
import type { ContentProbe } from '../core/fileprobe/probe';

export type TabId = 'hash' | 'json' | 'jsonsearch' | 'convert' | 'diff' | 'timecalc' | 'pwcheck' | 'pwgen' | 'jwt' | 'timestamp' | 'fileinfo' | 'tools';

export interface FileInfo {
  fileName: string;
  path: string;
  relativePath: string | null;
  /** git 工作樹根；不在 repo 內時退回工作區資料夾。 */
  projectRoot: string | null;
  projectRootKind: 'git' | 'workspace' | null;
  projectRelativePath: string | null;
  /** 只有磁碟上的檔案才有。 */
  summary: { workspace: string; gitRepo: string; gitTracking: string; access: string } | null;
  folder: string;
  isUntitled: boolean;
  languageId: string;
  isDirty: boolean;
  symlinkTarget: string | null;
  size: string | null;
  mode: string | null;
  owner: string | null;
  group: string | null;
  nlink: number | null;
  times: { label: string; value: string; relative: string }[];
  probe: ContentProbe;
  /** 只分析了前 N 位元組。 */
  truncatedAt: number | null;
  readAt: number;
}

export interface CallMap {
  'hash.table': {
    params: { input: string; inputMode: InputMode; format: OutputFormat; hmacKey: string; hmacKeyMode: InputMode };
    result: { rows: HashRow[]; hmacRows: HashRow[]; unsupportedPhp: string[]; inputBytes: number; bcrypt: BcryptInfo | null };
  };
  'json.process': {
    params: { input: string; action: 'format' | 'minify' | 'sort' | 'unescape' | 'stats' };
    result: string;
  };
  'json.search': {
    params: { input: string; query: string; mode: SearchMode; regex: boolean; caseSensitive: boolean };
    result: { path: string; offset: number; line: number; column: number; preview: string }[];
  };
  'convert.to': { params: { input: string; mode: TargetMode }; result: string };
  'convert.from': { params: { input: string; dialect: 'auto' | 'php' | 'python' | 'js' }; result: string };
  'diff.native': { params: { left: string; right: string }; result: null };
  'diff.unified': { params: { left: string; right: string; ignoreWhitespace: boolean; ignoreCase: boolean; context: number }; result: string };
  timecalc: { params: TimeCalcOp; result: string };
  'password.check': { params: { password: string; policy: PasswordPolicy }; result: PasswordCheck };
  'password.generate': { params: { length: number; count: number; excludeAmbiguous: boolean; policy: PasswordPolicy }; result: string[] };
  'password.snippets': { params: { policy: PasswordPolicy }; result: RuleSnippet[] };
  'fileinfo.refresh': { params: null; result: FileInfo | null };
  'tool.run': { params: { toolId: string; input: string; params: Record<string, string> }; result: string };
}

export type Method = keyof CallMap;

export type ClientMessage =
  | { type: 'ready' }
  | { type: 'call'; id: number; method: Method; params: unknown }
  | { type: 'copy'; text: string; label: string }
  | { type: 'openInEditor'; content: string; language: string }
  | { type: 'openSettings'; query: string }
  | { type: 'revealInOS'; path: string };

export interface InitPayload {
  tools: ToolInfo[];
  targetModes: { mode: TargetMode; label: string }[];
  policy: PasswordPolicy;
  generateLength: number;
  excludeAmbiguous: boolean;
  activeFile: string | null;
}

export type HostMessage =
  | { type: 'init'; payload: InitPayload }
  | { type: 'reply'; id: number; ok: true; result: unknown }
  | { type: 'reply'; id: number; ok: false; error: string }
  | { type: 'showTab'; tab: TabId }
  | { type: 'policyChanged'; policy: PasswordPolicy; generateLength: number; excludeAmbiguous: boolean }
  /** 只告知檔名讓面板標示過期，不讀檔。 */
  | { type: 'activeFileChanged'; name: string | null }
  | { type: 'fileInfo'; info: FileInfo | null };

export function isClientMessage(value: unknown): value is ClientMessage {
  return typeof value === 'object' && value !== null && typeof (value as { type?: unknown }).type === 'string';
}
