import type { NextConfig } from "next";

// Memoinder is a static site: `next build` writes plain HTML/JS to `out/`,
// which GitHub Pages serves. All data goes straight from the browser to
// Supabase, where Row Level Security decides what each user may touch.
//
// On GitHub Pages the site lives under /<repo>, e.g.
// https://hasanawas.github.io/Memoinder/, so the build takes that prefix from
// NEXT_PUBLIC_BASE_PATH. Locally it is empty.
const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

const nextConfig: NextConfig = {
  output: "export",
  basePath,
  // Pages serves folder/index.html, so every route ends in a slash.
  trailingSlash: true,
  images: { unoptimized: true },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
