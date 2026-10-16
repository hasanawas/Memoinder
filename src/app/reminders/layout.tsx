import Link from "next/link";
import { Account } from "./account";
import { RequireSignIn } from "@/components/auth";

export default function RemindersLayout({ children }: LayoutProps<"/reminders">) {
  return (
    <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-6 px-4 py-10">
      <RequireSignIn>
        <header className="flex items-center justify-between gap-4">
          <Link href="/reminders/" className="text-xl font-semibold">
            Memoinder
          </Link>
          <Account />
        </header>
        {children}
      </RequireSignIn>
    </div>
  );
}
