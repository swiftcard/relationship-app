import { getAdminSupabase } from "@/lib/supabase-admin";
import { claimBatch, finishBatch, listConnections, listEvents, logBatchItem, ownerBackground, readCandidates, setCandidates, settleQueueItem } from "@/lib/prospect-preview/desk";
import { pullBrandColors } from "@/lib/prospect-preview/colors-server";
import { createDraftFrom, extrasFrom, fieldsFrom, standing, type Json } from "@/lib/prospect-preview/draft-core";
import { styleNotes, type BatchCandidate } from "@/lib/prospect-preview/learn";
import { checkOpeners, rankOpeners, readOpeners } from "@/lib/prospect-preview/opener";
import { checkOutreach, readOutreach, staleNumbers } from "@/lib/prospect-preview/outreach";
import { isVerified } from "@/lib/prospect-preview/quality";
import { getPreviewById, setOpeners, setOutreach } from "@/lib/prospect-preview/store";
import { LINK_SLOT, TEXT_LIMIT } from "@/lib/prospect-preview/types";
import { connectionsAt } from "@/lib/prospect-preview/warm";
import { commandText, dollarsOf, jsonIn, NO_USAGE, say, turn, type Conversation, type Usage } from "./llm";

// ── Card Builder's job queue (owner, 2026-11-16) ────────────────────────────
// "Run overnight, and by morning every prospect is at ready_for_review."
//
// One row of card_builder_jobs per prospect (a row of prospect_queue), walked
// through   research → build_card → write_opener → ready_for_review
// by the worker clock (/api/card-builder/worker, every 5 minutes on Vercel).
// A batch typed as a target ("realtors in Great Neck") first gets one "find"
// job that finds the offices and makes their prospect rows and jobs.
//
// Vercel never retries a scheduled run, so this does: a step that throws is
// tried again after 5, 10 and 20 minutes, then the job is FAILED with the
// reason, which Approve shows next to a Retry button. A step that decides
// not to build (already contacted, no mobile number, nothing specific to
// say…) is SKIPPED, not failed, and the batch page groups those reasons.
//
// It makes DRAFTS only. Nothing is published and nothing is sent: the owner
// approves each one in admin › Card Builder › Approve.
//
// Schema: supabase/card-builder-autopilot.sql. Server only, service role.

export const STEPS = ["find", "research", "build_card", "write_opener", "ready_for_review"] as const;
export type Step = (typeof STEPS)[number];
export type JobStatus = "pending" | "running" | "done" | "failed" | "skipped";
export type Job = {
  id: string; created_at: string; updated_at: string; prospect_id: string | null; batch_id: string | null;
  step: Step; status: JobStatus; attempts: number; last_error: string | null; run_after: string;
  locked_until: string | null; preview_id: string | null; data: Json; finished_at: string | null;
};

/** One first try plus three retries. */
export const MAX_ATTEMPTS = 4;
/** After the 1st, 2nd and 3rd failure: wait 5, 10, 20 minutes. */
export const backoffMs = (attempts: number) => 5 * 60_000 * 2 ** Math.max(0, attempts - 1);
/** A claimed job belongs to its run this long; after that another run may take it (its run died). */
export const LEASE_SECONDS = 15 * 60;
/** How long one step may take before it is abandoned (and retried). */
const STEP_TIMEOUT_MS = 9 * 60_000;

const db = () => getAdminSupabase();
const JOBS = "card_builder_jobs";
const today = () => new Date().toISOString().slice(0, 10);
const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");

/** A reason a prospect was left out on purpose: skipped, never retried. */
export class Skip extends Error {}

// ── Queueing ────────────────────────────────────────────────────────────────

/**
 * "New batch" (and "Run overnight"): queue every job the batch needs at once,
 * due at the batch's start time. A CSV batch gets one job per row; a target
 * batch gets its "find" job, which makes the rest.
 */
export async function enqueueBatch(batch: { id: string; run_after: string | null }): Promise<number> {
  const runAfter = batch.run_after ?? new Date().toISOString();
  const { data: rows } = await db().from("prospect_queue").select("id").eq("batch_id", batch.id).eq("status", "queued");
  const jobs: Json[] = (rows ?? []).length
    ? (rows ?? []).map((r) => ({ prospect_id: r.id as string, batch_id: batch.id, step: "research", run_after: runAfter }))
    : [{ prospect_id: null, batch_id: batch.id, step: "find", run_after: runAfter }];
  const { data, error } = await db().from(JOBS).insert(jobs).select("id");
  // 23505: already queued (a double submit); nothing to add.
  if (error && error.code !== "23505") throw new Error(`queueing the batch: ${error.message}`);
  return data?.length ?? 0;
}

