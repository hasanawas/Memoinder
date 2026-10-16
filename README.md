# Memoinder

A personal AI reminder assistant built entirely on free tiers and open-source software. It is also a learning project for full-stack development.

- Architecture, verified free-tier limits and the $0 cost conditions: [docs/architecture.md](docs/architecture.md)
- Current phase: **1, reminder engine** (time zones, daylight saving, repeats; no UI yet). How it works: [docs/engine.md](docs/engine.md)

## Requirements

- Node.js 20.9 or newer (22 recommended) and npm
- No accounts or API keys are needed yet

## Run it locally

```bash
npm install
npm run dev            # http://localhost:3000
```

## Checks

| Command | What it does |
|---|---|
| `npm run typecheck` | Generates Next.js route types, then runs the TypeScript compiler |
| `npm run lint` | ESLint with the Next.js rules |
| `npm test` | Unit tests with Vitest (`src/**/*.test.ts`) |
| `npm run test:e2e` | Builds the app, starts it on port 3100 and runs Playwright browser tests (`tests/e2e`) |

The first time you run end-to-end tests on your own computer, install the browser once with `npx playwright install chromium`.

GitHub Actions runs all four checks on every pull request (`.github/workflows/ci.yml`). Actions minutes on standard runners are free for public repositories.

## Project layout

```
src/app/        Next.js App Router pages
src/lib/        Plain TypeScript logic (unit-tested)
src/lib/engine/ Reminder engine: schedules, repeats, due rules
tests/e2e/      Playwright browser tests
docs/           Architecture and decisions
```

## Known warnings

`npm audit` reports high-severity advisories in `braces`, pulled in by `eslint-config-next`. It is a development-only lint dependency and is not shipped to the browser or server. The suggested `npm audit fix --force` would downgrade the Next.js lint config to version 14, so it is intentionally not applied.
