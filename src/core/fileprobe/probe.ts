// 檔案內容探測：BOM、編碼、行尾、縮排。BOM 與 UTF-8 合法性是確定判斷；舊式中文編碼只能試解後推測。

export type BomKind = 'UTF-8' | 'UTF-16LE' | 'UTF-16BE' | 'UTF-32LE' | 'UTF-32BE';

export interface ContentProbe {
  bom: { kind: BomKind; bytes: number } | null;
  encoding: string;
  /** false 代表是推測，不是確定判斷。 */
  encodingCertain: boolean;
  encodingNote?: string;
  isAscii: boolean;
  validUtf8: boolean;
  hasNul: boolean;
  lines: number;
  eol: 'LF' | 'CRLF' | 'CR' | '混合' | '無';
  eolCounts: { lf: number; crlf: number; cr: number };
  endsWithNewline: boolean;
  indent: '空白' | 'Tab' | '混合' | '無';
  indentCounts: { spaces: number; tabs: number };
  longestLine: { length: number; line: number };
  analyzedBytes: number;
}

const BOMS: { kind: BomKind; bytes: number[] }[] = [
  // UTF-32LE 的 BOM 以 FF FE 開頭，必須排在 UTF-16LE 之前比對
  { kind: 'UTF-32LE', bytes: [0xff, 0xfe, 0x00, 0x00] },
  { kind: 'UTF-32BE', bytes: [0x00, 0x00, 0xfe, 0xff] },
  { kind: 'UTF-8', bytes: [0xef, 0xbb, 0xbf] },
  { kind: 'UTF-16LE', bytes: [0xff, 0xfe] },
  { kind: 'UTF-16BE', bytes: [0xfe, 0xff] },
];

export function detectBom(data: Uint8Array): { kind: BomKind; bytes: number } | null {
  for (const bom of BOMS) {
    if (bom.bytes.every((b, i) => data[i] === b)) {
      return { kind: bom.kind, bytes: bom.bytes.length };
    }
  }
  return null;
}

function tryDecode(label: string, data: Uint8Array): string | undefined {
  try {
    return new TextDecoder(label, { fatal: true }).decode(data);
  } catch {
    return undefined;
  }
}

/** 試解後依「常用漢字 + 可列印 ASCII」比例評分；同一串位元組常能被多種編碼解開，所以只是推測。 */
function guessLegacy(data: Uint8Array): { name: string; text: string; note: string } | undefined {
  const candidates = [
    { label: 'big5', name: 'Big5（繁中）' },
    { label: 'gbk', name: 'GBK（簡中）' },
    { label: 'shift_jis', name: 'Shift_JIS（日文）' },
  ];
  const scored = candidates
    .map((c) => {
      const text = tryDecode(c.label, data);
      if (text === undefined) {
        return undefined;
      }
      const chars = [...text];
      // eslint-disable-next-line no-control-regex -- Tab／換行也算可列印的正常字元
      const good = chars.filter((ch) => /[\x09\x0a\x0d\x20-\x7e]|[\u4e00-\u9fff\u3000-\u303f\uff00-\uffef]/.test(ch)).length;
      return { ...c, text, score: chars.length ? good / chars.length : 0 };
    })
    .filter((c): c is NonNullable<typeof c> => c !== undefined)
    .sort((a, b) => b.score - a.score);
  if (scored.length === 0) {
    return undefined;
  }
  const others = scored.slice(1).map((s) => s.name).join('、');
  return {
    name: scored[0].name,
    text: scored[0].text,
    note: `不是合法 UTF-8；以 ${scored[0].name} 試解最合理（${(scored[0].score * 100).toFixed(0)}% 常見字元）${others ? `，${others} 也能解開` : ''}`,
  };
}

function decodeWithBom(kind: BomKind, body: Uint8Array): string {
  if (kind === 'UTF-32LE' || kind === 'UTF-32BE') {
    const view = new DataView(body.buffer, body.byteOffset, body.byteLength);
    let out = '';
    for (let i = 0; i + 4 <= body.length; i += 4) {
      const cp = view.getUint32(i, kind === 'UTF-32LE');
      out += cp <= 0x10ffff ? String.fromCodePoint(cp) : '\ufffd';
    }
    return out;
  }
  return new TextDecoder(kind === 'UTF-8' ? 'utf-8' : kind.toLowerCase()).decode(body);
}