/** Retry from the review screen: the job starts its current step again, from scratch. */
export async function retryJob(id: string): Promise<boolean> {
  const { data, error } = await db().from(JOBS).update({ status: "pending", attempts: 0, last_error: null, run_after: new Date().toISOString(), locked_until: null, updated_at: new Date().toISOString() })
    .eq("id", id).eq("status", "failed").select("id");
  return !error && !!data?.length;
}

export type FailedJob = { id: string; step: Step; last_error: string | null; input: string | null; batch_label: string | null; updated_at: string };
/** What the review screen shows: everything that failed in the last two weeks, newest first. */
export async function failedJobs(limit = 50): Promise<FailedJob[]> {
  const since = new Date(Date.now() - 14 * 86_400_000).toISOString();
  const { data } = await db().from(JOBS).select("id, step, last_error, updated_at, prospect_id, batch_id, prospect_queue(input), prospect_batches(label)")
    .eq("status", "failed").gte("updated_at", since).order("updated_at", { ascending: false }).limit(limit);
  return (data ?? []).map((r) => {
    const q = r.prospect_queue as unknown as { input?: string } | null;
    const b = r.prospect_batches as unknown as { label?: string } | null;
    return { id: r.id as string, step: r.step as Step, last_error: (r.last_error as string | null) ?? null, input: q?.input ?? null, batch_label: b?.label ?? null, updated_at: r.updated_at as string };
  });
}

export type BatchProgress = Record<string, { total: number; ready: number; skipped: number; failed: number; working: number }>;
export async function batchProgress(batchIds: string[]): Promise<BatchProgress> {
  if (!batchIds.length) return {};
  const { data } = await db().from(JOBS).select("batch_id, step, status").in("batch_id", batchIds).not("prospect_id", "is", null);
  const out: BatchProgress = {};
  for (const r of data ?? []) {
    const b = (out[r.batch_id as string] ??= { total: 0, ready: 0, skipped: 0, failed: 0, working: 0 });
    b.total++;
    if (r.status === "done") b.ready++;
    else if (r.status === "skipped") b.skipped++;
    else if (r.status === "failed") b.failed++;
    else b.working++;
  }
  return out;
}

// ── The worker ──────────────────────────────────────────────────────────────

export type RunResult = { claimed: number; advanced: number; ready: number; skipped: number; failed: number; retrying: number; released: number; batchesStarted: number; batchesFinished: number; dollars: number; stoppedEarly: boolean };

/**
 * One run of the clock. Takes due jobs `concurrency` at a time and carries
 * each through as many steps as the time allows; stops taking new work
 * `reserveMs` before the deadline so the function always ends cleanly, and a
 * job it can't finish in time goes back to pending (no try used up).
 */
export async function runWorker(opts: { deadline: number; concurrency?: number; reserveMs?: number; now?: () => number }): Promise<RunResult> {
  const now = opts.now ?? Date.now;
  const concurrency = opts.concurrency ?? 3;
  const reserve = opts.reserveMs ?? STEP_TIMEOUT_MS + 60_000;
  const r: RunResult = { claimed: 0, advanced: 0, ready: 0, skipped: 0, failed: 0, retrying: 0, released: 0, batchesStarted: 0, batchesFinished: 0, dollars: 0, stoppedEarly: false };

  r.batchesStarted = await startDueBatches();
  await failExhausted();

  const timeLeft = () => opts.deadline - now();
  const lane = async () => {
    while (timeLeft() > reserve) {
      const { data, error } = await db().rpc("claim_card_builder_jobs", { p_limit: 1, p_lease_seconds: LEASE_SECONDS });
      if (error) throw new Error(`claiming jobs: ${error.message}`);
      const job = (data as Job[] | null)?.[0];
      if (!job) return;
      r.claimed++;
      await carry(job, r, () => timeLeft() > reserve);
    }
    if (timeLeft() <= reserve) r.stoppedEarly = true;
  };
  await Promise.all(Array.from({ length: concurrency }, lane));
  r.batchesFinished = await finishDoneBatches();
  return r;
}

