import crypto from "node:crypto";
import { passInputs, type PassInputs } from "@/lib/wallet-pass";
import { passPalette } from "@/lib/wallet-palette";

// ── Google Wallet: the Android twin of the Apple pass ───────────────────────
//
// An Apple pass is a signed file the phone keeps. A Google pass is a record on
// Google's servers (a "generic object") that the phone shows; "Add to Google
// Wallet" is a link to pay.google.com carrying a signed JWT that names it. So
// the download route here does two things: write this card's object (insert,
// or replace it when it already exists) and hand back the save link.
//
// Same inputs as the Apple pass (lib/wallet-pass passInputs), so the two carry
// the same kill-switches: a deleted account, an offline office card or a card
// past its plan limit gets no pass on either.
//
// Signing is plain node:crypto, the way lib/fcm.ts mints its Google token — no
// SDK for two RS256 signatures.

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "https://swiftcard.me";
const API = "https://walletobjects.googleapis.com/walletobjects/v1";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const SCOPE = "https://www.googleapis.com/auth/wallet_object.issuer";
const CLASS_SUFFIX = "swiftcard_card";

type Issuer = { issuerId: string; clientEmail: string; privateKey: string };

// Same normalisation fcm.ts does: Vercel keeps a pasted multi-line key with
// literal "\n" in it, often wrapped in quotes, and OpenSSL rejects both.
function normalizeKey(raw: string): string {
  return raw.trim().replace(/^"|"$/g, "").replace(/\\n/g, "\n");
}

function issuer(): Issuer | null {
  const issuerId = process.env.GOOGLE_WALLET_ISSUER_ID?.trim();
  const clientEmail = process.env.GOOGLE_WALLET_CLIENT_EMAIL?.trim();
  const privateKey = process.env.GOOGLE_WALLET_PRIVATE_KEY;
  if (!issuerId || !clientEmail || !privateKey) return null;
  return { issuerId, clientEmail, privateKey: normalizeKey(privateKey) };
}

function b64url(input: Buffer | string): string {
  return Buffer.from(input).toString("base64url");
}

/** An RS256 JWT over these claims. Exported for tests. */
export function signJwt(claims: Record<string, unknown>, privateKey: string): string {
  const head = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const body = b64url(JSON.stringify(claims));
  const input = `${head}.${body}`;
  return `${input}.${b64url(crypto.sign("RSA-SHA256", Buffer.from(input), privateKey))}`;
}

// One access token per process until shortly before it expires, like fcm.ts.
let cachedToken: { token: string; expiresAt: number } | null = null;
let classReady = false;

/** Exported for tests only. */
export function resetGoogleWalletCache(): void {
  cachedToken = null;
  classReady = false;
}

async function accessToken(iss: Issuer): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  if (cachedToken && cachedToken.expiresAt > now + 300) return cachedToken.token;
  const assertion = signJwt({ iss: iss.clientEmail, scope: SCOPE, aud: TOKEN_URL, iat: now, exp: now + 3600 }, iss.privateKey);
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion }).toString(),
  });
  if (!res.ok) throw new Error(`token ${res.status} ${(await res.text()).slice(0, 200)}`);
  const json = (await res.json()) as { access_token?: string; expires_in?: number };
  if (!json.access_token) throw new Error("token response had no access_token");
  cachedToken = { token: json.access_token, expiresAt: now + (json.expires_in ?? 3600) };
  return cachedToken.token;
}

