// 各分頁共用的環境：RPC、剪貼簿、開編輯器，以及跨隱藏／重新顯示保留輸入內容的狀態。
import type { CallMap, ClientMessage, HostMessage, InitPayload, Method, TabId } from '../shared/protocol';
import { debounce, el } from './dom';

interface VsCodeApi {
  postMessage(message: ClientMessage): void;
  getState(): unknown;
  setState(state: unknown): void;
}

declare function acquireVsCodeApi(): VsCodeApi;

interface PersistedState {
  tab: TabId;
  values: Record<string, string>;
}

export class TabContext {
  private readonly api = acquireVsCodeApi();
  private nextId = 1;
  private readonly pending = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void }>();
  private readonly state: PersistedState;
  private readonly saveLater = debounce(() => this.api.setState(this.state), 300);
  // 分頁建立後 DOM 會保留，同 key 的輸入框只共用 state 不會互相更新，要直接改對方的 value
  private readonly textareas = new Map<string, HTMLTextAreaElement[]>();
  init!: InitPayload;

  constructor() {
    const saved = this.api.getState() as PersistedState | undefined;
    this.state = saved && typeof saved === 'object' && saved.values ? saved : { tab: 'hash', values: {} };
  }

  get tab(): TabId {
    return this.state.tab;
  }

  set tab(tab: TabId) {
    this.state.tab = tab;
    this.saveLater();
  }

  get(key: string, fallback = ''): string {
    return this.state.values[key] ?? fallback;
  }

  set(key: string, value: string): void {
    this.state.values[key] = value;
    this.saveLater();
  }

  post(message: ClientMessage): void {
    this.api.postMessage(message);
  }

  call<M extends Method>(method: M, params: CallMap[M]['params']): Promise<CallMap[M]['result']> {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (value: unknown) => void, reject });
      this.post({ type: 'call', id, method, params });
    });
  }

  /** 回傳 true 代表這則訊息是 RPC 回覆，已處理完畢。 */
  handleReply(message: HostMessage): boolean {
    if (message.type !== 'reply') {
      return false;
    }
    const waiter = this.pending.get(message.id);
    this.pending.delete(message.id);
    if (waiter) {
      if (message.ok) {
        waiter.resolve(message.result);
      } else {
        waiter.reject(new Error(message.error));
      }
    }
    return true;
  }

  copy(text: string, label: string): void {
    if (text !== '') {
      this.post({ type: 'copy', text, label });
    }
  }

  openInEditor(content: string, language: string): void {
    if (content !== '') {
      this.post({ type: 'openInEditor', content, language });
    }
  }

  /** 建立綁定狀態的多行輸入框；內容跨面板隱藏保留，同 key 的輸入框內容連動。 */
  textarea(key: string, placeholder: string, onInput?: (value: string) => void, className = 'mono'): HTMLTextAreaElement {
    const area = el('textarea', className);
    area.placeholder = placeholder;
    area.spellcheck = false;
    area.value = this.get(key);
    const peers = this.textareas.get(key) ?? [];
    this.textareas.set(key, peers);
    peers.push(area);
    area.addEventListener('input', () => {
      this.set(key, area.value);
      for (const peer of peers) {
        if (peer !== area) {
          peer.value = area.value;
        }
      }
      onInput?.(area.value);
    });
    return area;
  }

  input(key: string, type: string, fallback = '', onInput?: (value: string) => void): HTMLInputElement {
    const node = el('input');
    node.type = type;
    node.value = this.get(key, fallback);
    node.addEventListener('input', () => {
      this.set(key, node.value);
      onInput?.(node.value);
    });
    return node;
  }
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
