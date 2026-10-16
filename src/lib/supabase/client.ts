"use client";

import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabaseEnv } from "./env";

// The one Supabase client for the whole app. It runs in the browser and sends
// the signed-in user's token with every request; Row Level Security in the
// database limits each query to that user's own rows.

let client: SupabaseClient | null = null;

export function supabase(): SupabaseClient {
  if (!client) {
    const { url, key } = supabaseEnv();
    client = createBrowserClient(url, key);
  }
  return client;
}
