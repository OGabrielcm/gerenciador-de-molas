import { describe, expect, it } from "vitest";
import { moveArea } from "./area-order";

describe("moveArea", () => {
  it("preserves hidden areas while moving across them", () => {
    expect(moveArea(["a", "hidden", "b", "c"], "a", "b")).toEqual(["hidden", "b", "a", "c"]);
    expect(moveArea(["a", "hidden", "b"], "b", "a")).toEqual(["b", "a", "hidden"]);
  });
  it("does not mutate the order and ignores invalid/no-op moves", () => {
    const ids = ["a", "b"];
    moveArea(ids, "a", "b");
    expect(ids).toEqual(["a", "b"]);
    expect(moveArea(ids, "missing", "a")).toBe(ids);
    expect(moveArea(["a"], "a", "a")).toEqual(["a"]);
  });
});
