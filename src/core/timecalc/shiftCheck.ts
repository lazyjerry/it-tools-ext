// 工時核對：把排班 JSON 的工作時段（每段扣掉休息）加總，和總時間比對。
// 四種角色——時段容器、休息容器、起訖、總時間——各有一張鍵名別名表，鍵名比對忽略大小寫與底線；
// 同一物件撞到多個候選時只取優先序最前的一個並警告，避免同一段被讀兩次。
// 時段長度沿用 timecalc 的跨夜規則（結束 ≤ 開始視為跨夜）；休息起訖相同則視為 0 分鐘，24 小時的休息不合理。
import { parseJsonDocument, toValue } from '../json/ast';

export interface BreakResult {
  start: string;
  end: string;
  minutes: number;
}

export interface SegmentResult {
  /** 從 1 起算，對應容器陣列的順序。 */
  index: number;
  start: string;
  end: string;
  minutes: number;
  crossesMidnight: boolean;
  breaks: BreakResult[];
  breakMinutes: number;
  /** 工作時段扣掉休息。 */
  net: number;
}

export interface ShiftCheckResult {
  segments: SegmentResult[];
  workMinutes: number;
  breakMinutes: number;
  computed: number;
  /** 總時間（分鐘）；缺少或無法解讀時為 null。 */
  expected: number | null;
  /** expected 為 null 時為 null。 */
  match: boolean | null;
  /** 實際採用的鍵名，依出現順序去重，例如 working_times、start_time、end_time、break_times、total_time。 */
  keys: string[];
  warnings: string[];
}

// ── 鍵名別名（優先序 = 陣列順序） ──

const normalizeKey = (key: string): string => key.toLowerCase().replace(/[_\-\s]/g, '');

const WORK_CONTAINER_KEYS = ['working_times', 'work_times', 'working_time', 'work_time', 'worktimes', 'worktime', 'work_periods', 'shift_times', 'shift_time', 'class_times', 'periods', 'times', 'intervals'];
const BREAK_CONTAINER_KEYS = ['break_times', 'break_time', 'breaks', 'break', 'break_periods', 'rest_times', 'rest_time', 'rests', 'rest', 'rest_periods', 'relax_times', 'shift_relax_times'];
const START_KEYS = ['start_time', 'start', 'start_at', 'begin_time', 'begin', 'from', 'work_start', 'on_time', 'ontime', 'on', 'clock_in', 'punch_in', 'in', 'start_minutes', 'time_start', 's_time'];
const END_KEYS = ['end_time', 'end', 'end_at', 'finish_time', 'finish', 'to', 'work_end', 'off_time', 'offtime', 'off', 'clock_out', 'punch_out', 'out', 'end_minutes', 'time_end', 'e_time'];
/** 時、分拆成兩個鍵的寫法（BasicConfig 的 hour_start／minute_start）。 */
const START_SPLIT_KEYS: [string, string][] = [['hour_start', 'minute_start'], ['start_hour', 'start_minute'], ['start_h', 'start_m']];
const END_SPLIT_KEYS: [string, string][] = [['hour_end', 'minute_end'], ['end_hour', 'end_minute'], ['end_h', 'end_m']];
const HOUR_PART_KEYS = ['hour', 'hours', 'h'];
const MINUTE_PART_KEYS = ['minute', 'minutes', 'm'];
/** 值是分鐘數。 */
const TOTAL_MINUTE_KEYS = ['total_time', 'total_minutes', 'total_minute', 'totaltime', 'work_minutes', 'work_minute', 'shift_total_time', 'punch_total_time', 'duration_minutes', 'duration', 'minutes', 'total', 'time'];
/** 值是小時數（數字）或 HH:mm 形式的時數字串。 */
const TOTAL_HOUR_KEYS = ['work_hours', 'total_hours', 'total_work_hours', 'shift_hours', 'hours'];

const MAX_SEARCH_DEPTH = 8;

type Rec = Record<string, unknown>;

