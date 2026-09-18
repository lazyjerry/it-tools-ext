// Diff 分頁：並排比較交給 VS Code 原生 diff 編輯器；另可產生可貼上的 unified diff 文字。
import { button, checkbox, columns, el, field, outputBox, row } from '../dom';
import type { TabContext } from '../context';
import { errorMessage } from '../context';

const UNIFIED_ONLY = '只影響「產生 unified diff」；並排比較請用 diff 編輯器右上角的設定。';

const IGNORE_WHITESPACE_HELP = `比對時把連續空白（含 Tab）視為一個空格，並忽略行首行尾空白；只有縮排或對齊不同的行視為相同。\n${UNIFIED_ONLY}`;

const IGNORE_CASE_HELP = `比對時不分英文大小寫，Foo 與 foo 視為相同。\n${UNIFIED_ONLY}`;

const CONTEXT_HELP = `每段變更的前、後各附上幾行沒有變動的內容（context lines），方便看出變更落在哪裡。0–20，慣例是 3；填 0 只輸出變動的行。\n兩段變更之間相隔的行數不超過這個數字的兩倍時，會併成同一段（hunk）。\n${UNIFIED_ONLY}`;

export function diffTab(ctx: TabContext): HTMLElement {
  const root = el('div', 'tab');
  const left = ctx.textarea('diff.left', '左側（原始）');
  const right = ctx.textarea('diff.right', '右側（修改後）');
  const output = outputBox('unified diff 會顯示在這裡');
  const status = el('div', 'hint');

  const context = ctx.input('diff.context', 'number', '3');
  context.min = '0';
  context.max = '20';

  root.append(
    columns(left, right),
    row(
      button(
        '以 VS Code 並排比較',
        async () => {
          try {
            await ctx.call('diff.native', { left: left.value, right: right.value });
            status.textContent = '已在編輯器開啟並排比較；忽略空白等選項請用 diff 編輯器右上角的設定。';
          } catch (error) {
            status.textContent = errorMessage(error);
          }
        },
        'primary',
      ),
      button('產生 unified diff', async () => {
        try {
          output.set(
            await ctx.call('diff.unified', {
              left: left.value,
              right: right.value,
              ignoreWhitespace: ctx.get('diff.ignoreWhitespace') === '1',
              ignoreCase: ctx.get('diff.ignoreCase') === '1',
              context: Number(context.value) || 0,
            }),
          );
        } catch (error) {
          output.error(errorMessage(error));
        }
      }),
      checkbox('忽略空白', ctx.get('diff.ignoreWhitespace') === '1', (v) => ctx.set('diff.ignoreWhitespace', v ? '1' : ''), IGNORE_WHITESPACE_HELP),
      checkbox('忽略大小寫', ctx.get('diff.ignoreCase') === '1', (v) => ctx.set('diff.ignoreCase', v ? '1' : ''), IGNORE_CASE_HELP),
      field('前後文行數', context, 'field', CONTEXT_HELP),
      button('左右互換', () => {
        [left.value, right.value] = [right.value, left.value];
        ctx.set('diff.left', left.value);
        ctx.set('diff.right', right.value);
      }),
    ),
    status,
    output.root,
    row(
      button('複製 diff', () => ctx.copy(output.value(), ' diff')),
      button('開在編輯器', () => ctx.openInEditor(output.value(), 'diff')),
    ),
    el(
      'div',
      'hint',
      '編輯器內也能直接比較：選取文字後右鍵「Diff：選取文字設為比較左側」，再選另一段執行「Diff：與左側比較」；或用「Diff：選取文字與剪貼簿比較」。',
    ),
  );
  return root;
}
