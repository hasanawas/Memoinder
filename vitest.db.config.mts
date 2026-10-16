import { loadEnv } from "vite";
import { defineConfig } from "vitest/config";

// Database tests run against a real local Supabase (`npx supabase start`).
export default defineConfig({
  test: {
    include: ["tests/db/**/*.test.ts"],
    environment: "node",
    env: loadEnv("", process.cwd(), ""),
    testTimeout: 20_000,
    // Several files run the dispatcher, which claims every due reminder in the
    // database; running files one at a time keeps them from taking each other's.
    fileParallelism: false,
  },
});