async function api(iss: Issuer, method: string, path: string, body?: unknown): Promise<Response> {
  return fetch(`${API}${path}`, {
    method,
    headers: { Authorization: `Bearer ${await accessToken(iss)}`, "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

/**
 * The object id for a card. Google allows letters, digits, ".", "_" and "-"
 * after the issuer prefix; a slug already is that, and anything else is
 * replaced so an odd legacy slug still gets a valid, stable id.
 */
export function objectIdFor(issuerId: string, username: string): string {
  return `${issuerId}.card_${username.toLowerCase().replace(/[^a-z0-9._-]/g, "_")}`;
}

function text(value: string) {
  return { defaultValue: { language: "en-US", value } };
}

// The same four lines as wallet.ts prettyPhone, copied for the same reason:
// that module pulls in passkit-generator, which this route never needs.
function prettyPhone(raw: string): string {
  const d = raw.replace(/\D/g, "");
  if (d.length === 10) return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`;
  if (d.length === 11 && d[0] === "1") return `+1 (${d.slice(1, 4)}) ${d.slice(4, 7)}-${d.slice(7)}`;
  return raw;
}

const HEX = /^#[0-9a-f]{6}$/i;
const NAVY = "#0d1b3e";

/**
 * The generic object for these inputs. Pure, and exported so its face can be
 * tested without Google. What it shows matches the Apple pass: the name, the
 * title and company, phone and email, and a QR that opens the card tagged
 * ?source=google_wallet so a scan lands in Traffic as "Google Wallet".
 */
export function buildGenericObject(issuerId: string, inputs: PassInputs) {
  const { card, meta } = inputs;
  const name = (card.name || meta?.name || "SwiftCard").trim();
  const title = (card.title || meta?.title || "").trim();
  const company = (card.company || meta?.company || "").trim();
  const cardUrl = `${APP_URL}/${card.username}`;

  let background = NAVY;
  if (meta) {
    try {
      const bg = passPalette(meta).body.background;
      if (HEX.test(bg)) background = bg;
    } catch { /* plain navy, like the Apple fallback pass */ }
  }

  // Google draws the logo in a circle at the top of the pass: the headshot
  // reads best there, then the company logo, then SwiftCard's own icon.
  const logoUri = [meta?.photoUrl, meta?.logoUrl].find((u): u is string => !!u && u.startsWith("https://"))
    ?? `${APP_URL}/wallet/icon@3x.png`;

  const modules: { id: string; header: string; body: string }[] = [];
  if (card.phone) modules.push({ id: "phone", header: "Phone", body: prettyPhone(card.phone) });
  if (card.email) modules.push({ id: "email", header: "Email", body: card.email });
  if (card.website) modules.push({ id: "website", header: "Website", body: card.website });

  return {
    id: objectIdFor(issuerId, card.username),
    classId: `${issuerId}.${CLASS_SUFFIX}`,
    state: "ACTIVE",
    cardTitle: text(company || "SwiftCard"),
    header: text(name),
    ...(title ? { subheader: text(title) } : {}),
    logo: { sourceUri: { uri: logoUri }, contentDescription: text(name) },
    hexBackgroundColor: background,
    barcode: { type: "QR_CODE", value: `${cardUrl}?source=google_wallet`, alternateText: "Scan to connect" },
    textModulesData: modules,
    linksModuleData: { uris: [{ id: "card", uri: cardUrl, description: "Open my SwiftCard" }] },
  };
}

// The one class every card's object belongs to. Created on first use; a 409
// means it already exists, which is the normal case after the first ever save.
async function ensureClass(iss: Issuer): Promise<void> {
  if (classReady) return;
  const res = await api(iss, "POST", "/genericClass", { id: `${iss.issuerId}.${CLASS_SUFFIX}` });
  if (!res.ok && res.status !== 409) throw new Error(`class ${res.status} ${(await res.text()).slice(0, 200)}`);
  classReady = true;
}

/**
 * The "Add to Google Wallet" link for a card, after writing its object — or
 * null when the card must not have a pass. Throws when Google refuses.
 */
export async function googleWalletSaveUrl(username: string): Promise<string | null> {
  const iss = issuer();
  if (!iss) return null;
  const inputs = await passInputs(username);
  if (!inputs) return null;

  await ensureClass(iss);
  const object = buildGenericObject(iss.issuerId, inputs);
  const created = await api(iss, "POST", "/genericObject", object);
  if (created.status === 409) {
    // Saved before: replace it so the pass shows the card as it is now.
    const replaced = await api(iss, "PUT", `/genericObject/${encodeURIComponent(object.id)}`, object);
    if (!replaced.ok) throw new Error(`object ${replaced.status} ${(await replaced.text()).slice(0, 200)}`);
  } else if (!created.ok) {
    throw new Error(`object ${created.status} ${(await created.text()).slice(0, 200)}`);
  }

  // The object already exists on Google's side, so the JWT only names it —
  // short enough for any browser's address bar.
  const jwt = signJwt({
    iss: iss.clientEmail,
    aud: "google",
    typ: "savetowallet",
    iat: Math.floor(Date.now() / 1000),
    origins: [APP_URL],
    payload: { genericObjects: [{ id: object.id }] },
  }, iss.privateKey);
  return `https://pay.google.com/gp/v/save/${jwt}`;
}

/**
 * After a card edit: rewrite its Google pass so phones holding it show the
 * change (Google pushes an updated object to them itself). A 404 means nobody
 * ever saved this card to Google Wallet — nothing to do, and no object is
 * created for a card no one asked to save.
 */
export async function touchGoogleWalletObject(username: string): Promise<void> {
  const iss = issuer();
  if (!iss) return;
  const inputs = await passInputs(username);
  if (!inputs) return;
  const object = buildGenericObject(iss.issuerId, inputs);
  const res = await api(iss, "PUT", `/genericObject/${encodeURIComponent(object.id)}`, object);
  if (!res.ok && res.status !== 404) {
    console.error("[google-wallet] update failed:", res.status, (await res.text()).slice(0, 200));
  }
}

export type GoogleWalletHealth = { configured: boolean; ok: boolean; reason: string };

/**
 * Are the Google Wallet credentials good? Minting an access token proves the
 * key and the service account line up — the step that fails when either is
 * wrong — without writing anything. Same shape as fcm.ts checkFcmCredentials.
 */
export async function checkGoogleWalletCredentials(): Promise<GoogleWalletHealth> {
  const iss = issuer();
  if (!iss) return { configured: false, ok: false, reason: "not_configured" };
  try {
    await accessToken(iss);
    return { configured: true, ok: true, reason: "" };
  } catch (e) {
    return { configured: true, ok: false, reason: e instanceof Error ? e.message : String(e) };
  }
}
