// Prints a new VAPID key pair for Web Push. Free, offline, no account needed.
// Usage: npm run push:keys
const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
const b64url = (bytes) => Buffer.from(bytes).toString("base64url");
const publicKey = b64url(new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey)));
const { d: privateKey } = await crypto.subtle.exportKey("jwk", pair.privateKey);

console.log(`# Add to .env.local (the browser needs the public key):
NEXT_PUBLIC_VAPID_PUBLIC_KEY=${publicKey}

# Add to supabase/functions/.env (local) or 'npx supabase secrets set' (hosted).
# Keep VAPID_PRIVATE_KEY secret; never put it in .env.local or in git.
VAPID_PUBLIC_KEY=${publicKey}
VAPID_PRIVATE_KEY=${privateKey}
VAPID_SUBJECT=mailto:you@example.com`);
