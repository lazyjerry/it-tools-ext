// 時間計算分頁：對應 time-date-converter 的五個區段、九個計算；五個區段以子分頁切換。
import type { TimeCalcOp } from '../../core/timecalc/timecalc';
import { button, el, field, row } from '../dom';
import type { TabContext } from '../context';
import { errorMessage } from '../context';

interface InputSpec {
  key: string;
  label: string;
  type: 'time' | 'date' | 'number';
  fallback: string;
  help?: string;
}

const WEEKEND_GOAL_HELP =
  '從開始日起算（含當天），區間內要剛好包含的天數，0–520。\n週六與週日要同時剛好等於目標；任一方先超過就無解，例如從週日開始要求 1 個週六、0 個週日。';

function today(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function timecalcTab(ctx: TabContext): HTMLElement {
  const root = el('div', 'tab timecalc');
  const date = today();

  const form = (title: string, specs: InputSpec[], build: (values: Record<string, string>) => TimeCalcOp): HTMLElement => {
    const box = el('div', 'calc');
    const result = el('div', 'calc-result');
    const inputs = specs.map((spec) => {
      const input = ctx.input(`timecalc.${spec.key}`, spec.type, spec.fallback);
      if (spec.type === 'number') {
        input.step = '1';
      }
      return { spec, input };
    });
    const calculate = async () => {
      const values = Object.fromEntries(inputs.map(({ spec, input }) => [spec.key, input.value]));
      try {
        result.classList.remove('error');
        result.textContent = await ctx.call('timecalc', build(values));
      } catch (error) {
        result.classList.add('error');
        result.textContent = errorMessage(error);
      }
    };
    for (const { input } of inputs) {
      input.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') {
          void calculate();
        }
      });
    }
    box.append(
      el('div', 'calc-title', title),
      row(...inputs.map(({ spec, input }) => field(spec.label, input, 'field', spec.help)), button('計算', () => void calculate(), 'primary')),
      result,
    );
    return box;
  };

  // 一次只顯示一個主題：九個計算全攤開時，畫面上同時有九顆「計算」，看不出現在要做哪一件事
  const sections: { id: string; button: HTMLButtonElement; view: HTMLElement }[] = [];
  const showSection = (id: string) => {
    const active = sections.some((s) => s.id === id) ? id : sections[0].id;
    for (const s of sections) {
      s.view.classList.toggle('hidden', s.id !== active);
      s.button.classList.toggle('active', s.id === active);
      s.button.setAttribute('aria-selected', String(s.id === active));
    }
  };
  const section = (id: string, title: string, ...forms: HTMLElement[]) => {
    const view = el('section', 'calc-section');
    view.setAttribute('role', 'tabpanel');
    view.append(...forms);
    const button = el('button', 'subtab', title);
    button.type = 'button';
    button.setAttribute('role', 'tab');
    button.addEventListener('click', () => {
      ctx.set('timecalc.section', id);
      showSection(id);
    });
    sections.push({ id, button, view });
  };

  section(
    'minutes',
    '時間 ⇄ 分鐘',
    form('時間 → 分鐘', [{ key: 'clock', label: '時間', type: 'time', fallback: '08:30' }], (v) => ({ op: 'timeToMinutes', time: v.clock })),
    form('分鐘 → 時間', [{ key: 'linear', label: '線性分鐘（0–1440）', type: 'number', fallback: '510', help: '從當天 00:00 起算的累計分鐘數：510 = 08:30，1440 = 24:00。' }], (v) => ({ op: 'minutesToTime', minutes: v.linear })),
  );
  section(
    'overnight',
    '跨夜時差',
    form(
      '起訖時間 → 分鐘差（相同時間視為跨夜 1440 分鐘）',
      [
        { key: 'diffStart', label: '開始', type: 'time', fallback: '22:00' },
        { key: 'diffEnd', label: '結束', type: 'time', fallback: '06:00' },
      ],
      (v) => ({ op: 'timeDifference', start: v.diffStart, end: v.diffEnd }),
    ),
    form(
      '開始＋分鐘 → 結束',
      [
        { key: 'durStart', label: '開始', type: 'time', fallback: '22:00' },
        { key: 'durMinutes', label: '分鐘（1–1440）', type: 'number', fallback: '480' },
      ],
      (v) => ({ op: 'durationToEnd', start: v.durStart, minutes: v.durMinutes }),
    ),
  );
  section(
    'weekend',
    '週末統計',
    form(
      '日期區間 → 週末天數（含開始與結束日）',
      [
        { key: 'wkStart', label: '開始日', type: 'date', fallback: date },
        { key: 'wkEnd', label: '結束日', type: 'date', fallback: date },
      ],
      (v) => ({ op: 'weekendCount', start: v.wkStart, end: v.wkEnd }),
    ),
    form(
      '目標天數 → 最早結束日',
      [
        { key: 'wkRevStart', label: '開始日', type: 'date', fallback: date },
        { key: 'sat', label: '週六天數', type: 'number', fallback: '1', help: WEEKEND_GOAL_HELP },
        { key: 'sun', label: '週日天數', type: 'number', fallback: '1', help: WEEKEND_GOAL_HELP },
      ],
      (v) => ({ op: 'weekendRange', start: v.wkRevStart, saturdays: v.sat, sundays: v.sun }),
    ),
  );
  section(
    'weeks',
    '週期日期',
    form(
      '開始＋週數 → 日期區間（一週固定 7 天）',
      [
        { key: 'weeksStart', label: '開始日', type: 'date', fallback: date },
        { key: 'weeks', label: '週數（1–520）', type: 'number', fallback: '1' },
      ],
      (v) => ({ op: 'weeksToRange', start: v.weeksStart, weeks: v.weeks }),
    ),
    form(
      '日期區間 → 週數',
      [
        { key: 'rangeStart', label: '開始日', type: 'date', fallback: date },
        { key: 'rangeEnd', label: '結束日', type: 'date', fallback: date },
      ],
      (v) => ({ op: 'rangeToWeeks', start: v.rangeStart, end: v.rangeEnd }),
    ),
  );
  section(
    'adjust',
    '時間加減',
    form(
      '時間＋正負分鐘 → 結果時間',
      [
        { key: 'adjTime', label: '時間', type: 'time', fallback: '00:30' },
        { key: 'adjMinutes', label: '正負分鐘', type: 'number', fallback: '-60', help: '正數往後加、負數往前減；跨過午夜時，結果會標示是前幾天或後幾天。' },
      ],
      (v) => ({ op: 'timeAdjustment', time: v.adjTime, minutes: v.adjMinutes }),
    ),
  );

  const bar = el('div', 'subtabs');
  bar.setAttribute('role', 'tablist');
  bar.append(...sections.map((s) => s.button));
  root.append(bar, ...sections.map((s) => s.view), el('div', 'hint', '計算規則與 time-date-converter 相同，日期以 UTC 零點運算，不受時區與日光節約影響。'));
  showSection(ctx.get('timecalc.section'));
  return root;
}
