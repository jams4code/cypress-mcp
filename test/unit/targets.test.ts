import { describe, expect, it } from "vitest";
import { parseSpec } from "../../src/services/spec-parser.js";
import { titlesAtLine } from "../../src/services/targets.js";

const SPEC = `describe("Checkout", () => {
  beforeEach(() => cy.visit("/"));
  it("adds one item", () => {
    cy.get("#add").click();
  });
  describe("when logged in", () => {
    it("shows the cart", () => {
      cy.get("#cart");
    });
    it("pays", () => {});
  });
});
`;

describe("titlesAtLine", () => {
  const parsed = parseSpec(SPEC);

  it("finds the test whose it() starts at or before the line", () => {
    expect(titlesAtLine(parsed, 3)).toEqual(["Checkout adds one item"]);
    expect(titlesAtLine(parsed, 4)).toEqual(["Checkout adds one item"]);
    expect(titlesAtLine(parsed, 8)).toEqual(["Checkout when logged in shows the cart"]);
  });

  it("gives every test of a describe at its line", () => {
    expect(titlesAtLine(parsed, 6)).toEqual([
      "Checkout when logged in shows the cart",
      "Checkout when logged in pays",
    ]);
    expect(titlesAtLine(parsed, 1)).toHaveLength(3);
  });

  it("finds nothing before the first block", () => {
    expect(titlesAtLine(parseSpec(`\n\n${SPEC}`), 1)).toEqual([]);
  });
});
