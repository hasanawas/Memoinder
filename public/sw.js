// Memoinder Service Worker. The browser runs this in the background, so a
// reminder can appear even when no Memoinder tab is open.
//
// For each push it (1) shows the notification and (2) tells the server it did,
// so the delivery status can honestly say "displayed". A tap reports "clicked".

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

function ack(data, eventName) {
  if (!data || !data.deliveryId || !data.ackToken) return Promise.resolve();
  return fetch("/api/deliveries/ack", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id: data.deliveryId, token: data.ackToken, event: eventName }),
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
    icon: "/icon-192.png",
    badge: "/icon-192.png",
    data,
  };
  event.waitUntil(self.registration.showNotification(title, options).then(() => ack(data, "displayed")));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const data = event.notification.data;
  const url = (data && data.url) || "/reminders";
  event.waitUntil(
    Promise.all([
      ack(data, "clicked"),
      self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((windows) => {
        for (const w of windows) {
          if (new URL(w.url).pathname.startsWith("/reminders") && "focus" in w) return w.focus();
        }
        return self.clients.openWindow(url);
      }),
    ]),
  );
});