/** Take one job as far as it will go in this run. */
async function carry(job: Job, r: RunResult, mayStartStep: () => boolean): Promise<void> {
  let current = job;
  let first = true;
  for (;;) {
    if (current.step === "ready_for_review") return;
    // A step needs room to finish: if there isn't any, hand it back untried.
    if (!first && !mayStartStep()) {
      await patch(current.id, { status: "pending", attempts: 0, locked_until: null, run_after: new Date().toISOString() });
      r.released++;
      return;
    }
    first = false;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), STEP_TIMEOUT_MS);
    try {
      const out = await runStep(current, controller.signal);
      clearTimeout(timer);
      r.dollars += out.dollars ?? 0;
      const data = { ...current.data, ...(out.data ?? {}), usage: addCost(current.data.usage, out.usage, current.step) };
      const next = nextStep(current.step);
      const done = next === "ready_for_review";
      const fields = { step: next, status: done ? "done" : "running", attempts: done ? current.attempts : 1, last_error: null, data, preview_id: out.preview_id ?? current.preview_id,
        locked_until: new Date(Date.now() + LEASE_SECONDS * 1000).toISOString(), ...(done ? { finished_at: new Date().toISOString(), locked_until: null } : {}) };
      await patch(current.id, fields);
      r.advanced++;
      if (done) { r.ready++; return; }
      current = { ...current, ...fields } as Job;
    } catch (e) {
      clearTimeout(timer);
      const message = controller.signal.aborted ? `took longer than ${Math.round(STEP_TIMEOUT_MS / 60_000)} minutes` : e instanceof Error ? e.message : String(e);
      if (e instanceof Skip) {
        await patch(current.id, { status: "skipped", last_error: message.slice(0, 500), locked_until: null, finished_at: new Date().toISOString() });
        await settleProspect(current, "skipped", message);
        r.skipped++;
        return;
      }
      if (current.attempts >= MAX_ATTEMPTS) {
        await patch(current.id, { status: "failed", last_error: `${stepLabel(current.step)}: ${message}`.slice(0, 500), locked_until: null, finished_at: new Date().toISOString() });
        await settleProspect(current, "failed", `${stepLabel(current.step)}: ${message}`);
        r.failed++;
      } else {
        await patch(current.id, { status: "pending", last_error: `${stepLabel(current.step)}: ${message}`.slice(0, 500), locked_until: null, run_after: new Date(Date.now() + backoffMs(current.attempts)).toISOString() });
        r.retrying++;
      }
      console.error("[card-builder-jobs]", current.id, current.step, `try ${current.attempts}`, message);
      return;
    }
  }
}

export const nextStep = (s: Step): Step => (s === "find" ? "ready_for_review" : STEPS[STEPS.indexOf(s) + 1] ?? "ready_for_review");
const stepLabel = (s: Step) => ({ find: "Finding offices", research: "Research", build_card: "Building the card", write_opener: "Writing the opener", ready_for_review: "Ready" })[s];

function addCost(prev: unknown, u: Usage | undefined, step: Step): Json {
  const before = (prev && typeof prev === "object" ? prev : {}) as Json;
  return u ? { ...before, [step]: { ...u, dollars: Math.round(dollarsOf(u) * 1000) / 1000 } } : before;
}

async function patch(id: string, fields: Json): Promise<void> {
  const { error } = await db().from(JOBS).update({ ...fields, updated_at: new Date().toISOString() }).eq("id", id);
  if (error) throw new Error(`saving the job: ${error.message}`);
}

