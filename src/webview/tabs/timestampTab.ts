// 時間戳分頁：輸入變動即轉換；留空代表現在。
import { button, debounce, el, field, outputBox, row } from '../dom';
import type { TabContext } from '../context';
import { errorMessage } from '../context';

export function timestampTab(ctx: TabContext): HTMLElement {
  const root = el('div', 'tab report');
  const output = outputBox();
  const convert = debounce(async () => {
    try {
      output.set(await ctx.call('tool.run', { toolId: 'time.timestamp', input: input.value, params: {} }));
    } catch (error) {
      output.error(errorMessage(error));
    }
  }, 200);
  const input = ctx.input('timestamp.input', 'text', '', () => convert());
  input.placeholder = '1790000000、1790000000000、2026-09-18 12:00（留空 = 現在）';
  input.spellcheck = false;

  root.append(
    row(
      field('時間戳或日期', input, 'field grow', '純數字依位數判斷秒／毫秒／微秒；其他內容當成日期字串解析，沒寫時區就用本機時區。'),
      button('現在', () => {
        input.value = '';
        ctx.set('timestamp.input', '');
        convert();
      }),
    ),
    output.root,
    row(
      button('複製結果', () => ctx.copy(output.value(), '結果')),
      button('開在編輯器', () => ctx.openInEditor(output.value(), 'plaintext')),
    ),
  );
  convert();
  return root;
}
