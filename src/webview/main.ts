// 面板進入點：左側分頁列、右側工作區。每個分頁只在第一次切到時建立，之後保留 DOM，
// 避免切換分頁時重建輸入框而失去游標與捲動位置。
import type { HostMessage, TabId } from '../shared/protocol';
import { TabContext } from './context';
import { el } from './dom';
import { convertTab } from './tabs/convertTab';
import { diffTab } from './tabs/diffTab';
import { fileInfoTab } from './tabs/fileInfoTab';
import type { FileInfoView } from './tabs/fileInfoTab';
import { hashTab } from './tabs/hashTab';
import { jsonSearchTab } from './tabs/jsonSearchTab';
import { jsonTab } from './tabs/jsonTab';
import { jwtTab } from './tabs/jwtTab';
import { PolicyStore } from './tabs/passwordPolicy';
import { passwordCheckTab, passwordGenerateTab } from './tabs/passwordTab';
import { timecalcTab } from './tabs/timecalcTab';
import { timestampTab } from './tabs/timestampTab';
import { toolsTab } from './tabs/toolsTab';

const TABS: { id: TabId; label: string }[] = [
  { id: 'hash', label: 'Hash' },
  { id: 'json', label: 'JSON' },
  { id: 'jsonsearch', label: 'JSON 搜尋' },
  { id: 'convert', label: '轉換' },
  { id: 'diff', label: 'Diff' },
  { id: 'timecalc', label: '時間計算' },
  { id: 'pwcheck', label: '密碼檢查' },
  { id: 'pwgen', label: '密碼產生' },
  { id: 'jwt', label: 'JWT' },
  { id: 'timestamp', label: '時間戳' },
  { id: 'fileinfo', label: '檔案資訊' },
  { id: 'tools', label: '常用工具' },
];

const ctx = new TabContext();
const app = document.getElementById('app') as HTMLElement;
const nav = el('nav', 'tabs');
const main = el('main', 'workspace');
const built = new Map<TabId, HTMLElement>();
const navButtons = new Map<TabId, HTMLButtonElement>();
let fileInfo: FileInfoView | undefined;
let policyStore: PolicyStore | undefined;
let passwordGenerate: ReturnType<typeof passwordGenerateTab> | undefined;

// 兩個密碼分頁誰先被打開都要拿到同一份；ctx.init 在 init 訊息之後才有值，所以延後建立
function sharedPolicy(): PolicyStore {
  policyStore ??= new PolicyStore(ctx);
  return policyStore;
}

function build(tab: TabId): HTMLElement {
  switch (tab) {
    case 'hash':
      return hashTab(ctx);
    case 'json':
      return jsonTab(ctx);
    case 'jsonsearch':
      return jsonSearchTab(ctx);
    case 'convert':
      return convertTab(ctx);
    case 'diff':
      return diffTab(ctx);
    case 'timecalc':
      return timecalcTab(ctx);
    case 'pwcheck':
      return passwordCheckTab(ctx, sharedPolicy());
    case 'pwgen':
      passwordGenerate = passwordGenerateTab(ctx, sharedPolicy());
      return passwordGenerate.root;
    case 'jwt':
      return jwtTab(ctx);
    case 'timestamp':
      return timestampTab(ctx);
    case 'fileinfo':
      fileInfo = fileInfoTab(ctx);
      return fileInfo.root;
    case 'tools':
      return toolsTab(ctx);
  }
}

function show(tab: TabId): void {
  ctx.tab = tab;
  let view = built.get(tab);
  if (!view) {
    view = build(tab);
    built.set(tab, view);
    main.append(view);
  }
  for (const [id, node] of built) {
    node.classList.toggle('hidden', id !== tab);
  }
  for (const [id, btn] of navButtons) {
    btn.classList.toggle('active', id === tab);
  }
}

window.addEventListener('message', (event: MessageEvent<HostMessage>) => {
  const message = event.data;
  if (ctx.handleReply(message)) {
    return;
  }
  switch (message.type) {
    case 'init': {
      ctx.init = message.payload;
      app.textContent = '';
      for (const tab of TABS) {
        const btn = el('button', 'tab-button', tab.label);
        btn.type = 'button';
        btn.addEventListener('click', () => show(tab.id));
        navButtons.set(tab.id, btn);
        nav.append(btn);
      }
      app.append(nav, main);
      show(TABS.some((t) => t.id === ctx.tab) ? ctx.tab : 'hash');
      return;
    }
    case 'showTab':
      show(message.tab);
      return;
    case 'activeFileChanged':
      ctx.init.activeFile = message.name;
      fileInfo?.setActiveFile(message.name);
      return;
    case 'fileInfo':
      show('fileinfo');
      fileInfo?.show(message.info);
      return;
    case 'policyChanged':
      ctx.init.policy = message.policy;
      ctx.init.generateLength = message.generateLength;
      ctx.init.excludeAmbiguous = message.excludeAmbiguous;
      policyStore?.defaultsChanged();
      passwordGenerate?.onDefaultsChanged();
      return;
  }
});

ctx.post({ type: 'ready' });
