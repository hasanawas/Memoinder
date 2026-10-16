import type { Metadata } from "next";
import { Chat } from "./chat";

export const metadata: Metadata = { title: "Chat · Memoinder" };

export default function ChatPage() {
  return (
    <main className="flex flex-col gap-4">
      <h1 className="text-2xl font-semibold">Chat</h1>
      <p className="text-sm text-zinc-600 dark:text-zinc-400">
        Tell me what to remind you about. I&apos;ll show you exactly what I understood before anything is saved.
      </p>
      <Chat />
    </main>
  );
}
