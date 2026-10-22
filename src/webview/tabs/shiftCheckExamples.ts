// 工時核對的範例：涵蓋別名鍵名、各種值格式、巢狀回應與片段，以及會產生警告或錯誤的資料，帶入後可直接核對。
// 每筆的 label 以結果開頭（一致／不一致／無總時間／警告／錯誤），使用者挑範例時就知道會看到什麼。
export interface ShiftCheckExample {
  id: string;
  label: string;
  text: string;
}

export const SHIFT_CHECK_EXAMPLES: readonly ShiftCheckExample[] = [
  {
    id: 'basic',
    label: '一致：單段扣休息',
    text: `{
  "working_times": [
    {
      "start_time": "09:00",
      "end_time": "15:00",
      "break_times": [{ "start_time": "10:00", "end_time": "11:30" }]
    }
  ],
  "total_time": 270
}`,
  },
  {
    id: 'mismatch',
    label: '不一致：總時間多 30 分',
    text: `{
  "working_times": [
    {
      "start_time": "09:00",
      "end_time": "15:00",
      "break_times": [{ "start_time": "10:00", "end_time": "11:30" }]
    }
  ],
  "total_time": 300
}`,
  },
  {
    id: 'api-response',
    label: '一致：整份 API 回應（巢狀）',
    text: `{
  "status": 200,
  "message": "ok",
  "data": {
    "items": [
      {
        "date": "2026-10-19",
        "working_times": [
          {
            "start_time": "09:00",
            "end_time": "18:00",
            "break_times": [{ "start_time": "12:00", "end_time": "13:00" }]
          }
        ],
        "total_time": 480
      }
    ]
  }
}`,
  },
  {
    id: 'fragment',
    label: '一致：沒有外層大括號的片段',
    text: `"working_times": [
  {
    "start_time": "09:00",
    "end_time": "18:00",
    "break_times": [{ "start_time": "12:00", "end_time": "13:00" }]
  }
],
"total_time": 480`,
  },
  {
    id: 'overnight',
    label: '一致：跨夜與午夜後的休息',
    text: `{
  "working_times": [
    {
      "start_time": "22:00",
      "end_time": "06:00",
      "break_times": [{ "start_time": "00:00", "end_time": "00:30" }]
    }
  ],
  "total_time": 450
}`,
  },
  {
    id: 'multi',
    label: '一致：多段，有的段沒休息',
    text: `{
  "shift_times": [
    { "start": "08:00", "end": "12:00" },
    {
      "start": "13:00",
      "end": "17:30",
      "breaks": [{ "start": "15:00", "end": "15:15" }]
    }
  ],
  "total_minutes": 495
}`,
  },
  {
    id: 'split-hm',
    label: '一致：時、分拆欄與 work_hours',
    text: `{
  "working_times": [
    {
      "hour_start": "09", "minute_start": "00",
      "hour_end": "18", "minute_end": "00",
      "break_times": [
        { "hour_start": "12", "minute_start": "00", "hour_end": "13", "minute_end": "00" }
      ]
    }
  ],
  "work_hours": "08:00"
}`,
  },
  {
    id: 'minutes',
    label: '一致：值是分鐘數',
    text: `{
  "work_time": [
    {
      "work_start": 540,
      "work_end": 1080,
      "break_times": [{ "start": 720, "end": 750 }]
    }
  ],
  "total_minutes": 510
}`,
  },
  {
    id: 'object-hm',
    label: '一致：{H, M} 物件、HH:mm:ss、camelCase',
    text: `{
  "shiftTimes": [
    {
      "start": { "H": 9, "M": 30 },
      "end": "18:30:00",
      "restTimes": [{ "startTime": "12:00:00", "endTime": "13:00:00" }]
    }
  ],
  "totalMinutes": 480
}`,
  },
  {
    id: 'datetime',
    label: '一致：含日期的 start_at／end_at',
    text: `{
  "work_time": [
    {
      "start_at": "2026-10-19 22:00:00",
      "end_at": "2026-10-20 06:00:00",
      "breaks": [{ "start_at": "2026-10-20 00:00:00", "end_at": "2026-10-20 00:30:00" }]
    }
  ],
  "minutes": 450
}`,
  },
  {
    id: 'no-total',
    label: '無總時間：只列計算結果',
    text: `{
  "working_times": [
    { "start_time": "09:00", "end_time": "12:00" },
    { "start_time": "13:00", "end_time": "18:00" }
  ]
}`,
  },
  {
    id: 'bad-breaks',
    label: '警告：休息超出時段、起訖相同、重疊',
    text: `{
  "working_times": [
    {
      "start_time": "09:00",
      "end_time": "18:00",
      "break_times": [
        { "start_time": "08:30", "end_time": "09:30" },
        { "start_time": "12:00", "end_time": "12:00" },
        { "start_time": "12:00", "end_time": "13:00" },
        { "start_time": "12:30", "end_time": "13:30" }
      ]
    }
  ],
  "total_time": 360
}`,
  },
  {
    id: 'duplicate-keys',
    label: '警告：同一物件有多個候選鍵',
    text: `{
  "working_times": [
    { "start_time": "09:00", "start": "08:00", "end_time": "10:00" }
  ],
  "total_time": 60,
  "total_minutes": 999
}`,
  },
  {
    id: 'string-total',
    label: '警告：總時間是字串',
    text: `{
  "working_times": [
    {
      "start_time": "09:00",
      "end_time": "18:00",
      "break_times": [{ "start_time": "12:00", "end_time": "13:00" }]
    }
  ],
  "total_time": "480"
}`,
  },
  {
    id: 'invalid-json',
    label: '錯誤：JSON 格式錯誤（缺逗號）',
    text: `{
  "working_times": [
    { "start_time": "09:00" "end_time": "18:00" }
  ],
  "total_time": 540
}`,
  },
  {
    id: 'no-periods',
    label: '錯誤：找不到工作時段（字串陣列）',
    text: `{
  "work_time": ["09:00:00", "18:00:00"],
  "total_time": 480
}`,
  },
];
