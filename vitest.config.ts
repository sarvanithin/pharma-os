import { defineConfig } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";
import { readFileSync } from "node:fs";

function loadEnvLocal(): Record<string, string> {
  try {
    const txt = readFileSync(".env.local", "utf8");
    const env: Record<string, string> = {};
    for (const line of txt.split("\n")) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
    return env;
  } catch {
    return {};
  }
}

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    env: loadEnvLocal(),
    testTimeout: 30000,
    hookTimeout: 30000,
  },
});
