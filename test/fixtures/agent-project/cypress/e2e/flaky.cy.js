describe("Flaky", () => {
  it("passes on retry", () => {
    expect(Cypress.currentRetry).to.be.greaterThan(0);
  });
});
