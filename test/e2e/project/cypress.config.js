const { defineConfig } = require("cypress");

module.exports = defineConfig({
  projectId: "e2e000",
  retries: { runMode: 2, openMode: 0 },
  video: false,
  e2e: {
    specPattern: "cypress/e2e/**/*.cy.js",
    supportFile: "cypress/support/e2e.js",
  },
});