function isRecord(value: unknown): value is Rec {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** 用別名表在物件裡找鍵：回傳命中的原始鍵名（依優先序）。 */
function matchKeys(record: Rec, aliases: readonly string[]): string[] {
  const byNorm = new Map<string, string>();
  for (const key of Object.keys(record)) {
    const n = normalizeKey(key);
    if (!byNorm.has(n)) {
      byNorm.set(n, key);
    }
  }
  const hits: string[] = [];
  for (const alias of aliases) {
    const key = byNorm.get(normalizeKey(alias));
    if (key !== undefined && !hits.includes(key)) {
      hits.push(key);
    }
  }
  return hits;
}

function pickKey(record: Rec, aliases: readonly string[], role: string, path: string, warnings: string[], accept: (value: unknown) => boolean = () => true): string | null {
  const hits = matchKeys(record, aliases).filter((k) => accept(record[k]));
  if (hits.length === 0) {
    return null;
  }
  if (hits.length > 1) {
    warnings.push(`${path} 同時有 ${hits.join('、')}（都像${role}），採用 ${hits[0]}`);
  }
  return hits[0];
}

function hasPeriodKeys(record: Rec): boolean {
  return (
    (matchKeys(record, START_KEYS).length > 0 || START_SPLIT_KEYS.some(([h, m]) => matchKeys(record, [h]).length > 0 && matchKeys(record, [m]).length > 0)) &&
    (matchKeys(record, END_KEYS).length > 0 || END_SPLIT_KEYS.some(([h, m]) => matchKeys(record, [h]).length > 0 && matchKeys(record, [m]).length > 0))
  );
}

/** 時段陣列：非空、每個元素都是帶起訖鍵的物件。hrm 的 work_time 常是 ['09:00:00'] 字串陣列，不算。 */
function isPeriodArray(value: unknown): value is Rec[] {
  return Array.isArray(value) && value.length > 0 && value.every((item) => isRecord(item) && hasPeriodKeys(item));
}

function isPeriodContainer(value: unknown): boolean {
  return Array.isArray(value) && (value.length === 0 || isPeriodArray(value));
}

// ── 值的解讀 ──

interface Clock {
  /** 分鐘數；含日期的值是絕對分鐘，其餘是當天 0 起算（可大於 1440 表示隔天）。 */
  minutes: number;
  absolute: boolean;
  text: string;
}

const pad = (n: number) => String(n).padStart(2, '0');

function clockText(minutes: number): string {
  const day = Math.floor(minutes / 1440);
  const m = ((minutes % 1440) + 1440) % 1440;
  return `${day > 0 ? `+${day}d ` : ''}${pad(Math.floor(m / 60))}:${pad(m % 60)}`;
}

function parseClock(value: unknown, path: string): Clock {
  if (typeof value === 'number') {
    if (!Number.isInteger(value) || value < 0) {
      throw new Error(`${path}：分鐘數必須是 0 以上的整數`);
    }
    return { minutes: value, absolute: false, text: clockText(value) };
  }
  if (isRecord(value)) {
    const h = matchKeys(value, HOUR_PART_KEYS)[0];
    const m = matchKeys(value, MINUTE_PART_KEYS)[0];
    if (h === undefined || m === undefined) {
      throw new Error(`${path}：物件要有 hour／minute（或 H／M）`);
    }
    return parseClock(`${pad(Number(value[h]))}:${pad(Number(value[m]))}`, path);
  }
  if (typeof value !== 'string') {
    throw new Error(`${path}：缺少或不是時間`);
  }
  const text = value.trim();
  const dateTime = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(text);
  if (dateTime) {
    const [, y, mo, d, h, mi] = dateTime;
    const stamp = Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi));
    if (Number.isNaN(stamp) || Number(h) > 23 || Number(mi) > 59) {
      throw new Error(`${path}：請輸入有效日期時間`);
    }
    return { minutes: Math.floor(stamp / 60_000), absolute: true, text };
  }
  const clock = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(text);
  if (!clock) {
    throw new Error(`${path}：時間格式必須為 HH:mm（也接受 HH:mm:ss、分鐘數、yyyy-MM-dd HH:mm）`);
  }
  const hours = Number(clock[1]);
  const minutes = Number(clock[2]);
  if (hours > 23 || minutes > 59) {
    throw new Error(`${path}：請輸入 00:00–23:59`);
  }
  return { minutes: hours * 60 + minutes, absolute: false, text: `${pad(hours)}:${pad(minutes)}` };
}

