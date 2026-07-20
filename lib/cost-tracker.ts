// AI cost tracking utility. Pricing is sourced from the 0G /v1/models endpoint,
// which reports per-token cost in "neuron" units (1 A0GI = 1e18 neuron).
// Values below are pre-converted to A0GI per token.
//
// This tracker is client-side only (localStorage-backed): it records calls
// made from the browser via recordCost(). AI calls made server-side — e.g.
// the cron job at app/api/cron/generate-tasks/route.ts, which calls
// generateText() directly with no client involved — are NOT counted here and
// will not appear in this dashboard.
const MODEL_PRICING: Record<string, { input: number; output: number }> = {
  "deepseek-v4-flash": { input: 6.44e-7, output: 1.28e-6 },
  "deepseek-v4-pro": { input: 7.7e-6, output: 1.542e-5 },
  "claude-sonnet-5": { input: 1.008e-5, output: 5.043e-5 },
};

export interface CostRecord {
  timestamp: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  costA0GI: number;
  module: string; // which feature used it: conversation, reader, writing, listening, translate, assessment, tts
}

export interface CostSummary {
  totalCostA0GI: number;
  totalCalls: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  byModule: Record<string, { calls: number; costA0GI: number }>;
  byModel: Record<string, { calls: number; costA0GI: number }>;
  todayCostA0GI: number;
  records: CostRecord[]; // last 100
}

// Durable cumulative totals, stored independently of the trimmed detail list
// below so that Total/byModule/byModel/today figures never shrink once the
// detail list is trimmed past MAX_STORED_RECORDS.
interface CumulativeCostTotals {
  totalCostA0GI: number;
  totalCalls: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  byModule: Record<string, { calls: number; costA0GI: number }>;
  byModel: Record<string, { calls: number; costA0GI: number }>;
  // Per-day rollup for "today's cost", reset whenever the local date
  // changes. Kept separate from the cumulative totals above so today's
  // figure stays correct regardless of the detail-list trim.
  today: { date: string; costA0GI: number };
}

const COST_KEY = "en-tutor-cost-records";
const TOTALS_KEY = "en-tutor-cost-totals";
const MAX_STORED_RECORDS = 500;
const MAX_SUMMARY_RECORDS = 100;

const isToday = (isoTimestamp: string): boolean => {
  const d = new Date(isoTimestamp);
  const now = new Date();
  return (
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate()
  );
};

// Local-date key used to detect day rollover for the `today` rollup. Not a
// display value, so no zero-padding is needed — it only has to be stable and
// unique per local calendar day, matching the semantics of isToday() above.
const todayKey = (): string => {
  const now = new Date();
  return `${now.getFullYear()}-${now.getMonth()}-${now.getDate()}`;
};

const readRecords = (): CostRecord[] => {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(COST_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as CostRecord[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

const writeRecords = (records: CostRecord[]): void => {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(COST_KEY, JSON.stringify(records));
  } catch {
    // Ignore quota errors — cost tracking is best-effort and must not
    // interrupt the calling feature.
  }
};

const emptyTotals = (): CumulativeCostTotals => ({
  totalCostA0GI: 0,
  totalCalls: 0,
  totalInputTokens: 0,
  totalOutputTokens: 0,
  byModule: {},
  byModel: {},
  today: { date: todayKey(), costA0GI: 0 },
});

const isValidTotals = (value: unknown): value is CumulativeCostTotals => {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.totalCostA0GI === "number" &&
    typeof v.totalCalls === "number" &&
    typeof v.totalInputTokens === "number" &&
    typeof v.totalOutputTokens === "number" &&
    typeof v.byModule === "object" &&
    v.byModule !== null &&
    typeof v.byModel === "object" &&
    v.byModel !== null &&
    typeof v.today === "object" &&
    v.today !== null
  );
};

// Aggregates whatever detail records currently survive the trim into a
// CumulativeCostTotals shape. Used only to seed the durable totals store the
// first time it's read (see readTotals) — e.g. right after this feature
// ships, when TOTALS_KEY doesn't exist yet but COST_KEY may already hold up
// to MAX_STORED_RECORDS records from before. This is necessarily an
// undercount if more than MAX_STORED_RECORDS calls happened before this
// feature shipped (those records are already gone), but it's a closer
// approximation than resetting existing users' totals to zero.
const aggregateFromRecords = (records: CostRecord[]): CumulativeCostTotals => {
  const totals = emptyTotals();
  for (const record of records) {
    totals.totalCostA0GI += record.costA0GI;
    totals.totalCalls += 1;
    totals.totalInputTokens += record.inputTokens;
    totals.totalOutputTokens += record.outputTokens;

    if (!totals.byModule[record.module]) {
      totals.byModule[record.module] = { calls: 0, costA0GI: 0 };
    }
    totals.byModule[record.module].calls += 1;
    totals.byModule[record.module].costA0GI += record.costA0GI;

    if (!totals.byModel[record.model]) {
      totals.byModel[record.model] = { calls: 0, costA0GI: 0 };
    }
    totals.byModel[record.model].calls += 1;
    totals.byModel[record.model].costA0GI += record.costA0GI;

    if (isToday(record.timestamp)) {
      totals.today.costA0GI += record.costA0GI;
    }
  }
  return totals;
};

const writeTotals = (totals: CumulativeCostTotals): void => {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(TOTALS_KEY, JSON.stringify(totals));
  } catch {
    // Ignore quota errors — cost tracking is best-effort and must not
    // interrupt the calling feature.
  }
};

