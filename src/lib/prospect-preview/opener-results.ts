import { listEvents, recentBatches } from "./desk";
import { openerResults, openerStats, type OpenerResults } from "./learn";
import { segmentOf } from "./outbox";
import { listPreviews } from "./store";
import type { ProspectPreview } from "./types";

// ── The open rates, loaded, for whoever writes the next openers ─────────────
// `card-builder.mjs style` (for /build-card) and the server's writeOpener both
// call this, so the writer sees the same numbers the admin's open-rate table
// shows (learn.ts openerStats / openerResults).

export async function loadOpenerResults(p: Pick<ProspectPreview, "batch_id"> | null): Promise<OpenerResults> {
  const [events, list, batches, segment] = await Promise.all([
    listEvents().catch(() => []),
    listPreviews(),
    recentBatches(200).catch(() => []),
    p ? segmentOf(p).catch(() => null) : Promise.resolve(null),
  ]);
  const rows = list.ready ? list.rows : [];
  return openerResults(openerStats(events, rows, new Map(batches.map((b) => [b.id, b.label]))), segment);
}
