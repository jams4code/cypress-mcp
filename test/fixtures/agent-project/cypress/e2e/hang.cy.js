describe("Hang", () => {
  it("finishes", () => {});
  it("never ends", () => {
    cy.wait(600000);
  });
});
