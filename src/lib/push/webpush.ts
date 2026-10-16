// Standard Web Push, written against the specs with only the Web Crypto API,
// so the same file runs in Node (tests), Deno (the Edge Function) and browsers.
//
// - RFC 8291: encrypting the message for one browser subscription.
// - RFC 8188: the "aes128gcm" content encoding that carries it.
// - RFC 8292: VAPID, which proves to the push service who is sending.
//
// No push-service account or fee is involved: the browser vendors' push
// services accept any sender that signs with its own VAPID key.

export interface PushSubscriptionKeys {
  /** The browser's public key (base64url, 65 bytes uncompressed P-256). */
  p256dh: string;
  /** The browser's 16-byte authentication secret (base64url). */
  auth: string;
}

export interface PushTarget {
  endpoint: string;
  keys: PushSubscriptionKeys;
}

export interface VapidKeys {
  /** base64url, 65 bytes uncompressed P-256. Also given to the browser. */
  publicKey: string;
  /** base64url, 32 bytes. Never leaves the server. */
  privateKey: string;
  /** "mailto:you@example.com" or an https URL the push service can contact. */
  subject: string;
}

const RECORD_SIZE = 4096;
/** Push services must accept at least this much encrypted body. */
export const MAX_PAYLOAD_BYTES = 4096 - 86 - 16 - 1;

// ---------- base64url ----------

export function b64urlEncode(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function b64urlDecode(text: string): Uint8Array {
  const b64 = text.replace(/-/g, "+").replace(/_/g, "/").replace(/\s+/g, "");
  const bin = atob(b64 + "=".repeat((4 - (b64.length % 4)) % 4));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

/** Web Crypto wants a plain ArrayBuffer; copying also drops any offset. */
function ab(bytes: Uint8Array): ArrayBuffer {
  return bytes.slice().buffer as ArrayBuffer;
}

const text = new TextEncoder();

// ---------- keys ----------

function p256Jwk(publicKey: Uint8Array, privateKey?: Uint8Array): JsonWebKey {
  if (publicKey.length !== 65 || publicKey[0] !== 4) throw new Error("Expected a 65-byte uncompressed P-256 public key");
  const jwk: JsonWebKey = {
    kty: "EC",
    crv: "P-256",
    x: b64urlEncode(publicKey.slice(1, 33)),
    y: b64urlEncode(publicKey.slice(33, 65)),
    ext: true,
  };
  if (privateKey) {
    if (privateKey.length !== 32) throw new Error("Expected a 32-byte P-256 private key");
    jwk.d = b64urlEncode(privateKey);
  }
  return jwk;
}

/** Makes a new VAPID key pair in the same text format the web-push tools use. */
export async function generateVapidKeys(): Promise<{ publicKey: string; privateKey: string }> {
  const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  const raw = new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey));
  const jwk = await crypto.subtle.exportKey("jwk", pair.privateKey);
  return { publicKey: b64urlEncode(raw), privateKey: jwk.d! };
}

async function hkdf(salt: Uint8Array, ikm: Uint8Array, info: Uint8Array, bytes: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey("raw", ab(ikm), "HKDF", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "HKDF", hash: "SHA-256", salt: ab(salt), info: ab(info) },
    key,
    bytes * 8,
  );
  return new Uint8Array(bits);
}

// ---------- RFC 8291 encryption ----------

export interface EncryptOptions {
  /** Only for tests: a fixed sender key pair (normally a fresh one per message). */
  senderKeys?: { publicKey: Uint8Array; privateKey: Uint8Array };
  /** Only for tests: a fixed 16-byte salt (normally random). */
  salt?: Uint8Array;
}

