"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { z } from "zod";
import { supabase } from "@/lib/supabase/client";
import { absoluteUrl } from "@/lib/paths";

// Passwordless sign-in: we email a 6-digit code (and a link). Typing the code
// works in any browser or installed app, which matters on iPhone, where the
// Home Screen app does not share sign-ins with Safari.

const emailSchema = z.email("Enter a valid email address");
const codeSchema = z.string().regex(/^\d{6}$/, "Enter the 6-digit code from the email");

export function LoginForm() {
  const router = useRouter();
  const [step, setStep] = useState<"email" | "code">("email");
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  // Opening the emailed link signs in here too; then go straight to the app.
  useEffect(() => {
    const { data } = supabase().auth.onAuthStateChange((_e, session) => {
      if (session) router.replace("/reminders/");
    });
    return () => data.subscription.unsubscribe();
  }, [router]);

  async function sendCode(fd: FormData) {
    setError(null);
    const parsed = emailSchema.safeParse(String(fd.get("email") ?? "").trim());
    if (!parsed.success) return setError(parsed.error.issues[0].message);
    setPending(true);
    const { error } = await supabase().auth.signInWithOtp({
      email: parsed.data,
      options: { emailRedirectTo: absoluteUrl("/login/") },
    });
    setPending(false);
    if (error) return setError(error.message);
    setEmail(parsed.data);
    setStep("code");
  }

  async function verify(fd: FormData) {
    setError(null);
    const parsed = codeSchema.safeParse(String(fd.get("code") ?? "").trim());
    if (!parsed.success) return setError(parsed.error.issues[0].message);
    setPending(true);
    const { error } = await supabase().auth.verifyOtp({ email, token: parsed.data, type: "email" });
    setPending(false);
    if (error) return setError(error.message);
    router.replace("/reminders/");
  }

  const alert = error && (
    <p role="alert" className="text-sm text-red-700 dark:text-red-400">
      {error}
    </p>
  );

  if (step === "email") {
    return (
      <form action={sendCode} className="flex flex-col gap-4">
        <label className="flex flex-col gap-1">
          <span className="text-sm font-medium">Email</span>
          <input name="email" type="email" required autoComplete="email" defaultValue={email} className="field" />
        </label>
        {alert}
        <div>
          <button disabled={pending} className="btn-primary">
            Email me a sign-in code
          </button>
        </div>
      </form>
    );
  }

  return (
    <form action={verify} className="flex flex-col gap-4">
      <p role="status" className="text-sm text-green-700 dark:text-green-400">
        We sent a 6-digit code to {email}. It is valid for one hour.
      </p>
      <label className="flex flex-col gap-1">
        <span className="text-sm font-medium">Code</span>
        <input
          name="code"
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="\d{6}"
          maxLength={6}
          required
          className="field"
        />
      </label>
      {alert}
      <div className="flex gap-3">
        <button disabled={pending} className="btn-primary">
          Sign in
        </button>
        <button type="button" className="btn-secondary" onClick={() => setStep("email")}>
          Use a different email
        </button>
      </div>
    </form>
  );
}
