// Used to check cancellation and timeouts: it runs far longer than either.
describe("Slow", () => {
  it("waits a long time", () => {
    cy.wait(120000);
  });
});
