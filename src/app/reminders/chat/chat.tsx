"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import type { Intent } from "@/lib/ai/intent";
import { ruleBasedProvider } from "@/lib/ai/rules";
import {
  createOllamaProvider,
  DEFAULT_OLLAMA_MODEL,
  DEFAULT_OLLAMA_URL,
  ollamaModels,
  OllamaOutputError,
} from "@/lib/ai/ollama";
import type { Clarify } from "@/lib/chat/resolve";
import { confirmCreate, confirmDelete, confirmReschedule, respond, type ChatReply } from "./actions";

type Mode = "auto" | "rules";
interface Settings {
  mode: Mode;
  model: string;
  url: string;
}

type Entry =
  | { id: number; from: "you"; text: string }
  | { id: number; from: "app"; reply: ChatReply; via?: string; note?: string; done?: boolean };

type NewEntry = Entry extends unknown ? (Entry extends infer E ? (E extends unknown ? Omit<E, "id"> : never) : never) : never;

const SETTINGS_KEY = "memoinder.ai";
const noopSubscribe = () => () => {};

function loadSettings(): Settings {
  const fallback = { mode: "auto" as Mode, model: DEFAULT_OLLAMA_MODEL, url: DEFAULT_OLLAMA_URL };
  try {
    return { ...fallback, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? "{}") };
  } catch {
    return fallback;
  }
}

/** Fills in a pending question with what the user typed. */
function answer(pending: Clarify, text: string): Intent {
  const p = pending.pending;
  if (pending.need === "title" && p.action === "create") return { ...p, title: text };
  if (p.action === "create" || p.action === "reschedule") return { ...p, when: `${p.when} ${text}`.trim() };
  return p;
}

export function Chat() {
  const onClient = useSyncExternalStore(noopSubscribe, () => true, () => false);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [models, setModels] = useState<string[] | null | undefined>(undefined);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [pending, setPending] = useState<Clarify | null>(null);
  const [busy, setBusy] = useState(false);
  const nextId = useRef(1);
  const timeZone = onClient ? Intl.DateTimeFormat().resolvedOptions().timeZone : "UTC";
  const current = settings ?? (onClient ? loadSettings() : null);

  // Check once whether Ollama answers from this browser.
  useEffect(() => {
    if (!current || current.mode === "rules") return;
    let cancelled = false;
    ollamaModels(current.url).then((m) => !cancelled && setModels(m));
    return () => {
      cancelled = true;
    };
  }, [current?.mode, current?.url]); // eslint-disable-line react-hooks/exhaustive-deps

  function save(next: Settings) {
    setSettings(next);
    setModels(undefined);
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(next));
    } catch {
      // Private browsing: settings just won't persist.
    }
  }

  const push = (e: NewEntry) => setEntries((xs) => [...xs, { ...e, id: nextId.current++ } as Entry]);
  const markDone = (id: number) => setEntries((xs) => xs.map((x) => (x.id === id ? { ...x, done: true } : x)));

  async function interpret(text: string): Promise<{ intent: Intent; via: string; note?: string }> {
    const ctx = { now: new Date(), timeZone };
    const s = current!;
    const useModel = s.mode === "auto" && models && models.includes(s.model);
    if (useModel) {
      try {
        const intent = await createOllamaProvider({ baseUrl: s.url, model: s.model }).interpret(text, ctx);
        return { intent, via: `local model (${s.model})` };
      } catch (e) {
        const why = e instanceof OllamaOutputError ? "gave an unusable answer" : "could not be reached";
        return {
          intent: await ruleBasedProvider.interpret(text, ctx),
          via: "built-in parser",
          note: `The local model ${why}, so the built-in parser handled this.`,
        };
      }
    }
    return { intent: await ruleBasedProvider.interpret(text, ctx), via: "built-in parser" };
  }

  async function send(intent: Intent, via?: string, note?: string) {
    const reply = await respond(intent, timeZone);
    setPending(reply.kind === "clarify" ? reply : null);
    push({ from: "app", reply, via, note });
  }

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const text = String(new FormData(form).get("message") ?? "").trim();
    if (!text || busy) return;
    form.reset();
    push({ from: "you", text });
    setBusy(true);
    try {
      if (pending && pending.need !== "which") {
        await send(answer(pending, text), "your answer");
      } else {
        const { intent, via, note } = await interpret(text);
        await send(intent, via, note);
      }
    } catch (err) {
      push({ from: "app", reply: { kind: "message", text: `Something went wrong: ${(err as Error).message}` } });
    } finally {
      setBusy(false);
    }
  }

  async function act(entryId: number, run: () => Promise<{ ok: boolean; text: string }>) {
    setBusy(true);
    try {
      const r = await run();
      markDone(entryId);
      push({ from: "app", reply: { kind: "message", text: r.text } });
    } finally {
      setBusy(false);
    }
  }

  async function choose(entryId: number, intent: Intent, label: string) {
    markDone(entryId);
    push({ from: "you", text: label });
    setBusy(true);
    try {
      await send(intent, "your choice");
    } finally {
      setBusy(false);
    }
  }

  if (!current) return <p className="text-zinc-500">Loading chat…</p>;

  const aiStatus =
    current.mode === "rules"
      ? "Built-in parser only"
      : models === undefined
        ? "Checking for a local model…"
        : models === null
          ? "Local model not reachable, using the built-in parser"
          : models.includes(current.model)
            ? `Local model: ${current.model}`
            : `Ollama is running but ${current.model} is not installed, using the built-in parser`;

  return (
    <div className="flex flex-col gap-4">
      <details className="rounded-md border border-zinc-200 p-3 text-sm dark:border-zinc-800">
        <summary className="cursor-pointer">
          <span role="status">{aiStatus}</span>
        </summary>
        <div className="mt-3 flex flex-col gap-3">
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={current.mode === "auto"}
              onChange={(e) => save({ ...current, mode: e.target.checked ? "auto" : "rules" })}
            />
            Use the local model when it&apos;s running
          </label>
          <label className="flex flex-col gap-1">
            Model
            <input
              className="field"
              defaultValue={current.model}
              onBlur={(e) => save({ ...current, model: e.target.value.trim() || DEFAULT_OLLAMA_MODEL })}
            />
          </label>
          <label className="flex flex-col gap-1">
            Ollama address
            <input
              className="field"
              defaultValue={current.url}
              onBlur={(e) => save({ ...current, url: e.target.value.trim() || DEFAULT_OLLAMA_URL })}
            />
          </label>
          <p className="text-xs text-zinc-500">
            The model runs on your computer and is called from this browser. Set-up steps are in docs/local-ai.md.
          </p>
        </div>
      </details>

      <ol className="flex flex-col gap-3" aria-label="Conversation">
        {entries.map((e) =>
          e.from === "you" ? (
            <li key={e.id} className="self-end rounded-lg bg-zinc-900 px-3 py-2 text-white dark:bg-zinc-100 dark:text-zinc-900">
              {e.text}
            </li>
          ) : (
            <li key={e.id} className="flex flex-col gap-2 rounded-lg border border-zinc-200 p-3 dark:border-zinc-800">
              <Reply entry={e} busy={busy} act={act} choose={choose} />
              {(e.via || e.note) && (
                <p className="text-xs text-zinc-500">
                  {e.note ?? ""} {e.via ? `Understood by: ${e.via}.` : ""}
                </p>
              )}
            </li>
          ),
        )}
      </ol>

      <form onSubmit={onSubmit} className="flex gap-2">
        <input
          name="message"
          aria-label="Message"
          autoComplete="off"
          placeholder={pending?.need === "which" ? "Pick one above" : pending ? "Your answer…" : 'e.g. "remind me to call mum tomorrow at 6pm"'}
          className="field flex-1"
        />
        <button className="btn-primary" disabled={busy}>
          {busy ? "…" : "Send"}
        </button>
      </form>
    </div>
  );
}

