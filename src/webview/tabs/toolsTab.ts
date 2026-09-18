// 常用工具分頁：與指令 itTools.run 共用同一份工具清單，參數欄位依工具動態產生。
import type { ToolInfo } from '../../core/registry';
import { button, columns, el, field, outputBox, row, select } from '../dom';
import type { TabContext } from '../context';
import { errorMessage } from '../context';

export function toolsTab(ctx: TabContext): HTMLElement {
  const root = el('div', 'tab');
  // 有專屬分頁的不重複列；其中密碼檢查另有一層理由：這裡的輸入會被保存
  const tools = ctx.init.tools.filter((t) => !t.hasTab);
  const output = outputBox();
  const paramsRow = el('div', 'row');
  const hint = el('div', 'hint');
  const input = ctx.textarea('tools.input', '輸入內容');
  const inputCol = el('div');
  inputCol.append(input);

  const current = (): ToolInfo => tools.find((t) => t.id === ctx.get('tools.id')) ?? tools[0];

  const renderParams = () => {
    const tool = current();
    paramsRow.textContent = '';
    for (const param of tool.params ?? []) {
      const key = `tools.param.${tool.id}.${param.id}`;
      if (param.kind === 'choice') {
        const choices = param.choices ?? [];
        paramsRow.append(field(param.label, select(choices, ctx.get(key, choices[0]?.value ?? ''), (v) => ctx.set(key, v))));
      } else {
        const node = param.kind === 'secret' ? el('input') : ctx.input(key, 'text');
        if (param.kind === 'secret') {
          // 密鑰不寫進面板狀態
          node.type = 'password';
        }
        node.placeholder = param.placeholder ?? '';
        node.dataset.param = param.id;
        paramsRow.append(field(param.label, node, 'field grow'));
      }
    }
    hint.textContent = [tool.detail, tool.kind === 'transform' ? '就地轉換類：指令版會直接取代選取文字' : '報告類：指令版會開新編輯器'].filter(Boolean).join('。');
    inputCol.classList.toggle('hidden', tool.input === 'none');
    input.placeholder = tool.input === 'optional' ? '輸入內容（可留空）' : '輸入內容';
  };

  const run = async () => {
    const tool = current();
    const params: Record<string, string> = {};
    for (const param of tool.params ?? []) {
      const key = `tools.param.${tool.id}.${param.id}`;
      if (param.kind === 'secret') {
        params[param.id] = paramsRow.querySelector<HTMLInputElement>(`input[data-param="${param.id}"]`)?.value ?? '';
      } else {
        params[param.id] = ctx.get(key, param.choices?.[0]?.value ?? '');
      }
    }
    try {
      output.set(await ctx.call('tool.run', { toolId: tool.id, input: input.value, params }));
    } catch (error) {
      output.error(errorMessage(error));
    }
  };

  const groups = [...new Set(tools.map((t) => t.group))];
  const toolSelect = el('select');
  for (const group of groups) {
    const optgroup = el('optgroup');
    optgroup.label = group;
    for (const tool of tools.filter((t) => t.group === group)) {
      const option = el('option', undefined, tool.label);
      option.value = tool.id;
      optgroup.append(option);
    }
    toolSelect.append(optgroup);
  }
  toolSelect.value = current().id;
  toolSelect.addEventListener('change', () => {
    ctx.set('tools.id', toolSelect.value);
    output.clear();
    renderParams();
  });

  root.append(
    row(field('工具', toolSelect, 'field grow'), button('執行', () => void run(), 'primary')),
    paramsRow,
    hint,
    columns(inputCol, output.root),
    row(
      button('複製結果', () => ctx.copy(output.value(), '結果')),
      button('開在編輯器', () => ctx.openInEditor(output.value(), current().language ?? 'plaintext')),
    ),
  );
  renderParams();
  return root;
}
