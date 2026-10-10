import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

const DEFAULT_AGENTS = `# Personal AI Assistant

You are my personal assistant on Slack (DMs and channels) backed by a vault on disk.

## Memory layout
- \`USER.md\` — who I am, global preferences
- \`MEMORY.md\` — workspace-wide durable facts and open loops
- \`channels/<channelId>/MEMORY.md\` — facts scoped to one Slack channel
- \`channels/<channelId>/CHANNEL.md\` — channel metadata (name, purpose)
- \`skills/\` — procedural notes you may create or improve

When a message comes from a channel, update that channel's MEMORY.md for channel-specific facts.
Put cross-cutting facts in the root MEMORY.md.

## Communication
- Reply in clear, concise language. Match my language (Vietnamese or English).
- Prefer actionable next steps over long essays.
- After finishing non-trivial work, update the appropriate MEMORY.md.
- Do not invent secrets or credentials. Never print API keys.
- Format for Slack mrkdwn, not GitHub Markdown:
  - Prefer bullet lists over pipe tables (\`| col |\`).
  - Use \`*bold*\` (single asterisks), not \`**bold**\`.
  - Links as \`<https://example.com|label>\` when possible.
`;

const DEFAULT_USER = `# User

- Name: (fill in)
- Timezone: Asia/Ho_Chi_Minh
- Preferred language: Vietnamese
- Goals: personal assistant via Slack (DM + channels) + Cursor agent
`;

const DEFAULT_MEMORY = `# Workspace memory

## Open loops
- (none yet)

## Durable facts
- Harness: Slack Socket Mode → Cursor local SDK
- Surfaces: DM + multi-channel (@mention / thread follow-ups)
`;

const DEFAULT_SKILL = `---
name: morning-briefing
description: Produce a short morning briefing from MEMORY.md and USER.md
---

# Morning briefing

1. Read USER.md and MEMORY.md
2. Summarize open loops and today's priorities in under 12 bullet points
3. Suggest one concrete next action
`;

export function isDirectMessage(channelId: string): boolean {
  return channelId.startsWith("D");
}

export function channelMemoryDir(channelId: string): string {
  return join("channels", sanitizeChannelId(channelId));
}

export function sanitizeChannelId(channelId: string): string {
  return channelId.replace(/[^A-Za-z0-9_-]/g, "_");
}

export async function ensureVault(vaultDir: string): Promise<void> {
  await mkdir(vaultDir, { recursive: true });
  await mkdir(join(vaultDir, "skills"), { recursive: true });
  await mkdir(join(vaultDir, "channels"), { recursive: true });

  await writeIfMissing(join(vaultDir, "AGENTS.md"), DEFAULT_AGENTS);
  await writeIfMissing(join(vaultDir, "USER.md"), DEFAULT_USER);
  await writeIfMissing(join(vaultDir, "MEMORY.md"), DEFAULT_MEMORY);
  await writeIfMissing(
    join(vaultDir, "skills", "morning-briefing.md"),
    DEFAULT_SKILL,
  );
}

export async function ensureChannelVault(
  vaultDir: string,
  channelId: string,
  channelName?: string,
): Promise<void> {
  const rel = channelMemoryDir(channelId);
  const dir = join(vaultDir, rel);
  await mkdir(dir, { recursive: true });

  await writeIfMissing(
    join(dir, "CHANNEL.md"),
    [
      `# Channel`,
      ``,
      `- id: \`${channelId}\``,
      `- name: ${channelName ? `#${channelName}` : "(unknown)"}`,
      ``,
    ].join("\n"),
  );

  await writeIfMissing(
    join(dir, "MEMORY.md"),
    [
      `# Channel memory (${channelName ? `#${channelName}` : channelId})`,
      ``,
      `## Open loops`,
      `- (none yet)`,
      ``,
      `## Durable facts`,
      `- (none yet)`,
      ``,
    ].join("\n"),
  );
}

async function writeIfMissing(path: string, contents: string): Promise<void> {
  try {
    await access(path);
  } catch {
    await writeFile(path, contents, "utf8");
  }
}

export async function readVaultSnippet(
  vaultDir: string,
  relativePath: string,
  maxChars = 4000,
): Promise<string> {
  try {
    const text = await readFile(join(vaultDir, relativePath), "utf8");
    if (text.length <= maxChars) return text;
    return `${text.slice(0, maxChars)}\n…(truncated)`;
  } catch {
    return "";
  }
}

export function buildUserPrompt(input: {
  userText: string;
  memorySnippet: string;
  userSnippet: string;
  channelMemorySnippet?: string;
  channelId?: string;
  channelName?: string;
  surface: "dm" | "channel";
}): string {
  const parts = [
    "You are my personal assistant. The vault cwd contains USER.md, MEMORY.md (workspace), channels/<id>/, AGENTS.md, and skills/.",
    input.surface === "channel"
      ? "This message is from a Slack channel. Prefer updating that channel's MEMORY.md for local facts; use root MEMORY.md for workspace-wide facts."
      : "This message is from a Slack DM. Update root MEMORY.md for durable facts.",
    "",
  ];

  if (input.surface === "channel" && input.channelId) {
    parts.push(
      `## Slack context`,
      `- surface: channel`,
      `- channel_id: ${input.channelId}`,
      input.channelName ? `- channel_name: #${input.channelName}` : "",
      input.channelId
        ? `- channel_memory_path: ${channelMemoryDir(input.channelId)}/MEMORY.md`
        : "",
      "",
    );
  } else {
    parts.push("## Slack context", "- surface: dm", "");
  }

  if (input.userSnippet.trim()) {
    parts.push("## USER.md (snippet)", input.userSnippet.trim(), "");
  }
  if (input.memorySnippet.trim()) {
    parts.push("## MEMORY.md workspace (snippet)", input.memorySnippet.trim(), "");
  }
  if (input.channelMemorySnippet?.trim()) {
    parts.push(
      "## Channel MEMORY.md (snippet)",
      input.channelMemorySnippet.trim(),
      "",
    );
  }
  parts.push("## Message from Slack", input.userText.trim());
  return parts.filter((line, i, arr) => !(line === "" && arr[i - 1] === "")).join("\n");
}

export function buildBriefingPrompt(): string {
  return [
    "Produce today's morning briefing.",
    "Read USER.md, MEMORY.md, and skim channels/*/MEMORY.md for urgent open loops.",
    "Return under 12 short bullets: open loops, priorities, and one next action.",
    "Update MEMORY.md if you close or add a workspace-wide open loop.",
  ].join("\n");
}

/** Strip Slack user/channel mention tokens from message text. */
export function stripSlackMentions(text: string): string {
  return text
    .replace(/<@[A-Z0-9]+>/gi, "")
    .replace(/<#[A-Z0-9]+\|([^>]+)>/gi, "#$1")
    .replace(/<#[A-Z0-9]+>/gi, "")
    .replace(/\s+/g, " ")
    .trim();
}
