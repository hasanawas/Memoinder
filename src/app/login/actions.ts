"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

export interface AuthState {
  error?: string;
  message?: string;
  email?: string;
}

const credentials = z.object({
  email: z.email("Enter a valid email address"),
  password: z.string().min(8, "Use at least 8 characters for the password"),
});

function read(fd: FormData) {
  return credentials.safeParse({ email: fd.get("email"), password: fd.get("password") });
}

/** One form, two buttons: the clicked button's name="intent" says which. */
export async function authenticate(_prev: AuthState, fd: FormData): Promise<AuthState> {
  const parsed = read(fd);
  const email = String(fd.get("email") ?? "");
  if (!parsed.success) return { error: parsed.error.issues[0].message, email };
  const supabase = await createClient();

  if (fd.get("intent") === "signup") {
    const { data, error } = await supabase.auth.signUp(parsed.data);
    if (error) return { error: error.message, email };
    // With email confirmation on (the hosted default), there is no session yet.
    if (!data.session) return { message: "Check your email to confirm your account, then sign in.", email };
  } else {
    const { error } = await supabase.auth.signInWithPassword(parsed.data);
    if (error) return { error: error.message, email };
  }
  redirect("/reminders");
}

export async function signOut(): Promise<void> {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}
