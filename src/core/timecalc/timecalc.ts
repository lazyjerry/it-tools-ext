// 排班時間計算：逐函式移植 time-date-converter 的 app.js，驗證規則與輸出文字保持一致。
// 日期一律用 UTC 零點運算，避開本地時區與 DST 讓「一天」不等於 86400 秒的問題。

const DAY_MS = 86_400_000;

export function timeToMinutes(value: string): number {
  const match = /^(\d{2}):(\d{2})$/.exec(value);
  if (!match) {
    throw new Error('時間格式必須為 HH:mm');
  }
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) {
    throw new Error('請輸入 00:00–23:59');
  }
  return hours * 60 + minutes;
}

export function minutesToTime(value: number | string): string {
  const minutes = Number(value);
  if (!Number.isInteger(minutes) || minutes < 0 || minutes > 1440) {
    throw new Error('分鐘必須是 0–1440 的整數');
  }
  if (minutes === 1440) {
    return '24:00';
  }
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
}

/** 結束 ≤ 開始視為跨夜，所以起訖相同是 1440 分鐘而不是 0。 */
export function getTimeDifference(start: string, end: string): { minutes: number; crossesMidnight: boolean } {
  const startMinutes = timeToMinutes(start);
  const endMinutes = timeToMinutes(end);
  const crossesMidnight = endMinutes <= startMinutes;
  return {
    minutes: crossesMidnight ? endMinutes + 1440 - startMinutes : endMinutes - startMinutes,
    crossesMidnight,
  };
}

export function addMinutesToTime(
  start: string,
  duration: number | string,
): { end: string; daysCrossed: number; crossesMidnight: boolean } {
  const minutes = Number(duration);
  if (!Number.isInteger(minutes) || minutes < 1 || minutes > 1440) {
    throw new Error('分鐘必須是 1–1440 的整數');
  }
  const total = timeToMinutes(start) + minutes;
  return {
    end: minutesToTime(total % 1440),
    daysCrossed: Math.floor(total / 1440),
    crossesMidnight: total >= 1440,
  };
}

export function shiftTimeByMinutes(time: string, adjustment: number | string): { time: string; dayOffset: number } {
  const minutes = Number(adjustment);
  if (!Number.isSafeInteger(minutes)) {
    throw new Error('正負分鐘數必須是整數');
  }
  const total = timeToMinutes(time) + minutes;
  const normalizedMinutes = ((total % 1440) + 1440) % 1440;
  return {
    time: minutesToTime(normalizedMinutes),
    dayOffset: Math.floor(total / 1440),
  };
}

function parseDate(value: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error('請輸入有效日期');
  }
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    throw new Error('請輸入有效日期');
  }
  return date;
}

function formatDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * DAY_MS);
}

function inclusiveDays(startValue: string, endValue: string): number {
  const start = parseDate(startValue);
  const end = parseDate(endValue);
  if (end < start) {
    throw new Error('結束日期不可早於開始日期');
  }
  return Math.round((end.getTime() - start.getTime()) / DAY_MS) + 1;
}

/** 區間含頭含尾。 */
export function countWeekends(startValue: string, endValue: string): { saturdays: number; sundays: number; days: number } {
  const start = parseDate(startValue);
  const days = inclusiveDays(startValue, endValue);
  const wholeWeeks = Math.floor(days / 7);
  let saturdays = wholeWeeks;
  let sundays = wholeWeeks;
  for (let offset = wholeWeeks * 7; offset < days; offset += 1) {
    const weekday = addDays(start, offset).getUTCDay();
    if (weekday === 6) {
      saturdays += 1;
    }
    if (weekday === 0) {
      sundays += 1;
    }
  }
  return { saturdays, sundays, days };
}

