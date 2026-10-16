export const site = {
  name: "Memoinder",
  tagline: "Your personal reminder assistant, built entirely on free and open-source tools.",
} as const;

// Phases from docs/architecture.md, shown on the home page while the app is being built.
export const phases = [
  { id: 0, title: "Project scaffold, tests and CI", done: true },
  { id: 1, title: "Reminder engine: time zones and recurrence", done: true },
  { id: 2, title: "Database, sign-in and reminder editing", done: true },
  { id: 3, title: "Chat with a local AI model", done: true },
  { id: 4, title: "Notifications with the browser closed", done: false },
  { id: 5, title: "Free deployment", done: false },
] as const;

export function progressLabel(list: ReadonlyArray<{ done: boolean }>): string {
  const done = list.filter((p) => p.done).length;
  return `${done} of ${list.length} phases complete`;
}
