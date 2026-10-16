"use client";

import { useRouter } from "next/navigation";
import { signOut, useAuth } from "@/components/auth";

export function Account() {
  const auth = useAuth();
  const router = useRouter();
  if (auth.status !== "signed-in") return null;
  return (
    <div className="flex items-center gap-3 text-sm">
      <span className="text-zinc-500">{auth.email}</span>
      <button
        className="btn-secondary"
        onClick={async () => {
          await signOut();
          router.replace("/login/");
        }}
      >
        Sign out
      </button>
    </div>
  );
}
