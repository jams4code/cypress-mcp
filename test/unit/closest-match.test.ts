import { describe, it, expect } from "vitest";
import { closestTitles } from "../../src/utils/closest-match.js";

const titles = [
  "Checkout adds one item to the cart",
  "Checkout logs in with valid credentials",
  "Checkout shows the cart page",
];

describe("closestTitles", () => {
  it("ranks titles containing the query first", () => {
    expect(closestTitles("logs in", titles)[0]).toBe(
      "Checkout logs in with valid credentials",
    );
  });

  it("tolerates typos and different case", () => {
    expect(closestTitles("checkout SHOWS the kart page", titles)[0]).toBe(
      "Checkout shows the cart page",
    );
  });

  it("returns at most the requested number of distinct titles", () => {
    expect(closestTitles("cart", [...titles, ...titles], 2)).toHaveLength(2);
    expect(closestTitles("x", [])).toEqual([]);
  });
});
