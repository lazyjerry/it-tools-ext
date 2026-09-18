// 面板 RPC 的實作：收參數 → 呼叫 core 純函式 → 回傳可序列化結果。
import type * as vscode from 'vscode';

import { excludeAmbiguous as excludeAmbiguousSetting, indent, passwordPolicy, resolveOwnerName } from '../config';
import { parseLiteral } from '../core/convert/fromLiteral';
import { convertJson } from '../core/convert/toLang';
import { unifiedDiff } from '../core/diff/unified';
import { parseBcrypt } from '../core/hash/bcrypt';
import { decodeInput } from '../core/hash/bytes';
import { buildHashTable, buildHmacTable } from '../core/hash/compat';
import { offsetToLineColumn, parseJsonDocument, stringifyNode } from '../core/json/ast';
import { formatJsonStats, jsonStats, searchJsonIsolated, unescapeJson } from '../core/json/tools';
import { validationSnippets } from '../core/password/codegen';
import { GENERATE_COUNT_RANGE, GENERATE_LENGTH_RANGE, checkPassword, generatePassword, safeMinLength } from '../core/password/policy';
import { findTool } from '../core/registry';
import { runTimeCalc } from '../core/timecalc/timecalc';
import type { DiffService } from '../diff/diffService';
import { collectFileInfo } from '../fileinfo/fileInfo';
import type { CallMap, FileInfo, Method } from '../shared/protocol';

type Handlers = { [M in Method]: (params: CallMap[M]['params']) => Promise<CallMap[M]['result']> | CallMap[M]['result'] };

export interface HandlerDeps {
  diff: DiffService;
  /** 面板操作時 webview 取得焦點，activeTextEditor 會變成 undefined，所以用最後一個文字編輯器。 */
  lastEditor(): vscode.TextEditor | undefined;
}

/** 範圍內的值原樣保留（含小數，與先前行為相同），超出夾到邊界，非數字用預設值。 */
function clampFinite(value: unknown, range: { min: number; max: number; fallback: number }): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.min(Math.max(value, range.min), range.max) : range.fallback;
}

export function createHandlers(deps: HandlerDeps): Handlers {
  return {
    'hash.table': ({ input, inputMode, format, hmacKey, hmacKeyMode }) => {
      const data = decodeInput(input, inputMode);
      const options = { inputMode, format, text: inputMode === 'text' ? input : undefined };
      const table = buildHashTable(data, options);
      let bcrypt = null;
      if (inputMode === 'text' && /^\$2[abxy]?\$/.test(input.trim())) {
        try {
          bcrypt = parseBcrypt(input);
        } catch {
          bcrypt = null;
        }
      }
      return {
        rows: table.rows,
        hmacRows: hmacKey ? buildHmacTable(data, decodeInput(hmacKey, hmacKeyMode), options) : [],
        unsupportedPhp: table.unsupportedPhp,
        inputBytes: table.inputBytes,
        bcrypt,
      };
    },

    'json.process': ({ input, action }) => {
      if (action === 'unescape') {
        return stringifyNode(unescapeJson(input), { indent: indent() });
      }
      const node = parseJsonDocument(input).node;
      switch (action) {
        case 'format':
          return stringifyNode(node, { indent: indent() });
        case 'minify':
          return stringifyNode(node, { indent: '' });
        case 'sort':
          return stringifyNode(node, { indent: indent(), sortKeys: true });
        case 'stats':
          return formatJsonStats(jsonStats(node));
      }
    },

    'json.search': async ({ input, query, mode, regex, caseSensitive }) => {
      const node = parseJsonDocument(input).node;
      return (await searchJsonIsolated(node, query, { mode, regex, caseSensitive }))
        .slice(0, 1000)
        .map((hit) => ({ ...hit, ...offsetToLineColumn(input, hit.offset) }));
    },

    'convert.to': ({ input, mode }) => convertJson(parseJsonDocument(input).node, mode, { indent: indent() }),

    'convert.from': ({ input, dialect }) =>
      stringifyNode(dialect === 'auto' ? parseLiteral(input) : parseLiteral(input, dialect), { indent: indent() }),

    'diff.native': async ({ left, right }) => {
      await deps.diff.open({ text: left, label: '左側' }, { text: right, label: '右側' });
      return null;
    },

    'diff.unified': ({ left, right, ignoreWhitespace, ignoreCase, context }) =>
      unifiedDiff(left, right, { ignoreWhitespace, ignoreCase, context }),

    timecalc: (params) => runTimeCalc(params),

    // 規則由面板帶進來：面板上可以臨時調整，設定頁的值只是它的預設
    'password.check': ({ password, policy }) => checkPassword(password, policy),

    // 面板 input 的 min／max 可被直接輸入繞過，host 端再夾一次；minLength 也會決定產生長度，一併限制
    'password.generate': ({ length, count, excludeAmbiguous, policy }) =>
      Array.from({ length: clampFinite(count, GENERATE_COUNT_RANGE) }, () =>
        generatePassword(
          { ...policy, minLength: safeMinLength(policy.minLength) },
          clampFinite(length, GENERATE_LENGTH_RANGE),
          excludeAmbiguous ?? excludeAmbiguousSetting(),
        ),
      ),

    'password.snippets': ({ policy }) => validationSnippets(policy),

    'fileinfo.refresh': async (): Promise<FileInfo | null> => {
      const editor = deps.lastEditor();
      return editor ? collectFileInfo(editor.document, resolveOwnerName()) : null;
    },

    'tool.run': ({ toolId, input, params }) => findTool(toolId).run(input, params, { indent: indent(), policy: passwordPolicy() }),
  };
}