/** A job that ran out of tries while its run died (no catch ran): failed, with what it was doing. */
async function failExhausted(): Promise<void> {
  const { data } = await db().from(JOBS).update({ status: "failed", last_error: "stopped mid-step four times (the run ran out of time each try)", locked_until: null, finished_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq("status", "running").lt("locked_until", new Date().toISOString()).gte("attempts", MAX_ATTEMPTS).select("*");
  for (const j of (data ?? []) as Job[]) await settleProspect(j, "failed", j.last_error ?? "failed");
}

/** A requested server batch whose time has come: running. */
async function startDueBatches(): Promise<number> {
  const { data } = await db().from("prospect_batches").select("id").eq("status", "requested").eq("engine", "server").lte("run_after", new Date().toISOString()).limit(20);
  for (const b of data ?? []) await claimBatch(b.id as string);
  return data?.length ?? 0;
}

/** A running server batch with nothing left to do: finished. The existing clock then sends the owner one push. */
async function finishDoneBatches(): Promise<number> {
  const { data: running } = await db().from("prospect_batches").select("id").eq("status", "running").eq("engine", "server").limit(50);
  let n = 0;
  for (const b of running ?? []) {
    const { count } = await db().from(JOBS).select("id", { count: "exact", head: true }).eq("batch_id", b.id).in("status", ["pending", "running"]);
    const { count: any } = await db().from(JOBS).select("id", { count: "exact", head: true }).eq("batch_id", b.id);
    if (count === 0 && (any ?? 0) > 0) { await finishBatch(b.id as string); n++; }
  }
  return n;
}

// ── The steps ───────────────────────────────────────────────────────────────

type StepOut = { data?: Json; preview_id?: string | null; usage?: Usage; dollars?: number };

async function runStep(job: Job, signal: AbortSignal): Promise<StepOut> {
  switch (job.step) {
    case "find": return find(job, signal);
    case "research": return research(job, signal);
    case "build_card": return buildCard(job);
    case "write_opener": return writeOpener(job, signal);
    default: return {};
  }
}

const SERVER_MODE = `SERVER MODE. You are running unattended on SwiftCard's server, not in Claude Code, and nobody is watching. You can't run \`node scripts/card-builder.mjs\` or open files: the server does those steps itself, before and after you, with the same code. Never ask a question; when a rule doesn't cover something, decide by the rules or leave that prospect out with a reason. Today is ${today()}.`;

/** Lines of the prospect queue, as the batch page's reasons. */
const SKIP_REASONS = ["already contacted", "already a SwiftCard user", "on the do-not-contact list", "couldn't confirm who is in charge", "no mobile number", "nothing specific to say", "their site wouldn't load"];

async function prospectInput(job: Job): Promise<{ input: string; is_notes: boolean }> {
  const { data } = await db().from("prospect_queue").select("input, is_notes").eq("id", job.prospect_id).maybeSingle();
  if (!data) throw new Skip("its row was removed from the queue");
  return { input: data.input as string, is_notes: data.is_notes === true };
}

/** Research: build-card steps 2–4, with web search and web fetch. Hands the create-draft JSON on. */
async function research(job: Job, signal: AbortSignal): Promise<StepOut> {
  const { input, is_notes } = await prospectInput(job);
  const connections = await listConnections();
  const background = await ownerBackground();
  const guessCompany = input.split(/[,·]/).slice(0, 2).join(" ");
  const convo: Conversation = { messages: [], usage: { ...NO_USAGE } };
  say(convo, [
    SERVER_MODE,
    "",
    "Your part is build-card's steps 1b (decide the warm path from the data below), 2, 3 and 4: research this prospect with web_search and web_fetch, opening the real pages. The server then reads the brand colours from the logo, creates the draft (step 5) with the same checks, scores it, and a separate call writes the messages (steps 9 and 10). Don't write messages here.",
    "",
    "This is part of an unattended batch, so these batch rules apply on top of build-card's:",
    "- Flag, don't pad. No mobile number for the decision-maker on any public page: leave them out with \"no mobile number\" (the opener goes over iMessage, so only a cell works). Fewer than 3 verified specifics, or nothing an opener could name: \"nothing specific to say\". Can't establish who is in charge: \"couldn't confirm who is in charge\".",
    "- If the person named is an agent rather than the person in charge, build for whoever runs their office instead.",
    "",
    `The prospect${is_notes ? " (the OWNER'S OWN NOTES: every fact in them is confirmed by the owner, see build-card)" : ""}:`,
    "<prospect>", input, "</prospect>",
    "",
    "Warm path data (what `card-builder.mjs warm` would return):",
    JSON.stringify({ connections_at_this_office_by_name_guess: connectionsAt(guessCompany, connections).slice(0, 10), owners_schools: background.schools, owners_past_employers: background.employers }),
    "(These are matched on a guess at the office's name from the line above. Only use a connection whose company is clearly this office.)",
    "",
    "Answer with ONE ```json block and nothing after it, either:",
    '{ "outcome": "build", "preview": { …the create-draft JSON exactly as build-card step 5 shows it, plus "phone_kind" and "warm_path" when you have them. Leave out crew_lead_id, batch_id, brand_primary and brand_secondary: the server fills those in… } }',
    `or { "outcome": "skip", "reason": "<one of: ${SKIP_REASONS.join(" | ")}, or a few plain words>", "office": "<the office, if you found it>" }`,
  ].join("\n"));

  const system = commandText("build-card");
  let reply = await turn(convo, { system, web: true, effort: "high", signal });
  for (let round = 0; ; round++) {
    const json = jsonIn(reply);
    const problem = (() => {
      if (!json) return "That wasn't one JSON object in a ```json block.";
      if (json.outcome === "skip") return null;
      if (json.outcome !== "build" || !json.preview || typeof json.preview !== "object") return 'outcome is "build" with a preview object, or "skip" with a reason.';
      try { fieldsFrom(json.preview as Json); extrasFrom(json.preview as Json); return null; } catch (e) { return `create-draft refused it: ${e instanceof Error ? e.message : String(e)}`; }
    })();
    if (!problem && json) {
      const usage = convo.usage;
      if (json.outcome === "skip") {
        const reason = str(json.reason) || "nothing specific to say";
        await logOutcome(job, { office: str(json.office) || input.slice(0, 120), outcome: "skipped", reason });
        throw new Skip(reason);
      }
      return { data: { research: json.preview, office: str((json.preview as Json).office_name) }, usage, dollars: dollarsOf(usage) };
    }
    if (round >= 2) throw new Error(problem ?? "no usable answer");
    say(convo, `Not saved. ${problem} Fix exactly that and answer again with the whole JSON (keep researching only if you must).`);
    reply = await turn(convo, { system, web: true, effort: "high", signal });
  }
}

/** Build the card: the brand colours, then a DRAFT, through the same checks as the command-line tool. */
async function buildCard(job: Job): Promise<StepOut> {
  const raw = { ...((job.data.research ?? {}) as Json) } as Json;
  if (!raw.office_name) throw new Error("the research didn't hand on a draft");
  if (!raw.brand_primary && (str(raw.logo_url) || str(raw.website))) {
    const c = await pullBrandColors({ logo_url: str(raw.logo_url) || null, website: str(raw.website) || null }).catch(() => null);
    if (c) {
      raw.brand_primary = c.primary;
      raw.brand_secondary = c.secondary;
      raw.sources = { ...((raw.sources ?? {}) as Json), colors: { url: c.url, note: `Read from the ${c.from === "logo" ? "logo" : "site's theme colour"}` } };
    }
  }
  if (job.batch_id) raw.batch_id = job.batch_id;
  try {
    const made = await createDraftFrom(raw);
    await settleProspect({ ...job, preview_id: made.id }, "built", null);
    await logOutcome(job, { office: str(raw.office_name), outcome: "built", preview_id: made.id });
    return { preview_id: made.id, data: { draft_link: made.draft_link } };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    // Already in hand, contacted, do-not-contact, already a user: a decision, not a failure.
    if (/already has a preview|Not building this one/i.test(msg)) {
      const reason = /do-not-contact/.test(msg) ? "on the do-not-contact list" : /SwiftCard user/.test(msg) ? "already a SwiftCard user" : /contacted/.test(msg) ? "already contacted" : "already has a preview";
      await logOutcome(job, { office: str(raw.office_name), outcome: "skipped", reason });
      throw new Skip(reason);
    }
    throw e;
  }
}

/** The opening texts (step 10) and the outreach (step 9), written and checked until clean. */
async function writeOpener(job: Job, signal: AbortSignal): Promise<StepOut> {
  if (!job.preview_id) throw new Error("no draft to write for");
  const p = await getPreviewById(job.preview_id);
  if (!p) throw new Skip("the draft was deleted");
  if (p.status !== "draft") return { data: { opener_note: "already published by hand; left as it is" } };
  const link = `${process.env.NEXT_PUBLIC_APP_URL && !/localhost/.test(process.env.NEXT_PUBLIC_APP_URL) ? process.env.NEXT_PUBLIC_APP_URL : "https://swiftcard.me"}/p/${p.slug}`;
  const stale = staleNumbers(p);
  const style = styleNotes(await listEvents());
  const facts = {
    office_name: p.office_name, owner_name: p.owner_name, owner_title: p.owner_title, license: p.license, address: p.address, specialty: p.specialty,
    team_size: p.team_size, team_size_uncertain: p.sources.team_size?.uncertain === true, team_members: p.team_members, current_tool: p.current_tool,
    linkedin_url: p.linkedin_url ?? null, warm_path: p.warm_path ?? null, hook: { detail: p.detail, why: p.hook_why, angle: p.hook_angle, specific: p.hook_specific },
    specifics: p.specifics.map((s, i) => ({ position: i, kind: s.kind, text: s.text, verified: isVerified(s), quiet: s.quiet === true, dated: s.dated })),
    numbers_flagged_as_possibly_stale: stale,
  };
  const convo: Conversation = { messages: [], usage: { ...NO_USAGE } };
  say(convo, [
    SERVER_MODE,
    "",
    "The draft below is saved. Your part is build-card's steps 9 and 10: write this prospect's outreach and their opening texts, in the owner's voice, from these facts and nothing else.",
    `The link will be ${link} (${link.length} characters): write ${LINK_SLOT} where it goes. A text is ${TEXT_LIMIT} characters at most with the link in.`,
    "",
    "The draft's facts:", JSON.stringify(facts),
    "",
    "The owner's own edits (what `card-builder.mjs style` returns; write like the 'after' side):", JSON.stringify(style),
    "",
    "Answer with ONE ```json block and nothing after it:",
    '{ "openers": { "candidates": [ { "hook", "uses", "text", "scores": { "specificity", "human", "curiosity" } } ] }, "outreach": { "first_text", "first_text_b", "link_text", "email_subject", "email_body", "call_opener", "voicemail", "nudge_no_view", "nudge_viewed", ("linkedin_note", "linkedin_dm" only when linkedin_url is set), "uses": { … } } }',
  ].join("\n"));

  const system = commandText("build-card");
  let reply = await turn(convo, { system, web: false, effort: "high", signal });
  let savedOpeners = false;
  let outreachNote: string | null = null;
  for (let round = 0; ; round++) {
    const json = jsonIn(reply);
    const problems: string[] = [];
    if (!json) problems.push("That wasn't one JSON object in a ```json block.");
    else {
      if (!savedOpeners) {
        const given = Array.isArray((json.openers as Json | undefined)?.candidates) ? ((json.openers as Json).candidates as unknown[]).length : 0;
        const read = readOpeners({ candidates: (json.openers as Json | undefined)?.candidates });
        if (!read) problems.push("Openers: no usable openers. Each needs hook, text, uses and scores { specificity, human, curiosity } of 1 to 10.");
        else if (read.candidates.length !== given) problems.push(`Openers: ${given - read.candidates.length} of them are missing a hook, text or a 1–10 score.`);
        else {
          const openers = rankOpeners(read.candidates);
          const bad = checkOpeners(openers, p, stale);
          if (bad.length) problems.push(...bad.map((b) => `Openers: ${b}`));
          else if (await setOpeners(p.id, openers)) savedOpeners = true;
          else problems.push("Openers: that didn't save.");
        }
      }
      if (outreachNote === null && json.outreach && typeof json.outreach === "object") {
        const o = readOutreach({ ...(json.outreach as Json), written_at: new Date().toISOString() });
        const bad = checkOutreach(o, { link, specifics: p.specifics, complete: true, linkedin: !!p.linkedin_url, warmName: p.warm_path?.name ?? null, stale });
        if (bad.length) problems.push(...bad.map((b) => `Outreach: ${b}`));
        else if (await setOutreach(p.id, o)) outreachNote = "written";
      }
    }
    if (savedOpeners && (outreachNote !== null || round >= 2)) {
      return { data: { openers: "written", outreach: outreachNote ?? "left on the templates: it didn't pass the checks in three tries" }, usage: convo.usage, dollars: dollarsOf(convo.usage) };
    }
    if (round >= 2) throw new Error(`the opening texts didn't pass the checks in three tries: ${problems.slice(0, 3).join(" ")}`.slice(0, 400));
    say(convo, `Not saved yet.${savedOpeners ? " (The openers ARE saved; only fix the outreach.)" : ""} Fix every one of these and answer again with the whole JSON:\n- ${problems.join("\n- ")}`);
    reply = await turn(convo, { system, web: false, effort: "high", signal });
  }
}

/** A target batch: find the offices (find-offices), then make a prospect row and a job for each. */
async function find(job: Job, signal: AbortSignal): Promise<StepOut> {
  const { data: b } = await db().from("prospect_batches").select("id, label, wanted, candidates").eq("id", job.batch_id).maybeSingle();
  if (!b) throw new Skip("the batch was removed");
  const wanted = Math.max(1, Number(b.wanted) || 5);
  const convo: Conversation = { messages: [], usage: { ...NO_USAGE } };
  say(convo, [
    SERVER_MODE,
    "",
    `Find offices for this Card Builder batch: "${b.label}". The owner wants ${wanted} drafts, so find ${Math.min(wanted * 2, 200)} candidates, best fit first, by find-offices' rules (who counts, the six criteria, the disqualifiers). Research with web_search and web_fetch. Don't build anything and don't score in a tool: the server checks each one against who is already contacted and builds them one by one.`,
    "",
    "Answer with ONE ```json block and nothing after it:",
    '{ "candidates": [ { "office": "…", "person": "<the decision-maker, name and title>", "city": "…", "website": "https://…", "why": "<one line: why they fit>" } ] }',
  ].join("\n"));
  const reply = await turn(convo, { system: commandText("find-offices"), web: true, effort: "high", signal });
  const list = jsonIn(reply)?.candidates;
  if (!Array.isArray(list) || !list.length) throw new Error("no offices came back");

  const fresh: (BatchCandidate & { why?: string })[] = [];
  for (const raw of list as Json[]) {
    const c = { office: str(raw.office), person: str(raw.person) || null, city: str(raw.city) || null, website: str(raw.website) || null, why: str(raw.why) };
    if (!c.office) continue;
    const s = await standing({ company: c.office, website: c.website ?? undefined });
    if (s.skip || s.preview_id) {
      await logBatchItem(b.id as string, { office: c.office, outcome: "skipped", reason: s.reasons.join("; ").slice(0, 200) });
      continue;
    }
    fresh.push(c);
  }
  const take = fresh.slice(0, wanted);
  await setCandidates(b.id as string, [...take, ...fresh.slice(wanted), ...readCandidates(b.candidates)]);
  if (!take.length) return { data: { found: 0 }, usage: convo.usage, dollars: dollarsOf(convo.usage) };
  const lines = take.map((c) => [c.person ? `${c.person}, ${c.office}` : c.office, c.city, c.website].filter(Boolean).join(" · "));
  const { data: rows, error } = await db().from("prospect_queue").insert(lines.map((input) => ({ input, is_notes: false, batch_id: b.id }))).select("id");
  if (error || !rows) throw new Error(`saving the offices: ${error?.message ?? "no rows"}`);
  const { error: jErr } = await db().from(JOBS).insert(rows.map((r) => ({ prospect_id: r.id, batch_id: b.id, step: "research", run_after: new Date().toISOString() })));
  if (jErr) throw new Error(`queueing the offices: ${jErr.message}`);
  return { data: { found: take.length }, usage: convo.usage, dollars: dollarsOf(convo.usage) };
}

// ── Keeping the queue row and the batch page in step ────────────────────────

async function settleProspect(job: Pick<Job, "prospect_id" | "batch_id" | "preview_id" | "step" | "data">, outcome: "built" | "skipped" | "failed", note: string | null): Promise<void> {
  if (!job.prospect_id) return;
  await settleQueueItem(job.prospect_id, outcome, { note, preview_id: job.preview_id ?? null, batch_id: job.batch_id ?? null }).catch(() => false);
  if (outcome === "failed" && job.batch_id) {
    await logBatchItem(job.batch_id, { office: str(job.data.office) || (await prospectInput(job as Job).catch(() => ({ input: "a prospect" }))).input.slice(0, 120), outcome: "failed", reason: note?.slice(0, 200) ?? null }).catch(() => null);
  }
}

async function logOutcome(job: Job, item: { office: string; outcome: "built" | "skipped" | "failed"; preview_id?: string; reason?: string }): Promise<void> {
  if (job.batch_id) await logBatchItem(job.batch_id, item).catch(() => null);
}
