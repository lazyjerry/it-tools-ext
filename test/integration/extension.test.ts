import * as assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import * as vscode from 'vscode';

import { DEFAULT_POLICY } from '../../src/core/password/policy';
import type { ItToolsApi } from '../../src/extension';

const EXTENSION_ID = 'workjerry.it-tooools';

async function activate(): Promise<ItToolsApi> {
  const extension = vscode.extensions.getExtension<ItToolsApi>(EXTENSION_ID);
  assert.ok(extension, `找不到 ${EXTENSION_ID}`);
  return extension.activate();
}

suite('IT Tooools 整合測試', () => {
  let api: ItToolsApi;

  suiteSetup(async () => {
    api = await activate();
  });

  teardown(async () => {
    await vscode.commands.executeCommand('workbench.action.closeAllEditors');
  });

  test('package.json 宣告的指令都有註冊', async () => {
    const extension = vscode.extensions.getExtension(EXTENSION_ID);
    const declared = (extension?.packageJSON.contributes.commands as { command: string }[]).map((c) => c.command);
    const registered = new Set(await vscode.commands.getCommands(true));
    assert.deepEqual(declared.filter((c) => !registered.has(c)), []);
  });

  test('原生 diff：兩段文字掛成虛擬文件並開啟 diff 編輯器', async () => {
    await api.call('diff.native', { left: 'a\nb\n', right: 'a\nc\n' });
    const docs = vscode.workspace.textDocuments.filter((d) => d.uri.scheme === api.diffScheme);
    assert.deepEqual(docs.map((d) => d.getText()).sort(), ['a\nb\n', 'a\nc\n']);
  });

  test('JSON 美化指令就地取代，大整數不失真', async () => {
    const document = await vscode.workspace.openTextDocument({ content: '{"id":12345678901234567890,"a":[1]}', language: 'json' });
    await vscode.window.showTextDocument(document);
    await vscode.commands.executeCommand('itTools.json.format');
    assert.equal(document.getText(), '{\n  "id": 12345678901234567890,\n  "a": [\n    1\n  ]\n}');
  });

  test('檔案資訊：BOM、CRLF、大小與摘要', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'itt-'));
    const file = path.join(dir, 'bom.txt');
    await fs.writeFile(file, Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('a\r\nb\r\n')]));
    try {
      await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(file));
      const info = await api.call('fileinfo.refresh', null);
      assert.ok(info);
      assert.equal(info.probe.bom?.kind, 'UTF-8');
      assert.equal(info.probe.eol, 'CRLF');
      assert.equal(info.probe.lines, 2);
      assert.match(info.size ?? '', /^9 B$/);
      assert.equal(info.summary?.workspace, '否');
      assert.equal(info.summary?.gitRepo, '否');
      assert.equal(info.summary?.access, process.platform === 'win32' ? info.summary?.access : '讀取 ✓・編輯 ✓・執行 ✗');

      // 只放一個空的 .git 目錄：判定在 repo 內、專案根改成 repo 根，但還沒有 index
      await fs.mkdir(path.join(dir, '.git'));
      const inRepo = await api.call('fileinfo.refresh', null);
      assert.equal(inRepo?.projectRootKind, 'git');
      assert.equal(inRepo?.projectRelativePath, 'bom.txt');
      assert.match(inRepo?.summary?.gitTracking ?? '', /^未追蹤（repo 還沒有 index/);
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  test('面板 RPC：hash 對照表與工具執行', async () => {
    const table = await api.call('hash.table', { input: 'hello', inputMode: 'text', format: 'hex', hmacKey: '', hmacKeyMode: 'text' });
    assert.equal(table.rows.find((r) => r.id === 'crc32')?.value, '3d653119');
    assert.equal(await api.call('tool.run', { toolId: 'url.encode', input: 'a b', params: {} }), 'a+b');
    assert.equal(await api.call('timecalc', { op: 'timeDifference', start: '08:00', end: '08:00' }), '1440 分鐘（24 小時 0 分鐘）｜跨夜');
  });

  test('面板 RPC：密碼規則以面板帶進來的為準，不讀設定', async () => {
    const policy = { ...DEFAULT_POLICY, minLength: 3, requireUppercase: false, requireDigit: false, requireSymbol: false, forbidSequential: false };
    const check = await api.call('password.check', { password: 'abc', policy });
    assert.equal(check.passed, true);
    assert.deepEqual(check.rules.map((r) => r.id), ['length', 'lower', 'repeated', 'keyboard', 'common']);
    const [generated] = await api.call('password.generate', { length: 12, count: 1, excludeAmbiguous: false, policy });
    assert.match(generated, /^[A-Za-z0-9]{12}$/);
    const snippets = await api.call('password.snippets', { policy });
    assert.match(snippets.find((s) => s.id === 'laravel')?.code ?? '', /Password::min\(3\)->letters\(\), 'regex:\/\[a-z\]\/'/);
  });

  test('面板 RPC：密碼產生的長度與數量在 host 端夾在範圍內', async () => {
    const policy = { ...DEFAULT_POLICY, requireSymbol: false };
    const many = await api.call('password.generate', { length: 100000, count: 1000, excludeAmbiguous: false, policy });
    assert.equal(many.length, 50);
    assert.ok(many.every((pw) => pw.length === 256));
    const [short] = await api.call('password.generate', { length: 1, count: 1, excludeAmbiguous: false, policy });
    assert.equal(short.length, 8);
    const [normal] = await api.call('password.generate', { length: 20, count: 1, excludeAmbiguous: false, policy });
    assert.equal(normal.length, 20);
  });

  test('面板 RPC：正則搜尋在 worker 執行，回溯爆炸時逾時回報而不凍結', async () => {
    const input = JSON.stringify({ a: 'xy', b: { c: 'x' }, evil: `${'a'.repeat(40)}!` });
    const hits = await api.call('json.search', { input, query: '^x', mode: 'value', regex: true, caseSensitive: false });
    assert.deepEqual(hits.map((h) => h.path), ['$.a', '$.b.c']);
    const started = Date.now();
    await assert.rejects(api.call('json.search', { input, query: '^(a+)+$', mode: 'value', regex: true, caseSensitive: false }), /正則執行超過 2 秒已中止/);
    assert.ok(Date.now() - started < 5000);
  });

  test('面板 RPC：正則測試工具在 worker 執行，結果不變、回溯爆炸時逾時回報', async () => {
    const report = await api.call('tool.run', { toolId: 'regex.test', input: '2026-09 1999-12', params: { pattern: '(\\d{4})-(\\d{2})', flags: '' } });
    assert.match(report, /^# 正則測試 \/\(\\d\{4\}\)-\(\\d\{2\}\)\/\n共 2 個匹配\n\n\[0\] 位置 0："2026-09"\n {5}群組 1："2026"\n {5}群組 2："09"\n\[1\] 位置 8："1999-12"/);
    const started = Date.now();
    await assert.rejects(
      api.call('tool.run', { toolId: 'regex.test', input: `${'a'.repeat(40)}!`, params: { pattern: '^(a+)+$', flags: '' } }),
      /正則執行超過 2 秒已中止/,
    );
    assert.ok(Date.now() - started < 5000);
  });

  test('面板 RPC：只接受 handlers 自己的方法', async () => {
    for (const method of ['constructor', 'valueOf', '__proto__', 'hasOwnProperty']) {
      await assert.rejects(api.call(method as never, null as never), /未知的方法/);
    }
  });
});
