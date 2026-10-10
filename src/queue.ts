/**
 * Per-session in-process mutex with a single queued follow-up slot.
 * Matches plan option 8A for a single-user gateway.
 */
export type QueuedMessage = {
  text: string;
  userId: string;
  channel: string;
  threadTs: string | null;
  messageTs: string;
  channelName?: string;
};

export class SessionQueue {
  private readonly busy = new Set<string>();
  private readonly pending = new Map<string, QueuedMessage>();

  isBusy(sessionKey: string): boolean {
    return this.busy.has(sessionKey);
  }

  tryAcquire(sessionKey: string): boolean {
    if (this.busy.has(sessionKey)) return false;
    this.busy.add(sessionKey);
    return true;
  }

  release(sessionKey: string): QueuedMessage | undefined {
    this.busy.delete(sessionKey);
    const next = this.pending.get(sessionKey);
    if (next) {
      this.pending.delete(sessionKey);
      return next;
    }
    return undefined;
  }

  /** Store at most one pending message per session (newer replaces older). */
  enqueueOrReject(sessionKey: string, message: QueuedMessage): void {
    this.pending.set(sessionKey, message);
  }

  peekPending(sessionKey: string): QueuedMessage | undefined {
    return this.pending.get(sessionKey);
  }

  clearPending(sessionKey: string): void {
    this.pending.delete(sessionKey);
  }
}
