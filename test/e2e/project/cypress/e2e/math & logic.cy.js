// The file name has a space and "&" on purpose: both must reach Cypress intact.
describe("Math", () => {
  it("adds numbers", () => {
    expect(1 + 1).to.eq(2);
  });

  it("is flaky on the first attempt", () => {
    expect(Cypress.currentRetry, "passes from the second attempt").to.be.greaterThan(0);
  });

  it('fails & shows "quotes"', () => {
    expect(1, "always wrong").to.eq(2);
  });

  it("reads the env value", () => {
    const check = ({ user, port }) => {
      expect(user).to.eq('a,"b" & c');
      expect(port, "string stays a string").to.eq("3000");
    };
    // cy.env arrived in Cypress 15.10 and Cypress.env() is gone in 16.
    if (typeof cy.env === "function") {
      cy.env(["user", "port"]).then(check);
    } else {
      check({ user: Cypress.env("user"), port: Cypress.env("port") });
    }
  });
});
