import { describe, expect, it } from "vitest";
import { normalizeCommandText } from "../src/slack/app.js";

describe("normalizeCommandText", () => {
  it("maps bang and bare aliases", () => {
    expect(normalizeCommandText("!new")).toBe("/new");
    expect(normalizeCommandText("stop")).toBe("/stop");
    expect(normalizeCommandText("usage")).toBe("/usage");
  });

  it("leaves normal chat alone", () => {
    expect(normalizeCommandText("hi there")).toBe("hi there");
    expect(normalizeCommandText("/new")).toBe("/new");
  });
});
