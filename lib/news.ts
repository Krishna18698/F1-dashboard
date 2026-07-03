/**
 * Paddock Intel — latest F1 news pulled server-side from public RSS feeds.
 * (Fetched on the server so there's no CORS issue; cached for 30 min.)
 */

export interface IntelItem {
  title: string;
  description: string;
  link: string;
  source: string;
  date: string; // friendly, e.g. "3 Jul" — empty if the feed omits pubDate
}

interface Feed {
  url: string;
  source: string;
}

// Motorsport first: it carries both a publish date and a fuller summary.
const FEEDS: Feed[] = [
  { url: "https://www.motorsport.com/rss/f1/news/", source: "Motorsport" },
  { url: "https://www.autosport.com/rss/f1/news/", source: "Autosport" },
  { url: "https://www.formula1.com/en/latest/all.xml", source: "Formula1.com" },
];

function formatDate(raw: string): string {
  const t = Date.parse(raw);
  if (Number.isNaN(t)) return "";
  return new Date(t).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });
}

function unwrap(s: string): string {
  return s
    .replace(/<!\[CDATA\[/g, "")
    .replace(/\]\]>/g, "")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&#8217;/g, "’")
    .replace(/&#8216;/g, "‘")
    .replace(/&#8220;/g, "“")
    .replace(/&#8221;/g, "”")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ") // collapse run-on whitespace
    .trim();
}

/** Trim RSS "read more" tails and fix jammed-together text so summaries read cleanly. */
function cleanSummary(s: string): string {
  return s
    .replace(/\s*(…|\.\.\.)?\s*(keep reading|read more|continue reading|read the full story).*$/i, "")
    .replace(/([A-Za-z0-9])\(/g, "$1 (") // "Hamilton(Ferrari)" → "Hamilton (Ferrari)"
    .replace(/\)([A-Za-z0-9])/g, ") $1") // "(Mercedes)3" → "(Mercedes) 3"
    .replace(/\s+/g, " ")
    .replace(/\s*(…|\.\.\.)\s*$/, "")
    .trim();
}

function tag(block: string, name: string): string {
  const m = block.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`, "i"));
  return m ? unwrap(m[1]) : "";
}

function parse(xml: string, source: string, limit: number): IntelItem[] {
  const items: IntelItem[] = [];
  const blocks = xml.match(/<item>([\s\S]*?)<\/item>/gi) ?? [];
  for (const block of blocks) {
    const title = tag(block, "title");
    const link = tag(block, "link") || tag(block, "guid");
    // Only trust http(s) links (guards against javascript:/data: URLs from a feed).
    if (!title || !/^https?:\/\//i.test(link)) continue;
    const rawDate = tag(block, "pubDate") || tag(block, "dc:date");
    items.push({
      title,
      description: cleanSummary(tag(block, "description")).slice(0, 300),
      link,
      source,
      date: rawDate ? formatDate(rawDate) : "",
    });
    if (items.length >= limit) break;
  }
  return items;
}

export async function getPaddockIntel(limit = 6): Promise<IntelItem[]> {
  for (const feed of FEEDS) {
    try {
      const res = await fetch(feed.url, {
        next: { revalidate: 1800 },
        headers: { "User-Agent": "Mozilla/5.0 (PitWall F1 Dashboard)" },
      });
      if (!res.ok) continue;
      const items = parse(await res.text(), feed.source, limit);
      if (items.length) return items;
    } catch {
      // try the next feed
    }
  }
  return [];
}
