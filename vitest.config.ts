import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    // Each file gets its own database, so the files run one after another.
    fileParallelism: false,
    testTimeout: 20_000,
    // Setup creates a fresh database and sockets, which can be slow on a busy machine.
    hookTimeout: 30_000,
  },
});
