import { isDirectMessage } from "../vault.js";

export type RouteDecision =
  | { handle: true; reason: string; replyInThreadTs: string | null }
  | { handle: false; reason: string };

/**
 * DM: all messages from allowlisted users.
 * Channel: @mention (handled separately) OR follow-up in a watched thread.
 * Never auto-reply to every channel message (would burn Cursor runs).
 */
export function routeSlackMessage(input: {
  channelId: string;
  threadTs: string | null;
  messageTs: string;
  text: string;
  source: "message" | "app_mention";
  isThreadWatched: (sessionKey: string) => boolean;
  buildSessionKey: (ref: {
    channel: string;
    threadTs: string | null;
  }) => string;
}): RouteDecision {
  const { channelId, threadTs, messageTs, source } = input;

  if (isDirectMessage(channelId)) {
    return {
      handle: true,
      reason: "dm",
      replyInThreadTs: threadTs,
    };
  }

  if (source === "app_mention") {
    // Start or continue a thread so channel chat stays tidy.
    const replyInThreadTs = threadTs ?? messageTs;
    return {
      handle: true,
      reason: "app_mention",
      replyInThreadTs,
    };
  }

  // Regular channel message: only continue watched threads (no bare @mention).
  if (threadTs) {
    const key = input.buildSessionKey({
      channel: channelId,
      threadTs,
    });
    if (input.isThreadWatched(key)) {
      return {
        handle: true,
        reason: "watched_thread",
        replyInThreadTs: threadTs,
      };
    }
    return { handle: false, reason: "unwatched_thread" };
  }

  return { handle: false, reason: "channel_requires_mention" };
}
