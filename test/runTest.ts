import { execFileSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { downloadAndUnzipVSCode, runTests } from '@vscode/test-electron';

const LSREGISTER =
  '/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister';

// 測試用 VS Code 啟動後會被 Launch Services 登記，Fork 等工具的 Open With 就會多出一個 VS Code
function unregisterFromLaunchServices(vscodeExecutablePath: string): void {
  if (process.platform !== 'darwin') {
    return;
  }
  const appBundlePath = vscodeExecutablePath.slice(0, vscodeExecutablePath.indexOf('.app/') + 4);
  try {
    execFileSync(LSREGISTER, ['-u', appBundlePath]);
  } catch {
    // 取消登記失敗不影響測試結果
  }
}

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

  const vscodeExecutablePath = await downloadAndUnzipVSCode('1.131.0');

  try {
    await runTests({
      vscodeExecutablePath,
      extensionDevelopmentPath,
      extensionTestsPath,
      launchArgs: [
        workspacePath,
        '--disable-extensions',
        `--user-data-dir=${path.join(testProfilePath, 'u')}`,
        `--extensions-dir=${path.join(testProfilePath, 'e')}`,
      ],
    });
  } finally {
    unregisterFromLaunchServices(vscodeExecutablePath);
    await fs.rm(testProfilePath, { recursive: true, force: true });
  }
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
