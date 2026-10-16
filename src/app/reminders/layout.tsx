import { RequireSignIn } from "@/components/auth";
import { AppShell } from "@/components/app-shell";

export default function RemindersLayout({ children }: LayoutProps<"/reminders">) {
  return (
    <RequireSignIn>
      <AppShell>{children}</AppShell>
    </RequireSignIn>
  );
}
