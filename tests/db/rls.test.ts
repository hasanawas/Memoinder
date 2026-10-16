import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { beforeAll, describe, expect, it } from "vitest";

// Proves the database itself enforces "users only see their own reminders",
// even for someone calling the API directly with the public key.

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!;

const client = () => createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

async function newUser(): Promise<SupabaseClient> {
  const c = client();
  const email = `rls-${crypto.randomUUID()}@example.test`;
  const { error } = await c.auth.signUp({ email, password: "correct-horse-battery" });
  if (error) throw error;
  return c;
}

const reminder = {
  title: "Pay rent",
  start_local: "2030-01-01T09:00:00",
  time_zone: "Asia/Karachi",
  next_fire_at: "2030-01-01T04:00:00Z",
};

let alice: SupabaseClient;
let bob: SupabaseClient;
let aliceReminderId: string;

beforeAll(async () => {
  if (!url || !key) throw new Error("Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY (.env.local)");
  alice = await newUser();
  bob = await newUser();
  const { data, error } = await alice.from("reminders").insert(reminder).select("id").single();
  if (error) throw error;
  aliceReminderId = data.id;
});

describe("row level security on reminders", () => {
  it("lets the owner read their reminder", async () => {
    const { data } = await alice.from("reminders").select("id,title").eq("id", aliceReminderId);
    expect(data).toEqual([{ id: aliceReminderId, title: "Pay rent" }]);
  });

  it("hides it from another user", async () => {
    const { data, error } = await bob.from("reminders").select("id").eq("id", aliceReminderId);
    expect(error).toBeNull();
    expect(data).toEqual([]);
  });

  it("does not let another user change or delete it", async () => {
    const upd = await bob.from("reminders").update({ title: "hacked" }).eq("id", aliceReminderId).select("id");
    expect(upd.data).toEqual([]);
    const del = await bob.from("reminders").delete().eq("id", aliceReminderId).select("id");
    expect(del.data).toEqual([]);
    const { data } = await alice.from("reminders").select("title").eq("id", aliceReminderId).single();
    expect(data?.title).toBe("Pay rent");
  });

  it("does not let a user create a reminder owned by someone else", async () => {
    const { data: me } = await alice.auth.getUser();
    const { error } = await bob.from("reminders").insert({ ...reminder, user_id: me.user!.id });
    expect(error?.message).toMatch(/row-level security/);
  });

  it("gives signed-out visitors nothing", async () => {
    const { data, error } = await client().from("reminders").select("id");
    expect(data).toBeNull();
    expect(error?.message).toBe("permission denied for table reminders");
  });
});

describe("database checks", () => {
  it("rejects an unknown time zone", async () => {
    const { error } = await alice.from("reminders").insert({ ...reminder, time_zone: "Mars/Olympus" });
    expect(error?.message).toContain("Unknown time zone");
  });

  it("rejects an empty title", async () => {
    const { error } = await alice.from("reminders").insert({ ...reminder, title: "" });
    expect(error?.message).toContain("reminders_title_check");
  });

  it("rejects an active reminder with no next time", async () => {
    const { error } = await alice.from("reminders").insert({ ...reminder, next_fire_at: null });
    expect(error?.message).toContain("active_has_next");
  });
});
