// Centralized 0-100 scoring scale. All scores in the app are 0-100 for
// storage/display/aggregation. Subjective AI graders still return 1-10 (LLMs
// calibrate better on a small integer scale); normalizeTo100 is the single
// boundary that converts them. NEVER average a subjective (1-10 ×10) score
// with an objective percentage as if equally precise (see D3 composite).

export interface ScoreBand {
  min: number; // inclusive lower bound on the 0-100 scale
  label: string;
}

// Ordered high → low; scoreLabel picks the first band whose min is met.
export const SCORE_BANDS: ScoreBand[] = [
  { min: 90, label: "Excellent" },
  { min: 75, label: "Good" },
  { min: 60, label: "Fair" },
  { min: 0, label: "Needs Work" },
];

export const scoreLabel = (score0to100: number): string => {
  const band = SCORE_BANDS.find((b) => score0to100 >= b.min);
  return band ? band.label : "Needs Work";
};

// Single 1-10 → 0-100 normalizer (clamps out-of-range AI output).
export const normalizeTo100 = (aiScore1to10: number): number =>
  Math.round(Math.max(0, Math.min(10, aiScore1to10)) * 10);

// Shared anchored rubric language injected into subjective-scoring prompts so
// every grader shares the same 1-10 band meaning + calibration anchors.
export const rubricSnippet = (dimension: string): string =>
  `Rate ${dimension} on a 1-10 scale with these anchors: ` +
  `1-3 = frequent breakdowns that impede understanding; ` +
  `4-6 = message gets across but with clear L1 interference and recurring grammar/vocabulary errors; ` +
  `7-8 = generally accurate and natural with only occasional slips; ` +
  `9-10 = near-native precision, range, and fluency. ` +
  `Be calibrated and consistent across responses; do not inflate.`;
