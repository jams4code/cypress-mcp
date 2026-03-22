describe("Sample Test Suite", () => {
  beforeEach(() => {
    cy.visit("/");
  });

  it("should load the page", () => {
    cy.get("h1").should("be.visible");
  });

  it("should navigate to about", () => {
    cy.get('[data-cy="about-link"]').click();
    cy.url().should("include", "/about");
  });

  it.skip("should handle contact form", () => {
    cy.get('[data-cy="contact-form"]').should("exist");
  });
});
