import type { Metadata } from "next";
import { Chat } from "./chat/chat";

export const metadata: Metadata = { title: "Chat · Memoinder" };

// The app opens on the chat, like a chat assistant; the full list is one
// click away in the sidebar.
export default function ChatPage() {
  return (
    <main className="flex h-full flex-col">
      <h1 className="sr-only">Chat</h1>
      <Chat />
    </main>
  );
}
