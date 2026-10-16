import type { Metadata } from "next";
import Link from "next/link";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Sign in · Memoinder" };

export default function LoginPage() {
  return (
    <main className="mx-auto flex w-full max-w-sm flex-1 flex-col gap-6 px-4 py-16">
      <header className="flex flex-col gap-1">
        <Link href="/" className="text-sm text-zinc-500 hover:underline">
          Memoinder
        </Link>
        <h1 className="text-2xl font-semibold">Sign in</h1>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          Enter your email and we will send you a 6-digit sign-in code. No password needed.
        </p>
      </header>
      <LoginForm />
    </main>
  );
}
