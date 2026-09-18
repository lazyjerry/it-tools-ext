import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { runTests } from '@vscode/test-electron';

async function main(): Promise<void> {
  const extensionDevelopmentPath = path.resolve(__dirname, '..', '..');
  const extensionTestsPath = path.resolve(__dirname, 'integration', 'index');
  // 專案路徑太長會讓 IPC socket 超過 103 字元，改用短暫存目錄
  const temporaryRoot = process.platform === 'darwin' ? '/private/tmp' : os.tmpdir();
  const testProfilePath = await fs.mkdtemp(path.join(temporaryRoot, 'itt-'));
  // 整合測試需要一個工作區資料夾
  const workspacePath = path.join(testProfilePath, 'ws');
  await fs.mkdir(workspacePath);

  // VS Code terminals may inherit this flag, which makes the app binary run as Node.
  delete process.env.ELECTRON_RUN_AS_NODE;

  try {
    await runTests({
      extensionDevelopmentPath,
      extensionTestsPath,
      version: '1.131.0',
      launchArgs: [
        workspacePath,
        '--disable-extensions',
        `--user-data-dir=${path.join(testProfilePath, 'u')}`,
        `--extensions-dir=${path.join(testProfilePath, 'e')}`,
      ],
    });
  } finally {
    await fs.rm(testProfilePath, { recursive: true, force: true });
  }
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