/** Encrypts `plaintext` for one subscription. Returns the full aes128gcm body. */
export async function encryptPayload(
  keys: PushSubscriptionKeys,
  plaintext: Uint8Array,
  options: EncryptOptions = {},
): Promise<Uint8Array> {
  if (plaintext.length > MAX_PAYLOAD_BYTES) throw new Error(`Push payload is ${plaintext.length} bytes; the limit is ${MAX_PAYLOAD_BYTES}`);
  const uaPublic = b64urlDecode(keys.p256dh);
  const authSecret = b64urlDecode(keys.auth);
  if (authSecret.length !== 16) throw new Error("Subscription auth secret must be 16 bytes");

  let asPublic: Uint8Array;
  let asPrivate: CryptoKey;
  if (options.senderKeys) {
    asPublic = options.senderKeys.publicKey;
    asPrivate = await crypto.subtle.importKey(
      "jwk",
      p256Jwk(options.senderKeys.publicKey, options.senderKeys.privateKey),
      { name: "ECDH", namedCurve: "P-256" },
      false,
      ["deriveBits"],
    );
  } else {
    const pair = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
    asPublic = new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey));
    asPrivate = pair.privateKey;
  }
  const uaKey = await crypto.subtle.importKey("raw", ab(uaPublic), { name: "ECDH", namedCurve: "P-256" }, false, []);
  const ecdhSecret = new Uint8Array(await crypto.subtle.deriveBits({ name: "ECDH", public: uaKey }, asPrivate, 256));

  // RFC 8291 section 3.4: mix in the auth secret and both public keys.
  const keyInfo = concat(text.encode("WebPush: info\0"), uaPublic, asPublic);
  const ikm = await hkdf(authSecret, ecdhSecret, keyInfo, 32);

  // RFC 8188 section 2.2: content key and nonce.
  const salt = options.salt ?? crypto.getRandomValues(new Uint8Array(16));
  const cek = await hkdf(salt, ikm, text.encode("Content-Encoding: aes128gcm\0"), 16);
  const nonce = await hkdf(salt, ikm, text.encode("Content-Encoding: nonce\0"), 12);

  // One record; 0x02 marks it as the last one.
  const padded = concat(plaintext, new Uint8Array([2]));
  const aes = await crypto.subtle.importKey("raw", ab(cek), "AES-GCM", false, ["encrypt"]);
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: ab(nonce) }, aes, ab(padded)));

  const header = new Uint8Array(16 + 4 + 1 + asPublic.length);
  header.set(salt, 0);
  new DataView(header.buffer).setUint32(16, RECORD_SIZE);
  header[20] = asPublic.length;
  header.set(asPublic, 21);
  return concat(header, ciphertext);
}

// ---------- RFC 8292 VAPID ----------

/** Signs the short-lived token that tells the push service who we are. */
export async function vapidAuthorization(endpoint: string, vapid: VapidKeys, now: Date = new Date()): Promise<string> {
  const audience = new URL(endpoint).origin;
  const header = b64urlEncode(text.encode(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  const claims = b64urlEncode(
    text.encode(
      JSON.stringify({
        aud: audience,
        // Push services reject tokens valid for more than 24 hours.
        exp: Math.floor(now.getTime() / 1000) + 12 * 60 * 60,
        sub: vapid.subject,
      }),
    ),
  );
  const key = await crypto.subtle.importKey(
    "jwk",
    p256Jwk(b64urlDecode(vapid.publicKey), b64urlDecode(vapid.privateKey)),
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign"],
  );
  // Web Crypto returns the raw r||s form that JWS ES256 expects.
  const signature = new Uint8Array(
    await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, ab(text.encode(`${header}.${claims}`))),
  );
  return `vapid t=${header}.${claims}.${b64urlEncode(signature)}, k=${vapid.publicKey}`;
}

// ---------- sending ----------

export type PushOutcome =
  /** The push service accepted it. This is NOT proof the device showed it. */
  | "sent"
  /** The subscription no longer exists (404/410); delete it. */
  | "expired"
  /** Anything else: bad request, auth problem, rate limit, network error. */
  | "failed";

export interface PushResult {
  outcome: PushOutcome;
  status: number | null;
  error?: string;
}

export interface SendOptions {
  /** Seconds the push service keeps the message for an offline device. */
  ttl?: number;
  urgency?: "very-low" | "low" | "normal" | "high";
  /** Messages with the same topic replace each other while waiting. */
  topic?: string;
  fetch?: typeof fetch;
  now?: Date;
}

export async function sendPush(
  target: PushTarget,
  payload: string,
  vapid: VapidKeys,
  options: SendOptions = {},
): Promise<PushResult> {
  const doFetch = options.fetch ?? fetch;
  try {
    const body = await encryptPayload(target.keys, text.encode(payload));
    const headers: Record<string, string> = {
      Authorization: await vapidAuthorization(target.endpoint, vapid, options.now),
      "Content-Encoding": "aes128gcm",
      "Content-Type": "application/octet-stream",
      TTL: String(options.ttl ?? 24 * 60 * 60),
      Urgency: options.urgency ?? "high",
    };
    if (options.topic) headers.Topic = options.topic;
    const res = await doFetch(target.endpoint, { method: "POST", headers, body: ab(body) });
    if (res.status >= 200 && res.status < 300) return { outcome: "sent", status: res.status };
    const detail = (await res.text().catch(() => "")).slice(0, 300);
    if (res.status === 404 || res.status === 410) return { outcome: "expired", status: res.status, error: detail };
    return { outcome: "failed", status: res.status, error: detail || res.statusText };
  } catch (e) {
    return { outcome: "failed", status: null, error: e instanceof Error ? e.message : String(e) };
  }
}
