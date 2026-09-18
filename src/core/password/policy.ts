// 密碼規則檢查與產生。產生器用同一份規則檢查自己的輸出，不合規就重抽，保證交出去的一定通過。
import { randomInt } from 'node:crypto';

import { COMMON_PASSWORDS } from './common';

export interface PasswordPolicy {
  minLength: number;
  requireUppercase: boolean;
  requireLowercase: boolean;
  requireDigit: boolean;
  requireSymbol: boolean;
  symbolSet: string;
  forbidSequential: boolean;
  forbidRepeated: boolean;
  forbidKeyboard: boolean;
  forbidCommon: boolean;
}

export const DEFAULT_POLICY: PasswordPolicy = {
  minLength: 8,
  requireUppercase: true,
  requireLowercase: true,
  requireDigit: true,
  requireSymbol: true,
  symbolSet: '!@#$%^&*()-_=+[]{};:,.<>?',
  forbidSequential: true,
  forbidRepeated: true,
  forbidKeyboard: true,
  forbidCommon: true,
};

/** 設定 itTools.password.minLength 與面板的範圍一致；超出就夾到邊界。 */
export const MIN_LENGTH_RANGE = { min: 1, max: 256 } as const;

/** 對應 package.json itTools.password.generateLength 的 minimum／maximum／default；數量上限與面板一致。 */
export const GENERATE_LENGTH_RANGE = { min: 4, max: 256, fallback: 16 } as const;
export const GENERATE_COUNT_RANGE = { min: 1, max: 50, fallback: 1 } as const;

/** 非整數（例如工作區 settings.json 填成字串）一律用預設值：這個值會原樣寫進產出的程式碼。 */
export function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  return typeof value === 'number' && Number.isInteger(value) ? Math.min(Math.max(value, min), max) : fallback;
}

export function safeMinLength(value: unknown): number {
  return clampInt(value, MIN_LENGTH_RANGE.min, MIN_LENGTH_RANGE.max, DEFAULT_POLICY.minLength);
}

export interface RuleResult {
  id: string;
  label: string;
  passed: boolean;
  detail?: string;
}

export interface PasswordCheck {
  passed: boolean;
  rules: RuleResult[];
  entropyBits: number;
  strength: string;
}

const KEYBOARD_ROWS = ['1234567890', 'qwertyuiop', 'asdfghjkl', 'zxcvbnm'];

function findSequential(pw: string, run = 3): string | undefined {
  const lower = pw.toLowerCase();
  for (let i = 0; i + run <= lower.length; i += 1) {
    const chunk = lower.slice(i, i + run);
    if (!/^[a-z0-9]+$/.test(chunk)) {
      continue;
    }
    const codes = [...chunk].map((c) => c.charCodeAt(0));
    const step = codes[1] - codes[0];
    if ((step === 1 || step === -1) && codes.every((c, j) => j === 0 || c - codes[j - 1] === step)) {
      return pw.slice(i, i + run);
    }
  }
  return undefined;
}

function findRepeated(pw: string, run = 3): string | undefined {
  return new RegExp(`(.)\\1{${run - 1},}`, 'u').exec(pw)?.[0];
}

function findKeyboard(pw: string, run = 4): string | undefined {
  const lower = pw.toLowerCase();
  for (const row of KEYBOARD_ROWS) {
    const reversed = [...row].reverse().join('');
    for (const line of [row, reversed]) {
      for (let i = 0; i + run <= line.length; i += 1) {
        const index = lower.indexOf(line.slice(i, i + run));
        if (index !== -1) {
          return pw.slice(index, index + run);
        }
      }
    }
  }
  return undefined;
}

export function charsetSize(pw: string, symbolSet: string): number {
  let size = 0;
  if (/[a-z]/.test(pw)) {
    size += 26;
  }
  if (/[A-Z]/.test(pw)) {
    size += 26;
  }
  if (/\d/.test(pw)) {
    size += 10;
  }
  if ([...pw].some((c) => symbolSet.includes(c))) {
    size += symbolSet.length;
  }
  if ([...pw].some((c) => !/[A-Za-z0-9]/.test(c) && !symbolSet.includes(c))) {
    size += 32;
  }
  return size;
}

