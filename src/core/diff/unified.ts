// 行層級 Myers diff 與 unified diff 輸出。並排比較交給 VS Code 原生 vscode.diff；這裡只負責產生可貼上的文字。

export interface DiffOptions {
  ignoreWhitespace?: boolean;
  ignoreCase?: boolean;
  context?: number;
}

export type DiffOp = { type: ' ' | '-' | '+'; line: string; aIndex: number; bIndex: number };

export function splitLines(text: string): string[] {
  if (text === '') {
    return [];
  }
  const lines = text.split(/\r\n|\r|\n/);
  if (lines[lines.length - 1] === '') {
    lines.pop();
  }
  return lines;
}

function normalizer(options: DiffOptions): (line: string) => string {
  return (line) => {
    let out = line;
    if (options.ignoreWhitespace) {
      out = out.replace(/\s+/g, ' ').trim();
    }
    if (options.ignoreCase) {
      out = out.toLowerCase();
    }
    return out;
  };
}

/** O((N+M)D) Myers，只保留 [-d, d] 範圍的 V 快照供回溯。 */
export function diffLines(a: string[], b: string[], options: DiffOptions = {}): DiffOp[] {
  const norm = normalizer(options);
  const na = a.map(norm);
  const nb = b.map(norm);

  let prefix = 0;
  while (prefix < na.length && prefix < nb.length && na[prefix] === nb[prefix]) {
    prefix += 1;
  }
  let suffix = 0;
  while (
    suffix < na.length - prefix &&
    suffix < nb.length - prefix &&
    na[na.length - 1 - suffix] === nb[nb.length - 1 - suffix]
  ) {
    suffix += 1;
  }
  const A = na.slice(prefix, na.length - suffix);
  const B = nb.slice(prefix, nb.length - suffix);
  const n = A.length;
  const m = B.length;
  const max = n + m;
  const trace: Int32Array[] = [];
  const v = new Int32Array(2 * max + 2);
  const off = max + 1;
  let found = n === 0 && m === 0;

  for (let d = 0; d <= max && !found; d += 1) {
    trace.push(v.slice(off - d - 1, off + d + 2));
    for (let k = -d; k <= d; k += 2) {
      let x = k === -d || (k !== d && v[off + k - 1] < v[off + k + 1]) ? v[off + k + 1] : v[off + k - 1] + 1;
      let y = x - k;
      while (x < n && y < m && A[x] === B[y]) {
        x += 1;
        y += 1;
      }
      v[off + k] = x;
      if (x >= n && y >= m) {
        found = true;
        break;
      }
    }
  }

  const middle: DiffOp[] = [];
  let x = n;
  let y = m;
  for (let d = trace.length - 1; d > 0; d -= 1) {
    const snapshot = trace[d];
    const at = (k: number) => snapshot[k + d + 1];
    const k = x - y;
    const prevK = k === -d || (k !== d && at(k - 1) < at(k + 1)) ? k + 1 : k - 1;
    const prevX = at(prevK);
    const prevY = prevX - prevK;
    while (x > prevX && y > prevY) {
      x -= 1;
      y -= 1;
      middle.push({ type: ' ', line: a[prefix + x], aIndex: prefix + x, bIndex: prefix + y });
    }
    if (x === prevX) {
      y -= 1;
      middle.push({ type: '+', line: b[prefix + y], aIndex: prefix + x, bIndex: prefix + y });
    } else {
      x -= 1;
      middle.push({ type: '-', line: a[prefix + x], aIndex: prefix + x, bIndex: prefix + y });
    }
  }
  while (x > 0 && y > 0) {
    x -= 1;
    y -= 1;
    middle.push({ type: ' ', line: a[prefix + x], aIndex: prefix + x, bIndex: prefix + y });
  }
  middle.reverse();

  const ops: DiffOp[] = [];
  for (let i = 0; i < prefix; i += 1) {
    ops.push({ type: ' ', line: a[i], aIndex: i, bIndex: i });
  }
  ops.push(...middle);
  for (let i = 0; i < suffix; i += 1) {
    const ai = a.length - suffix + i;
    const bi = b.length - suffix + i;
    ops.push({ type: ' ', line: a[ai], aIndex: ai, bIndex: bi });
  }
  return ops;
}

export function unifiedDiff(left: string, right: string, options: DiffOptions & { leftName?: string; rightName?: string } = {}): string {
  const a = splitLines(left);
  const b = splitLines(right);
  const ops = diffLines(a, b, options);
  const context = options.context ?? 3;
  const header = `--- ${options.leftName ?? 'left'}\n+++ ${options.rightName ?? 'right'}\n`;
  if (ops.every((op) => op.type === ' ')) {
    return `${header}（沒有差異）\n`;
  }

  const hunks: string[] = [];
  let i = 0;
  while (i < ops.length) {
    while (i < ops.length && ops[i].type === ' ') {
      i += 1;
    }
    if (i >= ops.length) {
      break;
    }
    const start = Math.max(0, i - context);
    let end = i;
    // 兩段變更之間的相同行 ≤ 2×context 時併成同一個 hunk
    for (;;) {
      while (end < ops.length && ops[end].type !== ' ') {
        end += 1;
      }
      let gap = end;
      while (gap < ops.length && ops[gap].type === ' ') {
        gap += 1;
      }
      if (gap < ops.length && gap - end <= context * 2) {
        end = gap;
        continue;
      }
      end = Math.min(ops.length, end + context);
      break;
    }
    const slice = ops.slice(start, end);
    const aLines = slice.filter((op) => op.type !== '+').length;
    const bLines = slice.filter((op) => op.type !== '-').length;
    const aStart = aLines === 0 ? slice[0].aIndex : slice[0].aIndex + 1;
    const bStart = bLines === 0 ? slice[0].bIndex : slice[0].bIndex + 1;
    hunks.push(`@@ -${aStart},${aLines} +${bStart},${bLines} @@\n${slice.map((op) => `${op.type}${op.line}`).join('\n')}\n`);
    i = end;
  }
  return header + hunks.join('');
}
