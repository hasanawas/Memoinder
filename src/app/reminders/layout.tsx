import { Suspense } from "react";
import Link from "next/link";
import { requireUser } from "@/lib/reminders/data";
import { signOut } from "@/app/login/actions";

export default function RemindersLayout({ children }: LayoutProps<"/reminders">) {
  return (
    <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-6 px-4 py-10">
      <header className="flex items-center justify-between gap-4">
        <Link href="/reminders" className="text-xl font-semibold">
          Memoinder
        </Link>
        <Suspense fallback={null}>
          <Account />
        </Suspense>
      </header>
      {children}
    </div>
  );
}

async function Account() {
  const { email } = await requireUser();
  return (
    <form action={signOut} className="flex items-center gap-3 text-sm">
      <span className="text-zinc-500">{email}</span>
      <button className="btn-secondary">Sign out</button>
    </form>
  );
}
