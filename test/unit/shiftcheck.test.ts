import * as assert from 'node:assert/strict';

import { checkShift, formatShiftCheck, shiftSummary } from '../../src/core/timecalc/shiftCheck';

const SAMPLE = `{
  "working_times": [
    {
      "start_time": "09:00",
      "end_time": "15:00",
      "break_times": [{ "start_time": "10:00", "end_time": "11:30" }]
    }
  ],
  "total_time": 270
}`;

suite('工時核對', () => {
  test('單段扣休息後與 total_time 一致', () => {
    const result = checkShift(SAMPLE);
    assert.equal(result.workMinutes, 360);
    assert.equal(result.breakMinutes, 90);
    assert.equal(result.computed, 270);
    assert.equal(result.expected, 270);
    assert.equal(result.match, true);
    assert.deepEqual(result.warnings, []);
    assert.equal(result.segments[0].net, 270);
    assert.deepEqual(result.keys, ['working_times', 'start_time', 'end_time', 'break_times', 'total_time']);
    assert.match(shiftSummary(result), /^一致：總時間 270 = 計算 270 分鐘（4 小時 30 分鐘）$/);
  });

  test('沒有外層大括號的片段也能解析', () => {
    const fragment = `"working_times": [{ "start_time": "09:00", "end_time": "12:00" }],
      "total_time": 180`;
    const result = checkShift(fragment);
    assert.equal(result.computed, 180);
    assert.equal(result.match, true);
  });

  test('貼整份 API 回應時找到巢狀的 working_times', () => {
    const wrapped = `{"status": 200, "data": {"items": [{"date": "2026-10-19", ${SAMPLE.slice(1, -1)} }]}}`;
    const result = checkShift(wrapped);
    assert.equal(result.computed, 270);
    assert.equal(result.match, true);
  });

  test('不一致時回報差額方向', () => {
    const result = checkShift(SAMPLE.replace('"total_time": 270', '"total_time": 300'));
    assert.equal(result.match, false);
    assert.equal(shiftSummary(result), '不一致：總時間 300，計算 270 分鐘，少 30 分鐘');
    const more = checkShift(SAMPLE.replace('"total_time": 270', '"total_time": 200'));
    assert.equal(shiftSummary(more), '不一致：總時間 200，計算 270 分鐘，多 70 分鐘');
  });

  test('跨夜時段與午夜後的休息', () => {
    const result = checkShift(`{
      "working_times": [{ "start_time": "22:00", "end_time": "06:00",
        "break_times": [{ "start_time": "00:00", "end_time": "00:30" }] }],
      "total_time": 450
    }`);
    assert.equal(result.segments[0].crossesMidnight, true);
    assert.equal(result.segments[0].minutes, 480);
    assert.equal(result.computed, 450);
    assert.equal(result.match, true);
    assert.deepEqual(result.warnings, []);
  });

  test('多段加總，沒有休息的段也算', () => {
    const result = checkShift(`{
      "working_times": [
        { "start_time": "08:00", "end_time": "12:00" },
        { "start_time": "13:00", "end_time": "17:30", "break_times": [] }
      ],
      "total_time": 510
    }`);
    assert.equal(result.segments.length, 2);
    assert.equal(result.computed, 510);
    assert.equal(result.match, true);
  });

  test('缺總時間只列計算結果', () => {
    const result = checkShift('{"working_times": [{"start_time": "09:00", "end_time": "10:00"}]}');
    assert.equal(result.expected, null);
    assert.equal(result.match, null);
    assert.equal(result.warnings.length, 1);
    assert.match(result.warnings[0], /^沒有總時間/);
    assert.match(shiftSummary(result), /沒有總時間可比對/);
  });

  test('total_time 是數字字串時照比對並警告', () => {
    const result = checkShift(SAMPLE.replace('"total_time": 270', '"total_time": "270"'));
    assert.equal(result.match, true);
    assert.match(result.warnings[0], /是字串/);
  });

  test('休息超出時段、起訖相同、重疊都警告但照扣', () => {
    const result = checkShift(`{
      "working_times": [{ "start_time": "09:00", "end_time": "12:00",
        "break_times": [
          { "start_time": "08:30", "end_time": "09:30" },
          { "start_time": "10:00", "end_time": "10:00" },
          { "start_time": "10:00", "end_time": "11:00" },
          { "start_time": "10:30", "end_time": "11:30" }
        ] }],
      "total_time": 0
    }`);
    assert.equal(result.breakMinutes, 60 + 0 + 60 + 60);
    assert.equal(result.computed, 0);
    assert.match(result.warnings.join('\n'), /08:30–09:30 超出工作時段 09:00–12:00/);
    assert.match(result.warnings.join('\n'), /10:00–10:00 起訖相同/);
    assert.match(result.warnings.join('\n'), /10:00–11:00 與 10:30–11:30 重疊/);
  });

  test('格式錯誤指出位置', () => {
    assert.throws(() => checkShift('{"working_times": [{"start_time": "9:0", "end_time": "10:00"}]}'), /第 1 段\.start_time：時間格式必須為 HH:mm/);
    assert.throws(() => checkShift('{"working_times": [{"start_time": "09:00", "end_time": "25:00"}]}'), /第 1 段\.end_time：請輸入 00:00–23:59/);
    assert.throws(() => checkShift('{"working_times": [{"start_time": "09:00", "end_time": "10:00", "break_times": [1]}]}'), /第 1 段休息 1：必須是物件/);
    assert.throws(() => checkShift('{"total_time": 1}'), /找不到工作時段/);
    assert.throws(() => checkShift('   '), /請貼上/);
    assert.throws(() => checkShift('{"working_times": [}'), /第 1 行/);
  });

  test('純文字報告含總結、採用欄位、逐段、合計與警告', () => {
    const report = formatShiftCheck(checkShift(SAMPLE.replace('"total_time": 270', '"total_time": 300')));
    assert.deepEqual(report.split('\n'), [
      '核對結果：不一致：總時間 300，計算 270 分鐘，少 30 分鐘',
      '採用欄位：working_times、start_time、end_time、break_times、total_time',
      '第 1 段 09:00–15:00：360 分鐘（6 小時 0 分鐘）',
      '  休息 10:00–11:30：90 分鐘',
      '  實際工時：270 分鐘',
      '合計：工作 360 − 休息 90 = 270 分鐘（4 小時 30 分鐘）',
    ]);
  });
});