const readTotals = (): CumulativeCostTotals => {
  if (typeof window === "undefined") return emptyTotals();
  try {
    const raw = window.localStorage.getItem(TOTALS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as unknown;
      if (isValidTotals(parsed)) return parsed;
    }
  } catch {
    // fall through to migration below
  }
  // No durable totals yet — either first run after this feature shipped, or
  // corrupt/missing data. Seed from the trimmed detail list so existing
  // users don't see their totals jump to zero.
  const seeded = aggregateFromRecords(readRecords());
  writeTotals(seeded);
  return seeded;
};

export const recordCost = (
  record: Omit<CostRecord, "timestamp" | "costA0GI">
): void => {
  if (typeof window === "undefined") return;

  let pricing = MODEL_PRICING[record.model];
  if (!pricing) {
    // Smoke-tested against router-api-staging.0g.ai: the chat/completions
    // response's `model` field comes back as exactly "deepseek-v4-pro" /
    // "deepseek-v4-flash" (no suffix/version), matching these keys directly.
    // An unknown model here means either a new/renamed model or a caller
    // bug — warn instead of silently pricing it as the cheapest tier.
    console.warn(
      `[cost-tracker] Unknown model "${record.model}" — falling back to deepseek-v4-flash pricing. ` +
        "Add a MODEL_PRICING entry if this is a real model."
    );
    pricing = MODEL_PRICING["deepseek-v4-flash"];
  }
  const costA0GI =
    record.inputTokens * pricing.input + record.outputTokens * pricing.output;

  const fullRecord: CostRecord = {
    ...record,
    timestamp: new Date().toISOString(),
    costA0GI,
  };

  // Trimmed detail list — powers the "recent activity" view (records, last
  // MAX_SUMMARY_RECORDS). Older calls fall off this list, but the cumulative
  // totals below are updated independently, so aggregate figures don't
  // shrink once the trim kicks in.
  //
  // Read totals BEFORE writing this call's detail record: if the totals
  // key doesn't exist yet, readTotals() seeds itself from the detail list
  // (see aggregateFromRecords), and that seed must only cover pre-existing
  // records — not the one this call is about to add — or the very first
  // call after migration would be double-counted.
  const totals = readTotals();

  const records = readRecords();
  records.push(fullRecord);
  const trimmed =
    records.length > MAX_STORED_RECORDS
      ? records.slice(records.length - MAX_STORED_RECORDS)
      : records;
  writeRecords(trimmed);

  totals.totalCostA0GI += costA0GI;
  totals.totalCalls += 1;
  totals.totalInputTokens += record.inputTokens;
  totals.totalOutputTokens += record.outputTokens;

  if (!totals.byModule[record.module]) {
    totals.byModule[record.module] = { calls: 0, costA0GI: 0 };
  }
  totals.byModule[record.module].calls += 1;
  totals.byModule[record.module].costA0GI += costA0GI;

  if (!totals.byModel[record.model]) {
    totals.byModel[record.model] = { calls: 0, costA0GI: 0 };
  }
  totals.byModel[record.model].calls += 1;
  totals.byModel[record.model].costA0GI += costA0GI;

  const key = todayKey();
  if (totals.today.date !== key) {
    totals.today = { date: key, costA0GI: 0 };
  }
  totals.today.costA0GI += costA0GI;

  writeTotals(totals);
};

export const getCostSummary = (): CostSummary => {
  const totals = readTotals();
  const records = readRecords();

  return {
    totalCostA0GI: totals.totalCostA0GI,
    totalCalls: totals.totalCalls,
    totalInputTokens: totals.totalInputTokens,
    totalOutputTokens: totals.totalOutputTokens,
    byModule: totals.byModule,
    byModel: totals.byModel,
    todayCostA0GI: totals.today.date === todayKey() ? totals.today.costA0GI : 0,
    records: records.slice(-MAX_SUMMARY_RECORDS).reverse(),
  };
};

export const clearCostHistory = (): void => {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(COST_KEY);
  window.localStorage.removeItem(TOTALS_KEY);
};
