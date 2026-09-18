// Hash 分頁：輸入變動即重算，對照表每列可複製值與 PHP／Java 等價程式碼。
import type { HashRow } from '../../core/hash/compat';
import type { CallMap } from '../../shared/protocol';
import { button, debounce, el, field, row, select } from '../dom';
import type { TabContext } from '../context';
import { errorMessage } from '../context';

const INPUT_MODES = [
  { value: 'text', label: '文字（UTF-8）' },
  { value: 'hex', label: 'Hex 位元組' },
  { value: 'base64', label: 'Base64' },
];

const FORMATS = [
  { value: 'hex', label: 'hex 小寫' },
  { value: 'HEX', label: 'HEX 大寫' },
  { value: 'base64', label: 'Base64' },
  { value: 'base64url', label: 'Base64URL' },
];

const GROUP_TITLES: Record<HashRow['group'], string> = {
  digest: '摘要演算法',
  checksum: '校驗和（CRC／Adler）',
  variant: '常見錯誤寫法與語言專屬',
};

const HMAC_HELP =
  'HMAC（Hash-based Message Authentication Code）：把密鑰和內容一起雜湊，用來驗證訊息沒被竄改、且來自持有同一把密鑰的一方，常見於 API 簽章與 webhook 驗證。\n填了密鑰，下方會多一張 HMAC 對照表；留空不計算。密鑰不會被保存。';

const INPUT_MODE_HELP =
  '輸入框內容要怎麼變成位元組再雜湊。\n文字：以 UTF-8 編碼。\nHex 位元組／Base64：先解碼成原始位元組，用來重現二進位資料或其他編碼（如 MS950）的結果。';

const KEY_MODE_HELP = 'HMAC 密鑰的解讀方式，規則同「輸入模式」。密鑰是一串隨機位元組（常以 hex 或 Base64 發放）時，選對應的模式。';

const STATUS_TEXT: Record<HashRow['status'], string> = { ok: '', warn: '⚠ 差異', info: 'ℹ' };

function renderRows(ctx: TabContext, table: HTMLTableElement, rows: HashRow[], grouped: boolean): void {
  let lastGroup: string | undefined;
  for (const r of rows) {
    if (grouped && r.group !== lastGroup) {
      lastGroup = r.group;
      const header = el('tr', 'group');
      const cell = el('th', undefined, GROUP_TITLES[r.group]);
      cell.colSpan = 3;
      header.append(cell);
      table.append(header);
    }
    const tr = el('tr', `status-${r.status}`);
    const label = el('td', 'label');
    label.append(el('span', undefined, r.label));
    if (STATUS_TEXT[r.status]) {
      label.append(el('span', `badge ${r.status}`, STATUS_TEXT[r.status]));
    }
    const value = el('td', 'value mono', r.value);
    const actions = el('td', 'actions');
    actions.append(button('複製', () => ctx.copy(r.value, ` ${r.label}`), 'link'));
    if (r.php) {
      actions.append(button('PHP', () => ctx.copy(r.php ?? '', ' PHP 程式碼'), 'link', r.php));
    }
    if (r.java) {
      actions.append(button('Java', () => ctx.copy(r.java ?? '', ' Java 程式碼'), 'link', r.java));
    }
    tr.append(label, value, actions);
    table.append(tr);
    if (r.note) {
      const noteRow = el('tr', 'note');
      const cell = el('td', undefined, r.note);
      cell.colSpan = 3;
      noteRow.append(cell);
      table.append(noteRow);
    }
  }
}

export function hashTab(ctx: TabContext): HTMLElement {
  const root = el('div', 'tab');
  const results = el('div', 'results');
  const status = el('div', 'hint');

  const compute = debounce(async () => {
    const params: CallMap['hash.table']['params'] = {
      input: ctx.get('hash.input'),
      inputMode: ctx.get('hash.mode', 'text') as CallMap['hash.table']['params']['inputMode'],
      format: ctx.get('hash.format', 'hex') as CallMap['hash.table']['params']['format'],
      hmacKey: hmacKey.value,
      hmacKeyMode: ctx.get('hash.hmacKeyMode', 'text') as CallMap['hash.table']['params']['hmacKeyMode'],
    };
    try {
      const result = await ctx.call('hash.table', params);
      results.textContent = '';
      status.textContent = `輸入 ${result.inputBytes} 位元組`;
      if (result.bcrypt) {
        const box = el('div', 'callout');
        box.append(
          el('strong', undefined, `偵測到 bcrypt 雜湊：${result.bcrypt.version} cost ${result.bcrypt.cost}（${result.bcrypt.iterations} 輪）`),
          ...result.bcrypt.notes.map((n) => el('div', undefined, `・${n}`)),
        );
        results.append(box);
      }
      const table = el('table', 'hash-table');
      renderRows(ctx, table, result.rows, true);
      results.append(table);
      if (result.hmacRows.length) {
        results.append(el('h3', undefined, 'HMAC'));
        const hmacTable = el('table', 'hash-table');
        renderRows(ctx, hmacTable, result.hmacRows, false);
        results.append(hmacTable);
      }
      results.append(el('div', 'hint', `PHP hash_algos() 有、本工具未支援：${result.unsupportedPhp.join(', ')}`));
    } catch (error) {
      results.textContent = '';
      results.append(el('div', 'error', errorMessage(error)));
    }
  }, 200);

  // 密鑰不寫進面板狀態，隱藏面板就清掉
  const hmacKey = el('input');
  hmacKey.type = 'password';
  hmacKey.placeholder = '留空不計算 HMAC';
  hmacKey.addEventListener('input', () => compute());

  const input = ctx.textarea('hash.input', '輸入要雜湊的內容', () => compute());
  input.rows = 2;
  input.classList.add('compact');

  const onChange = (key: string) => (value: string) => {
    ctx.set(key, value);
    compute();
  };

  root.append(
    row(
      field('輸入模式', select(INPUT_MODES, ctx.get('hash.mode', 'text'), onChange('hash.mode')), 'field', INPUT_MODE_HELP),
      field('輸出格式', select(FORMATS, ctx.get('hash.format', 'hex'), onChange('hash.format'))),
      field('HMAC 密鑰', hmacKey, 'field', HMAC_HELP),
      field('密鑰模式', select(INPUT_MODES, ctx.get('hash.hmacKeyMode', 'text'), onChange('hash.hmacKeyMode')), 'field', KEY_MODE_HELP),
    ),
    input,
    el(
      'div',
      'hint',
      '文字一律以 UTF-8 編碼。Java 未指定 charset 時用平台預設編碼（Windows 繁中為 MS950），結果會不同；要重現請在 Java 取 s.getBytes() 的 hex，改用「Hex 位元組」模式貼上。',
    ),
    status,
    results,
  );
  compute();
  return root;
}
