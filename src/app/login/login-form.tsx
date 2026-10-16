"use client";

import { useActionState } from "react";
import { authenticate, type AuthState } from "./actions";

export function LoginForm() {
  const [state, action, pending] = useActionState(authenticate, {} as AuthState);

  return (
    <form action={action} className="flex flex-col gap-4">
      <label className="flex flex-col gap-1">
        <span className="text-sm font-medium">Email</span>
        <input name="email" type="email" required autoComplete="email" defaultValue={state.email} className="field" />
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-sm font-medium">Password</span>
        <input
          name="password"
          type="password"
          required
          minLength={8}
          autoComplete="current-password"
          className="field"
        />
      </label>
      {state.error && (
        <p role="alert" className="text-sm text-red-700 dark:text-red-400">
          {state.error}
        </p>
      )}
      {state.message && (
        <p role="status" className="text-sm text-green-700 dark:text-green-400">
          {state.message}
        </p>
      )}
      <div className="flex gap-3">
        <button name="intent" value="signin" disabled={pending} className="btn-primary">
          Sign in
        </button>
        <button name="intent" value="signup" disabled={pending} className="btn-secondary">
          Create account
        </button>
      </div>
    </form>
  );
}
