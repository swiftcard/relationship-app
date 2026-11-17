// ── Card Builder's Mac agent: a pop-up on the owner's screen when a prospect opens their card ──
// (owner, 2026-11-16: "show open alerts as a pop-up on my Mac screen: name,
// company, tap-to-call, not just a text".) The push and the text still go from
// the server (src/lib/prospect-preview/alert.ts); this is the same alert, on
// the Mac, as a window that stays until it is answered. "Call" hands the
// number to the Mac's phone app (FaceTime › Call with iPhone).
//
// Which views to show is the server's decision, not this file's: only views
// the server ALERTED on (a real person, not a link-preview bot, not the
// owner's own network) are ever shown here.

import { execFile, spawn } from "node:child_process";

const DIALOG = `
on run argv
  set theTitle to item 1 of argv
  set theText to item 2 of argv
  set callLabel to item 3 of argv
  display notification theText with title theTitle sound name "Glass"
  set r to display dialog theText with title theTitle buttons {"Later", callLabel} default button callLabel giving up after 900
  if gave up of r then return "later"
  return button returned of r
end run`;

const pretty = (e164) => {
  const d = String(e164 ?? "").replace(/\D/g, "").replace(/^1(?=\d{10}$)/, "");
  return d.length === 10 ? `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}` : String(e164 ?? "");
};
const telOf = (phone) => {
  const d = String(phone ?? "").replace(/\D/g, "");
  return d.length === 10 ? `+1${d}` : d.length === 11 && d.startsWith("1") ? `+${d}` : d ? `+${d}` : null;
};

/** The words in the pop-up. Pure, tested. */
export function popupText(p) {
  const name = String(p.owner_name ?? "").trim() || "A prospect";
  const office = String(p.office_name ?? "").trim();
  const tel = telOf(p.phone);
  const title = `${name.split(/\s+/)[0]} is looking at their card`;
  const lines = [`${name}${office ? `, ${office}` : ""} just opened the card you sent.`];
  if (tel) lines.push("", pretty(tel));
  return { title, text: lines.join("\n"), callLabel: tel ? `Call ${name.split(/\s+/)[0]}` : "OK", tel };
}

/** Show it without waiting: the agent's loop goes on while the window is up. */
export function showOpenPopup(p, log = () => {}) {
  const { title, text, callLabel, tel } = popupText(p);
  const child = spawn("/usr/bin/osascript", ["-e", DIALOG, title, text, callLabel], { stdio: ["ignore", "pipe", "pipe"] });
  let out = "";
  child.stdout.on("data", (b) => { out += b; });
  child.stderr.on("data", (b) => log("popup:", String(b).trim()));
  child.on("close", () => {
    if (tel && out.trim() === callLabel) execFile("/usr/bin/open", [`tel:${tel}`], () => {});
  });
}
