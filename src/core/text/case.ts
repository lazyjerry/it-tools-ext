// 命名風格轉換。拆詞規則：分隔符號、小寫接大寫、連續大寫接大小寫（HTTPServer → HTTP Server）、字母數字交界不拆。

export function splitWords(input: string): string[] {
  return input
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);
}

const cap = (word: string) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();

export const CASES = {
  camel: (words: string[]) => words.map((w, i) => (i === 0 ? w.toLowerCase() : cap(w))).join(''),
  pascal: (words: string[]) => words.map(cap).join(''),
  snake: (words: string[]) => words.map((w) => w.toLowerCase()).join('_'),
  screamingSnake: (words: string[]) => words.map((w) => w.toUpperCase()).join('_'),
  kebab: (words: string[]) => words.map((w) => w.toLowerCase()).join('-'),
  dot: (words: string[]) => words.map((w) => w.toLowerCase()).join('.'),
  title: (words: string[]) => words.map(cap).join(' '),
  lower: (words: string[]) => words.map((w) => w.toLowerCase()).join(' '),
  upper: (words: string[]) => words.map((w) => w.toUpperCase()).join(' '),
} as const;

export type CaseStyle = keyof typeof CASES;

export const CASE_LABELS: Record<CaseStyle, string> = {
  camel: 'camelCase',
  pascal: 'PascalCase',
  snake: 'snake_case',
  screamingSnake: 'SCREAMING_SNAKE_CASE',
  kebab: 'kebab-case',
  dot: 'dot.case',
  title: 'Title Case',
  lower: 'lower case',
  upper: 'UPPER CASE',
};

/** 多行輸入逐行轉換，保留行尾以外的空行。 */
export function convertCase(input: string, style: CaseStyle): string {
  return input
    .split('\n')
    .map((line) => (line.trim() === '' ? line : CASES[style](splitWords(line))))
    .join('\n');
}

export function allCases(input: string): string {
  const words = splitWords(input);
  return (Object.keys(CASES) as CaseStyle[]).map((style) => `${CASE_LABELS[style].padEnd(22)}${CASES[style](words)}`).join('\n') + '\n';
}

// Go 慣例把常見縮寫全大寫（UserID 而非 UserId）。
const GO_INITIALISMS = new Set(['id', 'url', 'uri', 'http', 'https', 'api', 'json', 'xml', 'uuid', 'ip', 'sql', 'html', 'css', 'ui', 'db', 'tcp', 'udp']);

export function goFieldName(key: string): string {
  const words = splitWords(key);
  const name = words.map((w) => (GO_INITIALISMS.has(w.toLowerCase()) ? w.toUpperCase() : cap(w))).join('');
  return /^[A-Za-z]/.test(name) ? name : `F${name || 'ield'}`;
}
