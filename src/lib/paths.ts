// The site may be served under a prefix (GitHub Pages: /Memoinder). Next.js
// adds it to <Link> and router URLs by itself; anything built by hand (the
// Service Worker, icons, email redirect links) uses these helpers.

export const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

/** "/reminders/" -> "/Memoinder/reminders/" */
export function withBase(path: string): string {
  return `${basePath}${path}`;
}

/** Absolute URL of a page in this app, for links that leave the browser (emails). */
export function absoluteUrl(path: string): string {
  return `${window.location.origin}${withBase(path)}`;
}
