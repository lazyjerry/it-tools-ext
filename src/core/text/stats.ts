// 文字統計。中文不做分詞（沒有字典就只能猜），CJK 一字算一詞。

export interface TextStats {
  characters: number;
  bytes: number;
  lines: number;
  words: number;
  latinWords: number;
  cjkCharacters: number;
  whitespace: number;
  topWords: [string, number][];
}

const CJK_RE = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;
const TOKEN_RE = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]|[\p{L}\p{N}_]+(?:['’-][\p{L}\p{N}_]+)*/gu;

export function textStats(text: string, topN = 20): TextStats {
  const frequency = new Map<string, number>();
  let latinWords = 0;
  let cjkCharacters = 0;
  for (const match of text.matchAll(TOKEN_RE)) {
    const token = match[0];
    if (CJK_RE.test(token)) {
      cjkCharacters += 1;
    } else {
      latinWords += 1;
    }
    const key = token.toLowerCase();
    frequency.set(key, (frequency.get(key) ?? 0) + 1);
  }
  return {
    characters: [...text].length,
    bytes: Buffer.byteLength(text, 'utf8'),
    lines: text === '' ? 0 : text.split(/\r\n|\r|\n/).length,
    words: latinWords + cjkCharacters,
    latinWords,
    cjkCharacters,
    whitespace: (text.match(/\s/g) ?? []).length,
    topWords: [...frequency.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).slice(0, topN),
  };
}

export function formatTextStats(stats: TextStats): string {
  return [
    '# 文字統計',
    '',
    `字元數：${stats.characters}（UTF-8 ${stats.bytes} 位元組）`,
    `行數：${stats.lines}`,
    `單詞數：${stats.words}（英數單詞 ${stats.latinWords}、CJK 字 ${stats.cjkCharacters}）`,
    `空白字元：${stats.whitespace}`,
    '',
    '## 單詞頻率',
    ...stats.topWords.map(([w, n]) => `${String(n).padStart(6)}  ${w}`),
  ].join('\n') + '\n';
}
