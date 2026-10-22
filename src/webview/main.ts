// 面板進入點：左側兩層選單（最近使用 + 四個分類）、拖曳把手、右側工作區。
// 每個分頁只在第一次切到時建立，之後保留 DOM，避免切換分頁時重建輸入框而失去游標與捲動位置。
import { TAB_IDS } from '../shared/protocol';
import type { HostMessage, TabId } from '../shared/protocol';
import { NAV_WIDTH_MAX, NAV_WIDTH_MIN, normalizeNavWidth, pushRecent } from '../shared/uiState';
import { TabContext } from './context';
import { el, icon } from './dom';
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
import { shiftCheckTab } from './tabs/shiftCheckTab';
import { timecalcTab } from './tabs/timecalcTab';
import { timestampTab } from './tabs/timestampTab';
import { toolsTab } from './tabs/toolsTab';

interface Category {
  id: string;
  label: string;
  tabs: { id: TabId; label: string }[];
}

const CATEGORIES: Category[] = [
  {
    id: 'data',
    label: '資料',
    tabs: [
      { id: 'hash', label: 'Hash' },
      { id: 'json', label: 'JSON' },
      { id: 'jsonsearch', label: 'JSON 搜尋' },
      { id: 'convert', label: '轉換' },
      { id: 'jwt', label: 'JWT' },
    ],
  },
  {
    id: 'time',
    label: '時間',
    tabs: [
      { id: 'shiftcheck', label: '工時核對' },
      { id: 'timecalc', label: '時間計算' },
      { id: 'timestamp', label: '時間戳' },
    ],
  },
  {
    id: 'password',
    label: '密碼',
    tabs: [
      { id: 'pwcheck', label: '密碼檢查' },
      { id: 'pwgen', label: '密碼產生' },
    ],
  },
  {
    id: 'misc',
    label: '其他',
    tabs: [
      { id: 'diff', label: 'Diff' },
      { id: 'fileinfo', label: '檔案資訊' },
      { id: 'tools', label: '常用工具' },
    ],
  },
];

const LABELS = Object.fromEntries(CATEGORIES.flatMap((c) => c.tabs.map((t) => [t.id, t.label]))) as Record<TabId, string>;
const FALLBACK_TAB: TabId = 'hash';
const EXPANDED_KEY = 'nav.expanded';

const ctx = new TabContext();
const app = document.getElementById('app') as HTMLElement;
const nav = el('nav', 'tabs');
const resizer = el('div', 'nav-resizer');
const main = el('main', 'workspace');
const built = new Map<TabId, HTMLElement>();
const recentItems = el('div', 'nav-items');
const groupItems = new Map<string, { title: HTMLButtonElement; items: HTMLElement }>();
let recent: TabId[] = [];
let navWidth: number | null = null;
let fileInfo: FileInfoView | undefined;
let policyStore: PolicyStore | undefined;
let passwordGenerate: ReturnType<typeof passwordGenerateTab> | undefined;

const isTabId = (value: unknown): value is TabId => typeof value === 'string' && (TAB_IDS as readonly string[]).includes(value);

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
    case 'shiftcheck':
      return shiftCheckTab(ctx);
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

// ── 左側選單 ──

function tabButton(tab: TabId): HTMLButtonElement {
  const btn = el('button', 'tab-button', LABELS[tab]);
  btn.type = 'button';
  btn.dataset.tab = tab;
  btn.addEventListener('click', () => show(tab));
  return btn;
}

/** 同一個分頁在「最近使用」和它的分類裡各有一顆按鈕，兩顆一起反白。 */
function highlight(): void {
  for (const btn of nav.querySelectorAll<HTMLButtonElement>('.tab-button')) {
    btn.classList.toggle('active', btn.dataset.tab === ctx.tab);
  }
}

function renderRecent(): void {
  recentItems.textContent = '';
  if (recent.length === 0) {
    recentItems.append(el('div', 'nav-empty', '尚無紀錄'));
  }
  for (const tab of recent) {
    recentItems.append(tabButton(tab));
  }
}

function expandedGroups(): Set<string> {
  return new Set(ctx.get(EXPANDED_KEY).split(',').filter(Boolean));
}

