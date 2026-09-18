// 全部指令註冊：取選取文字（沒選取就整份文件）→ core 純函式 → 取代選取或開新編輯器。
import * as path from 'node:path';

import * as vscode from 'vscode';

import { excludeAmbiguous, generateLength, indent, inPlaceEdit, passwordPolicy, resolveOwnerName } from '../config';
import { parseLiteral } from '../core/convert/fromLiteral';
import { TARGET_MODES } from '../core/convert/toLang';
import { unifiedDiff } from '../core/diff/unified';
import { decodeInput } from '../core/hash/bytes';
import { buildHashTable, formatHashReport } from '../core/hash/compat';
import { JsonSyntaxError, offsetToLineColumn, parseJsonDocument, stringifyNode } from '../core/json/ast';
import { formatJsonStats, jsonStats, searchJsonIsolated } from '../core/json/tools';
import type { SearchHit } from '../core/json/tools';
import { checkPassword, formatCheck, generatePassword } from '../core/password/policy';
import { findTool, outputLanguage, TOOLS } from '../core/registry';
import type { Tool } from '../core/registry';
import { extensionOf } from '../diff/diffService';
import type { DiffService, DiffSide } from '../diff/diffService';
import { collectFileInfo } from '../fileinfo/fileInfo';
import type { ToolsViewProvider } from '../views/toolsViewProvider';

const PREFIX = 'IT Tooools：';
const RECENT_KEY = 'itTools.recentTools';

interface Source {
  editor: vscode.TextEditor;
  range: vscode.Range;
  text: string;
  isSelection: boolean;
}

export interface CommandDeps {
  context: vscode.ExtensionContext;
  diff: DiffService;
  panel: ToolsViewProvider;
  lastEditor(): vscode.TextEditor | undefined;
}

function currentSource(editor: vscode.TextEditor | undefined): Source | undefined {
  if (!editor) {
    return undefined;
  }
  const selection = editor.selection;
  if (!selection.isEmpty) {
    return { editor, range: selection, text: editor.document.getText(selection), isSelection: true };
  }
  const document = editor.document;
  const range = new vscode.Range(document.positionAt(0), document.positionAt(document.getText().length));
  return { editor, range, text: document.getText(), isSelection: false };
}

function sourceLabel(source: Source): string {
  const name = source.editor.document.isUntitled ? '未命名' : path.basename(source.editor.document.fileName);
  if (!source.isSelection) {
    return name;
  }
  const start = source.range.start.line + 1;
  const end = source.range.end.line + 1;
  return start === end ? `${name}（第 ${start} 行）` : `${name}（第 ${start}–${end} 行）`;
}

async function openReport(content: string, language = 'plaintext'): Promise<void> {
  const document = await vscode.workspace.openTextDocument({ content, language });
  await vscode.window.showTextDocument(document, { preview: false, viewColumn: vscode.ViewColumn.Beside });
}

async function applyTransform(source: Source | undefined, output: string): Promise<void> {
  if (source && inPlaceEdit()) {
    const ok = await source.editor.edit((edit) => edit.replace(source.range, output));
    if (ok) {
      return;
    }
  }
  await openReport(output, source?.editor.document.languageId);
}

function reveal(editor: vscode.TextEditor, offset: number, length = 0): void {
  const start = editor.document.positionAt(offset);
  const end = editor.document.positionAt(offset + length);
  editor.selection = new vscode.Selection(start, end);
  editor.revealRange(new vscode.Range(start, end), vscode.TextEditorRevealType.InCenter);
}

/** JSON 語法錯誤附「跳到錯誤位置」；位置以選取範圍起點換算回整份文件。 */
async function showError(error: unknown, source?: Source): Promise<void> {
  const message = error instanceof Error ? error.message : String(error);
  if (error instanceof JsonSyntaxError && source) {
    const choice = await vscode.window.showErrorMessage(`${PREFIX}${message}`, '跳到錯誤位置');
    if (choice) {
      reveal(source.editor, source.editor.document.offsetAt(source.range.start) + error.offset, 1);
    }
    return;
  }
  void vscode.window.showErrorMessage(`${PREFIX}${message}`);
}

async function askInput(title: string, options: { password?: boolean; optional?: boolean; placeholder?: string } = {}): Promise<string | undefined> {
  return vscode.window.showInputBox({
    title,
    password: options.password,
    placeHolder: options.placeholder,
    ignoreFocusOut: true,
    validateInput: (value) => (options.optional || value !== '' ? undefined : '不可為空'),
  });
}

async function collectParams(tool: Tool): Promise<Record<string, string> | undefined> {
  const params: Record<string, string> = {};
  for (const param of tool.params ?? []) {
    if (param.kind === 'choice') {
      const picked = await vscode.window.showQuickPick(
        (param.choices ?? []).map((c) => ({ label: c.label, value: c.value })),
        { title: `${tool.label}：${param.label}` },
      );
      if (!picked) {
        return undefined;
      }
      params[param.id] = picked.value;
    } else {
      const value = await askInput(`${tool.label}：${param.label}`, {
        password: param.kind === 'secret',
        optional: param.optional,
        placeholder: param.placeholder,
      });
      if (value === undefined) {
        return undefined;
      }
      params[param.id] = value;
    }
  }
  return params;
}

