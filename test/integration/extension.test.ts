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
});
