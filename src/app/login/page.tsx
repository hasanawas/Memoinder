import type { Metadata } from "next";
import Link from "next/link";
import { Logo } from "@/components/icons";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Sign in · Memoinder" };

export default function LoginPage() {
  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center gap-6 px-4 py-16">
      <header className="flex flex-col items-center gap-4 text-center">
        <Link href="/" aria-label="Memoinder home">
          <Logo size={44} />
        </Link>
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold tracking-tight">Sign in</h1>
          <p className="text-sm text-muted">Enter your email and we will send you a sign-in link. No password needed.</p>
        </div>
      </header>
      <div className="card p-6">
        <LoginForm />
      </div>
    </main>
  );
}
