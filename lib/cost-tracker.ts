// AI cost tracking utility. Pricing is sourced from the 0G /v1/models endpoint,
// which reports per-token cost in "neuron" units (1 A0GI = 1e18 neuron).
// Values below are pre-converted to A0GI per token.
const MODEL_PRICING: Record<string, { input: number; output: number }> = {
  "deepseek-v4-flash": { input: 6.44e-7, output: 1.28e-6 },
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

const COST_KEY = "en-tutor-cost-records";
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

export const recordCost = (
  record: Omit<CostRecord, "timestamp" | "costA0GI">
): void => {
  if (typeof window === "undefined") return;

  const pricing = MODEL_PRICING[record.model] ?? MODEL_PRICING["deepseek-v4-flash"];
  const costA0GI =
    record.inputTokens * pricing.input + record.outputTokens * pricing.output;

  const fullRecord: CostRecord = {
    ...record,
    timestamp: new Date().toISOString(),
    costA0GI,
  };

  const records = readRecords();
  records.push(fullRecord);
  const trimmed =
    records.length > MAX_STORED_RECORDS
      ? records.slice(records.length - MAX_STORED_RECORDS)
      : records;
  writeRecords(trimmed);
};

export const getCostSummary = (): CostSummary => {
  const records = readRecords();

  const summary: CostSummary = {
    totalCostA0GI: 0,
    totalCalls: 0,
    totalInputTokens: 0,
    totalOutputTokens: 0,
    byModule: {},
    byModel: {},
    todayCostA0GI: 0,
    records: records.slice(-MAX_SUMMARY_RECORDS).reverse(),
  };

  for (const record of records) {
    summary.totalCostA0GI += record.costA0GI;
    summary.totalCalls += 1;
    summary.totalInputTokens += record.inputTokens;
    summary.totalOutputTokens += record.outputTokens;

    if (!summary.byModule[record.module]) {
      summary.byModule[record.module] = { calls: 0, costA0GI: 0 };
    }
    summary.byModule[record.module].calls += 1;
    summary.byModule[record.module].costA0GI += record.costA0GI;

    if (!summary.byModel[record.model]) {
      summary.byModel[record.model] = { calls: 0, costA0GI: 0 };
    }
    summary.byModel[record.model].calls += 1;
    summary.byModel[record.model].costA0GI += record.costA0GI;

    if (isToday(record.timestamp)) {
      summary.todayCostA0GI += record.costA0GI;
    }
  }

  return summary;
};

export const clearCostHistory = (): void => {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(COST_KEY);
};
