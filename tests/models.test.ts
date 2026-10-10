import { describe, expect, it } from "vitest";
import { formatModelsList, matchModelId } from "../src/models.js";
import type { ModelListItem } from "@cursor/sdk";

const sample: ModelListItem[] = [
  {
    id: "composer-2",
    displayName: "Composer 2",
    aliases: ["composer2"],
  },
  {
    id: "composer-2.5",
    displayName: "Composer 2.5",
  },
  {
    id: "auto",
    displayName: "Auto",
  },
];

describe("matchModelId", () => {
  it("matches id, alias, and partial", () => {
    expect(matchModelId("composer-2.5", sample)?.id).toBe("composer-2.5");
    expect(matchModelId("composer2", sample)?.id).toBe("composer-2");
    expect(matchModelId("auto", sample)?.id).toBe("auto");
  });
});

describe("formatModelsList", () => {
  it("marks current model", () => {
    const text = formatModelsList(sample, "composer-2.5");
    expect(text).toContain("→ `composer-2.5`");
    expect(text).toContain("`composer-2`");
  });
});
