import "dotenv/config";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const baseUrl = process.env.BASE_URL || "http://localhost:3002";
const root = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@": path.join(root, "src"),
      "server-only": path.join(root, "tests/server-only-stub.ts"),
    },
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    testTimeout: 15_000,
    // Vite's own BASE_URL is "/" and would otherwise overwrite this value.
    env: {
      BASE_URL: baseUrl,
    },
  },
});
