import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    env: {
      NEXTAUTH_SECRET: "test-secret-for-vitest-0123456789abcdef",
      TOKEN_ENCRYPTION_KEY: "test-encryption-key-0123456789abcdef",
      OAUTH_STATE_SECRET: "test-state-secret-0123456789abcdef",
      DATABASE_URL: "postgresql://postgres:postgres@localhost:5432/test",
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname),
    },
  },
});