describe("Shop basics", () => {
  beforeEach(() => cy.visit("app/index.html"));
  it("shows the title", () => {
    cy.get("h1").should("have.text", "Shop");
  });
});
