// 文字工具清單：命令 itTools.run 的 QuickPick 與面板「常用工具」分頁共用這一份。
import { parseLiteral } from './convert/fromLiteral';
import type { SourceDialect } from './convert/fromLiteral';
import { convertJson, TARGET_MODES } from './convert/toLang';
import type { TargetMode } from './convert/toLang';
import { csvToJson, jsonToCsv } from './encode/csv';
import { decodeJwt, formatJwt } from './encode/jwt';
import { phpSerialize, phpUnserialize } from './encode/phpSerialize';
import {
  base64Decode,
  base64Encode,
  phpHtmlEntityDecode,
  phpHtmlentities,
  phpHtmlspecialchars,
  phpRawurldecode,
  phpRawurlencode,
  phpUrldecode,
  phpUrlencode,
} from './encode/web';
import { generateReport, timestampReport } from './gen/generate';
import { parseBcrypt } from './hash/bcrypt';
import { decodeInput } from './hash/bytes';
import { buildHashTable, formatHashReport } from './hash/compat';
import { parseJsonDocument, stringifyNode } from './json/ast';
import { formatJsonStats, jsonStats, unescapeJson } from './json/tools';
import { checkPassword, formatCheck } from './password/policy';
import type { PasswordPolicy } from './password/policy';
import { allCases, CASE_LABELS, convertCase } from './text/case';
import type { CaseStyle } from './text/case';
import { baseReport, processLines, regexReport } from './text/misc';
import type { LineOp } from './text/misc';
import { formatTextStats, textStats } from './text/stats';

export interface ToolParam {
  id: string;
  label: string;
  kind: 'text' | 'choice' | 'secret';
  choices?: { value: string; label: string }[];
  placeholder?: string;
  optional?: boolean;
}

export interface ToolContext {
  indent: string;
  policy: PasswordPolicy;
}

export interface Tool {
  id: string;
  label: string;
  group: string;
  detail?: string;
  /** transform：結果取代選取（可設定改開新編輯器）；report：一律開新編輯器。 */
  kind: 'transform' | 'report';
  /** report 開新編輯器時的語言模式。 */
  language?: string;
  input: 'required' | 'optional' | 'none';
  /** 面板已有專屬分頁，「常用工具」分頁不再列一次；指令 itTools.run 仍然列出（對編輯器選取文字就地處理）。 */
  hasTab?: true;
  params?: ToolParam[];
  run(input: string, params: Record<string, string>, ctx: ToolContext): string;
}

/** 面板與 QuickPick 需要的可序列化描述（不含 run）。 */
export type ToolInfo = Omit<Tool, 'run'>;

const json = (input: string) => parseJsonDocument(input).node;

const LINE_OPS: { value: LineOp; label: string }[] = [
  { value: 'sort', label: '排序（自然順序）' },
  { value: 'sortDesc', label: '反向排序' },
  { value: 'unique', label: '去除重複行' },
  { value: 'trim', label: '去除每行頭尾空白' },
  { value: 'removeEmpty', label: '移除空行' },
  { value: 'reverse', label: '行序反轉' },
];

