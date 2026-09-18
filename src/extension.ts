// 進入點：組裝 Diff 虛擬文件、底部面板與指令，並回傳整合測試用的 API。
import * as path from 'node:path';

import * as vscode from 'vscode';

import { registerCommands } from './commands/registerCommands';
import { DIFF_SCHEME, DiffService } from './diff/diffService';
import { createHandlers } from './host/handlers';
import type { CallMap, Method } from './shared/protocol';
import { ToolsViewProvider } from './views/toolsViewProvider';

/** headless 測試沒有剪貼簿與面板畫面可觀察，直接透過這個介面驗證。 */
export interface ItToolsApi {
  diffScheme: string;
  call<M extends Method>(method: M, params: CallMap[M]['params']): Promise<CallMap[M]['result']>;
}

export function activate(context: vscode.ExtensionContext): ItToolsApi {
  const diff = new DiffService();
  let lastEditor = vscode.window.activeTextEditor;
  const fileName = (editor: vscode.TextEditor | undefined) =>
    editor ? (editor.document.isUntitled ? editor.document.uri.path : path.basename(editor.document.fileName)) : null;

  const handlers = createHandlers({ diff, lastEditor: () => lastEditor });
  const call = async <M extends Method>(method: M, params: CallMap[M]['params']): Promise<CallMap[M]['result']> =>
    (handlers[method] as (p: CallMap[M]['params']) => Promise<CallMap[M]['result']> | CallMap[M]['result'])(params);

  const panel = new ToolsViewProvider(context.extensionUri, call, () => fileName(lastEditor));

  context.subscriptions.push(
    diff,
    panel,
    vscode.window.registerWebviewViewProvider(ToolsViewProvider.viewType, panel),
    // 只通知檔名讓面板標示「已切換、資訊過期」，不在這裡讀檔
    vscode.window.onDidChangeActiveTextEditor((editor) => {
      if (editor && editor.document.uri.scheme !== DIFF_SCHEME) {
        lastEditor = editor;
        panel.notifyActiveFile(fileName(editor));
      }
    }),
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration('itTools.password')) {
        panel.notifyPolicy();
      }
    }),
  );

  registerCommands({ context, diff, panel, lastEditor: () => lastEditor });

  return { diffScheme: DIFF_SCHEME, call };
}

export function deactivate(): void {}
