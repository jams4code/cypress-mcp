// Read by cypress-mcp's config loader only; the fake Cypress CLI ignores it.
module.exports = {
  e2e: {
    specPattern: "cypress/e2e/**/*.cy.js",
    supportFile: "cypress/support/e2e.js",
  },
};
