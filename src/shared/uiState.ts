// 裝置層級的面板偏好（最近使用的分頁、左側選單寬度）：host 與 webview 共用的正規化規則。
// 存在 host 的 globalState，不開 setKeysForSync，所以同一台機器的各視窗共用、不同裝置各自獨立。
import { TAB_IDS } from './protocol';
import type { TabId } from './protocol';

export const RECENT_LIMIT = 5;
export const NAV_WIDTH_MIN = 96;
export const NAV_WIDTH_MAX = 480;

export interface UiState {
  /** 新到舊，最多 RECENT_LIMIT 筆。 */
  recent: TabId[];
  /** null = 由內容決定（未拖曳過）。 */
  navWidth: number | null;
}

export function isTabId(value: unknown): value is TabId {
  return typeof value === 'string' && (TAB_IDS as readonly string[]).includes(value);
}

/** 去掉不認得的分頁與重複項，保留先出現的（新的）那筆。 */
export function normalizeRecent(value: unknown): TabId[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const seen = new Set<TabId>();
  for (const item of value) {
    if (isTabId(item) && !seen.has(item)) {
      seen.add(item);
      if (seen.size === RECENT_LIMIT) {
        break;
      }
    }
  }
  return [...seen];
}

/** 把一個分頁移到最前面。 */
export function pushRecent(recent: TabId[], tab: TabId): TabId[] {
  return normalizeRecent([tab, ...recent]);
}

export function normalizeNavWidth(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return null;
  }
  return Math.round(Math.min(Math.max(value, NAV_WIDTH_MIN), NAV_WIDTH_MAX));
}

export function normalizeUiState(value: unknown): UiState {
  const record = typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
  return { recent: normalizeRecent(record.recent), navWidth: normalizeNavWidth(record.navWidth) };
}