export function probeContent(data: Uint8Array): ContentProbe {
  const bom = detectBom(data);
  const hasNul = data.includes(0);
  const isAscii = data.every((b) => b < 0x80);
  const body = bom ? data.subarray(bom.bytes) : data;

  let encoding: string;
  let encodingCertain = true;
  let encodingNote: string | undefined;
  let text: string;
  const utf8 = tryDecode('utf-8', data);
  const validUtf8 = utf8 !== undefined;

  if (bom) {
    encoding = `${bom.kind}（含 BOM）`;
    text = decodeWithBom(bom.kind, body);
  } else if (isAscii && !hasNul) {
    encoding = 'ASCII（亦為合法 UTF-8）';
    text = utf8 ?? '';
  } else if (validUtf8 && !hasNul) {
    encoding = 'UTF-8（無 BOM）';
    text = utf8 ?? '';
  } else if (hasNul) {
    encoding = '二進位或無 BOM 的 UTF-16/32';
    encodingCertain = false;
    encodingNote = '內容含 NUL 位元組，文字統計僅供參考';
    text = new TextDecoder('utf-8').decode(data);
  } else {
    const legacy = guessLegacy(data);
    encodingCertain = false;
    if (legacy) {
      encoding = legacy.name;
      encodingNote = legacy.note;
      text = legacy.text;
    } else {
      encoding = '無法辨識';
      encodingNote = '不是 UTF-8，也無法以 Big5／GBK／Shift_JIS 完整解開';
      text = new TextDecoder('utf-8').decode(data);
    }
  }

  let lf = 0;
  let crlf = 0;
  let cr = 0;
  for (let i = 0; i < text.length; i += 1) {
    const c = text.charCodeAt(i);
    if (c === 13) {
      if (text.charCodeAt(i + 1) === 10) {
        crlf += 1;
        i += 1;
      } else {
        cr += 1;
      }
    } else if (c === 10) {
      lf += 1;
    }
  }
  const kinds = [lf && 'LF', crlf && 'CRLF', cr && 'CR'].filter(Boolean) as ('LF' | 'CRLF' | 'CR')[];
  const eol = kinds.length === 0 ? '無' : kinds.length > 1 ? '混合' : kinds[0];

  const lines = text === '' ? [] : text.split(/\r\n|\r|\n/);
  const endsWithNewline = /(\r\n|\r|\n)$/.test(text);
  if (endsWithNewline) {
    lines.pop();
  }
  let spaces = 0;
  let tabs = 0;
  let longest = { length: 0, line: 0 };
  lines.forEach((line, index) => {
    if (line.startsWith('\t')) {
      tabs += 1;
    } else if (line.startsWith(' ')) {
      spaces += 1;
    }
    const length = [...line].length;
    if (length > longest.length) {
      longest = { length, line: index + 1 };
    }
  });
  const indent = spaces && tabs ? '混合' : spaces ? '空白' : tabs ? 'Tab' : '無';

  return {
    bom,
    encoding,
    encodingCertain,
    encodingNote,
    isAscii,
    validUtf8,
    hasNul,
    lines: lines.length,
    eol,
    eolCounts: { lf, crlf, cr },
    endsWithNewline,
    indent,
    indentCounts: { spaces, tabs },
    longestLine: longest,
    analyzedBytes: data.length,
  };
}

export function formatMode(mode: number): string {
  const perms = ['r', 'w', 'x'];
  let out = '';
  for (let shift = 6; shift >= 0; shift -= 3) {
    const bits = (mode >> shift) & 7;
    out += perms.map((p, i) => (bits & (4 >> i) ? p : '-')).join('');
  }
  return `${out}（${(mode & 0o777).toString(8).padStart(3, '0')}）`;
}

export function humanSize(bytes: number): string {
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return unit === 0 ? `${bytes} B` : `${value.toFixed(value < 10 ? 2 : 1)} ${units[unit]}（${bytes.toLocaleString('en-US')} B）`;
}