/** 週六、週日都要剛好等於目標；任一方先超過就代表從這天起湊不出來。 */
export function findEarliestWeekendRange(
  startValue: string,
  targetSaturdays: number | string,
  targetSundays: number | string,
): { end: string; days: number } {
  const saturdayGoal = Number(targetSaturdays);
  const sundayGoal = Number(targetSundays);
  if (![saturdayGoal, sundayGoal].every((value) => Number.isInteger(value) && value >= 0 && value <= 520)) {
    throw new Error('週末天數必須是 0–520 的整數');
  }
  const start = parseDate(startValue);
  let saturdays = 0;
  let sundays = 0;
  for (let offset = 0; offset <= 3650; offset += 1) {
    const current = addDays(start, offset);
    if (current.getUTCDay() === 6) {
      saturdays += 1;
    }
    if (current.getUTCDay() === 0) {
      sundays += 1;
    }
    if (saturdays === saturdayGoal && sundays === sundayGoal) {
      return { end: formatDate(current), days: offset + 1 };
    }
    if (saturdays > saturdayGoal || sundays > sundayGoal) {
      break;
    }
  }
  throw new Error('從此開始日期無法組成指定的週六／週日數');
}

export function weeksToRange(startValue: string, weekCount: number | string): { start: string; end: string; days: number } {
  const weeks = Number(weekCount);
  if (!Number.isInteger(weeks) || weeks < 1 || weeks > 520) {
    throw new Error('週數必須是 1–520 的整數');
  }
  const start = parseDate(startValue);
  return { start: formatDate(start), end: formatDate(addDays(start, weeks * 7 - 1)), days: weeks * 7 };
}

export function rangeToWeeks(startValue: string, endValue: string): { days: number; wholeWeeks: number; remainingDays: number } {
  const days = inclusiveDays(startValue, endValue);
  return { days, wholeWeeks: Math.floor(days / 7), remainingDays: days % 7 };
}

// ── 與原站相同的結果文字 ──

export type TimeCalcOp =
  | { op: 'timeToMinutes'; time: string }
  | { op: 'minutesToTime'; minutes: string }
  | { op: 'timeDifference'; start: string; end: string }
  | { op: 'durationToEnd'; start: string; minutes: string }
  | { op: 'timeAdjustment'; time: string; minutes: string }
  | { op: 'weekendCount'; start: string; end: string }
  | { op: 'weekendRange'; start: string; saturdays: string; sundays: string }
  | { op: 'weeksToRange'; start: string; weeks: string }
  | { op: 'rangeToWeeks'; start: string; end: string };

const durationText = (minutes: number) => `${Math.floor(minutes / 60)} 小時 ${minutes % 60} 分鐘`;

export function runTimeCalc(request: TimeCalcOp): string {
  switch (request.op) {
    case 'timeToMinutes':
      return `${request.time} = ${timeToMinutes(request.time)} 分鐘`;
    case 'minutesToTime':
      return `${request.minutes} 分鐘 = ${minutesToTime(request.minutes)}`;
    case 'timeDifference': {
      const result = getTimeDifference(request.start, request.end);
      return `${result.minutes} 分鐘（${durationText(result.minutes)}）｜${result.crossesMidnight ? '跨夜' : '未跨夜'}`;
    }
    case 'durationToEnd': {
      const result = addMinutesToTime(request.start, request.minutes);
      return `結束時間 ${result.end}｜${result.crossesMidnight ? `跨夜 ${result.daysCrossed} 天` : '未跨夜'}`;
    }
    case 'timeAdjustment': {
      const result = shiftTimeByMinutes(request.time, request.minutes);
      const dayText = result.dayOffset === 0 ? '同一天' : `${result.dayOffset > 0 ? '後' : '前'} ${Math.abs(result.dayOffset)} 天`;
      return `結果時間 ${result.time}｜${dayText}`;
    }
    case 'weekendCount': {
      const result = countWeekends(request.start, request.end);
      return `${result.days} 天內：週六 ${result.saturdays} 天、週日 ${result.sundays} 天`;
    }
    case 'weekendRange': {
      const result = findEarliestWeekendRange(request.start, request.saturdays, request.sundays);
      return `最早結束日 ${result.end}｜區間共 ${result.days} 天`;
    }
    case 'weeksToRange': {
      const result = weeksToRange(request.start, request.weeks);
      return `${result.start} ～ ${result.end}｜共 ${result.days} 天`;
    }
    case 'rangeToWeeks': {
      const result = rangeToWeeks(request.start, request.end);
      return `${result.days} 天 = ${result.wholeWeeks} 週又 ${result.remainingDays} 天`;
    }
  }
}
