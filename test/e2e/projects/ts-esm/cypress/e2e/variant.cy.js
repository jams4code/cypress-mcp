// Runs through the cypress-mcp wrapper config. The first test proves the
// project's own support file and setupNodeEvents still run; the second fails
// on purpose so the failure context is recorded.
describe("Variant", () => {
  it("keeps the project's support file and tasks", () => {
    expect(window.variantSupportLoaded, "project support file").to.eq(true);
    cy.task("variantTask").should("eq", "from setupNodeEvents");
  });

  it("saves", () => {
    cy.visit("app/index.html");
    cy.get('[data-cy="save-button"]', { timeout: 1000 }).click();
  });
});
