// Does not compile on purpose: the import points at a file that does not exist.
import { missing } from "./does-not-exist";

describe("Broken", () => {
  it("never runs", () => {
    missing();
  });
});
