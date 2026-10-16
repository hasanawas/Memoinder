import type { Metadata } from "next";
import { History } from "./history";

export const metadata: Metadata = { title: "History · Memoinder" };

export default function HistoryPage() {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-6 md:py-10">
      <div className="flex flex-col gap-1">
        <h1 className="text-3xl font-semibold tracking-tight">Delivery history</h1>
        <p className="text-sm text-muted">
          &ldquo;Sent&rdquo; only means the browser&apos;s push service accepted the message. It changes to &ldquo;Shown on
          your device&rdquo; when the device itself confirms it displayed the notification.
        </p>
      </div>
      <History />
    </main>
  );
}
