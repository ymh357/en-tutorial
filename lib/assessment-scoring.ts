// Pure, local, heuristic assessment scoring. NOT group-calibrated IRT (a
// single-user local app has no population data) — the leveling is a
// heuristic spread-probe: generate items one level below / at / above the
// user's current level, locate where performance drops, then let cloze pick
// the within-level sub-band and subjective sections nudge it (bounded, so an
// unreliable single-shot LLM judgment can never override the objective
// location by more than one sub-band).

export type Cefr = "A1" | "A2" | "B1" | "B2" | "C1" | "C2";
export const CEFR_LADDER: Cefr[] = ["A1", "A2", "B1", "B2", "C1", "C2"];

// Representative 0-100 midpoint + [min,max] range for each CEFR level, so a
// located level maps to a score (for AssessmentResult.overallScore / history
// trend) and back (levelBand). Evenly partitions 0-100 across 6 levels.
export interface CefrRange { level: Cefr; min: number; mid: number; max: number; }
export const CEFR_RANGES: CefrRange[] = CEFR_LADDER.map((level, i) => {
  const width = 100 / CEFR_LADDER.length; // ~16.67
  const min = Math.round(i * width);
  const max = Math.round((i + 1) * width);
  return { level, min, mid: Math.round((min + max) / 2), max };
});

export const cefrIndex = (level: Cefr): number => {
  const i = CEFR_LADDER.indexOf(level);
  return i < 0 ? CEFR_LADDER.indexOf("B1") : i; // default B1 if unknown
};

// The 3-level spread around the user's current level, clamped to ladder ends.
export const spreadLevels = (current: Cefr): Cefr[] => {
  const i = cefrIndex(current);
  const lo = Math.max(0, i - 1);
  const hi = Math.min(CEFR_LADDER.length - 1, i + 1);
  const out: Cefr[] = [];
  for (let k = lo; k <= hi; k++) out.push(CEFR_LADDER[k]);
  return out; // 2 (at an end) or 3 levels
};

export interface SubtestScore { level: Cefr; correct: number; total: number; }
export interface Location {
  level: Cefr;
  atCeiling: boolean; // passed the hardest offered level → may be higher
  atFloor: boolean;   // failed even the easiest offered level → may be lower
}

// Locate = highest offered level with >= passMark (default 2/3) correct.
// Ceiling/floor flags drive a "retest to converge" hint (detection is ±1
// level per run — the spread only spans current±1).
export const locateLevel = (
  subtests: SubtestScore[],
  passRatio = 2 / 3
): Location => {
  if (subtests.length === 0) return { level: "B1", atCeiling: false, atFloor: true }; // defensive; schema .min(2) prevents in practice
  const ordered = [...subtests].sort(
    (a, b) => cefrIndex(a.level) - cefrIndex(b.level)
  );
  const passed = (s: SubtestScore): boolean =>
    s.total > 0 && s.correct / s.total >= passRatio;
  let located = ordered[0].level;
  let anyPassed = false;
  for (const s of ordered) {
    if (passed(s)) { located = s.level; anyPassed = true; }
  }
  const hardest = ordered[ordered.length - 1];
  const easiest = ordered[0];
  return {
    level: anyPassed ? located : easiest.level,
    atCeiling: passed(hardest),
    atFloor: !passed(easiest),
  };
};

export interface FinalBand {
  overallScore: number; // 0-100 for AssessmentResult (consistent w/ band)
  cefr: Cefr;
  band: string;         // e.g. "B1 (Upper)"
  lowConfidence: boolean;
}

// Bridge: located level = anchor. cloze% picks within-level sub-band
// (Upper/Lower). subjective (writing+conversation avg, 0-100) nudges bounded
// to +/- half a level, and the TOTAL deviation from the located midpoint is
// clamped to +/- one level width, so subjective never overrides location by
// more than a sub-band. lowConfidence when subjective disagrees strongly with
// the objective location, or reading hit a ceiling/floor edge.
export const computeFinalBand = (
  loc: Location,
  clozePct: number,       // 0-100
  subjectiveAvg: number   // 0-100 (already-normalized writing+conversation avg)
): FinalBand => {
  const range = CEFR_RANGES[cefrIndex(loc.level)];
  const width = range.max - range.min;
  // cloze within-level: 50% → midpoint, 100% → top of level, 0% → bottom.
  const clozeOffset = (clozePct / 100 - 0.5) * width; // [-w/2, +w/2]
  let score = range.mid + clozeOffset;
  // subjective bounded nudge toward its own value, capped at +/- width/2.
  const subjDelta = Math.max(-width / 2, Math.min(width / 2, (subjectiveAvg - score) * 0.3));
  score += subjDelta;
  // hard clamp: never leave the located level +/- one level width.
  score = Math.max(range.min - width, Math.min(range.max + width, score));
  score = Math.max(0, Math.min(100, Math.round(score)));
  const lowConfidence =
    loc.atCeiling || loc.atFloor || Math.abs(subjectiveAvg - range.mid) > width;
  // score===100 (only reachable when loc.level is C2, since the hard clamp
  // caps a lower-located score at range.max+width < 100) matches no half-open
  // range → `?? range` returns the located C2 range, keeping band consistent.
  const finalRange = CEFR_RANGES.find((r) => score >= r.min && score < r.max) ?? range;
  const cefr = finalRange.level;
  const sub = score >= finalRange.mid ? "Upper" : "Lower";
  return { overallScore: score, cefr, band: `${cefr} (${sub})`, lowConfidence };
};
