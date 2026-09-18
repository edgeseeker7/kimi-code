const CJK_RE = /[㐀-䶿一-鿿豈-﫿]/;
const ASCII_RUN_RE = /[a-z0-9_.\-/#]+/g;

export function tokenize(text: string): string[] {
  const lower = String(text ?? '').toLowerCase();
  const tokens: string[] = [];
  let cjkRun = '';
  const flushCjk = (): void => {
    if (cjkRun.length === 1) tokens.push(cjkRun);
    for (let i = 0; i + 2 <= cjkRun.length; i += 1) tokens.push(cjkRun.slice(i, i + 2));
    cjkRun = '';
  };
  let i = 0;
  while (i < lower.length) {
    const ch = lower[i]!;
    if (CJK_RE.test(ch)) {
      cjkRun += ch;
      i += 1;
      continue;
    }
    flushCjk();
    const rest = lower.slice(i);
    const m = ASCII_RUN_RE.exec(rest);
    if (m !== null && m.index === 0) {
      tokens.push(m[0]);
      i += m[0].length;
      ASCII_RUN_RE.lastIndex = 0;
    } else {
      i += 1;
    }
    ASCII_RUN_RE.lastIndex = 0;
  }
  flushCjk();
  return tokens;
}

const STOP = new Set(['的', '了', '是', '在', '和', '与', '或', 'the', 'and', 'for', 'with']);

export function topTerms(text: string, n: number): string[] {
  const freq = new Map<string, number>();
  for (const token of tokenize(text)) {
    if (STOP.has(token) || token.length < 2) continue;
    freq.set(token, (freq.get(token) ?? 0) + 1);
  }
  return [...freq.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([term]) => term);
}
