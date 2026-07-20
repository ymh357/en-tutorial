// Word-level alignment for listening dictation/shadowing accuracy. Replaces
// the old positional index comparison where a single dropped/inserted word
// made every subsequent word count wrong. Needleman-Wunsch global alignment:
// an omission/insertion only affects its local position, and substitutions
// keep the user's word (heardAs) for display.

export interface WordDiffEntry {
  word: string; // target word
  heardAs: string | null; // aligned user word (substitution shown), null if omitted
  correct: boolean;
}

export interface AlignResult {
  accuracy: number; // 0-100, correct target words / total target words
  original: WordDiffEntry[];
}

const normalizeWord = (w: string): string =>
  w.toLowerCase().replace(/[.,!?;:'"]/g, "");

const tokenize = (text: string): string[] =>
  text.trim().split(/\s+/).filter(Boolean).map(normalizeWord).filter(Boolean);

export const alignWords = (original: string, userText: string): AlignResult => {
  const a = tokenize(original); // target
  const b = tokenize(userText); // user
  const n = a.length;
  const m = b.length;
  const GAP = -1;
  const MATCH = 1;
  const MIS = -1;

  const dp: number[][] = Array.from({ length: n + 1 }, () =>
    new Array<number>(m + 1).fill(0)
  );
  for (let i = 1; i <= n; i++) dp[i][0] = i * GAP;
  for (let j = 1; j <= m; j++) dp[0][j] = j * GAP;
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      const diag = dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? MATCH : MIS);
      dp[i][j] = Math.max(diag, dp[i - 1][j] + GAP, dp[i][j - 1] + GAP);
    }
  }

  const rev: WordDiffEntry[] = [];
  let i = n;
  let j = m;
  while (i > 0 || j > 0) {
    if (
      i > 0 &&
      j > 0 &&
      dp[i][j] === dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? MATCH : MIS)
    ) {
      rev.push({
        word: a[i - 1],
        heardAs: b[j - 1],
        correct: a[i - 1] === b[j - 1],
      });
      i--;
      j--;
    } else if (i > 0 && dp[i][j] === dp[i - 1][j] + GAP) {
      rev.push({ word: a[i - 1], heardAs: null, correct: false }); // omission
      i--;
    } else {
      j--; // insertion (extra user word) — no target entry
    }
  }

  const original2 = rev.reverse();
  const correctCount = original2.filter((e) => e.correct).length;
  const accuracy =
    a.length === 0 ? 0 : Math.round((correctCount / a.length) * 100);
  return { accuracy, original: original2 };
};
