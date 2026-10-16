import type { Metadata } from "next";
import "./globals.css";
import { site } from "@/lib/site";

export const metadata: Metadata = {
  title: site.name,
  description: site.tagline,
  // iPhone/iPad use these when Memoinder is added to the Home Screen.
  appleWebApp: { capable: true, title: site.name },
  icons: { apple: "/icon-192.png" },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
