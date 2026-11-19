import { defineConfig } from "cypress";

export default defineConfig({
  video: false,
  e2e: {
    specPattern: "cypress/e2e/**/*.cy.js",
    supportFile: "cypress/support/e2e.js",
    setupNodeEvents(on) {
      on("task", { variantTask: () => "from setupNodeEvents" });
    },
  },
});