suite('工時核對：鍵名別名', () => {
  test('hrm-api BasicConfig：hour_start／minute_start 拆欄，休息同樣拆欄', () => {
    const result = checkShift(`{
      "working_times": [{ "hour_start": "09", "minute_start": "00", "hour_end": "18", "minute_end": "00",
        "break_times": [{ "hour_start": "12", "minute_start": "00", "hour_end": "13", "minute_end": "00" }] }],
      "total_time": 480
    }`);
    assert.equal(result.match, true);
    assert.deepEqual(result.keys, ['working_times', 'hour_start+minute_start', 'hour_end+minute_end', 'break_times', 'total_time']);
    assert.equal(result.segments[0].start, '09:00');
  });

  test('分鐘數：work_start／work_end 與休息的 start／end', () => {
    const result = checkShift('[{"work_start": 540, "work_end": 1080, "break_times": [{"start": 720, "end": 750}]}]');
    assert.equal(result.computed, 510);
    assert.equal(result.expected, null);
    assert.equal(result.segments[0].start, '09:00');
    assert.equal(result.segments[0].breaks[0].end, '12:30');
    assert.deepEqual(result.keys, ['work_start', 'work_end', 'break_times', 'start', 'end']);
  });

  test('start: {H, M} 物件與 HH:mm:ss、camelCase 鍵、rest_times', () => {
    const result = checkShift(`{
      "shiftTimes": [{ "start": { "H": 9, "M": 30 }, "end": "18:30:00",
        "restTimes": [{ "startTime": "12:00:00", "endTime": "13:00:00" }] }],
      "totalMinutes": 480
    }`);
    assert.equal(result.match, true);
    assert.deepEqual(result.keys, ['shiftTimes', 'start', 'end', 'restTimes', 'startTime', 'endTime', 'totalMinutes']);
  });

  test('含日期的 start_at／end_at 直接相減，跨日標示跨夜', () => {
    const result = checkShift(`{
      "work_time": [{ "start_at": "2026-10-19 22:00:00", "end_at": "2026-10-20 06:00:00",
        "breaks": [{ "start_at": "2026-10-20 00:00:00", "end_at": "2026-10-20 00:30:00" }] }],
      "minutes": 450
    }`);
    assert.equal(result.match, true);
    assert.equal(result.segments[0].crossesMidnight, true);
    assert.deepEqual(result.warnings, []);
    assert.throws(() => checkShift('[{"start_at": "2026-10-19 22:00", "end_at": "2026-10-19 21:00"}]'), /結束早於開始/);
    assert.throws(() => checkShift('[{"start_at": "2026-10-19 22:00", "end_time": "23:00"}]'), /同一種格式/);
  });

  test('總時間：work_hours "08:00"、total_hours 數字、往外層找', () => {
    const hhmm = checkShift('{"working_times": [{"start_time": "09:00", "end_time": "18:00", "break_times": [{"start_time": "12:00", "end_time": "13:00"}]}], "work_hours": "08:00"}');
    assert.equal(hhmm.expected, 480);
    assert.equal(hhmm.match, true);
    assert.deepEqual(hhmm.warnings, []);
    const hours = checkShift('{"working_times": [{"start_time": "09:00", "end_time": "17:30"}], "total_hours": 8.5}');
    assert.equal(hours.expected, 510);
    assert.equal(hours.match, true);
    const outer = checkShift('{"total_time": 60, "shift": {"working_times": [{"start_time": "09:00", "end_time": "10:00"}]}}');
    assert.equal(outer.expected, 60);
    assert.equal(outer.match, true);
    const mixed = checkShift('{"working_times": [{"start_time": "09:00", "end_time": "10:00"}], "total_time": "01:00"}');
    assert.equal(mixed.expected, 60);
    assert.match(mixed.warnings[0], /時:分形式/);
  });

  test('同一物件撞到多個候選鍵：只取一個並警告', () => {
    const result = checkShift('{"working_times": [{"start_time": "09:00", "start": "08:00", "end_time": "10:00"}], "total_time": 60, "total_minutes": 999}');
    assert.equal(result.segments[0].start, '09:00');
    assert.equal(result.expected, 60);
    assert.match(result.warnings.join('\n'), /同時有 start_time、start（都像開始時間），採用 start_time/);
    assert.match(result.warnings.join('\n'), /同時有 total_time、total_minutes（都像總時間），採用 total_time/);
  });

  test('hrm 的 work_time 字串陣列不是時段，不會被誤認', () => {
    assert.throws(() => checkShift('{"work_time": ["09:00:00", "18:00:00"], "total_time": 480}'), /找不到工作時段/);
    // 同一物件裡字串陣列與真正的時段陣列並存時，取時段陣列
    const result = checkShift('{"work_time": ["09:00:00"], "working_times": [{"start_time": "09:00", "end_time": "10:00"}], "total_time": 60}');
    assert.equal(result.match, true);
    assert.equal(result.keys[0], 'working_times');
  });

  test('根本身就是單一時段物件', () => {
    const result = checkShift('{"start_time": "09:00", "end_time": "12:00", "break_times": [{"start_time": "10:00", "end_time": "10:15"}], "total_time": 165}');
    assert.equal(result.match, true);
    assert.deepEqual(result.keys, ['start_time', 'end_time', 'break_times', 'total_time']);
  });
});
