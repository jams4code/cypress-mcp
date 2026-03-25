import { describe, it, expect } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
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
    expect(config.specPattern).toEqual(["cypress/e2e/**/*.cy.{ts,js}"]);
    expect(config.supportFile).toBe("cypress/support/e2e.ts");
    expect(config.titleFilterSupport).toBe(false);
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

  it("should follow simple relative imports for config hints", async () => {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "cypress-mcp-config-"));

    try {
      await fs.mkdir(path.join(tempRoot, "config"), { recursive: true });
      await fs.writeFile(
        path.join(tempRoot, "cypress.config.ts"),
        'import shared from "./config/shared";\nexport default shared;\n',
      );
      await fs.writeFile(
        path.join(tempRoot, "config", "shared.ts"),
        [
          "export default {",
          '  e2e: { specPattern: ["e2e/**/*.cy.ts"], supportFile: false },',
          '  screenshotsFolder: "artifacts/screens",',
          '  downloadsFolder: "artifacts/downloads",',
          "};",
          "",
        ].join("\n"),
      );

      const loader = new ConfigLoader(tempRoot, logger);
      const config = await loader.load();

      expect(config.specPattern).toEqual(["e2e/**/*.cy.ts"]);
      expect(config.supportFile).toBe(false);
      expect(config.screenshotsDir).toBe("artifacts/screens");
      expect(config.downloadsDir).toBe("artifacts/downloads");
    } finally {
      await fs.rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("should honor server config overrides for config path and title filtering", async () => {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "cypress-mcp-config-"));

    try {
      await fs.mkdir(path.join(tempRoot, "config"), { recursive: true });
      await fs.writeFile(
        path.join(tempRoot, "config", "custom.config.ts"),
        "export default { e2e: { specPattern: 'tests/e2e/**/*.cy.ts' } };\n",
      );
      await fs.writeFile(
        path.join(tempRoot, "cypress-mcp.config.json"),
        JSON.stringify({
          cypressConfigFile: "config/custom.config.ts",
          defaultBrowser: "chrome",
          titleFilterSupport: true,
        }),
      );

      const loader = new ConfigLoader(tempRoot, logger);
      const config = await loader.load();

      expect(config.cypressConfigFile).toBe("config/custom.config.ts");
      expect(config.defaultBrowser).toBe("chrome");
      expect(config.specPattern).toEqual(["tests/e2e/**/*.cy.ts"]);
      expect(config.titleFilterSupport).toBe(true);
    } finally {
      await fs.rm(tempRoot, { recursive: true, force: true });
    }
  });
});
