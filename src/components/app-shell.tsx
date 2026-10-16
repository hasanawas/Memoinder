"use client";

import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { DateTime } from "luxon";
import { signOut, useAuth } from "@/components/auth";
import { NotificationsPanel } from "@/components/notifications-panel";
import { ChatIcon, CloseIcon, HistoryIcon, ListIcon, Logo, MenuIcon, PenIcon, PlusIcon } from "@/components/icons";
import { listReminders } from "@/lib/reminders/data";
import { countDevices } from "@/lib/push/data";
import { onRemindersChanged, startNewChat } from "@/lib/events";
import { useLoad } from "@/lib/use-load";

// The signed-in layout: a sidebar (a drawer on phones) with navigation, what
// is coming up and the notification switch, next to the page itself.

const NAV = [
  { href: "/reminders/", label: "Chat", icon: ChatIcon },
  { href: "/reminders/list/", label: "Reminders", icon: ListIcon },
  { href: "/reminders/history/", label: "History", icon: HistoryIcon },
  { href: "/reminders/new/", label: "New reminder", icon: PlusIcon },
] as const;

const TITLES: Record<string, string> = {
  "/reminders/": "Chat",
  "/reminders/list/": "Reminders",
  "/reminders/history/": "History",
  "/reminders/new/": "New reminder",
  "/reminders/edit/": "Edit reminder",
};

const withSlash = (p: string) => (p.endsWith("/") ? p : `${p}/`);

export function AppShell({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const path = withSlash(usePathname());
  const close = () => setOpen(false);

  return (
    <div className="flex h-dvh overflow-hidden">
      {open && <div className="fixed inset-0 z-30 bg-black/40 md:hidden" onClick={close} aria-hidden />}
      <aside
        aria-label="Sidebar"
        className={`fixed inset-y-0 left-0 z-40 flex w-72 flex-col border-r border-line bg-sidebar transition-transform duration-200 md:static md:translate-x-0 ${
          open ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <Sidebar path={path} onNavigate={close} />
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 shrink-0 items-center gap-2 px-3 md:px-6">
          <button className="btn-ghost -ml-1 px-2 md:hidden" onClick={() => setOpen(true)} aria-label="Open menu">
            <MenuIcon />
          </button>
          <span className="truncate text-sm font-medium text-muted">{TITLES[path] ?? "Memoinder"}</span>
          <Account />
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
      </div>
    </div>
  );
}

function Sidebar({ path, onNavigate }: { path: string; onNavigate: () => void }) {
  const router = useRouter();
  return (
    <div className="flex h-full flex-col gap-4 overflow-y-auto p-3">
      <div className="flex items-center justify-between px-1 pt-1">
        <Link href="/reminders/" onClick={onNavigate} className="flex items-center gap-2 text-lg font-semibold tracking-tight">
          <Logo />
          Memoinder
        </Link>
        <button className="btn-ghost px-2 md:hidden" onClick={onNavigate} aria-label="Close menu">
          <CloseIcon />
        </button>
      </div>

      <button
        className="btn-secondary justify-start"
        onClick={() => {
          startNewChat();
          router.push("/reminders/");
          onNavigate();
        }}
      >
        <PenIcon /> New chat
      </button>

      <nav aria-label="Main" className="flex flex-col gap-0.5">
        {NAV.map(({ href, label, icon: Icon }) => {
          const active = path === href;
          return (
            <Link
              key={href}
              href={href}
              onClick={onNavigate}
              aria-current={active ? "page" : undefined}
              className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition ${
                active ? "bg-bubble font-medium text-ink" : "text-ink/80 hover:bg-bubble/70"
              }`}
            >
              <Icon className="text-muted" />
              {label}
            </Link>
          );
        })}
      </nav>

      <ComingUp onNavigate={onNavigate} />

      <div className="mt-auto">
        <SidebarNotifications />
      </div>
    </div>
  );
}

function ComingUp({ onNavigate }: { onNavigate: () => void }) {
  const list = useLoad(listReminders);
  const { reload } = list;
  useEffect(() => onRemindersChanged(reload), [reload]);
  const next = (list.data ?? []).filter((r) => r.status === "active" && r.next_fire_at).slice(0, 6);

  return (
    <section aria-labelledby="coming-up" className="flex flex-col gap-1">
      <h2 id="coming-up" className="px-3 text-xs font-medium uppercase tracking-wide text-muted">
        Coming up
      </h2>
      {list.data && next.length === 0 && <p className="px-3 py-1 text-sm text-muted">Nothing scheduled.</p>}
      <ul className="flex flex-col">
        {next.map((r) => (
          <li key={r.id}>
            <Link
              href={`/reminders/edit/?id=${r.id}`}
              onClick={onNavigate}
              className="flex flex-col rounded-lg px-3 py-1.5 transition hover:bg-bubble/70"
            >
              <span className="truncate text-sm">{r.title}</span>
              <span className="text-xs text-muted">
                {DateTime.fromISO(r.next_fire_at!, { zone: r.time_zone }).toRelative() ?? ""}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

function SidebarNotifications() {
  const devices = useLoad(countDevices);
  if (devices.data === undefined) return null;
  return (
    <NotificationsPanel
      vapidPublicKey={process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY || null}
      deviceCount={devices.data}
      onChange={devices.reload}
    />
  );
}

function Account() {
  const auth = useAuth();
  const router = useRouter();
  if (auth.status !== "signed-in") return null;
  return (
    <div className="ml-auto flex items-center gap-3 text-sm">
      <span className="hidden items-center gap-2 sm:flex">
        <span
          aria-hidden
          className="flex h-7 w-7 items-center justify-center rounded-full bg-ink text-xs font-semibold uppercase text-bg"
        >
          {auth.email.slice(0, 1)}
        </span>
        <span className="text-muted">{auth.email}</span>
      </span>
      <button
        className="btn-ghost"
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
