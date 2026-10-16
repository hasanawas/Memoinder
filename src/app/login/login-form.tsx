"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { z } from "zod";
import { supabase } from "@/lib/supabase/client";
import { absoluteUrl } from "@/lib/paths";

// Passwordless sign-in: we email a link. Supabase's built-in email uses its
// default template, which has only the link; the template that also shows a
// 6-digit code needs custom SMTP. So the code box stays for when the email has
// one (local development, or custom SMTP later). The link must be opened in
// the browser that asked for it, because the sign-in is bound to that browser.

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
    <p role="alert" className="text-sm text-danger">
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
        <button disabled={pending} className="btn-primary w-full py-2.5">
          Email me a sign-in link
        </button>
      </form>
    );
  }

  return (
    <form action={verify} className="flex flex-col gap-4">
      <p role="status" className="text-sm text-ok">
        We sent a sign-in email to {email}. Open its link in this browser. If the email shows a 6-digit code, you can type it here instead.
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
      <div className="flex flex-wrap gap-3">
        <button disabled={pending} className="btn-primary flex-1">
          Sign in
        </button>
        <button type="button" className="btn-secondary" onClick={() => setStep("email")}>
          Use a different email
        </button>
      </div>
    </form>
  );
}