function Reply({
  entry,
  busy,
  act,
  choose,
}: {
  entry: Extract<Entry, { from: "app" }>;
  busy: boolean;
  act: (id: number, run: () => Promise<{ ok: boolean; text: string }>) => void;
  choose: (id: number, intent: Intent, label: string) => void;
}) {
  const r = entry.reply;
  const off = busy || entry.done;
  const buttons = (confirmLabel: string, run: () => Promise<{ ok: boolean; text: string }>) =>
    !entry.done && (
      <div className="flex gap-2">
        <button className="btn-primary" disabled={off} onClick={() => act(entry.id, run)}>
          {confirmLabel}
        </button>
        <button className="btn-secondary" disabled={off} onClick={() => act(entry.id, async () => ({ ok: true, text: "Cancelled. Nothing was changed." }))}>
          Cancel
        </button>
      </div>
    );

  switch (r.kind) {
    case "message":
      return <p>{r.text}</p>;
    case "clarify":
      return (
        <>
          <p>{r.question}</p>
          {r.options && !entry.done && (
            <div className="flex flex-wrap gap-2">
              {r.options.map((o) => (
                <button key={o.label} className="btn-secondary" disabled={off} onClick={() => choose(entry.id, o.intent, o.label)}>
                  {o.label}
                </button>
              ))}
            </div>
          )}
        </>
      );
    case "proposal-create":
    case "proposal-reschedule":
      return (
        <>
          <p>
            {r.kind === "proposal-create" ? "Create this reminder?" : `Move "${r.title}" to this schedule?`}
          </p>
          <div className="rounded-md bg-zinc-50 p-3 dark:bg-zinc-900">
            <p className="font-medium">{r.proposal.draft.title}</p>
            <p className="text-sm">{r.proposal.summary}</p>
            <p className="text-sm text-zinc-500">Next: {r.proposal.nextTimes.join(" · ")}</p>
          </div>
          {buttons(r.kind === "proposal-create" ? "Create" : "Move", () =>
            r.kind === "proposal-create" ? confirmCreate(r.proposal.draft) : confirmReschedule(r.id, r.proposal.draft),
          )}
        </>
      );
    case "proposal-delete":
      return (
        <>
          <p>
            Delete &quot;{r.title}&quot;{r.next ? ` (next: ${r.next})` : ""}?
          </p>
          {buttons("Delete", () => confirmDelete(r.id))}
        </>
      );
    case "list":
      return (
        <>
          <p className="font-medium">{r.heading}</p>
          {r.items.length === 0 ? (
            <p className="text-sm text-zinc-500">Nothing scheduled.</p>
          ) : (
            <ul className="flex flex-col gap-1 text-sm">
              {r.items.map((i) => (
                <li key={i.id}>
                  <strong>{i.next}</strong> {i.title} <span className="text-zinc-500">· {i.summary}</span>
                </li>
              ))}
            </ul>
          )}
          <Link href="/reminders" className="text-sm underline">
            Open the full list
          </Link>
        </>
      );
  }
}
