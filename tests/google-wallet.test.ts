import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import crypto from "node:crypto";
import { readFileSync } from "node:fs";

// Google Wallet, the Android twin of the Apple pass (lib/google-wallet.ts).
// The pieces Google can't be asked about in CI: the signed JWTs, the face of
// the pass, and what happens when nothing is configured.

vi.mock("@/lib/wallet-pass", () => ({ passInputs: vi.fn() }));

import { buildGenericObject, objectIdFor, signJwt, googleWalletSaveUrl, resetGoogleWalletCache } from "@/lib/google-wallet";
import { passInputs } from "@/lib/wallet-pass";

const { privateKey, publicKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
const PEM = privateKey.export({ type: "pkcs8", format: "pem" }).toString();

const INPUTS = {
  card: { username: "alex-morgan", name: "Alex Morgan", title: "Broker", company: "Morgan Realty", phone: "2125550123", email: "alex@morgan.co", website: "morgan.co", label: null },
  meta: null,
};

function decode(jwt: string) {
  const [h, b, s] = jwt.split(".");
  const ok = crypto.verify("RSA-SHA256", Buffer.from(`${h}.${b}`), publicKey, Buffer.from(s, "base64url"));
  return { ok, header: JSON.parse(Buffer.from(h, "base64url").toString()), body: JSON.parse(Buffer.from(b, "base64url").toString()) };
}

describe("the pass face", () => {
  it("shows the card: name, title, company, phone, email, and a QR tagged google_wallet", () => {
    const o = buildGenericObject("3388000000012345678", INPUTS);
    expect(o.id).toBe("3388000000012345678.card_alex-morgan");
    expect(o.classId).toBe("3388000000012345678.swiftcard_card");
    expect(o.header.defaultValue.value).toBe("Alex Morgan");
    expect(o.subheader?.defaultValue.value).toBe("Broker");
    expect(o.cardTitle.defaultValue.value).toBe("Morgan Realty");
    expect(o.barcode).toMatchObject({ type: "QR_CODE", value: "https://swiftcard.me/alex-morgan?source=google_wallet" });
    expect(o.textModulesData.map((m) => m.body)).toEqual(["(212) 555-0123", "alex@morgan.co", "morgan.co"]);
    expect(o.hexBackgroundColor).toMatch(/^#[0-9a-f]{6}$/i);
    expect(o.logo.sourceUri.uri).toMatch(/^https:\/\//);
  });

  it("an odd slug still gets a valid, stable object id", () => {
    expect(objectIdFor("1", "Alex Morgan!")).toBe("1.card_alex_morgan_");
  });

  it("google_wallet is a source Traffic knows", async () => {
    const { storedSource, getSourceLabel } = await import("@/lib/source-labels");
    expect(storedSource("google_wallet")).toBe("google_wallet");
    expect(getSourceLabel("google_wallet")).toBe("Google Wallet");
  });
});

describe("the save link", () => {
  const env = { ...process.env };
  beforeEach(() => {
    resetGoogleWalletCache();
    process.env.GOOGLE_WALLET_ISSUER_ID = "3388000000012345678";
    process.env.GOOGLE_WALLET_CLIENT_EMAIL = "wallet@swiftcard.iam.gserviceaccount.com";
    // Pasted into Vercel with literal \n — the normalisation must undo it.
    process.env.GOOGLE_WALLET_PRIVATE_KEY = `"${PEM.replace(/\n/g, "\\n")}"`;
    vi.mocked(passInputs).mockResolvedValue(INPUTS);
  });
  afterEach(() => {
    process.env = { ...env };
    vi.unstubAllGlobals();
  });

  it("writes the object, then links to pay.google.com with a signed savetowallet JWT naming it", async () => {
    const calls: { url: string; method: string; body?: string }[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit = {}) => {
      calls.push({ url, method: init.method ?? "GET", body: init.body as string | undefined });
      if (url.includes("oauth2")) return new Response(JSON.stringify({ access_token: "t", expires_in: 3600 }));
      if (url.endsWith("/genericClass")) return new Response("{}", { status: 409 });
      if (url.endsWith("/genericObject")) return new Response("{}", { status: 409 });
      return new Response("{}", { status: 200 });
    }));

    const url = await googleWalletSaveUrl("alex-morgan");
    expect(url).toMatch(/^https:\/\/pay\.google\.com\/gp\/v\/save\//);
    const { ok, header, body } = decode(url!.split("/save/")[1]);
    expect(ok, "signature does not verify").toBe(true);
    expect(header).toEqual({ alg: "RS256", typ: "JWT" });
    expect(body).toMatchObject({ aud: "google", typ: "savetowallet", iss: "wallet@swiftcard.iam.gserviceaccount.com" });
    expect(body.payload).toEqual({ genericObjects: [{ id: "3388000000012345678.card_alex-morgan" }] });

    // The token assertion is signed by the same key, for the issuer scope.
    const tokenCall = calls.find((c) => c.url.includes("oauth2"))!;
    const assertion = new URLSearchParams(tokenCall.body!).get("assertion")!;
    expect(decode(assertion).ok).toBe(true);
    expect(decode(assertion).body.scope).toBe("https://www.googleapis.com/auth/wallet_object.issuer");
    // Saved before (409): replaced, so the pass shows the card as it is now.
    expect(calls.some((c) => c.method === "PUT" && c.url.includes("/genericObject/"))).toBe(true);
  });

  it("no pass for a card that must not have one", async () => {
    vi.mocked(passInputs).mockResolvedValue(null);
    vi.stubGlobal("fetch", vi.fn());
    expect(await googleWalletSaveUrl("gone")).toBeNull();
  });

  it("nothing at all until it is configured", async () => {
    delete process.env.GOOGLE_WALLET_PRIVATE_KEY;
    const f = vi.fn();
    vi.stubGlobal("fetch", f);
    expect(await googleWalletSaveUrl("alex-morgan")).toBeNull();
    expect(f).not.toHaveBeenCalled();
  });

  it("signJwt is plain RS256", () => {
    expect(decode(signJwt({ a: 1 }, PEM)).ok).toBe(true);
  });
});

describe("the route", () => {
  it("501s until configured, and is rate-limited like the Apple pass", () => {
    const src = readFileSync("src/app/api/wallet/google/route.ts", "utf8");
    expect(src).toMatch(/status: 501/);
    expect(src).toMatch(/isRateLimited\(`wallet-google:/);
    expect(src).toMatch(/NextResponse\.redirect\(url, 302\)/);
  });

  it("card edits refresh the Google pass wherever they refresh the Apple one", () => {
    for (const f of ["src/app/api/cards/[id]/route.ts", "src/lib/office-brand.ts"]) {
      const src = readFileSync(f, "utf8");
      expect(src, f).toContain("touchWalletPass");
      expect(src, f).toContain("touchGoogleWalletObject");
    }
  });
});
