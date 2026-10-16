# Chat and the local AI model (Phase 3)

Memoinder's chat turns messages like "gym every Monday and Thursday at 7am" into reminders. It never needs a paid AI API. It has two interchangeable "providers":

| Provider | Where it runs | Good at |
|---|---|---|
| **Built-in parser** (`src/lib/ai/rules.ts`) | Anywhere, including phones. No set-up. | Common phrasings: "remind me to X tomorrow at 9am", "every Monday at 8", "what's on tomorrow", "delete the gym reminder", "move dentist to Friday at 4pm" |
| **Local model via Ollama** (`src/lib/ai/ollama.ts`) | On your own computer | Looser phrasing: "rent is due next Friday, ping me at 10am", "get rid of the gym reminder" |

If the local model isn't running, gives an unusable answer, or isn't installed, the chat says so and uses the built-in parser for that message.

## How a message becomes a reminder

```
your message
   │  provider (built-in parser OR local model)
   ▼
Intent  {action:"create", title:"Gym", when:"at 7am", repeat:{weekly, MO, TH}}
   │  checked against a Zod schema; anything malformed is rejected
   ▼
src/lib/chat/resolve.ts (no AI)  →  exact start "2026-10-19T07:00", next 3 times
   │  or a question: "What time on Saturday 17 Oct?", "5 in the morning or the evening?"
   ▼
confirmation card  →  you press Create  →  saved (server re-validates everything)
```

The model is only asked **what** you want, using your own words for the time. All date arithmetic happens in code (`chrono-node` reads the words, Luxon and `rrule` do the maths), so a model can't put a reminder on the wrong day. Nothing is saved, moved or deleted until you press the button.

To use a different model or a different AI system later, write another `AIProvider` (`src/lib/ai/intent.ts`). Nothing else changes.

## Conversation memory and small talk

The chat remembers what it is talking about, without any AI model (`src/lib/chat/conversation.ts`):

- **Follow-ups:** after a suggestion or a save, "make it 7pm", "friday instead" or "no, 8am" change that reminder, keeping the day or the time you didn't mention. "Delete it" and "move that to Monday" mean the reminder just discussed.
- **Small talk:** "hi", "thanks", "how are you", "who are you" and "help" get a short answer. Each kind of answer rotates through a few wordings, so the chat doesn't repeat the same sentence.
- **History:** the conversation is kept in this browser (localStorage), so a reload or another page doesn't lose it. **New chat** clears it. It never leaves the browser.

The hosted site has no AI model (a hosted model API would not be free), so the wording of answers is written by hand. With Ollama running, the model reads your messages, but the answers are still these.

## Setting up Ollama (optional)

**Computer requirements.** These are practical guidance, not an official spec:

| Model | Download | Memory | Speed on a typical laptop CPU |
|---|---|---|---|
| `llama3.2:3b` (default) | 2.0 GB | 8 GB RAM | a few seconds per message |
| `llama3.2:1b` (lighter) | 1.3 GB | 4–8 GB RAM | faster, less accurate |

Apple Silicon Macs and computers with a recent GPU are much faster.

1. Install Ollama from ollama.com (Windows, macOS or Linux). It is free and open source.
2. Download the model: `ollama pull llama3.2:3b`
3. Let Memoinder's page talk to it. By default Ollama only accepts browser requests from `127.0.0.1` pages, so set `OLLAMA_ORIGINS` to the addresses you open Memoinder at, then restart Ollama:
   - Value: `http://localhost:3000,http://127.0.0.1:3000` (for the deployed site also add `https://hasanawas.github.io`)
   - **macOS app:** `launchctl setenv OLLAMA_ORIGINS "http://localhost:3000,http://127.0.0.1:3000"`, then quit and reopen Ollama
   - **Linux (systemd):** `systemctl edit ollama.service`, add `Environment="OLLAMA_ORIGINS=http://localhost:3000,http://127.0.0.1:3000"` under `[Service]`, then `systemctl daemon-reload && systemctl restart ollama`
   - **Windows:** quit Ollama, add `OLLAMA_ORIGINS` under "Edit environment variables for your account", then start Ollama again
4. Open the chat page. The status line at the top should read **Local model: llama3.2:3b**. Open it to switch models, change the address, or turn the model off.

**How the app reaches it.** Your **browser** calls `http://127.0.0.1:11434` directly. A hosted server can't reach your computer, but the page running on your computer can. Your message goes only to Ollama on your machine. Only the confirmed reminder is sent to the database. Newer Chrome versions may ask once for permission to access devices on your local network; allow it.

**Not yet verified:** whether every browser allows a deployed `https://` page to call `http://127.0.0.1`. Safari is the most likely to block it. That gets checked in Phase 5. If it's blocked, run the app locally (`npm run dev`) on that computer for model-assisted chat; the built-in parser works everywhere either way.

## Measuring accuracy

`tests/eval/cases.ts` holds phrasings and the exact result each should produce. Run:

```bash
npm run eval:ai                              # built-in parser only
OLLAMA_MODEL=llama3.2:3b npm run eval:ai     # also your local model
```

It prints a score and every miss. Current result for the built-in parser: **17 of 19**. The two misses are the free-form ones the model is there for. The local model's score has **not been measured yet**: the development environment used to build this phase couldn't download models, because its network blocks ollama.com. Run the command above on your computer to get the real number, and add your own phrasings to the cases file.

## Tests

- `src/lib/ai/rules.test.ts`: the built-in parser.
- `src/lib/ai/ollama.test.ts`: the request sent to Ollama, the schema check, and errors (not running, missing model, non-JSON answers).
- `src/lib/chat/resolve.test.ts`: date resolution, daylight saving, questions, matching reminders by name, listing by day.
- `tests/e2e/chat.spec.ts`: the chat in a real browser. One set of tests uses the built-in parser. The other fakes Ollama's HTTP API to check the model path and the fallback when the model answers nonsense.

## Troubleshooting

| Status line says | Fix |
|---|---|
| Local model not reachable | Ollama isn't running, or `OLLAMA_ORIGINS` doesn't include this page's address (the browser console shows a CORS error) |
| Ollama is running but the model is not installed | `ollama pull llama3.2:3b`, or change the model name in the chat settings |
| The local model gave an unusable answer | The answer failed the schema check; the built-in parser handled it. Try a bigger model if this happens a lot |
