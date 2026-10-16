// Test-only: plays the browser's part of Web Push, so tests can check that
// what the dispatcher sends really decrypts and carries a valid VAPID token.
import { b64urlDecode, b64urlEncode } from "../../src/lib/push/webpush.ts";

const text = new TextEncoder();
const ab = (u: Uint8Array) => u.slice().buffer as ArrayBuffer;

async function hkdf(salt: Uint8Array, ikm: Uint8Array, info: Uint8Array, bytes: number) {
  const key = await crypto.subtle.importKey("raw", ab(ikm), "HKDF", false, ["deriveBits"]);
  return new Uint8Array(
    await crypto.subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt: ab(salt), info: ab(info) }, key, bytes * 8),
  );
}

export interface FakeBrowser {
  keys: { p256dh: string; auth: string };
  decrypt(body: Uint8Array): Promise<string>;
}

/** A fresh browser-side key pair, like PushManager.subscribe() makes. */
export async function fakeBrowser(): Promise<FakeBrowser> {
  const pair = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
  const uaPublic = new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey));
  const auth = crypto.getRandomValues(new Uint8Array(16));
  return {
    keys: { p256dh: b64urlEncode(uaPublic), auth: b64urlEncode(auth) },
    async decrypt(body) {
      const salt = body.slice(0, 16);
      const idlen = body[20];
      const asPublic = body.slice(21, 21 + idlen);
      const ciphertext = body.slice(21 + idlen);
      const asKey = await crypto.subtle.importKey("raw", ab(asPublic), { name: "ECDH", namedCurve: "P-256" }, false, []);
      const secret = new Uint8Array(await crypto.subtle.deriveBits({ name: "ECDH", public: asKey }, pair.privateKey, 256));
      const info = new Uint8Array([...text.encode("WebPush: info\0"), ...uaPublic, ...asPublic]);
      const ikm = await hkdf(auth, secret, info, 32);
      const cek = await hkdf(salt, ikm, text.encode("Content-Encoding: aes128gcm\0"), 16);
      const nonce = await hkdf(salt, ikm, text.encode("Content-Encoding: nonce\0"), 12);
      const key = await crypto.subtle.importKey("raw", ab(cek), "AES-GCM", false, ["decrypt"]);
      const padded = new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv: ab(nonce) }, key, ab(ciphertext)));
      let end = padded.length - 1;
      while (end >= 0 && padded[end] === 0) end--;
      if (padded[end] !== 2) throw new Error("Missing last-record delimiter");
      return new TextDecoder().decode(padded.slice(0, end));
    },
  };
}

/** Checks a "vapid t=..., k=..." header the way a push service does. */
export async function verifyVapid(header: string, endpoint: string) {
  const m = /^vapid t=([\w-]+)\.([\w-]+)\.([\w-]+), k=([\w-]+)$/.exec(header);
  if (!m) throw new Error(`Malformed VAPID header: ${header}`);
  const [, h, c, sig, k] = m;
  const pub = await crypto.subtle.importKey("raw", ab(b64urlDecode(k)), { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]);
  const ok = await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, pub, ab(b64urlDecode(sig)), ab(text.encode(`${h}.${c}`)));
  const claims = JSON.parse(new TextDecoder().decode(b64urlDecode(c))) as { aud: string; exp: number; sub: string };
  return { ok, claims, publicKey: k, audienceMatches: claims.aud === new URL(endpoint).origin };
}
