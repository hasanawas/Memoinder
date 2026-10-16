// Tiny in-page signals between parts of the app shell, e.g. the sidebar's
// "Coming up" list refreshes when a reminder is saved anywhere.

const CHANGED = "memoinder:reminders-changed";
const NEW_CHAT = "memoinder:new-chat";

function emit(name: string) {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(name));
}

function listen(name: string, cb: () => void) {
  window.addEventListener(name, cb);
  return () => window.removeEventListener(name, cb);
}

export const remindersChanged = () => emit(CHANGED);
export const onRemindersChanged = (cb: () => void) => listen(CHANGED, cb);
export const startNewChat = () => emit(NEW_CHAT);
export const onNewChat = (cb: () => void) => listen(NEW_CHAT, cb);
