// Weekly Workers AI budget. New posts are read by the AI on Sundays only (UTC), up to a weekly
// ceiling in neurons; themes and moves are rebuilt on Mondays from that reading, before the weekly
// email. Every AI call is logged in `ai_usage`, so the ceiling holds whatever triggers the call.
import { Env } from "./lib";

// Workers AI prices in neurons per million tokens [input, output]. $0.011 per 1,000 neurons above
// the account's 10,000 free a day.
const RATES: Record<string, [number, number]> = {
  "@cf/meta/llama-3.3-70b-instruct-fp8-fast": [26668, 204805],
  "@cf/meta/llama-3.1-8b-instruct-fast": [4119, 34868],
  "@cf/openai/gpt-oss-120b": [31818, 68182],
};
// A model not in the table is priced as the dearest reader, so the ceiling errs on the safe side
const UNKNOWN_RATE: [number, number] = [26668, 204805];

const READING_DAY = 0; // Sunday
const SYNTHESIS_DAY = 1; // Monday
// About $1.50 a week ($0.21 a day) for this tool; set AI_WEEKLY_NEURONS on the Worker to change it
const DEFAULT_WEEKLY_NEURONS = 150000;
// Reading stops at this share of the week's ceiling; the rest is kept for Monday's themes and moves
const READING_SHARE = 0.85;

export const isReadingDay = (d = new Date()) => d.getUTCDay() === READING_DAY;
export const isSynthesisDay = (d = new Date()) => d.getUTCDay() === SYNTHESIS_DAY;
export const WAITING_NOTE = "weekly reading: waits for Sunday";
// Queue this job to run the weekly reading now, outside Sunday:
//   INSERT OR IGNORE INTO pending_jobs (job, created_at) VALUES ('read_now', datetime('now'));
// It reads until the queue is empty (within the same weekly budget), then rebuilds themes and moves.
export const READ_NOW_JOB = "read_now";

/** True on Sundays, or while a 'read_now' job is queued. */
export async function readingAllowed(env: Env): Promise<boolean> {
  if (isReadingDay()) return true;
  return !!(await env.DB.prepare(`SELECT 1 FROM pending_jobs WHERE job=?1`).bind(READ_NOW_JOB).first());
}

/** The budget week starts on the reading day: the most recent Sunday (UTC), as YYYY-MM-DD. */
export function weekStart(d = new Date()): string {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - d.getUTCDay())).toISOString().slice(0, 10);
}

export function weeklyNeurons(env: Env): number {
  const n = Number(env.AI_WEEKLY_NEURONS);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_WEEKLY_NEURONS;
}

export async function neuronsThisWeek(env: Env): Promise<number> {
  const r = await env.DB.prepare(`SELECT COALESCE(SUM(neurons), 0) AS n FROM ai_usage WHERE day >= ?1`).bind(weekStart()).first<any>();
  return Number(r?.n) || 0;
}

/** True while this week's reading may still call the AI. */
export async function readingBudgetLeft(env: Env): Promise<boolean> {
  return (await neuronsThisWeek(env)) < weeklyNeurons(env) * READING_SHARE;
}

/** Neurons one call cost, from the token counts Workers AI returns (estimated from text length if it returns none). */
export function neuronsFor(model: string, prompt: string, out: any): number {
  const u = out?.usage || {};
  const input = Number(u.prompt_tokens ?? u.input_tokens) || Math.ceil(prompt.length / 4);
  const output = Number(u.completion_tokens ?? u.output_tokens) || Math.ceil(JSON.stringify(out ?? "").length / 4);
  const [rin, rout] = RATES[model] || UNKNOWN_RATE;
  return (input * rin + output * rout) / 1e6;
}

/** Log one AI call. A failed write never stops the reading. */
export async function recordAiUsage(env: Env, model: string, neurons: number): Promise<void> {
  try {
    await env.DB.prepare(`INSERT INTO ai_usage (day, model, calls, neurons) VALUES (?1, ?2, 1, ?3)
      ON CONFLICT(day, model) DO UPDATE SET calls = calls + 1, neurons = neurons + excluded.neurons`)
      .bind(new Date().toISOString().slice(0, 10), model, neurons).run();
  } catch (e) {
    console.error("ai_usage write failed", String((e as any)?.message || e));
  }
}