function readClock(record: Rec, aliases: readonly string[], splitAliases: readonly [string, string][], role: string, path: string, warnings: string[], keys: string[]): Clock {
  const key = pickKey(record, aliases, role, path, warnings);
  if (key !== null) {
    keys.push(key);
    return parseClock(record[key], `${path}.${key}`);
  }
  for (const [hourKey, minuteKey] of splitAliases) {
    const h = matchKeys(record, [hourKey])[0];
    const m = matchKeys(record, [minuteKey])[0];
    if (h !== undefined && m !== undefined) {
      keys.push(`${h}+${m}`);
      return parseClock(`${pad(Number(record[h]))}:${pad(Number(record[m]))}`, `${path}.${h}/${m}`);
    }
  }
  throw new Error(`${path}：找不到${role}（${aliases.slice(0, 4).join('／')}…）`);
}

/** 起訖 → 長度。同為絕對時間時直接相減；否則結束 ≤ 開始視為跨夜。 */
function span(start: Clock, end: Clock, path: string, allowZero: boolean): { minutes: number; crossesMidnight: boolean } {
  if (start.absolute && end.absolute) {
    if (end.minutes < start.minutes) {
      throw new Error(`${path}：結束早於開始`);
    }
    return { minutes: end.minutes - start.minutes, crossesMidnight: Math.floor(end.minutes / 1440) !== Math.floor(start.minutes / 1440) };
  }
  if (start.absolute !== end.absolute) {
    throw new Error(`${path}：開始與結束要同一種格式（都含日期或都不含）`);
  }
  if (allowZero && end.minutes === start.minutes) {
    return { minutes: 0, crossesMidnight: false };
  }
  const crossesMidnight = end.minutes <= start.minutes;
  return { minutes: crossesMidnight ? end.minutes + 1440 - start.minutes : end.minutes - start.minutes, crossesMidnight };
}

// ── 找資料 ──

interface Located {
  periods: Rec[];
  /** 容器所在的物件與其祖先（近到遠），用來找總時間。 */
  owners: Rec[];
  containerKey: string | null;
}

function locate(value: unknown, ancestors: Rec[], warnings: string[], depth = 0): Located | null {
  if (depth > MAX_SEARCH_DEPTH) {
    return null;
  }
  if (isRecord(value)) {
    const key = pickKey(value, WORK_CONTAINER_KEYS, '時段容器', '物件', warnings, isPeriodContainer);
    if (key !== null) {
      return { periods: value[key] as Rec[], owners: [value, ...ancestors], containerKey: key };
    }
    for (const child of Object.values(value)) {
      const found = locate(child, [value, ...ancestors], warnings, depth + 1);
      if (found) {
        return found;
      }
    }
  } else if (Array.isArray(value)) {
    for (const child of value) {
      const found = locate(child, ancestors, warnings, depth + 1);
      if (found) {
        return found;
      }
    }
  }
  return null;
}

/** 接受完整 JSON，也接受沒有外層大括號的 `"working_times": [...], "total_time": 270` 片段。 */
function parseInput(text: string): unknown {
  try {
    return toValue(parseJsonDocument(text).node);
  } catch (error) {
    const trimmed = text.trim();
    if (trimmed.startsWith('"')) {
      try {
        return toValue(parseJsonDocument(`{${trimmed}}`).node);
      } catch {
        // 片段也解不開，回報原本的錯誤
      }
    }
    throw error;
  }
}