export const TOOLS: readonly Tool[] = [
  // ── Hash ──
  {
    id: 'hash.report',
    hasTab: true,
    label: 'Hash 對照表（含 PHP／Java 相容性）',
    group: 'Hash',
    kind: 'report',
    language: 'plaintext',
    input: 'required',
    run: (input) => formatHashReport(buildHashTable(decodeInput(input, 'text'), { inputMode: 'text', format: 'hex', text: input }), 'Hash 對照表（輸入以 UTF-8 編碼）'),
  },
  {
    id: 'hash.bcrypt',
    hasTab: true,
    label: 'bcrypt 雜湊結構解析',
    group: 'Hash',
    detail: '拆解 $2y$10$... 的版本、cost、salt，說明 PHP／Java 相容性',
    kind: 'report',
    language: 'plaintext',
    input: 'required',
    run: (input) => {
      const info = parseBcrypt(input);
      return [
        '# bcrypt 結構',
        `版本   ${info.version}`,
        `cost   ${info.cost}（2^${info.cost} = ${info.iterations} 輪）`,
        `salt   ${info.salt}`,
        `hash   ${info.hash}`,
        '',
        ...info.notes.map((n) => `- ${n}`),
      ].join('\n') + '\n';
    },
  },
  // ── JSON ──
  {
    id: 'json.format',
    hasTab: true,
    label: 'JSON 美化',
    group: 'JSON',
    detail: '容忍註解與尾逗號、支援 JSON Lines，大整數不失真',
    kind: 'transform',
    input: 'required',
    run: (input, _p, ctx) => stringifyNode(json(input), { indent: ctx.indent }),
  },
  { id: 'json.minify', hasTab: true, label: 'JSON 壓縮', group: 'JSON', kind: 'transform', input: 'required', run: (input) => stringifyNode(json(input), { indent: '' }) },
  {
    id: 'json.sortKeys',
    hasTab: true,
    label: 'JSON 遞迴排序 key',
    group: 'JSON',
    kind: 'transform',
    input: 'required',
    run: (input, _p, ctx) => stringifyNode(json(input), { indent: ctx.indent, sortKeys: true }),
  },
  {
    id: 'json.unescape',
    hasTab: true,
    label: 'JSON 去除跳脫字元',
    group: 'JSON',
    detail: '把 "{\\"a\\":1}" 還原成 JSON',
    kind: 'transform',
    input: 'required',
    run: (input, _p, ctx) => stringifyNode(unescapeJson(input), { indent: ctx.indent }),
  },
  { id: 'json.stats', hasTab: true, label: 'JSON 統計（結構與單詞）', group: 'JSON', kind: 'report', language: 'markdown', input: 'required', run: (input) => formatJsonStats(jsonStats(json(input))) },
  // ── 轉換 ──
  {
    id: 'convert.jsonTo',
    hasTab: true,
    label: 'JSON → 程式語言資料結構',
    group: '轉換',
    kind: 'report',
    input: 'required',
    params: [{ id: 'mode', label: '目標', kind: 'choice', choices: TARGET_MODES.map((m) => ({ value: m.mode, label: m.label })) }],
    run: (input, p, ctx) => convertJson(json(input), p.mode as TargetMode, { indent: ctx.indent }),
  },
  {
    id: 'convert.toJson',
    hasTab: true,
    label: 'PHP／Python／JS literal → JSON',
    group: '轉換',
    kind: 'report',
    language: 'json',
    input: 'required',
    params: [
      {
        id: 'dialect',
        label: '來源語言',
        kind: 'choice',
        choices: [
          { value: 'auto', label: '自動偵測' },
          { value: 'php', label: 'PHP array' },
          { value: 'python', label: 'Python dict' },
          { value: 'js', label: 'JavaScript object' },
        ],
      },
    ],
    run: (input, p, ctx) =>
      stringifyNode(p.dialect && p.dialect !== 'auto' ? parseLiteral(input, p.dialect as SourceDialect) : parseLiteral(input), { indent: ctx.indent }),
  },
  { id: 'convert.csvToJson', hasTab: true, label: 'CSV → JSON', group: '轉換', kind: 'report', language: 'json', input: 'required', run: (input, _p, ctx) => stringifyNode(csvToJson(input), { indent: ctx.indent }) },
  { id: 'convert.jsonToCsv', hasTab: true, label: 'JSON → CSV', group: '轉換', kind: 'report', language: 'csv', input: 'required', run: (input) => jsonToCsv(json(input)) },
  { id: 'php.unserialize', hasTab: true, label: 'PHP unserialize → JSON', group: '轉換', kind: 'report', language: 'json', input: 'required', run: (input, _p, ctx) => stringifyNode(phpUnserialize(input), { indent: ctx.indent }) },
  { id: 'php.serialize', hasTab: true, label: 'JSON → PHP serialize', group: '轉換', kind: 'report', language: 'plaintext', input: 'required', run: (input) => phpSerialize(json(input)) + '\n' },
  // ── 編碼 ──
  { id: 'base64.encode', label: 'Base64 編碼', group: '編碼', kind: 'transform', input: 'required', run: (input) => base64Encode(input) },
  { id: 'base64.encodeUrl', label: 'Base64URL 編碼（無 padding）', group: '編碼', kind: 'transform', input: 'required', run: (input) => base64Encode(input, true) },
  { id: 'base64.decode', label: 'Base64／Base64URL 解碼', group: '編碼', kind: 'transform', input: 'required', run: (input) => base64Decode(input) },
  { id: 'url.encode', label: 'URL 編碼（PHP urlencode，空白→+）', group: '編碼', kind: 'transform', input: 'required', run: (input) => phpUrlencode(input) },
  { id: 'url.rawencode', label: 'URL 編碼（PHP rawurlencode，空白→%20）', group: '編碼', kind: 'transform', input: 'required', run: (input) => phpRawurlencode(input) },
  { id: 'url.decode', label: 'URL 解碼（PHP urldecode，+→空白）', group: '編碼', kind: 'transform', input: 'required', run: (input) => phpUrldecode(input) },
  { id: 'url.rawdecode', label: 'URL 解碼（PHP rawurldecode，+ 保留）', group: '編碼', kind: 'transform', input: 'required', run: (input) => phpRawurldecode(input) },
  { id: 'html.specialchars', label: 'HTML 跳脫（PHP htmlspecialchars）', group: '編碼', kind: 'transform', input: 'required', run: (input) => phpHtmlspecialchars(input) },
  { id: 'html.entities', label: 'HTML 實體（PHP htmlentities）', group: '編碼', kind: 'transform', input: 'required', run: (input) => phpHtmlentities(input) },
  { id: 'html.decode', label: 'HTML 實體解碼（PHP html_entity_decode）', group: '編碼', kind: 'transform', input: 'required', run: (input) => phpHtmlEntityDecode(input) },
  {
    id: 'jwt.decode',
    hasTab: true,
    label: 'JWT 解碼與驗簽',
    group: '編碼',
    kind: 'report',
    language: 'markdown',
    input: 'required',
    params: [{ id: 'secret', label: 'HS256/384/512 密鑰（留空只解碼）', kind: 'secret', optional: true }],
    run: (input, p) => formatJwt(decodeJwt(input, p.secret || undefined)),
  },
  // ── 文字 ──
  {
    id: 'case.convert',
    label: '命名風格轉換',
    group: '文字',
    kind: 'transform',
    input: 'required',
    params: [
      {
        id: 'style',
        label: '風格',
        kind: 'choice',
        choices: (Object.keys(CASE_LABELS) as CaseStyle[]).map((s) => ({ value: s, label: CASE_LABELS[s] })),
      },
    ],
    run: (input, p) => convertCase(input, p.style as CaseStyle),
  },
  { id: 'case.all', label: '命名風格一覽', group: '文字', kind: 'report', language: 'plaintext', input: 'required', run: (input) => allCases(input) },
  {
    id: 'lines.process',
    label: '行處理（排序、去重、去空白）',
    group: '文字',
    kind: 'transform',
    input: 'required',
    params: [{ id: 'op', label: '動作', kind: 'choice', choices: LINE_OPS }],
    run: (input, p) => processLines(input, p.op as LineOp),
  },
  { id: 'text.stats', label: '文字統計', group: '文字', kind: 'report', language: 'markdown', input: 'required', run: (input) => formatTextStats(textStats(input)) },
  { id: 'number.base', label: '進位轉換', group: '文字', detail: '支援 0x／0o／0b 前綴與任意大數', kind: 'report', language: 'plaintext', input: 'required', run: (input) => baseReport(input) },
  {
    id: 'regex.test',
    label: '正則測試（輸入為要比對的文字）',
    group: '文字',
    kind: 'report',
    language: 'markdown',
    input: 'required',
    params: [
      { id: 'pattern', label: '正則（不含分隔符號）', kind: 'text', placeholder: '(\\d{4})-(\\d{2})' },
      { id: 'flags', label: '旗標', kind: 'text', placeholder: 'gimsuy', optional: true },
    ],
    run: (input, p) => regexReport(p.pattern ?? '', p.flags ?? '', input),
  },
  // ── 產生與時間 ──
  { id: 'gen.ids', label: '產生 UUID／ULID／NanoID／Token', group: '產生', kind: 'report', language: 'markdown', input: 'none', run: () => generateReport() },
  {
    id: 'time.timestamp',
    hasTab: true,
    label: 'Unix 時間戳 ⇄ 日期',
    group: '產生',
    detail: '留空代表現在；純數字依位數判斷秒／毫秒／微秒',
    kind: 'report',
    language: 'plaintext',
    input: 'optional',
    run: (input) => timestampReport(input),
  },
  {
    id: 'password.check',
    hasTab: true,
    label: '密碼檢查（依設定的規則）',
    group: '產生',
    kind: 'report',
    language: 'markdown',
    input: 'required',
    run: (input, _p, ctx) => formatCheck(checkPassword(input, ctx.policy)),
  },
];

export function findTool(id: string): Tool {
  const tool = TOOLS.find((t) => t.id === id);
  if (!tool) {
    throw new Error(`找不到工具：${id}`);
  }
  return tool;
}

export function toolInfos(): ToolInfo[] {
  return TOOLS.map((t) => ({
    id: t.id,
    label: t.label,
    group: t.group,
    detail: t.detail,
    kind: t.kind,
    language: t.language,
    input: t.input,
    hasTab: t.hasTab,
    params: t.params,
  }));
}

/** convert.jsonTo 的輸出語言依目標而定。 */
export function outputLanguage(tool: Tool, params: Record<string, string>): string {
  if (tool.id === 'convert.jsonTo') {
    return TARGET_MODES.find((m) => m.mode === params.mode)?.vscodeLanguage ?? 'plaintext';
  }
  return tool.language ?? 'plaintext';
}
