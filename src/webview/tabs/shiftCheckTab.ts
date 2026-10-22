// 工時核對分頁：貼上含 working_times／total_time 的 JSON，輸入變動即核對；左側輸入、右側結果。
import type { ShiftCheckResult } from '../../core/timecalc/shiftCheck';
import { button, columns, debounce, el, field, row, select } from '../dom';
import type { TabContext } from '../context';
import { errorMessage } from '../context';
import { SHIFT_CHECK_EXAMPLES } from './shiftCheckExamples';

const PLACEHOLDER = '貼上含工作時段與總時間的 JSON，或帶入範例';

function cell(tag: 'td' | 'th', text: string, className?: string): HTMLTableCellElement {
  return el(tag, className, text);
}

function renderSegments(result: ShiftCheckResult): HTMLTableElement {
  const table = el('table', 'shift-table');
  const head = el('tr');
  head.append(cell('th', '段'), cell('th', '工作時段'), cell('th', '工作'), cell('th', '休息'), cell('th', '實際'));
  table.append(head);
  for (const s of result.segments) {
    const tr = el('tr');
    const span = `${s.start}–${s.end}${s.crossesMidnight ? '（跨夜）' : ''}`;
    const breaks = s.breaks.map((b) => `${b.start}–${b.end} ${b.minutes}`).join('\n');
    tr.append(cell('td', String(s.index)), cell('td', span, 'mono'), cell('td', String(s.minutes), 'num'), cell('td', breaks || '—', 'mono breaks'), cell('td', String(s.net), 'num'));
    table.append(tr);
  }
  const total = el('tr', 'total');
  total.append(cell('td', ''), cell('td', '合計'), cell('td', String(result.workMinutes), 'num'), cell('td', String(result.breakMinutes), 'num'), cell('td', String(result.computed), 'num'));
  table.append(total);
  return table;
}

export function shiftCheckTab(ctx: TabContext): HTMLElement {
  const root = el('div', 'tab shift-check');
  const status = el('div', 'shift-status hidden');
  const detail = el('div', 'shift-detail');
  const error = el('div', 'error hidden');
  let report = '';

  const clear = () => {
    report = '';
    status.classList.add('hidden');
    detail.textContent = '';
    error.classList.add('hidden');
  };

  const check = debounce(async () => {
    if (input.value.trim() === '') {
      clear();
      return;
    }
    try {
      const result = await ctx.call('shift.check', { input: input.value });
      report = result.report;
      error.classList.add('hidden');
      status.className = `shift-status ${result.match === null ? 'unknown' : result.match ? 'pass' : 'fail'}`;
      // 報告第一行就是總結（含一致／不一致與差額），直接拿來當狀態列
      status.textContent = result.report.split('\n')[0];
      detail.textContent = '';
      // 讓使用者一眼看到是拿哪些鍵算的，別名猜錯時才看得出來
      detail.append(el('div', 'hint shift-keys', `採用欄位：${result.keys.join('、')}`), renderSegments(result));
      if (result.warnings.length > 0) {
        const list = el('ul', 'shift-warnings');
        list.append(...result.warnings.map((w) => el('li', undefined, w)));
        detail.append(list);
      }
    } catch (err) {
      report = '';
      status.classList.add('hidden');
      detail.textContent = '';
      error.textContent = errorMessage(err);
      error.classList.remove('hidden');
    }
  }, 250);

  const input = ctx.textarea('shiftcheck.input', PLACEHOLDER, () => {
    syncFill();
    check();
  });
  const examples = select(
    SHIFT_CHECK_EXAMPLES.map((e) => ({ value: e.id, label: e.label })),
    ctx.get('shiftcheck.example', SHIFT_CHECK_EXAMPLES[0].id),
    (v) => ctx.set('shiftcheck.example', v),
  );
  const fill = button('帶入範例', () => {
    const example = SHIFT_CHECK_EXAMPLES.find((e) => e.id === examples.value);
    if (!example || input.value.trim() !== '') {
      return;
    }
    input.value = example.text;
    // 走 ctx.textarea 掛的 input 事件：狀態保存、同 key 連動、觸發核對都在那裡，不另寫一份
    input.dispatchEvent(new Event('input'));
  });
  // 只在輸入框為空時可帶入：不覆蓋使用者貼進來的資料
  const syncFill = () => {
    fill.disabled = input.value.trim() !== '';
    fill.title = fill.disabled ? '清空輸入框後才能帶入範例' : '';
  };
  syncFill();
  const inputColumn = el('div', 'shift-input');
  inputColumn.append(row(field('範例', examples), fill), input);
  const results = el('div', 'shift-results');
  results.append(
    status,
    error,
    detail,
    row(
      button('複製報告', () => ctx.copy(report, '核對報告')),
      button('開在編輯器', () => ctx.openInEditor(report, 'plaintext')),
    ),
  );

  root.append(columns(inputColumn, results));
  check();
  return root;
}
