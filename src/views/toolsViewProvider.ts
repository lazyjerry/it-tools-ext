// 底部面板的 webview：負責 HTML、訊息轉發與 RPC 分派，運算都交給 host/handlers。
import * as vscode from 'vscode';

import { excludeAmbiguous, generateLength, passwordPolicy } from '../config';
import { TARGET_MODES } from '../core/convert/toLang';
import { toolInfos } from '../core/registry';
import { isClientMessage } from '../shared/protocol';
import type { CallMap, ClientMessage, FileInfo, HostMessage, Method, TabId } from '../shared/protocol';

type Dispatch = <M extends Method>(method: M, params: CallMap[M]['params']) => Promise<CallMap[M]['result']>;

export class ToolsViewProvider implements vscode.WebviewViewProvider, vscode.Disposable {
  static readonly viewType = 'itTools.panel';

  private view: vscode.WebviewView | undefined;
  private ready = false;
  /** 面板還沒開或還沒 ready 時先記著，ready 後補送。 */
  private pending: HostMessage[] = [];
  private readonly disposables: vscode.Disposable[] = [];

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly dispatch: Dispatch,
    private readonly activeFileName: () => string | null,
  ) {}

  resolveWebviewView(webviewView: vscode.WebviewView): void {
    this.view = webviewView;
    this.ready = false;
    const mediaUri = vscode.Uri.joinPath(this.extensionUri, 'media');
    webviewView.webview.options = { enableScripts: true, localResourceRoots: [mediaUri] };
    webviewView.webview.html = this.getHtml(webviewView.webview, mediaUri);
    this.disposables.push(
      webviewView.webview.onDidReceiveMessage((message: unknown) => {
        if (isClientMessage(message)) {
          void this.handle(message);
        }
      }),
      webviewView.onDidDispose(() => {
        this.view = undefined;
        this.ready = false;
      }),
    );
  }

  private async handle(message: ClientMessage): Promise<void> {
    switch (message.type) {
      case 'ready':
        this.ready = true;
        await this.post({
          type: 'init',
          payload: {
            tools: toolInfos(),
            targetModes: TARGET_MODES.map(({ mode, label }) => ({ mode, label })),
            policy: passwordPolicy(),
            generateLength: generateLength(),
            excludeAmbiguous: excludeAmbiguous(),
            activeFile: this.activeFileName(),
          },
        });
        for (const queued of this.pending.splice(0)) {
          await this.post(queued);
        }
        return;
      case 'call':
        try {
          const result = await this.dispatch(message.method, message.params as never);
          await this.post({ type: 'reply', id: message.id, ok: true, result });
        } catch (error) {
          await this.post({ type: 'reply', id: message.id, ok: false, error: error instanceof Error ? error.message : String(error) });
        }
        return;
      case 'copy':
        await vscode.env.clipboard.writeText(message.text);
        void vscode.window.setStatusBarMessage(`IT Tooools：已複製${message.label}`, 2000);
        return;
      case 'openInEditor': {
        const document = await vscode.workspace.openTextDocument({ content: message.content, language: message.language });
        await vscode.window.showTextDocument(document, { preview: false });
        return;
      }
      case 'revealInOS':
        await vscode.commands.executeCommand('revealFileInOS', vscode.Uri.file(message.path));
        return;
      case 'openSettings':
        await vscode.commands.executeCommand('workbench.action.openSettings', message.query);
        return;
    }
  }

  private async post(message: HostMessage): Promise<void> {
    if (!this.view || !this.ready) {
      // 同類型只留最新一筆：面板沒開時切換檔案不該一直累積
      if (message.type !== 'reply') {
        this.pending = this.pending.filter((m) => m.type !== message.type);
        this.pending.push(message);
      }
      return;
    }
    await this.view.webview.postMessage(message);
  }

  async reveal(tab?: TabId): Promise<void> {
    await vscode.commands.executeCommand(`${ToolsViewProvider.viewType}.focus`);
    if (tab) {
      await this.post({ type: 'showTab', tab });
    }
  }

  notifyActiveFile(name: string | null): void {
    void this.post({ type: 'activeFileChanged', name });
  }

  notifyPolicy(): void {
    void this.post({ type: 'policyChanged', policy: passwordPolicy(), generateLength: generateLength(), excludeAmbiguous: excludeAmbiguous() });
  }

  sendFileInfo(info: FileInfo | null): void {
    void this.post({ type: 'fileInfo', info });
  }

  private getHtml(webview: vscode.Webview, mediaUri: vscode.Uri): string {
    const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(mediaUri, 'main.js'));
    const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(mediaUri, 'styles.css'));
    const nonce = createNonce();
    return `<!DOCTYPE html>
<html lang="zh-Hant">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy"
    content="default-src 'none'; style-src ${webview.cspSource}; script-src 'nonce-${nonce}';">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <link href="${styleUri}" rel="stylesheet">
  <title>IT Tooools</title>
</head>
<body>
  <div id="app"></div>
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
  }

  dispose(): void {
    this.disposables.forEach((d) => d.dispose());
  }
}

function createNonce(): string {
  const characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let nonce = '';
  for (let index = 0; index < 32; index += 1) {
    nonce += characters.charAt(Math.floor(Math.random() * characters.length));
  }
  return nonce;
}
