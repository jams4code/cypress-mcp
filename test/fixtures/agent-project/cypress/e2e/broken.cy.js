import { nope } from "./does-not-exist";

describe("Broken", () => {
  it("never runs", () => {
    nope();
  });
});
