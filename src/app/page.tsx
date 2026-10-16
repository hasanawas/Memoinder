import Link from "next/link";
import { BellIcon, ChatIcon, Logo, RepeatIcon } from "@/components/icons";
import { phases, progressLabel, site } from "@/lib/site";

const FEATURES = [
  { icon: ChatIcon, title: "Just say it", text: "“Gym every Monday and Thursday at 7am.” You see exactly what was understood before anything is saved." },
  { icon: BellIcon, title: "Arrives with the app closed", text: "Notifications come through your browser's push service, on your phone or computer." },
  { icon: RepeatIcon, title: "Repeats and time zones", text: "Daily, weekly, monthly or yearly, in your own time zone, including daylight-saving changes." },
];

export default function Home() {
  return (
    <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-16 px-4 py-16 md:py-24">
      <header className="flex flex-col items-center gap-6 text-center">
        <Logo size={56} />
        <div className="flex flex-col gap-3">
          <h1 className="text-4xl font-semibold tracking-tight md:text-5xl">{site.name}</h1>
          <p className="mx-auto max-w-xl text-lg text-muted">{site.tagline}</p>
        </div>
        <Link href="/reminders/" className="btn-primary px-6 py-3 text-base">
          Open my reminders
        </Link>
      </header>

      <div className="card mx-auto flex w-full max-w-2xl flex-col gap-4 p-5" aria-hidden>
        <p className="max-w-[80%] self-end rounded-3xl rounded-br-lg bg-bubble px-4 py-2.5">
          remind me to call mum tomorrow at 6pm
        </p>
        <div className="flex gap-3">
          <Logo size={26} />
          <div className="flex flex-1 flex-col gap-2">
            <p>Create this reminder?</p>
            <div className="rounded-2xl border border-line border-l-4 border-l-accent p-4">
              <p className="font-medium">Call mum</p>
              <p className="text-sm text-muted">Once, tomorrow at 18:00</p>
            </div>
          </div>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        {FEATURES.map(({ icon: Icon, title, text }) => (
          <div key={title} className="card flex flex-col gap-2 p-5">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-accent/10 text-accent">
              <Icon />
            </span>
            <h2 className="font-medium">{title}</h2>
            <p className="text-sm text-muted">{text}</p>
          </div>
        ))}
      </div>

      <section aria-labelledby="progress" className="mx-auto flex w-full max-w-2xl flex-col gap-3">
        <h2 id="progress" className="text-sm font-medium uppercase tracking-wide text-muted">
          Build progress: {progressLabel(phases)}
        </h2>
        <ol className="card flex flex-col divide-y divide-line">
          {phases.map((p) => (
            <li key={p.id} className="flex items-center gap-3 px-4 py-3 text-sm">
              <span aria-hidden className={p.done ? "text-ok" : "text-muted"}>
                {p.done ? "✓" : "○"}
              </span>
              <span>
                Phase {p.id}: {p.title}
              </span>
              <span className="sr-only">{p.done ? "(done)" : "(not started)"}</span>
            </li>
          ))}
        </ol>
      </section>
    </main>
  );
}
