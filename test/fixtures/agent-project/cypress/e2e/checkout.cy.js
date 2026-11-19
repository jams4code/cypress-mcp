describe("Checkout", () => {
  beforeEach(() => cy.visit("app/index.html"));
  it("adds one item to the cart", () => {
    cy.get('[data-testid="add-to-cart"]').click();
    cy.get('[data-cy="cart-count"]').should("have.text", "1");
  });
  it("logs in with valid credentials", () => {
    cy.get('[data-cy="email"]').type("a@b.c");
    cy.get('[data-cy="password"]').type("secret");
    cy.get('[data-cy="login-button"]').click();
    cy.contains("Welcome back").should("be.visible");
  });
  it("shows the cart page", () => {
    cy.get('[data-cy="cart-count"]').should("exist");
  });
});