function readSegment(raw: Rec, index: number, warnings: string[], keys: string[]): SegmentResult {
  const path = `第 ${index + 1} 段`;
  const start = readClock(raw, START_KEYS, START_SPLIT_KEYS, '開始時間', path, warnings, keys);
  const end = readClock(raw, END_KEYS, END_SPLIT_KEYS, '結束時間', path, warnings, keys);
  const total = span(start, end, path, false);
  const segStartClock = ((start.minutes % 1440) + 1440) % 1440;

  const breaks: { start: string; end: string; minutes: number; offset: number }[] = [];
  const breakKey = pickKey(raw, BREAK_CONTAINER_KEYS, '休息容器', path, warnings, (v) => v === null || v === undefined || Array.isArray(v));
  const rawBreaks = breakKey === null ? undefined : raw[breakKey];
  if (breakKey !== null && Array.isArray(rawBreaks)) {
    keys.push(breakKey);
    rawBreaks.forEach((item, i) => {
      const breakPath = `${path}休息 ${i + 1}`;
      if (!isRecord(item)) {
        throw new Error(`${breakPath}：必須是物件`);
      }
      const bStart = readClock(item, START_KEYS, START_SPLIT_KEYS, '開始時間', breakPath, warnings, keys);
      const bEnd = readClock(item, END_KEYS, END_SPLIT_KEYS, '結束時間', breakPath, warnings, keys);
      const length = span(bStart, bEnd, breakPath, true);
      if (length.minutes === 0) {
        warnings.push(`${breakPath} ${bStart.text}–${bEnd.text} 起訖相同，以 0 分鐘計`);
      }
      // 休息在時段內的位置：絕對時間直接相減，否則以時鐘差對一天取模（跨夜時段裡午夜後的休息會落在正確位置）
      const offset = bStart.absolute && start.absolute ? bStart.minutes - start.minutes : ((((bStart.minutes % 1440) + 1440) % 1440) - segStartClock + 1440) % 1440;
      if (offset < 0 || offset + length.minutes > total.minutes) {
        warnings.push(`${breakPath} ${bStart.text}–${bEnd.text} 超出工作時段 ${start.text}–${end.text}，仍照休息長度扣除`);
      }
      breaks.push({ start: bStart.text, end: bEnd.text, minutes: length.minutes, offset });
    });
    const ordered = [...breaks].sort((a, b) => a.offset - b.offset);
    for (let i = 1; i < ordered.length; i += 1) {
      if (ordered[i].offset < ordered[i - 1].offset + ordered[i - 1].minutes) {
        warnings.push(`${path}休息 ${ordered[i - 1].start}–${ordered[i - 1].end} 與 ${ordered[i].start}–${ordered[i].end} 重疊，重疊部分會被扣兩次`);
      }
    }
  }

  const breakMinutes = breaks.reduce((sum, b) => sum + b.minutes, 0);
  if (breakMinutes > total.minutes) {
    warnings.push(`${path}休息合計 ${breakMinutes} 分鐘超過工作時段 ${total.minutes} 分鐘`);
  }
  return {
    index: index + 1,
    start: start.text,
    end: end.text,
    minutes: total.minutes,
    crossesMidnight: total.crossesMidnight,
    breaks: breaks.map(({ start: s, end: e, minutes }) => ({ start: s, end: e, minutes })),
    breakMinutes,
    net: total.minutes - breakMinutes,
  };
}

/** 總時間：先在容器同層找，沒有才往外層找；分鐘鍵優先於小時鍵。 */
function readExpected(owners: Rec[], warnings: string[], keys: string[]): number | null {
  for (const owner of owners) {
    const minuteKey = pickKey(owner, TOTAL_MINUTE_KEYS, '總時間', '容器同層', warnings, (v) => v !== null && v !== undefined);
    const hourKey = minuteKey === null ? pickKey(owner, TOTAL_HOUR_KEYS, '總時數', '容器同層', warnings, (v) => v !== null && v !== undefined) : null;
    const key = minuteKey ?? hourKey;
    if (key === null) {
      continue;
    }
    keys.push(key);
    const raw = owner[key];
    const isHours = minuteKey === null;
    if (typeof raw === 'number' && Number.isFinite(raw)) {
      if (isHours) {
        const minutes = raw * 60;
        if (!Number.isInteger(minutes)) {
          warnings.push(`${key} = ${raw} 小時換算後不是整數分鐘，四捨五入成 ${Math.round(minutes)}`);
        }
        return Math.round(minutes);
      }
      if (!Number.isInteger(raw)) {
        warnings.push(`${key} = ${raw} 不是整數，四捨五入成 ${Math.round(raw)}`);
      }
      return Math.round(raw);
    }
    if (typeof raw === 'string') {
      const text = raw.trim();
      const hhmm = /^(\d{1,3}):(\d{2})$/.exec(text);
      if (hhmm) {
        const minutes = Number(hhmm[1]) * 60 + Number(hhmm[2]);
        if (!isHours) {
          warnings.push(`${key} = "${text}" 是時:分形式，當成 ${minutes} 分鐘比對`);
        }
        return minutes;
      }
      if (/^-?\d+(\.\d+)?$/.test(text)) {
        warnings.push(`${key} 是字串 "${text}"，已當成數字比對`);
        return Math.round(Number(text) * (isHours ? 60 : 1));
      }
    }
    warnings.push(`${key} 不是可解讀的時間（${JSON.stringify(raw)}），無法比對`);
    return null;
  }
  warnings.push(`沒有總時間（${TOTAL_MINUTE_KEYS.slice(0, 3).join('／')}…），只列出計算結果`);
  return null;
}

