import { describe, expect, it } from "vitest";
import {
  convertMarkdownTables,
  markdownToMrkdwn,
} from "../src/slack/mrkdwn.js";

describe("markdownToMrkdwn", () => {
  it("converts bold and links", () => {
    expect(markdownToMrkdwn("**BTC** is up")).toBe("*BTC* is up");
    expect(markdownToMrkdwn("[CoinGecko](https://www.coingecko.com/)")).toBe(
      "<https://www.coingecko.com/|CoinGecko>",
    );
  });

  it("leaves fenced code alone", () => {
    const input = "see:\n```\n**keep**\n```\n";
    expect(markdownToMrkdwn(input)).toContain("**keep**");
  });
});

describe("convertMarkdownTables", () => {
  it("turns pipe tables into bullets", () => {
    const table = [
      "| Coin | USD | 24h |",
      "|------|-----|-----|",
      "| **BTC** | **$82,923** | ~-0.05% |",
      "| **ETH** | **$2,507** | ~+0.75% |",
    ].join("\n");

    const out = convertMarkdownTables(table);
    expect(out).toContain("• *BTC* —");
    expect(out).toContain("USD: $82,923");
    expect(out).not.toContain("|------|");
  });
});
