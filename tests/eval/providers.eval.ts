import { describe, it } from "vitest";
import type { AIProvider, InterpretContext } from "@/lib/ai/intent";
import { ruleBasedProvider } from "@/lib/ai/rules";
import { createOllamaProvider, DEFAULT_OLLAMA_MODEL } from "@/lib/ai/ollama";
import { proposeCreate } from "@/lib/chat/resolve";
import { CASES, type EvalCase } from "./cases";

// Scores each provider on CASES. Not a pass/fail test: it prints a report.
//   npm run eval:ai                      # built-in parser only
//   OLLAMA_MODEL=llama3.2:3b npm run eval:ai   # also your local model

const ctx: InterpretContext = { now: new Date("2026-10-16T08:00:00Z"), timeZone: "Asia/Karachi" };

async function score(provider: AIProvider, c: EvalCase): Promise<string | null> {
  let intent;
  try {
    intent = await provider.interpret(c.text, ctx);
  } catch (e) {
    return `error: ${(e as Error).message}`;
  }
  const e = c.expect;
  if (e.action === "list") return intent.action === "list" && intent.range === e.range ? null : `got ${JSON.stringify(intent)}`;
  if (e.action === "delete" || e.action === "reschedule")
    return intent.action === e.action && e.target.test(intent.target) ? null : `got ${JSON.stringify(intent)}`;
  if (intent.action !== "create") return `got ${JSON.stringify(intent)}`;
  const r = proposeCreate(intent, ctx);
  if (e.action === "clarify") return r.kind === "clarify" ? null : `expected a question, got ${r.proposal.summary}`;
  if (r.kind === "clarify") return `asked "${r.question}" for ${JSON.stringify(intent)}`;
  if (e.action !== "create") return `got ${JSON.stringify(intent)}`;
  const s = r.proposal.draft.schedule;
  const rep = s.recurrence ? `${s.recurrence.freq}${s.recurrence.weekdays ? `:${s.recurrence.weekdays.join(",")}` : ""}` : undefined;
  const problems = [
    !e.title.test(r.proposal.draft.title) && `title "${r.proposal.draft.title}"`,
    s.start !== e.start && `start ${s.start}`,
    rep !== e.repeat && `repeat ${rep ?? "none"}`,
  ].filter(Boolean);
  return problems.length ? problems.join(", ") : null;
}

const providers: AIProvider[] = [ruleBasedProvider];
if (process.env.OLLAMA_MODEL) {
  providers.push(
    createOllamaProvider({ model: process.env.OLLAMA_MODEL || DEFAULT_OLLAMA_MODEL, baseUrl: process.env.OLLAMA_URL, timeoutMs: 120_000 }),
  );
}

describe("provider accuracy", () => {
  for (const p of providers) {
    it(p.name, { timeout: 30 * 60_000 }, async () => {
      let ok = 0;
      const lines: string[] = [];
      for (const c of CASES) {
        const t0 = performance.now();
        const problem = await score(p, c);
        const ms = Math.round(performance.now() - t0);
        if (!problem) ok++;
        lines.push(`${problem ? "✗" : "✓"} ${c.text}${problem ? `  →  ${problem}` : ""}  (${ms} ms)`);
      }
      console.log(`\n${p.name}: ${ok}/${CASES.length} correct\n${lines.join("\n")}\n`);
    });
  }
});
