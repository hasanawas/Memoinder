import Link from "next/link";
import { phases, progressLabel, site } from "@/lib/site";

export default function Home() {
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-8 px-4 py-16">
      <header className="flex flex-col gap-2">
        <h1 className="text-3xl font-semibold tracking-tight">{site.name}</h1>
        <p className="text-zinc-600 dark:text-zinc-400">{site.tagline}</p>
        <div>
          <Link href="/reminders" className="btn-primary inline-block">
            Open my reminders
          </Link>
        </div>
      </header>

      <section aria-labelledby="progress" className="flex flex-col gap-3">
        <h2 id="progress" className="text-lg font-medium">
          Build progress: {progressLabel(phases)}
        </h2>
        <ol className="flex flex-col gap-2">
          {phases.map((p) => (
            <li
              key={p.id}
              className="flex items-center gap-3 rounded-lg border border-zinc-200 px-4 py-3 dark:border-zinc-800"
            >
              <span aria-hidden>{p.done ? "✓" : "○"}</span>
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
