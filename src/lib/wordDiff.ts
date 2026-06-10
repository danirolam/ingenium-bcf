// A minimal word-level diff for statutory text. Tokenizes on whitespace
// boundaries (words and the spaces between them, both kept) and runs a longest-
// common-subsequence pass so a "changed" provision highlights only the words
// that actually changed — CanLII / GitHub style — instead of repainting the
// whole paragraph red+green.

export type WordPart = { text: string; kind: "same" | "del" | "add" };

const tokenize = (s: string): string[] => s.match(/\s+|\S+/g) ?? [];

// Coalesce adjacent parts of the same kind so the DOM stays small and
// strike-through / highlight spans read as continuous runs.
function push(parts: WordPart[], text: string, kind: WordPart["kind"]) {
  const last = parts[parts.length - 1];
  if (last && last.kind === kind) last.text += text;
  else parts.push({ text, kind });
}

/**
 * Split `before` → `after` into the run of parts each side should render:
 *   left  = the "before" text with removed words tagged `del`
 *   right = the "after"  text with inserted words tagged `add`
 * Common words are tagged `same` on both sides.
 *
 * Falls back to a whole-text del/add (no alignment) for pathologically long
 * inputs so the O(n·m) table can't blow up the render.
 */
export function wordDiff(before: string, after: string): { left: WordPart[]; right: WordPart[] } {
  const a = tokenize(before);
  const b = tokenize(after);
  const n = a.length;
  const m = b.length;

  if (n === 0) return { left: [], right: after ? [{ text: after, kind: "add" }] : [] };
  if (m === 0) return { left: before ? [{ text: before, kind: "del" }] : [], right: [] };
  if (n * m > 250_000) {
    return { left: [{ text: before, kind: "del" }], right: [{ text: after, kind: "add" }] };
  }

  // dp[i][j] = LCS length of a[i..] and b[j..].
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }

  const left: WordPart[] = [];
  const right: WordPart[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      push(left, a[i], "same");
      push(right, b[j], "same");
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      push(left, a[i], "del");
      i++;
    } else {
      push(right, b[j], "add");
      j++;
    }
  }
  while (i < n) push(left, a[i++], "del");
  while (j < m) push(right, b[j++], "add");
  return { left, right };
}