export function checkShift(input: string): ShiftCheckResult {
  if (input.trim() === '') {
    throw new Error('請貼上含工作時段的 JSON');
  }
  const root = parseInput(input);
  const warnings: string[] = [];
  const keys: string[] = [];
  let located = locate(root, [], warnings);
  if (!located) {
    // 沒有容器時只接受根本身就是時段（單一物件或時段陣列），不往深處猜，避免抓到日期區間之類的東西
    if (isPeriodArray(root)) {
      located = { periods: root, owners: [], containerKey: null };
    } else if (isRecord(root) && hasPeriodKeys(root)) {
      located = { periods: [root], owners: [root], containerKey: null };
    } else {
      throw new Error(`找不到工作時段：需要 ${WORK_CONTAINER_KEYS.slice(0, 4).join('／')} 等鍵的時段陣列，或本身就是帶開始／結束的物件`);
    }
  }
  if (located.containerKey !== null) {
    keys.push(located.containerKey);
  }
  if (located.periods.length === 0) {
    warnings.push(`${located.containerKey ?? '時段'} 是空的`);
  }
  const segments = located.periods.map((raw, index) => readSegment(raw, index, warnings, keys));
  const workMinutes = segments.reduce((sum, s) => sum + s.minutes, 0);
  const breakMinutes = segments.reduce((sum, s) => sum + s.breakMinutes, 0);
  const computed = workMinutes - breakMinutes;
  const expected = readExpected(located.owners, warnings, keys);

  return {
    segments,
    workMinutes,
    breakMinutes,
    computed,
    expected,
    match: expected === null ? null : expected === computed,
    keys: [...new Set(keys)],
    warnings,
  };
}

const durationText = (minutes: number) => `${Math.floor(Math.abs(minutes) / 60)} 小時 ${Math.abs(minutes) % 60} 分鐘`;

export function shiftSummary(result: ShiftCheckResult): string {
  if (result.expected === null) {
    return `計算 ${result.computed} 分鐘（${durationText(result.computed)}），沒有總時間可比對`;
  }
  if (result.match) {
    return `一致：總時間 ${result.expected} = 計算 ${result.computed} 分鐘（${durationText(result.computed)}）`;
  }
  const diff = result.computed - result.expected;
  return `不一致：總時間 ${result.expected}，計算 ${result.computed} 分鐘，${diff > 0 ? '多' : '少'} ${Math.abs(diff)} 分鐘`;
}

/** 可複製、可開在編輯器的純文字報告。 */
export function formatShiftCheck(result: ShiftCheckResult): string {
  const lines = [`核對結果：${shiftSummary(result)}`, `採用欄位：${result.keys.join('、')}`];
  for (const s of result.segments) {
    lines.push(`第 ${s.index} 段 ${s.start}–${s.end}：${s.minutes} 分鐘（${durationText(s.minutes)}）${s.crossesMidnight ? '｜跨夜' : ''}`);
    for (const b of s.breaks) {
      lines.push(`  休息 ${b.start}–${b.end}：${b.minutes} 分鐘`);
    }
    if (s.breaks.length > 0) {
      lines.push(`  實際工時：${s.net} 分鐘`);
    }
  }
  lines.push(`合計：工作 ${result.workMinutes} − 休息 ${result.breakMinutes} = ${result.computed} 分鐘（${durationText(result.computed)}）`);
  for (const w of result.warnings) {
    lines.push(`⚠ ${w}`);
  }
  return lines.join('\n');
}
