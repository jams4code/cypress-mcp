import { describe, it, expect } from "vitest";
import path from "node:path";
import { ConfigLoader } from "../../src/services/config-loader.js";
import { createLogger } from "../../src/utils/logger.js";

const fixtureRoot = path.resolve("test/fixtures/cypress-project");
const logger = createLogger(false);

describe("ConfigLoader", () => {
  it("should detect cypress.config.ts in fixture project", async () => {
    const loader = new ConfigLoader(fixtureRoot, logger);
    const config = await loader.load();

    expect(config.cypressConfigFile).toBe("cypress.config.ts");
    expect(config.defaultBrowser).toBe("electron");
    expect(config.defaultTimeout).toBe(300_000);
  });

  it("should cache config on repeated loads", async () => {
    const loader = new ConfigLoader(fixtureRoot, logger);
    const config1 = await loader.load();
    const config2 = await loader.load();

    expect(config1).toBe(config2);
  });

  it("should invalidate cache", async () => {
    const loader = new ConfigLoader(fixtureRoot, logger);
    const config1 = await loader.load();
    loader.invalidate();
    const config2 = await loader.load();

    expect(config1).not.toBe(config2);
    expect(config1.cypressConfigFile).toBe(config2.cypressConfigFile);
  });

  it("should throw on missing config", async () => {
    const loader = new ConfigLoader("/nonexistent/path", logger);

    await expect(loader.load()).rejects.toThrow("No Cypress config file found");
  });
});
