import type { CrewStore } from "./store";
import type { Platform } from "./types";

// ── The de-dup ledger: one person, every platform, every team ───────────────
// Hard rule from the meeting: never DM (or draft a DM to) anyone we have
// already replied to or contacted. Every handle is normalized here first, so
// "u/Jane_Doe", "/u/jane_doe" and "https://reddit.com/user/jane_doe/" are the
// same person. Cross-platform links are made only on an exact email or a
// profile that links to the other handle — never on a name that looks alike.

export function normalizeHandle(platform: Platform, raw: string): string {
  let s = raw.trim();
  if (!s) return "";
  if (platform === "email") {
    const [local, domain] = s.toLowerCase().split("@");
    if (!domain) return s.toLowerCase();
    return `${local.split("+")[0]}@${domain}`;
  }
  s = s.replace(/^https?:\/\/(www\.|m\.|old\.)?/i, "").replace(/[?#].*$/, "").replace(/\/+$/, "");
  switch (platform) {
    case "reddit": {
      const m = s.match(/(?:reddit\.com\/)?\/?(?:u|user)\/([A-Za-z0-9_-]+)/i);
      return `u/${(m ? m[1] : s.replace(/^@/, "")).toLowerCase()}`;
    }
    case "instagram":
    case "threads":
    case "tiktok": {
      const m = s.match(/(?:instagram\.com|threads\.net|threads\.com|tiktok\.com)\/@?([A-Za-z0-9._]+)/i);
      return `@${(m ? m[1] : s.replace(/^@/, "")).toLowerCase()}`;
    }
    case "linkedin": {
      const m = s.match(/linkedin\.com\/in\/([^/]+)/i);
      return `in/${decodeURIComponent(m ? m[1] : s.replace(/^in\//i, "")).toLowerCase()}`;
    }
    default:
      return s.toLowerCase();
  }
}

/** Find or create the person behind a handle. */
export async function personFor(store: CrewStore, platform: Platform, handle: string, displayName?: string | null): Promise<string | null> {
  const norm = normalizeHandle(platform, handle);
  if (!norm || norm === "u/" || norm === "@" || norm === "in/") return null;
  return store.createPerson(displayName ?? null, platform, norm);
}

/** Has anyone on any team already talked to this person? (Lead listing is not talking.) */
export async function everContacted(store: CrewStore, personId: string): Promise<boolean> {
  const t = await store.touchesFor(personId);
  return t.some((x) => x.kind !== "lead_listed");
}

export function emailsIn(text: string): string[] {
  const found = text.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,24}/g) ?? [];
  const clean = found
    .map((e) => e.replace(/[.,;:]+$/, "").toLowerCase())
    .filter((e) => !/\.(png|jpe?g|gif|webp|svg)$/.test(e) && !/^(noreply|no-reply|donotreply|example)@/.test(e) && !/@(example|sentry|wixpress)\./.test(e));
  return [...new Set(clean)];
}
