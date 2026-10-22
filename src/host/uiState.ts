// 面板偏好的存取：包一層 Memento（globalState），讀寫都先正規化，壞資料不會傳進 webview。
import { normalizeUiState } from '../shared/uiState';
import type { UiState } from '../shared/uiState';

/** vscode.Memento 的子集，讓單元測試不必載入 vscode。 */
export interface MementoLike {
  get<T>(key: string): T | undefined;
  update(key: string, value: unknown): Thenable<void>;
}

const KEY = 'ui';

export class UiStateStore {
  constructor(private readonly memento: MementoLike) {}

  get(): UiState {
    return normalizeUiState(this.memento.get<unknown>(KEY));
  }

  /** 只更新帶進來的欄位；沒帶的沿用目前的值。 */
  async patch(partial: Partial<UiState>): Promise<UiState> {
    const next = normalizeUiState({ ...this.get(), ...partial });
    await this.memento.update(KEY, next);
    return next;
  }
}
