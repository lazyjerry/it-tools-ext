// Base64、URL、HTML 編碼。URL 與 HTML 以 PHP 函式的行為為準，因為 JS 內建函式的保留字元集合不同。
import { HTML401_ENTITIES } from './htmlEntities';

const strictUtf8 = new TextDecoder('utf-8', { fatal: true });

function bytesToText(bytes: Uint8Array, what: string): string {
  try {
    return strictUtf8.decode(bytes);
  } catch {
    throw new Error(`${what}解出的位元組不是合法 UTF-8（可能是二進位資料或其他編碼）：${Buffer.from(bytes).toString('hex').slice(0, 64)}…`);
  }
}

export function base64Encode(text: string, urlSafe = false): string {
  return Buffer.from(text, 'utf8').toString(urlSafe ? 'base64url' : 'base64');
}

export function base64Decode(input: string): string {
  const compact = input.replace(/\s/g, '');
  if (!/^[A-Za-z0-9+/_-]*={0,2}$/.test(compact)) {
    throw new Error('Base64 含非法字元');
  }
  const urlSafe = /[-_]/.test(compact);
  return bytesToText(new Uint8Array(Buffer.from(compact, urlSafe ? 'base64url' : 'base64')), 'Base64 ');
}

function percentEncode(text: string, keep: RegExp, spaceAsPlus: boolean): string {
  let out = '';
  for (const byte of Buffer.from(text, 'utf8')) {
    const char = String.fromCharCode(byte);
    if (byte < 0x80 && keep.test(char)) {
      out += char;
    } else if (spaceAsPlus && byte === 0x20) {
      out += '+';
    } else {
      out += `%${byte.toString(16).toUpperCase().padStart(2, '0')}`;
    }
  }
  return out;
}

/** PHP urlencode()：空白轉 +，只保留英數與 -_.（application/x-www-form-urlencoded）。 */
export function phpUrlencode(text: string): string {
  return percentEncode(text, /[A-Za-z0-9\-_.]/, true);
}

/** PHP rawurlencode()：RFC 3986，空白轉 %20，保留英數與 -_.~。 */
export function phpRawurlencode(text: string): string {
  return percentEncode(text, /[A-Za-z0-9\-_.~]/, false);
}

function percentDecode(text: string, plusAsSpace: boolean): string {
  const bytes: number[] = [];
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i];
    if (c === '%' && /^[0-9a-fA-F]{2}$/.test(text.slice(i + 1, i + 3))) {
      bytes.push(parseInt(text.slice(i + 1, i + 3), 16));
      i += 2;
    } else if (plusAsSpace && c === '+') {
      bytes.push(0x20);
    } else {
      bytes.push(...Buffer.from(c, 'utf8'));
    }
  }
  return bytesToText(new Uint8Array(bytes), 'URL 解碼');
}

export function phpUrldecode(text: string): string {
  return percentDecode(text, true);
}

export function phpRawurldecode(text: string): string {
  return percentDecode(text, false);
}

const SPECIAL: Record<string, string> = { '&': '&amp;', '"': '&quot;', "'": '&#039;', '<': '&lt;', '>': '&gt;' };

/** PHP 8.1+ htmlspecialchars() 預設 flags（ENT_QUOTES | ENT_SUBSTITUTE | ENT_HTML401）。 */
export function phpHtmlspecialchars(text: string): string {
  return text.replace(/[&"'<>]/g, (c) => SPECIAL[c]);
}

/** PHP htmlentities()：凡 HTML 4.01 有命名實體的字元都轉換。 */
export function phpHtmlentities(text: string): string {
  let out = '';
  for (const char of text) {
    out += HTML401_ENTITIES[char.codePointAt(0) ?? 0] ?? char;
  }
  return out;
}

let reverseEntities: Map<string, string> | undefined;

/** PHP html_entity_decode()：命名實體（HTML 4.01）與十進位／十六進位數字實體。 */
export function phpHtmlEntityDecode(text: string): string {
  if (!reverseEntities) {
    reverseEntities = new Map(Object.entries(HTML401_ENTITIES).map(([cp, entity]) => [entity, String.fromCodePoint(Number(cp))]));
  }
  const table = reverseEntities;
  return text.replace(/&(#\d+|#[xX][0-9a-fA-F]+|[A-Za-z][A-Za-z0-9]*);/g, (entity, body: string) => {
    if (body.startsWith('#')) {
      const cp = body[1] === 'x' || body[1] === 'X' ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      return cp > 0 && cp <= 0x10ffff && !(cp >= 0xd800 && cp <= 0xdfff) ? String.fromCodePoint(cp) : entity;
    }
    return table.get(entity) ?? entity;
  });
}
