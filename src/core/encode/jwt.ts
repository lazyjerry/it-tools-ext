// JWT 解碼。只驗 HS256/384/512（共用密鑰）；RS／ES 需要公鑰與 PEM 解析，不在範圍內。
import { createHmac, timingSafeEqual } from 'node:crypto';

import { parseJson, stringifyNode } from '../json/ast';
import type { JsonNode } from '../json/ast';

export interface JwtInfo {
  header: JsonNode;
  payload: JsonNode;
  signature: string;
  claims: { name: string; value: number; iso: string; relative: string }[];
  expired: boolean | null;
  notYetValid: boolean | null;
  verified: boolean | null;
  notes: string[];
}

const HMAC_ALGS: Record<string, string> = { HS256: 'sha256', HS384: 'sha384', HS512: 'sha512' };

function decodeSegment(segment: string, what: string): JsonNode {
  if (!/^[A-Za-z0-9_-]*$/.test(segment)) {
    throw new Error(`${what}不是 base64url`);
  }
  try {
    return parseJson(Buffer.from(segment, 'base64url').toString('utf8'));
  } catch (error) {
    throw new Error(`${what}解開後不是 JSON：${error instanceof Error ? error.message : String(error)}`);
  }
}

// Buffer.from 解 base64url 會略過非法字元、接受 = 與非正規末字元，不先擋就會讓變造過的簽章也驗證通過
function isCanonicalBase64url(segment: string): boolean {
  return /^[A-Za-z0-9_-]*$/.test(segment) && Buffer.from(segment, 'base64url').toString('base64url') === segment;
}

function isoTime(seconds: number): string {
  try {
    return new Date(seconds * 1000).toISOString();
  } catch {
    return '無效時間';
  }
}

export function relativeTime(seconds: number, nowSeconds: number): string {
  const diff = seconds - nowSeconds;
  const abs = Math.abs(diff);
  const units: [number, string][] = [
    [86400, '天'],
    [3600, '小時'],
    [60, '分鐘'],
    [1, '秒'],
  ];
  const [size, unit] = units.find(([s]) => abs >= s) ?? [1, '秒'];
  const amount = Math.floor(abs / size);
  return diff >= 0 ? `${amount} ${unit}後` : `${amount} ${unit}前`;
}

export function decodeJwt(token: string, secret?: string, nowMs = Date.now()): JwtInfo {
  const parts = token.trim().replace(/^Bearer\s+/i, '').split('.');
  if (parts.length !== 3) {
    throw new Error(`JWT 應為三段（header.payload.signature），實際 ${parts.length} 段`);
  }
  const [h, p, s] = parts;
  const header = decodeSegment(h, 'header ');
  const payload = decodeSegment(p, 'payload ');
  const now = Math.floor(nowMs / 1000);
  const notes: string[] = [];

  const claims: JwtInfo['claims'] = [];
  let expired: boolean | null = null;
  let notYetValid: boolean | null = null;
  if (payload.type === 'object') {
    for (const entry of payload.entries) {
      if (['exp', 'iat', 'nbf', 'auth_time'].includes(entry.key) && entry.value.type === 'number') {
        const value = Number(entry.value.raw);
        claims.push({ name: entry.key, value, iso: isoTime(value), relative: relativeTime(value, now) });
        if (entry.key === 'exp') {
          expired = value <= now;
        }
        if (entry.key === 'nbf') {
          notYetValid = value > now;
        }
      }
    }
  }

  const alg = header.type === 'object' ? header.entries.find((e) => e.key === 'alg')?.value : undefined;
  const algName = alg?.type === 'string' ? alg.value : '';
  let verified: boolean | null = null;
  if (algName === 'none') {
    notes.push('alg 為 none：沒有簽章，任何人都能偽造，伺服器不應接受');
  }
  const canonicalSignature = isCanonicalBase64url(s);
  if (!canonicalSignature) {
    notes.push('signature 不是正規的 base64url（含非法字元、= 補位或非正規結尾）');
  }
  if (secret !== undefined && secret !== '') {
    const hash = HMAC_ALGS[algName];
    if (!hash) {
      notes.push(`alg ${algName || '（未指定）'} 不是 HS256/384/512，無法用共用密鑰驗證`);
    } else if (!canonicalSignature) {
      verified = false;
    } else {
      const expected = createHmac(hash, secret).update(`${h}.${p}`).digest();
      const actual = Buffer.from(s, 'base64url');
      verified = expected.length === actual.length && timingSafeEqual(expected, actual);
    }
  }
  return { header, payload, signature: s, claims, expired, notYetValid, verified, notes };
}

export function formatJwt(info: JwtInfo): string {
  const lines = [
    '# JWT',
    '',
    '## Header',
    stringifyNode(info.header, { indent: '  ' }),
    '',
    '## Payload',
    stringifyNode(info.payload, { indent: '  ' }),
    '',
    '## 時間欄位',
    ...(info.claims.length ? info.claims.map((c) => `${c.name.padEnd(10)}${c.value}  ${c.iso}  （${c.relative}）`) : ['（無）']),
    '',
    `過期：${info.expired === null ? '沒有 exp' : info.expired ? '⚠ 已過期' : '未過期'}`,
    `生效：${info.notYetValid === null ? '沒有 nbf' : info.notYetValid ? '⚠ 尚未生效' : '已生效'}`,
    `簽章：${info.verified === null ? '未驗證（沒有提供密鑰）' : info.verified ? '✓ 驗證通過' : '✗ 驗證失敗'}`,
    ...info.notes.map((n) => `⚠ ${n}`),
  ];
  return lines.join('\n') + '\n';
}