function setExpanded(id: string, expanded: boolean): void {
  const set = expandedGroups();
  if (expanded) {
    set.add(id);
  } else {
    set.delete(id);
  }
  ctx.set(EXPANDED_KEY, [...set].join(','));
  const group = groupItems.get(id);
  if (group) {
    group.items.classList.toggle('hidden', !expanded);
    group.title.classList.toggle('collapsed', !expanded);
    group.title.setAttribute('aria-expanded', String(expanded));
  }
}

function group(id: string, label: string, items: HTMLElement, collapsible: boolean): HTMLElement {
  const root = el('div', collapsible ? 'nav-group' : 'nav-group static');
  const title = el('button', 'nav-group-title');
  title.type = 'button';
  if (collapsible) {
    title.append(icon('chevron'));
    title.addEventListener('click', () => setExpanded(id, !expandedGroups().has(id)));
    groupItems.set(id, { title, items });
  } else {
    title.disabled = true;
  }
  title.append(el('span', undefined, label));
  root.append(title, items);
  return root;
}

function buildNav(): void {
  nav.textContent = '';
  groupItems.clear();
  renderRecent();
  // 最近使用固定展開：它的用途就是一眼看到、一下點到
  nav.append(group('recent', '最近使用', recentItems, false));
  const expanded = expandedGroups();
  for (const category of CATEGORIES) {
    const items = el('div', 'nav-items');
    items.append(...category.tabs.map((t) => tabButton(t.id)));
    nav.append(group(category.id, category.label, items, true));
    setExpanded(category.id, expanded.has(category.id));
  }
}

function applyNavWidth(width: number | null): void {
  navWidth = width;
  nav.style.width = width === null ? '' : `${width}px`;
}

// 拖曳把手：按下時記住起點，放開才回報 host 落地；雙擊還原成由內容決定的寬度
function setupResizer(): void {
  resizer.setAttribute('role', 'separator');
  resizer.setAttribute('aria-orientation', 'vertical');
  resizer.title = '拖曳調整選單寬度，雙擊還原';
  resizer.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) {
      return;
    }
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = nav.getBoundingClientRect().width;
    // 把手緊貼面板邊緣時不能超過視窗一半，否則工作區會被擠到看不見
    const max = Math.min(NAV_WIDTH_MAX, Math.floor(window.innerWidth / 2));
    const move = (e: PointerEvent) => applyNavWidth(Math.min(Math.max(Math.round(startWidth + e.clientX - startX), NAV_WIDTH_MIN), max));
    const stop = () => {
      resizer.removeEventListener('pointermove', move);
      resizer.removeEventListener('pointerup', stop);
      resizer.removeEventListener('pointercancel', stop);
      resizer.classList.remove('dragging');
      ctx.post({ type: 'uiState', navWidth });
    };
    resizer.setPointerCapture(event.pointerId);
    resizer.classList.add('dragging');
    resizer.addEventListener('pointermove', move);
    resizer.addEventListener('pointerup', stop);
    resizer.addEventListener('pointercancel', stop);
  });
  resizer.addEventListener('dblclick', () => {
    applyNavWidth(null);
    ctx.post({ type: 'uiState', navWidth: null });
  });
}

// ── 分頁切換 ──

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
  const category = CATEGORIES.find((c) => c.tabs.some((t) => t.id === tab));
  if (category && !expandedGroups().has(category.id)) {
    setExpanded(category.id, true);
  }
  const next = pushRecent(recent, tab);
  if (next.join(',') !== recent.join(',')) {
    recent = next;
    renderRecent();
    ctx.post({ type: 'uiState', recent });
  }
  highlight();
}

window.addEventListener('message', (event: MessageEvent<HostMessage>) => {
  const message = event.data;
  if (ctx.handleReply(message)) {
    return;
  }
  switch (message.type) {
    case 'init': {
      ctx.init = message.payload;
      recent = message.payload.recent.filter(isTabId);
      app.textContent = '';
      buildNav();
      setupResizer();
      applyNavWidth(normalizeNavWidth(message.payload.navWidth));
      app.append(nav, resizer, main);
      // 預設開最近用的那個；這台機器沒有紀錄時才退回這個視窗上次停留的分頁
      show(recent[0] ?? (isTabId(ctx.tab) ? ctx.tab : FALLBACK_TAB));
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
