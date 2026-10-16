import { describe, expect, it, vi } from "vitest";
import { fakeBrowser, verifyVapid } from "../../../tests/support/push-receiver.ts";
import { b64urlDecode, b64urlEncode, encryptPayload, generateVapidKeys, MAX_PAYLOAD_BYTES, sendPush, vapidAuthorization } from "./webpush.ts";

describe("encryptPayload", () => {
  it("matches the worked example in RFC 8291 Appendix A", async () => {
    // Every value below is copied from RFC 8291 Appendix A.
    const body = await encryptPayload(
      { p256dh: "BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4", auth: "BTBZMqHH6r4Tts7J_aSIgg" },
      b64urlDecode("V2hlbiBJIGdyb3cgdXAsIEkgd2FudCB0byBiZSBhIHdhdGVybWVsb24"),
      {
        senderKeys: {
          publicKey: b64urlDecode("BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8"),
          privateKey: b64urlDecode("yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw"),
        },
        salt: b64urlDecode("DGv6ra1nlYgDCS1FRnbzlw"),
      },
    );
    const header = b64urlDecode("DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8");
    const ciphertext = b64urlDecode("8pfeW0KbunFT06SuDKoJH9Ql87S1QUrdirN6GcG7sFz1y1sqLgVi1VhjVkHsUoEsbI_0LpXMuGvnzQ");
    expect(b64urlEncode(body.slice(0, 86))).toBe(b64urlEncode(header));
    expect(b64urlEncode(body.slice(86))).toBe(b64urlEncode(ciphertext));
  });

  it("produces a message a browser key pair can decrypt", async () => {
    const browser = await fakeBrowser();
    const body = await encryptPayload(browser.keys, new TextEncoder().encode('{"title":"Call mum"}'));
    expect(await browser.decrypt(body)).toBe('{"title":"Call mum"}');
  });

  it("uses a fresh key and salt every time", async () => {
    const browser = await fakeBrowser();
    const msg = new TextEncoder().encode("same");
    const a = await encryptPayload(browser.keys, msg);
    const b = await encryptPayload(browser.keys, msg);
    expect(b64urlEncode(a)).not.toBe(b64urlEncode(b));
  });

  it("refuses payloads the push services may reject", async () => {
    const browser = await fakeBrowser();
    await expect(encryptPayload(browser.keys, new Uint8Array(MAX_PAYLOAD_BYTES + 1))).rejects.toThrow(/limit/);
  });
});

describe("VAPID", () => {
  it("signs a token the push service can verify", async () => {
    const keys = await generateVapidKeys();
    expect(b64urlDecode(keys.publicKey)).toHaveLength(65);
    expect(b64urlDecode(keys.privateKey)).toHaveLength(32);
    const endpoint = "https://fcm.googleapis.com/fcm/send/abc";
    const now = new Date("2026-10-16T10:00:00Z");
    const header = await vapidAuthorization(endpoint, { ...keys, subject: "mailto:me@example.com" }, now);
    const v = await verifyVapid(header, endpoint);
    expect(v.ok).toBe(true);
    expect(v.audienceMatches).toBe(true);
    expect(v.publicKey).toBe(keys.publicKey);
    expect(v.claims.sub).toBe("mailto:me@example.com");
    expect(v.claims.exp - now.getTime() / 1000).toBe(12 * 3600);
  });
});

describe("sendPush", () => {
  async function setup(status: number) {
    const browser = await fakeBrowser();
    const vapid = { ...(await generateVapidKeys()), subject: "mailto:me@example.com" };
    const fetchMock = vi.fn<(url: string | URL | Request, init?: RequestInit) => Promise<Response>>(async () => new Response("nope", { status }));
    const target = { endpoint: "https://push.example.net/sub/1", keys: browser.keys };
    return { browser, vapid, fetchMock, target };
  }

  it("posts an encrypted body with the standard headers", async () => {
    const { browser, vapid, fetchMock, target } = await setup(201);
    const result = await sendPush(target, "hello", vapid, { fetch: fetchMock as typeof fetch, ttl: 600, topic: "abc" });
    expect(result).toEqual({ outcome: "sent", status: 201 });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(target.endpoint);
    const headers = init!.headers as Record<string, string>;
    expect(headers["Content-Encoding"]).toBe("aes128gcm");
    expect(headers.TTL).toBe("600");
    expect(headers.Topic).toBe("abc");
    expect((await verifyVapid(headers.Authorization, target.endpoint)).ok).toBe(true);
    expect(await browser.decrypt(new Uint8Array(init!.body as ArrayBuffer))).toBe("hello");
  });

  it.each([404, 410])("reports %i as an expired subscription", async (status) => {
    const { vapid, fetchMock, target } = await setup(status);
    expect((await sendPush(target, "x", vapid, { fetch: fetchMock as typeof fetch })).outcome).toBe("expired");
  });

  it.each([400, 403, 413, 429, 500])("reports %i as failed", async (status) => {
    const { vapid, fetchMock, target } = await setup(status);
    const r = await sendPush(target, "x", vapid, { fetch: fetchMock as typeof fetch });
    expect(r).toMatchObject({ outcome: "failed", status, error: "nope" });
  });

  it("reports a network error as failed instead of throwing", async () => {
    const { vapid, target } = await setup(201);
    const r = await sendPush(target, "x", vapid, { fetch: (async () => { throw new TypeError("connection refused"); }) as typeof fetch });
    expect(r).toEqual({ outcome: "failed", status: null, error: "connection refused" });
  });
});
