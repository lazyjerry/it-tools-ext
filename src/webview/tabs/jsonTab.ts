// JSON 分頁：美化／壓縮／排序／去除跳脫字元／統計。搜尋在 jsonSearchTab，兩邊輸入框共用 json.input。
import type { CallMap } from '../../shared/protocol';
import { button, columns, el, iconButton, outputBox, row } from '../dom';
import type { TabContext } from '../context';
import { errorMessage } from '../context';

type Action = CallMap['json.process']['params']['action'];

export function jsonTab(ctx: TabContext): HTMLElement {
  const root = el('div', 'tab');
  const input = ctx.textarea('json.input', '貼上 JSON（容忍註解、尾逗號，也接受 JSON Lines）');
  const output = outputBox();
  let outputLanguage = 'json';

  const run = async (action: Action) => {
    try {
      output.set(await ctx.call('json.process', { input: input.value, action }));
      outputLanguage = action === 'stats' ? 'markdown' : 'json';
    } catch (error) {
      output.error(errorMessage(error));
    }
  };

  const resultActions = row(
    button('複製結果', () => ctx.copy(output.value(), '結果')),
    button('開在編輯器', () => ctx.openInEditor(output.value(), outputLanguage)),
    button('結果放回輸入', () => {
      if (output.value() && outputLanguage === 'json') {
        input.value = output.value();
        // 走 input 事件才會寫回狀態並同步 JSON 搜尋分頁的輸入框
        input.dispatchEvent(new Event('input'));
      }
    }),
  );
  resultActions.classList.add('push-end');

  root.append(
    row(
      iconButton('format', '美化', () => void run('format'), 'primary'),
      iconButton('minify', '壓縮', () => void run('minify')),
      iconButton('sort', '排序 key', () => void run('sort')),
      iconButton('unescape', '去除跳脫字元', () => void run('unescape'), 'secondary', '把 "{\\"a\\":1}" 這種被包成字串的 JSON 解回 {"a":1}（可解多層）；輸入本來就是 JSON 時等同美化'),
      iconButton('stats', '統計', () => void run('stats'), 'secondary', '結構統計與字串值的單詞頻率'),
      iconButton('settings', '開啟設定（縮排）', () => ctx.post({ type: 'openSettings', query: 'itTools.json.indent' })),
      resultActions,
    ),
    columns(input, output.root),
  );
  return root;
}
