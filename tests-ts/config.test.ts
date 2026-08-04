import { describe, expect, it } from "vitest";
import {
  ConfigurationError,
  readRuntimeConfig,
} from "@/server/config";

const validEnvironment = {
  DATABASE_URL: "postgresql://casting:casting@localhost:5432/casting",
  CASTING_APP_URL: "https://casting.internal.example",
  CASTING_AUTH_SECRET: "a".repeat(32),
  CASTING_AUTH_ADAPTER: "session",
  CASTING_WORKSPACE_SLUG: "editorial-team",
};

describe("runtime configuration", () => {
  it("accepts provider-neutral PostgreSQL and session configuration", () => {
    expect(readRuntimeConfig(validEnvironment)).toMatchObject({
      CASTING_AUTH_ADAPTER: "session",
      CASTING_WORKSPACE_SLUG: "editorial-team",
    });
  });

  it("returns structured fields for invalid configuration", () => {
    expect.assertions(2);
    try {
      readRuntimeConfig({
        ...validEnvironment,
        DATABASE_URL: "sqlite:./local.db",
        CASTING_AUTH_SECRET: "short",
      });
    } catch (error) {
      expect(error).toBeInstanceOf(ConfigurationError);
      expect((error as ConfigurationError).fields).toMatchObject({
        DATABASE_URL: expect.any(Array),
        CASTING_AUTH_SECRET: expect.any(Array),
      });
    }
  });
});
