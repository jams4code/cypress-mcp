// Fails on purpose: the button is data-cy="login-btn". The smoke test checks
// that the failure context names the page, its errors and the right selector.
describe("Context", () => {
  it("logs in", () => {
    cy.visit("app/shop.html");
    cy.get('[data-cy="login-button"]', { timeout: 1000 }).click();
  });
});
