import type { MetadataRoute } from "next";

// Lets phones install Memoinder to the Home Screen. On iPhone/iPad this is
// required before the browser allows web notifications.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Memoinder",
    short_name: "Memoinder",
    description: "Personal reminders that arrive even when the app is closed.",
    start_url: "/reminders",
    display: "standalone",
    background_color: "#ffffff",
    theme_color: "#18181b",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
  };
}
