"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { ArrowUpIcon, Logo } from "@/components/icons";
import { onNewChat } from "@/lib/events";
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
  const bottom = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
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

  // "New chat" in the sidebar starts over.
  useEffect(
    () =>
      onNewChat(() => {
        setEntries([]);
        setPending(null);
        input.current?.focus();
      }),
    [],
  );

  // Keep the newest message in view.
  useEffect(() => {
    bottom.current?.scrollIntoView?.({ behavior: "smooth", block: "end" });
  }, [entries.length, busy]);

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

  async function submitText(raw: string) {
    const text = raw.trim();
    if (!text || busy) return;
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

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const text = String(new FormData(form).get("message") ?? "");
    if (!text.trim() || busy) return;
    form.reset();
    await submitText(text);
    input.current?.focus();
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

  if (!current) return <p className="p-6 text-muted">Loading chat…</p>;

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
  const usingModel = current.mode === "auto" && Boolean(models?.includes(current.model));
  const empty = entries.length === 0;

  return (
    <div className="flex h-full flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 pb-6 pt-2">
          {empty && (
            <div className="flex flex-col items-center gap-6 pt-[12vh] text-center">
              <Logo size={44} />
              <div className="flex flex-col gap-2">
                <h2 className="text-3xl font-semibold tracking-tight">{greeting()}</h2>
                <p className="text-muted">What should I remind you about? I&apos;ll show you exactly what I understood before saving.</p>
              </div>
              <div className="grid w-full max-w-xl gap-2 sm:grid-cols-2">
                {SUGGESTIONS.map((s) => (
                  <button
                    key={s}
                    type="button"
                    disabled={busy}
                    onClick={() => submitText(s)}
                    className="card px-4 py-3 text-left text-sm transition hover:border-accent/50 hover:bg-bubble/40"
                  >
                    {s}
                  </button>
                ))}
              </div>
              <p className="text-xs text-muted md:hidden">Turn on notifications from the menu (top left) to get reminders here.</p>
            </div>
          )}

          <ol className="flex flex-col gap-6" aria-label="Conversation">
            {entries.map((e) =>
              e.from === "you" ? (
                <li
                  key={e.id}
                  className="max-w-[85%] self-end whitespace-pre-wrap rounded-3xl rounded-br-lg bg-bubble px-4 py-2.5"
                >
                  {e.text}
                </li>
              ) : (
                <li key={e.id} className="flex gap-3">
                  <span className="mt-0.5">
                    <Logo size={26} />
                  </span>
                  <div className="flex min-w-0 flex-1 flex-col gap-3 leading-relaxed">
                    <Reply entry={e} busy={busy} act={act} choose={choose} />
                    {(e.via || e.note) && (
                      <p className="text-xs text-muted">
                        {e.note ?? ""} {e.via ? `Understood by: ${e.via}.` : ""}
                      </p>
                    )}
                  </div>
                </li>
              ),
            )}
          </ol>
          {busy && (
            <div className="flex items-center gap-3" aria-hidden>
              <Logo size={26} />
              <span className="flex gap-1">
                <span className="h-2 w-2 animate-bounce rounded-full bg-muted [animation-delay:-0.3s]" />
                <span className="h-2 w-2 animate-bounce rounded-full bg-muted [animation-delay:-0.15s]" />
                <span className="h-2 w-2 animate-bounce rounded-full bg-muted" />
              </span>
            </div>
          )}
          <div ref={bottom} />
        </div>
      </div>

      <div className="shrink-0 bg-gradient-to-t from-bg via-bg to-bg/0 px-4 pb-4 pt-2">
        <form onSubmit={onSubmit} className="mx-auto w-full max-w-3xl">
          <div className="card flex items-end gap-2 rounded-3xl p-2 pl-4 transition focus-within:border-accent/60 focus-within:ring-2 focus-within:ring-accent/15">
            <textarea
              ref={input}
              name="message"
              aria-label="Message"
              autoComplete="off"
              rows={1}
              onKeyDown={(e) => {
                // Enter sends, Shift+Enter adds a line, as in other chat apps.
                if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  e.currentTarget.form?.requestSubmit();
                }
              }}
              onInput={(e) => {
                const t = e.currentTarget;
                t.style.height = "auto";
                t.style.height = `${Math.min(t.scrollHeight, 200)}px`;
              }}
              placeholder={
                pending?.need === "which" ? "Pick one above" : pending ? "Your answer…" : "Message Memoinder"
              }
              className="max-h-[200px] min-h-[40px] flex-1 resize-none bg-transparent py-2 text-base outline-none placeholder:text-muted"
            />
            <button
              aria-label="Send"
              disabled={busy}
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-accent text-accent-ink transition hover:bg-accent-hover disabled:opacity-40"
            >
              <ArrowUpIcon />
            </button>
          </div>
        </form>
        <details className="group mx-auto mt-2 w-full max-w-3xl text-xs text-muted">
          <summary className="mx-auto flex w-fit cursor-pointer list-none items-center gap-1.5 rounded-full px-3 py-1 hover:bg-bubble/70">
            <span className={`h-1.5 w-1.5 rounded-full ${usingModel ? "bg-ok" : "bg-muted"}`} aria-hidden />
            <span role="status">{aiStatus}</span>
          </summary>
          <div className="card mt-2 flex flex-col gap-3 p-4 text-sm text-ink">
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                className="accent-[var(--accent)]"
                checked={current.mode === "auto"}
                onChange={(e) => save({ ...current, mode: e.target.checked ? "auto" : "rules" })}
              />
              Use the local model when it&apos;s running
            </label>
            <div className="grid gap-3 sm:grid-cols-2">
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
            </div>
            <p className="text-xs text-muted">
              The model runs on your own computer and is called from this browser. Without it, the built-in parser
              understands everyday phrases. Set-up steps are in docs/local-ai.md.
            </p>
          </div>
        </details>
      </div>
    </div>
  );
}

const SUGGESTIONS = [
  "Remind me to call mum tomorrow at 6pm",
  "Gym every Monday and Thursday at 7am",
  "Pay rent every month on the 1st at 9am",
  "What do I have tomorrow?",
];

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
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
          <div className="card flex flex-col gap-1 border-l-4 border-l-accent p-4">
            <p className="font-medium">{r.proposal.draft.title}</p>
            <p className="text-sm">{r.proposal.summary}</p>
            <p className="text-sm text-muted">Next: {r.proposal.nextTimes.join(" · ")}</p>
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
            <p className="text-sm text-muted">Nothing scheduled.</p>
          ) : (
            <ul className="card flex flex-col divide-y divide-line text-sm">
              {r.items.map((i) => (
                <li key={i.id} className="px-4 py-2.5">
                  <strong>{i.next}</strong> {i.title} <span className="text-muted">· {i.summary}</span>
                </li>
              ))}
            </ul>
          )}
          <Link href="/reminders/list/" className="text-sm text-accent hover:underline">
            Open the full list
          </Link>
        </>
      );
  }
}
