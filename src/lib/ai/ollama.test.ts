import { describe, expect, it, vi } from "vitest";
import { createOllamaProvider, ollamaModels, OllamaOutputError, OllamaUnavailableError, wireJsonSchema, wireToIntent } from "./ollama";

const ctx = { now: new Date("2026-10-16T08:00:00Z"), timeZone: "Asia/Karachi" };
const base = { title: "", when: "", repeat: "none", interval: 1, weekdays: [], target: "", range: "all" };

function replyWith(content: string, status = 200) {
  return vi.fn(async () => new Response(JSON.stringify({ message: { role: "assistant", content } }), { status }));
}

describe("wireToIntent", () => {
  it("maps a create with a weekly repeat", () => {
    expect(
      wireToIntent({ ...base, action: "create", title: " Gym ", when: "at 7am", repeat: "weekly", weekdays: ["MO", "MO", "TH"] }),
    ).toEqual({ action: "create", title: "Gym", when: "at 7am", repeat: { freq: "weekly", interval: 1, weekdays: ["MO", "TH"] } });
  });

  it("ignores weekdays for non-weekly repeats and clamps the interval", () => {
    expect(wireToIntent({ ...base, action: "create", title: "Rent", when: "1st at 10am", repeat: "monthly", interval: 0, weekdays: ["MO"] })).toEqual({
      action: "create",
      title: "Rent",
      when: "1st at 10am",
      repeat: { freq: "monthly", interval: 1 },
    });
  });

  it("maps list, delete and reschedule", () => {
    expect(wireToIntent({ ...base, action: "list", range: "tomorrow" })).toEqual({ action: "list", range: "tomorrow" });
    expect(wireToIntent({ ...base, action: "delete", target: "gym" })).toEqual({ action: "delete", target: "gym" });
    expect(wireToIntent({ ...base, action: "reschedule", target: "gym", when: "friday 6pm" })).toEqual({
      action: "reschedule",
      target: "gym",
      when: "friday 6pm",
    });
  });

  it.each([
    [{ ...base, action: "explode" }],
    [{ ...base, action: "create", repeat: "hourly" }],
    [{ action: "create", title: "x" }],
    [{ ...base, action: "delete", target: "  " }],
  ])("rejects %j", (raw) => {
    expect(() => wireToIntent(raw)).toThrow(OllamaOutputError);
  });
});

describe("Ollama provider", () => {
  it("sends the schema, temperature 0 and the user's text, and parses the reply", async () => {
    const fetch = replyWith(JSON.stringify({ ...base, action: "create", title: "Call mum", when: "tomorrow at 6pm" }));
    const provider = createOllamaProvider({ fetch, model: "llama3.2:3b" });
    await expect(provider.interpret("remind me to call mum tomorrow at 6pm", ctx)).resolves.toEqual({
      action: "create",
      title: "Call mum",
      when: "tomorrow at 6pm",
      repeat: null,
    });
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("http://127.0.0.1:11434/api/chat");
    const body = JSON.parse(init.body as string);
    expect(body).toMatchObject({ model: "llama3.2:3b", stream: false, options: { temperature: 0 }, format: wireJsonSchema });
    expect(body.messages[1]).toEqual({ role: "user", content: "remind me to call mum tomorrow at 6pm" });
    expect(body.messages[0].content).toContain("Do NOT calculate");
  });

  it("reports invalid JSON from the model", async () => {
    const provider = createOllamaProvider({ fetch: replyWith("Sure! Here is your reminder.") });
    await expect(provider.interpret("x", ctx)).rejects.toThrow(OllamaOutputError);
  });

  it("reports when Ollama is not running", async () => {
    const fetch = vi.fn(async () => {
      throw new TypeError("Failed to fetch");
    });
    const provider = createOllamaProvider({ fetch });
    await expect(provider.interpret("x", ctx)).rejects.toThrow(OllamaUnavailableError);
  });

  it("reports a missing model (HTTP 404)", async () => {
    const provider = createOllamaProvider({ fetch: replyWith('{"error":"model not found"}', 404) });
    await expect(provider.interpret("x", ctx)).rejects.toThrow(/404/);
  });
});

describe("ollamaModels", () => {
  it("lists model names, or null when unreachable", async () => {
    const ok = vi.fn(async () => new Response(JSON.stringify({ models: [{ name: "llama3.2:3b" }] })));
    expect(await ollamaModels(undefined, ok)).toEqual(["llama3.2:3b"]);
    const down = vi.fn(async () => {
      throw new TypeError("Failed to fetch");
    });
    expect(await ollamaModels(undefined, down)).toBeNull();
  });
});
