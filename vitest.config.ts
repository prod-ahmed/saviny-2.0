import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    // Each file gets its own database, so the files run one after another.
    fileParallelism: false,
    testTimeout: 20_000,
  },
});
