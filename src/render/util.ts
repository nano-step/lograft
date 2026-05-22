export const FILE_SIZE_CAP = 5 * 1024 * 1024;

export function truncatedToCap(content: string, capBytes = FILE_SIZE_CAP): {
  content: string;
  truncated: boolean;
} {
  const size = Buffer.byteLength(content, "utf8");
  if (size <= capBytes) return { content, truncated: false };
  const ratio = capBytes / size;
  const sliceLen = Math.floor(content.length * ratio) - 200;
  const safe = content.slice(0, Math.max(0, sliceLen));
  return {
    content: `${safe}\n\n<!-- TRUNCATED: output exceeded ${capBytes}B cap -->\n`,
    truncated: true,
  };
}

export function assertHttpsUrl(url: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch (err) {
    throw new Error(`invalid URL: ${(err as Error).message}`);
  }
  if (parsed.protocol !== "https:") {
    throw new Error(`ticketLinkBase must use https; got ${parsed.protocol}`);
  }
  return parsed;
}

export function buildTicketLink(base: URL, ticket: string): string {
  const trimmed = base.pathname.endsWith("/") ? base.pathname : `${base.pathname}/`;
  const next = new URL(base.toString());
  next.pathname = `${trimmed}${encodeURIComponent(ticket)}`;
  return next.toString();
}
