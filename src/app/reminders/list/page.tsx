import type { Metadata } from "next";
import { RemindersView } from "./reminders-view";

export const metadata: Metadata = { title: "Reminders · Memoinder" };

export default function RemindersPage() {
  return <RemindersView />;
}
