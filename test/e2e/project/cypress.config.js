const { defineConfig } = require("cypress");

module.exports = defineConfig({
  projectId: "e2e000",
  // The project's own reporter, which cypress-mcp must keep writing.
  reporter: "junit",
  reporterOptions: { mochaFile: "results/junit-[hash].xml" },
  retries: { runMode: 2, openMode: 0 },
  video: false,
  e2e: {
    specPattern: "cypress/e2e/**/*.cy.js",
    supportFile: "cypress/support/e2e.js",
  },
});
