// 把任意兩段文字掛成唯讀虛擬文件，交給 VS Code 原生 vscode.diff 並排比較。
import * as path from 'node:path';

import * as vscode from 'vscode';

export const DIFF_SCHEME = 'it-tooools-diff';

export interface DiffSide {
  text: string;
  /** 顯示在分頁標題的名稱。 */
  label: string;
  /** 用來推測語法上色的副檔名（含點），例如 .json。 */
  extension?: string;
}

export class DiffService implements vscode.TextDocumentContentProvider, vscode.Disposable {
  private readonly contents = new Map<string, string>();
  private nextId = 1;
  private left: DiffSide | undefined;
  private readonly disposables: vscode.Disposable[] = [];

  constructor() {
    this.disposables.push(
      vscode.workspace.registerTextDocumentContentProvider(DIFF_SCHEME, this),
      // 分頁關掉就釋放內容，避免貼過的大段文字一直留在記憶體
      vscode.workspace.onDidCloseTextDocument((doc) => {
        if (doc.uri.scheme === DIFF_SCHEME) {
          this.contents.delete(doc.uri.query);
        }
      }),
    );
  }

  provideTextDocumentContent(uri: vscode.Uri): string {
    return this.contents.get(uri.query) ?? '';
  }

  private register(side: DiffSide): vscode.Uri {
    const id = String(this.nextId++);
    this.contents.set(id, side.text);
    const safe = side.label.replace(/[\\/:*?"<>|]/g, '_');
    return vscode.Uri.from({ scheme: DIFF_SCHEME, path: `/${id}/${safe}${side.extension ?? '.txt'}`, query: id });
  }

  async open(left: DiffSide, right: DiffSide): Promise<void> {
    const leftUri = this.register(left);
    const rightUri = this.register(right);
    await vscode.commands.executeCommand('vscode.diff', leftUri, rightUri, `${left.label} ↔ ${right.label}`, { preview: false });
  }

  setLeft(side: DiffSide): void {
    this.left = side;
    void vscode.commands.executeCommand('setContext', 'itTools.diffLeftSet', true);
  }

  getLeft(): DiffSide | undefined {
    return this.left;
  }

  dispose(): void {
    this.disposables.forEach((d) => d.dispose());
    this.contents.clear();
  }
}

/** 取來源文件的副檔名給虛擬文件用，讓並排比較也有語法上色。 */
export function extensionOf(document: vscode.TextDocument | undefined): string | undefined {
  if (!document || document.isUntitled) {
    return undefined;
  }
  return path.extname(document.fileName) || undefined;
}
