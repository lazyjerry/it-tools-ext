// 轉換分頁：JSON ⇄ 各語言資料結構、CSV、PHP serialize，輸入變動即轉換。
import type { CallMap } from '../../shared/protocol';
import { button, columns, debounce, el, field, outputBox, row, select } from '../dom';
import type { TabContext } from '../context';
import { errorMessage } from '../context';

type Direction = 'toLang' | 'fromLang' | 'csvToJson' | 'jsonToCsv' | 'unserialize' | 'serialize';

const DIRECTIONS: { value: Direction; label: string }[] = [
  { value: 'toLang', label: 'JSON → 程式語言' },
  { value: 'fromLang', label: 'PHP／Python／JS → JSON' },
  { value: 'csvToJson', label: 'CSV → JSON' },
  { value: 'jsonToCsv', label: 'JSON → CSV' },
  { value: 'unserialize', label: 'PHP unserialize → JSON' },
  { value: 'serialize', label: 'JSON → PHP serialize' },
];

const TOOL_OF: Partial<Record<Direction, string>> = {
  csvToJson: 'convert.csvToJson',
  jsonToCsv: 'convert.jsonToCsv',
  unserialize: 'php.unserialize',
  serialize: 'php.serialize',
};

const LANGUAGE_OF_MODE: Record<string, string> = {
  php: 'php',
  js: 'javascript',
  python: 'python',
  go: 'go',
  java: 'java',
  swift: 'swift',
  objc: 'objective-c',
};

export function convertTab(ctx: TabContext): HTMLElement {
  const root = el('div', 'tab');
  const output = outputBox();
  const direction = () => ctx.get('convert.direction', 'toLang') as Direction;

  const outputLanguage = (): string => {
    switch (direction()) {
      case 'toLang':
        return LANGUAGE_OF_MODE[ctx.get('convert.mode', 'php-short').split('-')[0]] ?? 'plaintext';
      case 'jsonToCsv':
        return 'csv';
      case 'serialize':
        return 'plaintext';
      default:
        return 'json';
    }
  };

  const convert = debounce(async () => {
    const input = ctx.get('convert.input');
    if (input.trim() === '') {
      output.clear();
      return;
    }
    try {
      const d = direction();
      const tool = TOOL_OF[d];
      if (tool) {
        output.set(await ctx.call('tool.run', { toolId: tool, input, params: {} }));
      } else if (d === 'toLang') {
        output.set(await ctx.call('convert.to', { input, mode: ctx.get('convert.mode', 'php-short') as CallMap['convert.to']['params']['mode'] }));
      } else {
        output.set(await ctx.call('convert.from', { input, dialect: ctx.get('convert.dialect', 'auto') as CallMap['convert.from']['params']['dialect'] }));
      }
    } catch (error) {
      output.error(errorMessage(error));
    }
  }, 250);

  const modeField = field(
    '目標',
    select(ctx.init.targetModes.map((m) => ({ value: m.mode, label: m.label })), ctx.get('convert.mode', 'php-short'), (v) => {
      ctx.set('convert.mode', v);
      convert();
    }),
  );
  const dialectField = field(
    '來源語言',
    select(
      [
        { value: 'auto', label: '自動偵測' },
        { value: 'php', label: 'PHP array' },
        { value: 'python', label: 'Python dict' },
        { value: 'js', label: 'JavaScript object' },
      ],
      ctx.get('convert.dialect', 'auto'),
      (v) => {
        ctx.set('convert.dialect', v);
        convert();
      },
    ),
  );
  const syncFields = () => {
    modeField.classList.toggle('hidden', direction() !== 'toLang');
    dialectField.classList.toggle('hidden', direction() !== 'fromLang');
  };
  syncFields();

  root.append(
    row(
      field(
        '方向',
        select(DIRECTIONS, direction(), (v) => {
          ctx.set('convert.direction', v);
          syncFields();
          convert();
        }),
      ),
      modeField,
      dialectField,
    ),
    columns(ctx.textarea('convert.input', '貼上要轉換的內容', () => convert()), output.root),
    row(
      button('複製結果', () => ctx.copy(output.value(), '轉換結果')),
      button('開在編輯器', () => ctx.openInEditor(output.value(), outputLanguage())),
    ),
    el('div', 'hint', 'Go／Java／Swift 的 struct 模式會依資料推導型別，陣列中部分物件缺少的欄位會標成 optional。語言 → JSON 只接受純資料 literal，遇到變數或函式呼叫會直接報錯。'),
  );
  convert();
  return root;
}
