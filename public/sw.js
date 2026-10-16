// Memoinder Service Worker. The browser runs this in the background, so a
// reminder can appear even when no Memoinder tab is open.
//
// For each push it (1) shows the notification and (2) tells the server it did,
// so the delivery status can honestly say "displayed". A tap reports "clicked".

// The page registers this file as sw.js?supabaseUrl=...&supabaseKey=... (both
// public values; the database's ack_delivery() checks a one-time token).
const config = new URL(self.location.href).searchParams;
const SUPABASE_URL = config.get("supabaseUrl");
const SUPABASE_KEY = config.get("supabaseKey");
// Everything else is relative to where the site lives (e.g. /Memoinder/).
const here = (path) => new URL(path.replace(/^\//, ""), self.registration.scope).href;

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

function ack(data, eventName) {
  if (!data || !data.deliveryId || !data.ackToken || !SUPABASE_URL || !SUPABASE_KEY) return Promise.resolve();
  return fetch(`${SUPABASE_URL}/rest/v1/rpc/ack_delivery`, {
    method: "POST",
    headers: { "Content-Type": "application/json", apikey: SUPABASE_KEY },
    body: JSON.stringify({ p_id: data.deliveryId, p_token: data.ackToken, p_event: eventName }),
    keepalive: true,
  }).catch(() => {
    // Offline right now: the notification was still shown; only the status
    // stays at "sent".
  });
}

self.addEventListener("push", (event) => {
  let data = null;
  try {
    data = event.data ? event.data.json() : null;
  } catch {
    data = null;
  }
  const title = (data && data.title) || "Memoinder reminder";
  const options = {
    body: (data && data.body) || "",
    tag: data && data.reminderId ? `reminder-${data.reminderId}` : undefined,
    renotify: Boolean(data && data.reminderId),
    requireInteraction: true,
    icon: here("icon-192.png"),
    badge: here("icon-192.png"),
    data,
  };
  event.waitUntil(self.registration.showNotification(title, options).then(() => ack(data, "displayed")));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const data = event.notification.data;
  const url = here((data && data.url) || "reminders/");
  event.waitUntil(
    Promise.all([
      ack(data, "clicked"),
      self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((windows) => {
        for (const w of windows) {
          if (w.url.startsWith(here("reminders")) && "focus" in w) return w.focus();
        }
        return self.clients.openWindow(url);
      }),
    ]),
  );
});
