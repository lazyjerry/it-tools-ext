// ID／token 產生與時間戳轉換。亂數一律走 crypto，不用 Math.random。
import { randomBytes, randomInt, randomUUID } from 'node:crypto';

import { relativeTime } from '../encode/jwt';

export function uuidV4(): string {
  return randomUUID();
}

/** RFC 9562 UUIDv7：前 48 位元是毫秒時間戳，可依時間排序。 */
export function uuidV7(nowMs = Date.now()): string {
  const bytes = randomBytes(16);
  const ts = BigInt(nowMs);
  for (let i = 0; i < 6; i += 1) {
    bytes[i] = Number((ts >> BigInt(8 * (5 - i))) & 0xffn);
  }
  bytes[6] = (bytes[6] & 0x0f) | 0x70;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/** ULID：10 字元時間 + 16 字元亂數，Crockford base32。 */
export function ulid(nowMs = Date.now()): string {
  let time = '';
  let t = nowMs;
  for (let i = 0; i < 10; i += 1) {
    time = CROCKFORD[t % 32] + time;
    t = Math.floor(t / 32);
  }
  let random = '';
  for (let i = 0; i < 16; i += 1) {
    random += CROCKFORD[randomInt(32)];
  }
  return time + random;
}

const NANOID_ALPHABET = 'useandom-26T198340PX75pxJACKVERYMINDBUSHWOLF_GQZbfghjklqvwyzrict';

export function nanoid(size = 21): string {
  let id = '';
  for (let i = 0; i < size; i += 1) {
    id += NANOID_ALPHABET[randomInt(64)];
  }
  return id;
}

export function randomToken(bytes = 32, encoding: 'hex' | 'base64url' = 'hex'): string {
  return randomBytes(bytes).toString(encoding);
}

export function generateReport(count = 5): string {
  const block = (title: string, make: () => string) => [`## ${title}`, ...Array.from({ length: count }, make), ''];
  return [
    '# 產生器',
    '',
    ...block('UUID v4', uuidV4),
    ...block('UUID v7（時間排序）', () => uuidV7()),
    ...block('ULID', () => ulid()),
    ...block('NanoID', () => nanoid()),
    ...block('Token（32 位元組 hex）', () => randomToken(32, 'hex')),
    ...block('Token（32 位元組 base64url）', () => randomToken(32, 'base64url')),
  ].join('\n');
}

// ── 時間戳 ──

const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六'];

function pad(n: number, width = 2): string {
  return String(n).padStart(width, '0');
}

function localIso(date: Date): string {
  const offset = -date.getTimezoneOffset();
  const sign = offset >= 0 ? '+' : '-';
  const abs = Math.abs(offset);
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ` +
    `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())} ` +
    `(UTC${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)})`
  );
}

/** 純數字依位數判斷單位：≥ 16 位是微秒、≥ 13 位是毫秒，其餘是秒；空白代表現在。 */
export function parseTimestamp(input: string, nowMs = Date.now()): { date: Date; unit: string } {
  const text = input.trim();
  if (text === '') {
    return { date: new Date(nowMs), unit: '現在' };
  }
  if (/^-?\d+(\.\d+)?$/.test(text)) {
    const digits = text.replace(/^-/, '').split('.')[0].length;
    const value = Number(text);
    if (digits >= 16) {
      return { date: new Date(value / 1000), unit: '微秒' };
    }
    if (digits >= 13) {
      return { date: new Date(value), unit: '毫秒' };
    }
    return { date: new Date(value * 1000), unit: '秒' };
  }
  const parsed = Date.parse(text.replace(/^(\d{4}-\d{2}-\d{2}) (\d)/, '$1T$2'));
  if (Number.isNaN(parsed)) {
    throw new Error('無法辨識的時間格式：請輸入 Unix 時間戳或 ISO 8601 日期');
  }
  return { date: new Date(parsed), unit: '日期字串' };
}

export function timestampReport(input: string, nowMs = Date.now()): string {
  const { date, unit } = parseTimestamp(input, nowMs);
  const ms = date.getTime();
  if (Number.isNaN(ms)) {
    throw new Error('超出可表示的時間範圍');
  }
  return [
    '# 時間戳轉換',
    `輸入判定：${unit}`,
    '',
    `Unix 秒      ${Math.floor(ms / 1000)}`,
    `Unix 毫秒    ${ms}`,
    `ISO 8601 UTC ${date.toISOString()}`,
    `本地時間     ${localIso(date)} 星期${WEEKDAYS[date.getDay()]}`,
    `RFC 2822     ${date.toUTCString()}`,
    `相對現在     ${relativeTime(Math.floor(ms / 1000), Math.floor(nowMs / 1000))}`,
    '',
    `PHP  date('Y-m-d H:i:s', ${Math.floor(ms / 1000)})`,
    `Java Instant.ofEpochMilli(${ms}L)`,
  ].join('\n') + '\n';
}
