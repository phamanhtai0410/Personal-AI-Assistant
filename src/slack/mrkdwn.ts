/**
 * Convert common GitHub/CommonMark markdown into Slack mrkdwn.
 * Slack does not render GFM tables, **bold**, or [label](url) links.
 */

export function markdownToMrkdwn(input: string): string {
  if (!input.trim()) return input;

  const parts = splitByFencedCode(input);
  return parts
    .map((part) =>
      part.type === "code" ? part.text : transformProse(part.text),
    )
    .join("");
}

type Segment = { type: "code" | "prose"; text: string };

function splitByFencedCode(input: string): Segment[] {
  const segments: Segment[] = [];
  const re = /```[\s\S]*?```/g;
  let last = 0;
  let match: RegExpExecArray | null;
  while ((match = re.exec(input)) !== null) {
    if (match.index > last) {
      segments.push({ type: "prose", text: input.slice(last, match.index) });
    }
    segments.push({ type: "code", text: match[0] });
    last = match.index + match[0].length;
  }
  if (last < input.length) {
    segments.push({ type: "prose", text: input.slice(last) });
  }
  return segments.length > 0 ? segments : [{ type: "prose", text: input }];
}

function transformProse(text: string): string {
  const withTables = convertMarkdownTables(text);
  return withTables
    .replace(/^#{1,6}\s+(.+)$/gm, "*$1*")
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, "<$2|$1>")
    .replace(/\*\*([^*]+)\*\*/g, "*$1*")
    .replace(/__([^_]+)__/g, "*$1*");
}

/**
 * Turn GFM pipe tables into Slack-friendly bullet lines.
 *
 * | Coin | USD | 24h |
 * |------|-----|-----|
 * | BTC  | $1  | +1% |
 *
 * →
 * • *BTC* — USD: $1 · 24h: +1%
 */
export function convertMarkdownTables(text: string): string {
  const lines = text.split("\n");
  const out: string[] = [];
  let i = 0;

  while (i < lines.length) {
    const header = lines[i] ?? "";
    const separator = lines[i + 1] ?? "";

    if (isTableRow(header) && isTableSeparator(separator)) {
      const headers = splitTableRow(header);
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && isTableRow(lines[i] ?? "")) {
        rows.push(splitTableRow(lines[i] ?? ""));
        i += 1;
      }

      if (rows.length === 0) {
        out.push(header, separator);
        continue;
      }

      for (const row of rows) {
        const label = cleanCell(row[0] ?? "");
        const details = headers
          .slice(1)
          .map((h, idx) => {
            const value = cleanCell(row[idx + 1] ?? "");
            if (!value) return null;
            return `${cleanCell(h)}: ${value}`;
          })
          .filter((x): x is string => Boolean(x));
        out.push(
          details.length > 0
            ? `• *${label}* — ${details.join(" · ")}`
            : `• *${label}*`,
        );
      }
      continue;
    }

    out.push(header);
    i += 1;
  }

  return out.join("\n");
}

function isTableRow(line: string): boolean {
  const t = line.trim();
  return t.startsWith("|") && t.endsWith("|") && t.includes("|");
}

function isTableSeparator(line: string): boolean {
  const t = line.trim();
  if (!t.startsWith("|") || !t.endsWith("|")) return false;
  return /^\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?$/.test(t);
}

function splitTableRow(line: string): string[] {
  const t = line.trim().replace(/^\|/, "").replace(/\|$/, "");
  return t.split("|").map((c) => c.trim());
}

function cleanCell(cell: string): string {
  return cell.replace(/\*\*/g, "").replace(/__/g, "").trim();
}
