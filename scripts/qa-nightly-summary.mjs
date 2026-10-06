// Folds every nightly QA output into one verdict the workflow can act on.
// Each section is a JSON file a QA script wrote; a missing file means that
// script crashed before writing, which is itself a failure.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
const SECTIONS = [
  ["Flows (sign in, save, sign out, back/forward)", "nightly/flows/failures.json", (j) => j.map((f) => (typeof f === "string" ? f : `${f.flow ?? "?"}: ${f.detail ?? JSON.stringify(f)}`))],
  ["Every screen, both widths, all plans", "nightly/sweep/issues.json", (j) => j.map((i) => `${i.screen ?? i.page ?? "?"}: ${i.kind ?? ""} ${i.detail ?? ""}`.trim())],
  ["Office admin + member (iPhone shell)", "nightly/office-shell/issues.json", (j) => j.map((i) => `${i.screen}: ${i.kind} — ${i.detail}`)],
  ["Office Swift Links branding", "nightly/office-links/failures.json", (j) => j],
  ["Analytics + notifications end to end", "nightly/probe/failures.json", (j) => j],
  ["Notifications for every plan and account type", "nightly/notifications/failures.json", (j) => j],
  ["Link previews (name, logo, photo)", "nightly/share-preview/failures.json", (j) => j],
  ["Production health + speed budget", "nightly/health.json", (j) => (j.results ?? []).filter((r) => !r.ok).map((r) => `${r.name}: ${r.detail}`)],
];
const sections = SECTIONS.map(([name, file, pick]) => {
  if (!existsSync(file)) return { name, failures: [`no output written (${file}) — the script crashed`] };
  try { return { name, failures: pick(JSON.parse(readFileSync(file, "utf8"))).map(String).slice(0, 40) }; }
  catch (e) { return { name, failures: [`unreadable output: ${e.message}`] }; }
});
const failedCount = sections.reduce((n, s) => n + s.failures.length, 0);
const out = { healthy: failedCount === 0, failedCount, sections, at: new Date().toISOString() };
writeFileSync("nightly/summary.json", JSON.stringify(out, null, 2));
console.log(JSON.stringify(out, null, 2));
