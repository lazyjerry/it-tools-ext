// RFC 4180 CSV ↔ JSON。第一列當欄位名；分隔符號未指定時從第一列猜（逗號、Tab、分號）。
import type { JsonNode } from '../json/ast';

export function detectDelimiter(text: string): string {
  const firstLine = text.split(/\r?\n/, 1)[0] ?? '';
  const candidates = [',', '\t', ';'];
  return candidates.reduce((best, d) => (firstLine.split(d).length > firstLine.split(best).length ? d : best), ',');
}

export function parseCsv(text: string, delimiter = detectDelimiter(text)): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  let i = 0;
  const input = text.replace(/^\uFEFF/, '');
  while (i < input.length) {
    const c = input[i];
    if (quoted) {
      if (c === '"') {
        if (input[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        quoted = false;
        i += 1;
        continue;
      }
      field += c;
      i += 1;
      continue;
    }
    if (c === '"' && field === '') {
      quoted = true;
    } else if (c === delimiter) {
      row.push(field);
      field = '';
    } else if (c === '\n' || c === '\r') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
      if (c === '\r' && input[i + 1] === '\n') {
        i += 1;
      }
    } else {
      field += c;
    }
    i += 1;
  }
  if (quoted) {
    throw new Error('CSV 有未閉合的雙引號');
  }
  if (field !== '' || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

export function csvToJson(text: string, delimiter?: string): JsonNode {
  const [header, ...rows] = parseCsv(text, delimiter);
  if (!header) {
    return { type: 'array', start: 0, items: [] };
  }
  return {
    type: 'array',
    start: 0,
    items: rows.map((row) => ({
      type: 'object',
      start: 0,
      entries: header.map((key, i) => ({ key, keyStart: 0, value: { type: 'string', start: 0, value: row[i] ?? '' } })),
    })),
  };
}

function cell(node: JsonNode | undefined, delimiter: string): string {
  let text: string;
  if (!node || node.type === 'null') {
    text = '';
  } else if (node.type === 'string') {
    text = node.value;
  } else if (node.type === 'number') {
    text = node.raw;
  } else if (node.type === 'boolean') {
    text = String(node.value);
  } else {
    throw new Error('CSV 儲存格不能放巢狀物件或陣列，請先攤平');
  }
  return /["\r\n]/.test(text) || text.includes(delimiter) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** 陣列裡的物件 → CSV；欄位取所有物件 key 的聯集，依首次出現順序。 */
export function jsonToCsv(node: JsonNode, delimiter = ','): string {
  if (node.type !== 'array') {
    throw new Error('JSON 根節點必須是物件陣列');
  }
  const columns: string[] = [];
  for (const item of node.items) {
    if (item.type !== 'object') {
      throw new Error('陣列元素必須都是物件');
    }
    for (const e of item.entries) {
      if (!columns.includes(e.key)) {
        columns.push(e.key);
      }
    }
  }
  const lines = [columns.map((c) => cell({ type: 'string', start: 0, value: c }, delimiter)).join(delimiter)];
  for (const item of node.items) {
    if (item.type === 'object') {
      lines.push(columns.map((c) => cell(item.entries.find((e) => e.key === c)?.value, delimiter)).join(delimiter));
    }
  }
  return lines.join('\n') + '\n';
}
