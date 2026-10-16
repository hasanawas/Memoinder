"use client";

import { useEffect, useState } from "react";
import { removeDeviceAction, saveDeviceAction, sendTestAction } from "@/app/reminders/notifications/actions";
import { withBase } from "@/lib/paths";
import { BellIcon } from "@/components/icons";
import { supabaseEnv } from "@/lib/supabase/env";

// Lets you turn notifications on for this browser/device. Once on, reminders
// arrive through the browser's push service even with every Memoinder tab
// closed; the server sends them, not this page.

type State =
  | { kind: "checking" }
  | { kind: "unsupported"; reason: string }
  | { kind: "denied" }
  | { kind: "off" }
  | { kind: "on"; endpoint: string };

function decodeKey(base64url: string): Uint8Array<ArrayBuffer> {
  const b64 = base64url.replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(b64 + "=".repeat((4 - (b64.length % 4)) % 4));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function isIos() {
  return /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}

function isStandalone() {
  return window.matchMedia("(display-mode: standalone)").matches || ("standalone" in navigator && navigator.standalone === true);
}

async function registration() {
  // The Service Worker is a plain static file, so it gets the (public)
  // Supabase address and key it needs for confirmations through its URL.
  const { url, key } = supabaseEnv();
  const params = new URLSearchParams({ supabaseUrl: url, supabaseKey: key });
  return navigator.serviceWorker.register(withBase(`/sw.js?${params}`), { scope: withBase("/"), updateViaCache: "none" });
}

async function detect(vapidPublicKey: string | null): Promise<State> {
  if (!vapidPublicKey) return { kind: "unsupported", reason: "Notifications are not set up on this server yet (missing VAPID public key)." };
  if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) {
    return {
      kind: "unsupported",
      reason:
        isIos() && !isStandalone()
          ? "On iPhone and iPad, first add Memoinder to your Home Screen (Share, then Add to Home Screen), then open it from there."
          : "This browser does not support web notifications.",
    };
  }
  if (Notification.permission === "denied") return { kind: "denied" };
  const reg = await registration();
  const sub = await reg.pushManager.getSubscription();
  return sub && Notification.permission === "granted" ? { kind: "on", endpoint: sub.endpoint } : { kind: "off" };
}

export function NotificationsPanel({
  vapidPublicKey,
  deviceCount,
  onChange,
}: {
  vapidPublicKey: string | null;
  deviceCount: number;
  /** Called after this device was added or removed, or a test was created. */
  onChange?: () => void;
}) {
  const [state, setState] = useState<State>({ kind: "checking" });
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    detect(vapidPublicKey)
      .catch((e): State => ({ kind: "unsupported", reason: `Could not start notifications: ${String(e)}` }))
      .then((next) => {
        if (!cancelled) setState(next);
      });
    return () => {
      cancelled = true;
    };
  }, [vapidPublicKey]);

  async function turnOn() {
    setBusy(true);
    setMessage(null);
    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setState(permission === "denied" ? { kind: "denied" } : { kind: "off" });
        return;
      }
      const reg = await registration();
      await navigator.serviceWorker.ready;
      const sub =
        (await reg.pushManager.getSubscription()) ??
        (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: decodeKey(vapidPublicKey!) }));
      const result = await saveDeviceAction(sub.toJSON(), navigator.userAgent);
      if (!result.ok) {
        setMessage(result.error);
        return;
      }
      setState({ kind: "on", endpoint: sub.endpoint });
      setMessage("Notifications are on for this device.");
      onChange?.();
    } catch (e) {
      setMessage(`Could not turn on notifications: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  }

  async function turnOff() {
    setBusy(true);
    setMessage(null);
    try {
      const reg = await registration();
      const sub = await reg.pushManager.getSubscription();
      if (sub) {
        const result = await removeDeviceAction(sub.endpoint);
        if (!result.ok) return setMessage(result.error);
        await sub.unsubscribe();
      }
      setState({ kind: "off" });
      setMessage("Notifications are off for this device.");
      onChange?.();
    } finally {
      setBusy(false);
    }
  }

  async function sendTest() {
    setBusy(true);
    setMessage(null);
    const result = await sendTestAction(Intl.DateTimeFormat().resolvedOptions().timeZone);
    setBusy(false);
    if (result.ok) onChange?.();
    setMessage(
      result.ok
        ? "Test reminder created. It should arrive within about a minute, even if you close this tab. Check its status under History."
        : result.error,
    );
  }

  const on = state.kind === "on";
  return (
    <section aria-labelledby="notifications-heading" className="card flex flex-col gap-2 p-3 text-sm">
      <h2 id="notifications-heading" className="flex items-center gap-2 font-medium">
        <BellIcon width={16} height={16} className={on ? "text-accent" : "text-muted"} />
        Notifications
        <span className={`ml-auto h-2 w-2 rounded-full ${on ? "bg-ok" : "bg-line"}`} aria-hidden />
      </h2>
      {state.kind === "checking" && <p className="text-muted">Checking this browser…</p>}
      {state.kind === "unsupported" && <p className="text-muted">{state.reason}</p>}
      {state.kind === "denied" && (
        <p className="text-muted">
          Notifications are blocked for this site. Allow them in your browser&apos;s site settings, then reload this page.
        </p>
      )}
      {state.kind === "off" && (
        <>
          <p className="text-muted">This device will not get reminders.</p>
          <button className="btn-primary w-full" onClick={turnOn} disabled={busy}>
            Turn on notifications
          </button>
        </>
      )}
      {on && (
        <>
          <p className="text-muted">This device gets reminders, even with Memoinder closed.</p>
          <div className="flex gap-2">
            <button className="btn-secondary flex-1 px-2" onClick={sendTest} disabled={busy}>
              Send a test
            </button>
            <button className="btn-secondary flex-1 px-2" onClick={turnOff} disabled={busy}>
              Turn off
            </button>
          </div>
        </>
      )}
      <p className="text-xs text-muted">
        {deviceCount === 0
          ? "No devices have notifications on."
          : `${deviceCount} ${deviceCount === 1 ? "device has" : "devices have"} notifications on.`}
      </p>
      {message && (
        <p role="status" className="text-xs">
          {message}
        </p>
      )}
      <details className="text-xs text-muted">
        <summary className="cursor-pointer hover:text-ink">How delivery works</summary>
        <p className="mt-1">
          On a phone, reminders arrive even when the browser is closed. On a computer, the browser itself must still be
          running (with no windows open is fine); if it is fully quit, the reminder waits up to 24 hours for it to start.
        </p>
      </details>
    </section>
  );
}
