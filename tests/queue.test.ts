import { describe, expect, it } from "vitest";
import { SessionQueue } from "../src/queue.js";

describe("SessionQueue", () => {
  it("acquires and releases with pending drain", () => {
    const q = new SessionQueue();
    expect(q.tryAcquire("s1")).toBe(true);
    expect(q.tryAcquire("s1")).toBe(false);

    q.enqueueOrReject("s1", {
      text: "second",
      userId: "U1",
      channel: "D1",
      threadTs: null,
      messageTs: "1",
    });

    const next = q.release("s1");
    expect(next?.text).toBe("second");
    expect(q.isBusy("s1")).toBe(false);
  });
});
