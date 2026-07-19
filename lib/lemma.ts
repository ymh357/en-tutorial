// lib/lemma.ts
// English lemmatizer wrapping wink-lemmatizer, loaded lazily via dynamic
// import so its dictionary stays out of the main bundle. Callers that need
// accurate lemmas must `await ensureLemmatizer()` once before relying on
// `lemmatize()`; before load (or if load fails) `lemmatize()` falls back to
// a lowercased trim so callers never break.

type WinkLemmatizer = {
  noun: (w: string) => string;
  verb: (w: string) => string;
  adjective: (w: string) => string;
};

let lemmatizer: WinkLemmatizer | null = null;
let loadPromise: Promise<void> | null = null;

export const ensureLemmatizer = async (): Promise<void> => {
  if (lemmatizer) return;
  if (!loadPromise) {
    loadPromise = import("wink-lemmatizer")
      .then((mod) => {
        const m =
          (mod as { default?: WinkLemmatizer }).default ??
          (mod as unknown as WinkLemmatizer);
        lemmatizer = m;
      })
      .catch(() => {
        // Leave lemmatizer null so lemmatize() keeps its lowercase fallback;
        // allow a later retry by clearing the promise.
        loadPromise = null;
      });
  }
  await loadPromise;
};

// Synchronous. Tries noun → verb → adjective, returning the first base form
// that differs from the input; otherwise the lowercased word.
export const lemmatize = (word: string): string => {
  const w = word.trim().toLowerCase();
  if (!w || !lemmatizer) return w;
  const n = lemmatizer.noun(w);
  if (n !== w) return n;
  const v = lemmatizer.verb(w);
  if (v !== w) return v;
  return lemmatizer.adjective(w);
};
