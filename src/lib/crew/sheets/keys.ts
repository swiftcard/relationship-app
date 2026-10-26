import { createHash } from "node:crypto";

// ── Row keys ────────────────────────────────────────────────────────────────
// The short id in every row's Key column. Hashed from the record's id, so two
// ids that share a prefix never share a key; prefixed by kind so a person can
// tell a draft (A) from a lead (L), a person (P), a fact (C) or a GEO check (G).

const short = (seed: string) => createHash("sha1").update(seed).digest("hex").slice(0, 10);
export const approvalKey = (id: string) => `A-${short(id)}`;
export const leadKey = (id: string) => `L-${short(id)}`;
export const personKey = (id: string) => `P-${short(id)}`;
export const customKey = (prefix: string, seed: string) => `${prefix}-${short(seed)}`;