export function registerCommands(deps: CommandDeps): void {
  const { context, diff, panel } = deps;
  const register = (command: string, handler: (...args: unknown[]) => unknown): void => {
    context.subscriptions.push(vscode.commands.registerCommand(command, handler));
  };
  const editorSource = () => currentSource(vscode.window.activeTextEditor ?? deps.lastEditor());

  /** 共用流程：取輸入 → 收參數 → 執行 → 依工具類型取代或開新編輯器。 */
  const runTool = async (tool: Tool, presetParams?: Record<string, string>): Promise<void> => {
    let source = tool.input === 'none' ? undefined : editorSource();
    let input = source?.text ?? '';
    if (tool.input !== 'none' && input === '') {
      source = undefined;
      const typed = await askInput(`${tool.label}：輸入內容`, { optional: tool.input === 'optional', password: tool.id === 'password.check' });
      if (typed === undefined) {
        return;
      }
      input = typed;
    }
    const params = presetParams ?? (await collectParams(tool));
    if (!params) {
      return;
    }
    try {
      const output = await tool.run(input, params, { indent: indent(), policy: passwordPolicy() });
      if (tool.kind === 'transform') {
        await applyTransform(source, output);
      } else {
        await openReport(output, outputLanguage(tool, params));
      }
    } catch (error) {
      await showError(error, source);
    }
  };

  register('itTools.openPanel', () => panel.reveal());

  register('itTools.run', async () => {
    const recent = context.globalState.get<string[]>(RECENT_KEY, []).filter((id) => TOOLS.some((t) => t.id === id));
    type Item = vscode.QuickPickItem & { tool?: Tool };
    const items: Item[] = [];
    if (recent.length) {
      items.push({ label: '最近使用', kind: vscode.QuickPickItemKind.Separator });
      items.push(...recent.map((id) => findTool(id)).map((tool) => ({ label: tool.label, description: tool.group, detail: tool.detail, tool })));
    }
    for (const group of [...new Set(TOOLS.map((t) => t.group))]) {
      items.push({ label: group, kind: vscode.QuickPickItemKind.Separator });
      items.push(...TOOLS.filter((t) => t.group === group).map((tool) => ({ label: tool.label, detail: tool.detail, tool })));
    }
    const picked = await vscode.window.showQuickPick(items, { title: 'IT Tooools：執行工具', matchOnDetail: true });
    if (!picked?.tool) {
      return;
    }
    await context.globalState.update(RECENT_KEY, [picked.tool.id, ...recent.filter((id) => id !== picked.tool?.id)].slice(0, 5));
    await runTool(picked.tool);
  });

  register('itTools.hashSelection', async () => {
    const source = editorSource();
    const text = source?.text || (await askInput('Hash：輸入內容'));
    if (text === undefined) {
      return;
    }
    const table = buildHashTable(decodeInput(text, 'text'), { inputMode: 'text', format: 'hex', text });
    const title = `Hash 對照表：${source ? sourceLabel(source) : '手動輸入'}（以 UTF-8 編碼）`;
    await openReport(formatHashReport(table, title));
  });

  const jsonTransform = (sortKeys: boolean, minify: boolean) => async () => {
    const source = editorSource();
    if (!source || source.text.trim() === '') {
      void vscode.window.showWarningMessage(`${PREFIX}請先開啟或選取 JSON`);
      return;
    }
    try {
      const node = parseJsonDocument(source.text).node;
      await applyTransform(source, stringifyNode(node, { indent: minify ? '' : indent(), sortKeys }));
    } catch (error) {
      await showError(error, source);
    }
  };
  register('itTools.json.format', jsonTransform(false, false));
  register('itTools.json.minify', jsonTransform(false, true));

  register('itTools.json.stats', async () => {
    const source = editorSource();
    if (!source) {
      return;
    }
    try {
      await openReport(formatJsonStats(jsonStats(parseJsonDocument(source.text).node)), 'markdown');
    } catch (error) {
      await showError(error, source);
    }
  });

  register('itTools.json.search', async () => {
    const source = editorSource();
    if (!source) {
      void vscode.window.showWarningMessage(`${PREFIX}請先開啟 JSON 檔案`);
      return;
    }
    let root;
    try {
      root = parseJsonDocument(source.text).node;
    } catch (error) {
      await showError(error, source);
      return;
    }
    const query = await askInput('JSON 搜尋', { placeholder: '關鍵字搜 key 與值；$ 開頭為路徑（$.a[0]、$..id）；/正則/ 搜值' });
    if (!query) {
      return;
    }
    let hits: SearchHit[];
    try {
      if (query.startsWith('$')) {
        hits = await searchJsonIsolated(root, query, { mode: 'path' });
      } else {
        const regex = /^\/(.+)\/([a-z]*)$/.exec(query);
        const text = regex ? regex[1] : query;
        const options = { regex: Boolean(regex), caseSensitive: regex ? !regex[2].includes('i') : false };
        const byPath = new Map<string, SearchHit>();
        const byKey = await searchJsonIsolated(root, text, { mode: 'key', ...options });
        const byValue = await searchJsonIsolated(root, text, { mode: 'value', ...options });
        for (const hit of [...byKey, ...byValue]) {
          byPath.set(`${hit.path}@${hit.offset}`, hit);
        }
        hits = [...byPath.values()].sort((a, b) => a.offset - b.offset);
      }
    } catch (error) {
      await showError(error, source);
      return;
    }
    if (hits.length === 0) {
      void vscode.window.showInformationMessage(`${PREFIX}沒有符合「${query}」的結果`);
      return;
    }
    const base = source.editor.document.offsetAt(source.range.start);
    const items = hits.map((hit) => {
      const { line } = offsetToLineColumn(source.text, hit.offset);
      return { label: hit.path, description: hit.preview, detail: `第 ${source.range.start.line + line} 行`, hit };
    });
    const picked = await vscode.window.showQuickPick(items, {
      title: `JSON 搜尋「${query}」：${hits.length} 筆`,
      matchOnDescription: true,
      // 上下移動時即時預覽位置
      onDidSelectItem: (item) => {
        const hit = items.find((i) => i === item)?.hit;
        if (hit) {
          reveal(source.editor, base + hit.offset);
        }
      },
    });
    if (picked) {
      reveal(source.editor, base + picked.hit.offset);
    }
  });

  register('itTools.convert.jsonTo', async () => {
    const tool = findTool('convert.jsonTo');
    const picked = await vscode.window.showQuickPick(
      TARGET_MODES.map((m) => ({ label: m.label, mode: m.mode })),
      { title: '轉換：JSON → 程式語言' },
    );
    if (picked) {
      await runTool(tool, { mode: picked.mode });
    }
  });

  register('itTools.convert.toJson', async () => {
    const source = editorSource();
    if (!source || source.text.trim() === '') {
      void vscode.window.showWarningMessage(`${PREFIX}請先選取 PHP array、Python dict 或 JS object`);
      return;
    }
    try {
      await openReport(stringifyNode(parseLiteral(source.text), { indent: indent() }), 'json');
    } catch (error) {
      await showError(error, source);
    }
  });

  // ── Diff ──

  const sideFrom = (source: Source): DiffSide => ({
    text: source.text,
    label: sourceLabel(source),
    extension: extensionOf(source.editor.document),
  });

  register('itTools.diff.selectLeft', () => {
    const source = editorSource();
    if (!source) {
      return;
    }
    diff.setLeft(sideFrom(source));
    void vscode.window.setStatusBarMessage(`${PREFIX}已設為比較左側：${sourceLabel(source)}`, 3000);
  });

  register('itTools.diff.compareWithLeft', async () => {
    const left = diff.getLeft();
    const source = editorSource();
    if (!left) {
      void vscode.window.showWarningMessage(`${PREFIX}請先用「Diff：選取文字設為比較左側」指定左側`);
      return;
    }
    if (source) {
      await diff.open(left, sideFrom(source));
    }
  });

  register('itTools.diff.compareWithClipboard', async () => {
    const source = editorSource();
    if (!source) {
      return;
    }
    const clipboard = await vscode.env.clipboard.readText();
    await diff.open({ text: clipboard, label: '剪貼簿', extension: extensionOf(source.editor.document) }, sideFrom(source));
  });

  register('itTools.diff.unified', async () => {
    const source = editorSource();
    if (!source) {
      return;
    }
    const left = diff.getLeft() ?? { text: await vscode.env.clipboard.readText(), label: '剪貼簿' };
    const right = sideFrom(source);
    await openReport(unifiedDiff(left.text, right.text, { leftName: left.label, rightName: right.label }), 'diff');
  });

  // ── 面板分頁 ──

  register('itTools.timeCalc', () => panel.reveal('timecalc'));

  register('itTools.password.check', async () => {
    const password = await askInput('密碼檢查（輸入內容不會被記錄）', { password: true });
    if (password !== undefined) {
      await openReport(formatCheck(checkPassword(password, passwordPolicy())), 'markdown');
    }
  });

  register('itTools.password.generate', async () => {
    try {
      const password = generatePassword(passwordPolicy(), generateLength(), excludeAmbiguous());
      await vscode.env.clipboard.writeText(password);
      const editor = vscode.window.activeTextEditor;
      const choice = await vscode.window.showInformationMessage(
        `${PREFIX}已產生 ${password.length} 碼密碼並複製到剪貼簿`,
        ...(editor ? ['插入游標處'] : []),
      );
      if (choice && editor) {
        await editor.edit((edit) => edit.replace(editor.selection, password));
      }
    } catch (error) {
      await showError(error);
    }
  });

  register('itTools.fileInfo.show', () => panel.reveal('fileinfo'));

  register('itTools.fileInfo.refresh', async () => {
    const editor = vscode.window.activeTextEditor ?? deps.lastEditor();
    try {
      panel.sendFileInfo(editor ? await collectFileInfo(editor.document, resolveOwnerName()) : null);
      await panel.reveal('fileinfo');
    } catch (error) {
      await showError(error);
    }
  });
}