export function checkPassword(pw: string, policy: PasswordPolicy): PasswordCheck {
  const chars = [...pw];
  const rules: RuleResult[] = [];
  const add = (id: string, label: string, passed: boolean, detail?: string) => rules.push({ id, label, passed, detail });

  add('length', `至少 ${policy.minLength} 個字元`, chars.length >= policy.minLength, `目前 ${chars.length} 個`);
  if (policy.requireUppercase) {
    add('upper', '包含大寫英文', /[A-Z]/.test(pw));
  }
  if (policy.requireLowercase) {
    add('lower', '包含小寫英文', /[a-z]/.test(pw));
  }
  if (policy.requireDigit) {
    add('digit', '包含數字', /\d/.test(pw));
  }
  if (policy.requireSymbol) {
    const others = chars.filter((c) => !/[A-Za-z0-9]/.test(c) && !policy.symbolSet.includes(c));
    add(
      'symbol',
      '包含特殊符號',
      chars.some((c) => policy.symbolSet.includes(c)),
      others.length ? `「${[...new Set(others)].join('')}」不在設定的符號集內，不算數` : `符號集：${policy.symbolSet}`,
    );
  }
  if (policy.forbidSequential) {
    const hit = findSequential(pw);
    add('sequential', '不含 3 個以上連續字元（abc、321）', !hit, hit && `命中「${hit}」`);
  }
  if (policy.forbidRepeated) {
    const hit = findRepeated(pw);
    add('repeated', '不含同一字元連續 3 次以上', !hit, hit && `命中「${hit}」`);
  }
  if (policy.forbidKeyboard) {
    const hit = findKeyboard(pw);
    add('keyboard', '不含 4 碼以上鍵盤序列（qwer、asdf）', !hit, hit && `命中「${hit}」`);
  }
  if (policy.forbidCommon) {
    add('common', '不在常見弱密碼清單（Top 1000，離線比對）', !COMMON_PASSWORDS.has(pw.toLowerCase()));
  }

  const entropyBits = chars.length * Math.log2(Math.max(charsetSize(pw, policy.symbolSet), 1));
  const strength = entropyBits < 28 ? '很弱' : entropyBits < 36 ? '弱' : entropyBits < 60 ? '中' : entropyBits < 128 ? '強' : '很強';
  return { passed: rules.every((r) => r.passed), rules, entropyBits, strength };
}

export function formatCheck(check: PasswordCheck): string {
  return [
    `# 密碼檢查：${check.passed ? '✓ 全部通過' : '✗ 未通過'}`,
    '',
    ...check.rules.map((r) => `${r.passed ? '✓' : '✗'} ${r.label}${r.detail ? `（${r.detail}）` : ''}`),
    '',
    `熵值估算：${check.entropyBits.toFixed(1)} bits（${check.strength}）`,
    '以字元集大小 × 長度估算，不做 zxcvbn 那種樣式分析；有規律的密碼實際強度會更低。',
  ].join('\n') + '\n';
}

// ── 產生 ──

const LOWER = 'abcdefghijklmnopqrstuvwxyz';
const UPPER = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const DIGITS = '0123456789';
const AMBIGUOUS = /[0O1lI]/g;

export function generatePassword(policy: PasswordPolicy, length: number, excludeAmbiguous = false): string {
  const clean = (set: string) => (excludeAmbiguous ? set.replace(AMBIGUOUS, '') : set);
  const pools = [
    { set: clean(LOWER), required: policy.requireLowercase, include: true },
    { set: clean(UPPER), required: policy.requireUppercase, include: true },
    { set: clean(DIGITS), required: policy.requireDigit, include: true },
    { set: clean(policy.symbolSet), required: policy.requireSymbol, include: policy.requireSymbol },
  ].filter((p) => p.include && p.set.length > 0);
  const required = pools.filter((p) => p.required);
  const target = Math.max(length, policy.minLength, required.length);
  const all = pools.map((p) => p.set).join('');
  if (all === '') {
    throw new Error('可用字元集為空，請檢查符號集設定');
  }

  for (let attempt = 0; attempt < 200; attempt += 1) {
    const chars = required.map((p) => p.set[randomInt(p.set.length)]);
    while (chars.length < target) {
      chars.push(all[randomInt(all.length)]);
    }
    for (let i = chars.length - 1; i > 0; i -= 1) {
      const j = randomInt(i + 1);
      [chars[i], chars[j]] = [chars[j], chars[i]];
    }
    const candidate = chars.join('');
    if (checkPassword(candidate, policy).passed) {
      return candidate;
    }
  }
  throw new Error('連續 200 次都產生不出合規密碼，規則可能互相衝突（例如長度太短又禁止連續字元）');
}

/** 依目前規則產生 Laravel Password rule；Laravel 沒有的規則改用 not_regex 或註明需自訂。 */
export function laravelRule(policy: PasswordPolicy): string {
  let chain = `Password::min(${safeMinLength(policy.minLength)})`;
  const notes: string[] = [];
  const extra: string[] = [];
  if (policy.requireUppercase && policy.requireLowercase) {
    chain += '->mixedCase()';
  } else if (policy.requireUppercase || policy.requireLowercase) {
    chain += '->letters()';
    extra.push(`'regex:/[${policy.requireUppercase ? 'A-Z' : 'a-z'}]/'`);
    notes.push(`Laravel 沒有只要求${policy.requireUppercase ? '大' : '小'}寫的規則，以 regex 補上`);
  }
  if (policy.requireDigit) {
    chain += '->numbers()';
  }
  if (policy.requireSymbol) {
    chain += '->symbols()';
    notes.push('Laravel symbols() 接受任何 Unicode 標點與符號，比這裡設定的符號集寬');
  }
  const rules = [`'required'`, `'string'`, chain, ...extra];
  if (policy.forbidRepeated) {
    rules.push(`'not_regex:/(.)\\1{2,}/'`);
  }
  if (policy.forbidSequential || policy.forbidKeyboard) {
    notes.push('連續字元與鍵盤序列 Laravel 沒有內建規則，需自訂 Rule 類別');
  }
  if (policy.forbidCommon) {
    notes.push('->uncompromised() 會連線查 Have I Been Pwned，與這裡的離線 Top 1000 比對不同');
  }
  return [
    'use Illuminate\\Validation\\Rules\\Password;',
    '',
    `'password' => [${rules.join(', ')}],`,
    ...notes.map((n) => `// ${n}`),
  ].join('\n') + '\n';
}
