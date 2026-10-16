import type { MetadataRoute } from "next";
import { withBase } from "@/lib/paths";

// Lets phones install Memoinder to the Home Screen. On iPhone/iPad this is
// required before the browser allows web notifications.
export const dynamic = "force-static";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Memoinder",
    short_name: "Memoinder",
    description: "Personal reminders that arrive even when the app is closed.",
    start_url: withBase("/reminders/"),
    scope: withBase("/"),
    display: "standalone",
    background_color: "#ffffff",
    theme_color: "#18181b",
    icons: [
      { src: withBase("/icon-192.png"), sizes: "192x192", type: "image/png" },
      { src: withBase("/icon-512.png"), sizes: "512x512", type: "image/png" },
    ],
  };
}
