import { loadEnv } from "vite";
import { defineConfig } from "vitest/config";

// Database tests run against a real local Supabase (`npx supabase start`).
export default defineConfig({
  test: {
    include: ["tests/db/**/*.test.ts"],
    environment: "node",
    env: loadEnv("", process.cwd(), ""),
    testTimeout: 20_000,
  },
});
