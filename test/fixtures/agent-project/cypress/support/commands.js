Cypress.Commands.add("login", (name) => {
  cy.visit("/login");
  cy.get("#user").type(name);
});
