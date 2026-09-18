import * as assert from 'node:assert/strict';

import {
  addMinutesToTime,
  countWeekends,
  findEarliestWeekendRange,
  getTimeDifference,
  minutesToTime,
  rangeToWeeks,
  runTimeCalc,
  shiftTimeByMinutes,
  timeToMinutes,
  weeksToRange,
} from '../../src/core/timecalc/timecalc';

// 規則對照 time-date-converter 的 app.js；移植時曾以原站程式對 27000 筆隨機輸入差分比對全數一致。

suite('時間 ⇄ 分鐘', () => {
  test('HH:mm 轉線性分鐘', () => {
    assert.equal(timeToMinutes('00:00'), 0);
    assert.equal(timeToMinutes('23:59'), 1439);
  });

  test('24:00 與非兩位數格式不接受', () => {
    assert.throws(() => timeToMinutes('24:00'), /00:00–23:59/);
    assert.throws(() => timeToMinutes('7:00'), /HH:mm/);
  });

  test('1440 轉成 24:00，超出範圍報錯', () => {
    assert.equal(minutesToTime(1440), '24:00');
    assert.equal(minutesToTime(75), '01:15');
    assert.throws(() => minutesToTime(1441));
    assert.throws(() => minutesToTime(1.5));
  });
});

suite('跨夜時差', () => {
  test('起訖相同視為跨夜 1440 分鐘', () => {
    assert.deepEqual(getTimeDifference('08:00', '08:00'), { minutes: 1440, crossesMidnight: true });
  });

  test('結束早於開始算跨夜', () => {
    assert.deepEqual(getTimeDifference('22:00', '06:00'), { minutes: 480, crossesMidnight: true });
    assert.deepEqual(getTimeDifference('09:00', '18:00'), { minutes: 540, crossesMidnight: false });
  });

  test('開始＋分鐘：1440 分鐘剛好回到同一時刻並跨一天', () => {
    assert.deepEqual(addMinutesToTime('08:00', 1440), { end: '08:00', daysCrossed: 1, crossesMidnight: true });
    assert.throws(() => addMinutesToTime('08:00', 0), /1–1440/);
  });
});

suite('時間加減分鐘', () => {
  test('負數往前一天回繞', () => {
    assert.deepEqual(shiftTimeByMinutes('00:30', -60), { time: '23:30', dayOffset: -1 });
  });

  test('跨多天', () => {
    assert.deepEqual(shiftTimeByMinutes('12:00', 1440 * 2 + 30), { time: '12:30', dayOffset: 2 });
  });
});

suite('週末統計', () => {
  test('區間含頭含尾：2026-09-19（六）到 2026-09-20（日）', () => {
    assert.deepEqual(countWeekends('2026-09-19', '2026-09-20'), { saturdays: 1, sundays: 1, days: 2 });
  });

  test('結束早於開始報錯', () => {
    assert.throws(() => countWeekends('2026-09-20', '2026-09-19'), /不可早於/);
  });

  test('閏年 2 月 29 日有效、2 月 30 日無效', () => {
    assert.equal(countWeekends('2028-02-29', '2028-02-29').days, 1);
    assert.throws(() => countWeekends('2026-02-30', '2026-03-01'), /有效日期/);
  });

  test('最早結束日：週六週日都要剛好命中', () => {
    // 2026-09-18 是週五 → 19 六、20 日
    assert.deepEqual(findEarliestWeekendRange('2026-09-18', 1, 1), { end: '2026-09-20', days: 3 });
  });

  test('只要 1 個週日但從週六起算，週六先超過 → 無解', () => {
    assert.throws(() => findEarliestWeekendRange('2026-09-19', 0, 1), /無法組成/);
  });
});

suite('週期日期', () => {
  test('一週固定 7 天，結束日 = 開始 + 週數×7 − 1', () => {
    assert.deepEqual(weeksToRange('2026-12-28', 1), { start: '2026-12-28', end: '2027-01-03', days: 7 });
  });

  test('日期區間轉週數含餘數', () => {
    assert.deepEqual(rangeToWeeks('2026-01-01', '2026-01-10'), { days: 10, wholeWeeks: 1, remainingDays: 3 });
  });
});

suite('結果文字與原站一致', () => {
  test('跨夜時差', () => {
    assert.equal(runTimeCalc({ op: 'timeDifference', start: '22:00', end: '06:00' }), '480 分鐘（8 小時 0 分鐘）｜跨夜');
  });

  test('時間加減的前後天', () => {
    assert.equal(runTimeCalc({ op: 'timeAdjustment', time: '00:30', minutes: '-60' }), '結果時間 23:30｜前 1 天');
    assert.equal(runTimeCalc({ op: 'timeAdjustment', time: '10:00', minutes: '30' }), '結果時間 10:30｜同一天');
  });

  test('週數轉區間', () => {
    assert.equal(runTimeCalc({ op: 'weeksToRange', start: '2026-12-28', weeks: '1' }), '2026-12-28 ～ 2027-01-03｜共 7 天');
  });
});
