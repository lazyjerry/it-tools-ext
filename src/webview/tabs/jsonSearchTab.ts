// JSON 搜尋分頁：輸入框與 JSON 分頁共用 json.input，結果可點擊跳轉。
import type { CallMap } from '../../shared/protocol';
import { button, checkbox, columns, el, field, row, select } from '../dom';
import type { TabContext } from '../context';
import { errorMessage } from '../context';

const MODE_HELP =
  'key 名稱：找出 key 含查詢字串的欄位。\n值內容：比對字串、數字、true／false、null 的文字；物件與陣列本身不比對。\n路徑：依位置取值，$.a.b[0] 取單一位置、$.a[*] 取全部元素、$..id 找出任何層級的 id；此模式不套用「正則」與「區分大小寫」。';

const REGEX_HELP = '把查詢字串當成正規表示式（JavaScript 語法），例如 ^user_ 或 id$。沒勾選時是單純的「包含」比對。';

export function jsonSearchTab(ctx: TabContext): HTMLElement {
  const root = el('div', 'tab json-search');
  const input = ctx.textarea('json.input', '貼上 JSON（容忍註解、尾逗號，也接受 JSON Lines）；內容與 JSON 分頁連動');

  const hits = el('div', 'hits');
  const search = async () => {
    hits.textContent = '';
    const query = ctx.get('json.query');
    if (!query) {
      return;
    }
    try {
      const result = await ctx.call('json.search', {
        input: input.value,
        query,
        mode: ctx.get('json.searchMode', 'key') as CallMap['json.search']['params']['mode'],
        regex: ctx.get('json.regex') === '1',
        caseSensitive: ctx.get('json.case') === '1',
      });
      hits.append(el('div', 'hint', `${result.length} 筆${result.length >= 1000 ? '（只列前 1000 筆）' : ''}`));
      for (const hit of result) {
        const item = el('button', 'hit');
        item.type = 'button';
        item.append(el('span', 'hit-path mono', hit.path), el('span', 'hit-preview mono', hit.preview), el('span', 'hint', `${hit.line}:${hit.column}`));
        item.addEventListener('click', () => {
          input.focus();
          input.setSelectionRange(hit.offset, hit.offset + 1);
          // textarea 沒有 revealRange，用行高估算捲動位置
          const lineHeight = parseFloat(getComputedStyle(input).lineHeight) || 16;
          input.scrollTop = Math.max(0, (hit.line - 3) * lineHeight);
        });
        hits.append(item);
      }
    } catch (error) {
      hits.append(el('div', 'error', errorMessage(error)));
    }
  };

  const query = ctx.input('json.query', 'search', '');
  query.placeholder = '搜尋 key、值，或路徑 $.a.b[0]、$..id';
  query.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      void search();
    }
  });

  root.append(
    row(
      field('查詢', query, 'field grow'),
      field(
        '模式',
        select(
          [
            { value: 'key', label: 'key 名稱' },
            { value: 'value', label: '值內容' },
            { value: 'path', label: '路徑' },
          ],
          ctx.get('json.searchMode', 'key'),
          (v) => ctx.set('json.searchMode', v),
        ),
        'field',
        MODE_HELP,
      ),
      checkbox('正則', ctx.get('json.regex') === '1', (v) => ctx.set('json.regex', v ? '1' : ''), REGEX_HELP),
      checkbox('區分大小寫', ctx.get('json.case') === '1', (v) => ctx.set('json.case', v ? '1' : '')),
      button('搜尋', () => void search(), 'primary'),
    ),
    columns(input, hits),
  );
  return root;
}
