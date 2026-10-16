import { z } from "zod";
import { WEEKDAYS } from "@/lib/engine";
import { intentSchema, type AIProvider, type Intent, type InterpretContext } from "./intent";

// Talks to Ollama running on the user's own computer. It runs in the BROWSER:
// a hosted server (Vercel) can't reach your laptop, but your browser can.
// Ollama must allow the app's origin (OLLAMA_ORIGINS, see docs/local-ai.md).

export const DEFAULT_OLLAMA_URL = "http://127.0.0.1:11434";
export const DEFAULT_OLLAMA_MODEL = "llama3.2:3b";

/**
 * What we ask the model to fill in. Flat, with every field required, because
 * small local models follow a flat schema far more reliably than a union.
 */
export const wireSchema = z.object({
  action: z.enum(["create", "list", "delete", "reschedule", "unknown"]),
  title: z.string(),
  when: z.string(),
  repeat: z.enum(["none", "daily", "weekly", "monthly", "yearly"]),
  interval: z.number().int(),
  weekdays: z.array(z.enum(WEEKDAYS)),
  target: z.string(),
  range: z.enum(["today", "tomorrow", "week", "all"]),
});
export type Wire = z.infer<typeof wireSchema>;

export const wireJsonSchema = z.toJSONSchema(wireSchema);

export class OllamaUnavailableError extends Error {}
export class OllamaOutputError extends Error {}

export function systemPrompt(ctx: InterpretContext): string {
  return [
    "You turn one message about reminders into JSON that matches the given schema.",
    "Fields:",
    '- action: "create" a reminder, "list" upcoming ones, "delete" one, "reschedule" one to a new time, or "unknown".',
    "- title: what to be reminded about, short, without the time words. Empty unless action is create.",
    '- when: copy the user\'s own words for the date and time exactly, e.g. "tomorrow at 9am". Do NOT calculate or convert dates. Empty if none.',
    '- repeat: "none" unless the user asks for a repeat. interval: 1 unless they say e.g. "every 2 weeks". weekdays: two-letter codes (MO..SU) for weekly repeats on specific days, else [].',
    "- target: for delete or reschedule, the words naming the existing reminder. Else empty.",
    '- range: for list, "today", "tomorrow", "week" or "all". Else "all".',
    `Context only (do not do date maths with it): the user's time zone is ${ctx.timeZone}.`,
    "Examples:",
    'remind me to call mum tomorrow at 6pm -> {"action":"create","title":"Call mum","when":"tomorrow at 6pm","repeat":"none","interval":1,"weekdays":[],"target":"","range":"all"}',
    'gym every monday and thursday at 7am -> {"action":"create","title":"Gym","when":"at 7am","repeat":"weekly","interval":1,"weekdays":["MO","TH"],"target":"","range":"all"}',
    'what do I have tomorrow? -> {"action":"list","title":"","when":"","repeat":"none","interval":1,"weekdays":[],"target":"","range":"tomorrow"}',
    'move the dentist to friday at 4pm -> {"action":"reschedule","title":"","when":"friday at 4pm","repeat":"none","interval":1,"weekdays":[],"target":"dentist","range":"all"}',
  ].join("\n");
}

/** Validates the model's reply and converts it to an Intent, or throws OllamaOutputError. */
export function wireToIntent(raw: unknown): Intent {
  const w = wireSchema.safeParse(raw);
  if (!w.success) throw new OllamaOutputError(`Model reply did not match the schema: ${w.error.issues[0].message}`);
  const v = w.data;
  let intent: unknown;
  switch (v.action) {
    case "create":
      intent = {
        action: "create",
        title: v.title.trim(),
        when: v.when.trim(),
        repeat:
          v.repeat === "none"
            ? null
            : {
                freq: v.repeat,
                interval: Math.min(Math.max(v.interval || 1, 1), 999),
                ...(v.repeat === "weekly" && v.weekdays.length ? { weekdays: [...new Set(v.weekdays)] } : {}),
              },
      };
      break;
    case "list":
      intent = { action: "list", range: v.range };
      break;
    case "delete":
      intent = { action: "delete", target: v.target.trim() };
      break;
    case "reschedule":
      intent = { action: "reschedule", target: v.target.trim(), when: v.when.trim() };
      break;
    default:
      intent = { action: "unknown" };
  }
  const parsed = intentSchema.safeParse(intent);
  if (!parsed.success) throw new OllamaOutputError(`Model reply was not a usable action: ${parsed.error.issues[0].message}`);
  // A delete/reschedule with no target, or a create with no title AND no time, is not trustworthy.
  if ((v.action === "delete" || v.action === "reschedule") && !v.target.trim())
    throw new OllamaOutputError("Model did not say which reminder");
  return parsed.data;
}

export function createOllamaProvider(opts: {
  baseUrl?: string;
  model?: string;
  fetch?: typeof fetch;
  timeoutMs?: number;
} = {}): AIProvider {
  const baseUrl = (opts.baseUrl ?? DEFAULT_OLLAMA_URL).replace(/\/$/, "");
  const model = opts.model ?? DEFAULT_OLLAMA_MODEL;
  const doFetch = opts.fetch ?? fetch;
  return {
    name: `ollama:${model}`,
    async interpret(text, ctx) {
      let res: Response;
      try {
        res = await doFetch(`${baseUrl}/api/chat`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            model,
            stream: false,
            format: wireJsonSchema,
            options: { temperature: 0 },
            messages: [
              { role: "system", content: systemPrompt(ctx) },
              { role: "user", content: text },
            ],
          }),
          signal: AbortSignal.timeout(opts.timeoutMs ?? 60_000),
        });
      } catch (e) {
        throw new OllamaUnavailableError(`Could not reach Ollama at ${baseUrl}: ${(e as Error).message}`);
      }
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        throw new OllamaUnavailableError(`Ollama returned ${res.status}: ${body.slice(0, 200)}`);
      }
      const data = (await res.json()) as { message?: { content?: string } };
      let parsed: unknown;
      try {
        parsed = JSON.parse(data.message?.content ?? "");
      } catch {
        throw new OllamaOutputError("Model reply was not valid JSON");
      }
      return wireToIntent(parsed);
    },
  };
}

/** Lists installed models, or null when Ollama isn't reachable from this browser. */
export async function ollamaModels(baseUrl = DEFAULT_OLLAMA_URL, doFetch: typeof fetch = fetch): Promise<string[] | null> {
  try {
    const res = await doFetch(`${baseUrl.replace(/\/$/, "")}/api/tags`, { signal: AbortSignal.timeout(3000) });
    if (!res.ok) return null;
    const data = (await res.json()) as { models?: { name: string }[] };
    return (data.models ?? []).map((m) => m.name);
  } catch {
    return null;
  }
}
