"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase/client";

// Keeps signed-out visitors away from the reminder pages. This is only for a
// pleasant experience: without a valid session the database returns nothing.

type Auth = { status: "loading" } | { status: "signed-in"; email: string; userId: string } | { status: "signed-out" };

const AuthContext = createContext<Auth>({ status: "loading" });

export function useAuth() {
  return useContext(AuthContext);
}

export function RequireSignIn({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [auth, setAuth] = useState<Auth>({ status: "loading" });

  useEffect(() => {
    const client = supabase();
    const apply = (session: Awaited<ReturnType<typeof client.auth.getSession>>["data"]["session"]) =>
      setAuth(session ? { status: "signed-in", email: session.user.email ?? "", userId: session.user.id } : { status: "signed-out" });
    client.auth.getSession().then(({ data }) => apply(data.session));
    const { data } = client.auth.onAuthStateChange((_event, session) => apply(session));
    return () => data.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (auth.status === "signed-out") router.replace("/login/");
  }, [auth.status, router]);

  if (auth.status !== "signed-in") {
    return (
      <div className="flex flex-1 items-center justify-center p-10 text-muted">
        {auth.status === "loading" ? "Loading…" : "Redirecting to sign in…"}
      </div>
    );
  }
  return <AuthContext.Provider value={auth}>{children}</AuthContext.Provider>;
}

export async function signOut() {
  await supabase().auth.signOut();
}
