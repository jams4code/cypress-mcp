import { defineConfig } from "cypress";

export default defineConfig({
  video: false,
  e2e: {
    specPattern: "cypress/e2e/**/*.cy.js",
    supportFile: "cypress/support/e2e.ts",
    setupNodeEvents(on: Cypress.PluginEvents) {
      on("task", { variantTask: () => "from setupNodeEvents" });
    },
  },
});
