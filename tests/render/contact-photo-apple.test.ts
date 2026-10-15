// The picture in a saved contact, checked by APPLE'S OWN PARSER.
//
// Owner, 2026-10-15: "when I press Save Contact on a user, it doesn't save
// their headshot as the picture on the phone … headshot, then logo, then
// initials … set in stone." The server vCard carried the picture all along —
// as whatever the upload was (PNG logos up to ~290KB, past what iCloud keeps).
// Every source test said "PHOTO is in the file"; none could say whether an
// iPhone keeps it.
//
// This one can. On the macOS CI runner (the `render` job, which gates every
// deploy) the files go through CNContactVCardSerialization — the Contacts
// framework an iPhone runs when Safari hands it a contact — and the picture
// it reads back must be there, decodable, and square. Everywhere else
// (Windows / Linux dev machines) the shape checks still run; only the Apple
// parse is skipped, because Contacts.framework only exists on a Mac.

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { build } from "esbuild";
import { chromium, webkit, type BrowserType } from "playwright";
import sharp from "sharp";
import { contactPhotoFromBytes } from "@/lib/contact-photo";
import { renderInitialsPhoto } from "@/lib/contact-initials-photo";
import {
  buildVCard, CONTACT_PHOTO_EDGE, CONTACT_PHOTO_MAX_BYTES, CONTACT_LOGO_DARK_BG,
  type ContactImageKind, type VCardPhoto,
} from "@/lib/vcard";

const onMac = process.platform === "darwin";

// A portrait headshot the shape phones upload: taller than wide, a face in
// the upper half, no JFIF header (libvips output, like the real uploads).
async function portraitHeadshot(): Promise<Buffer> {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="900" height="1200">
    <rect width="900" height="1200" fill="#8aa1b8"/>
    <ellipse cx="450" cy="430" rx="190" ry="240" fill="#e0b48f"/>
    <rect x="170" y="760" width="560" height="440" rx="120" fill="#3b4a5c"/>
  </svg>`;
  return sharp(Buffer.from(svg)).jpeg({ quality: 92 }).toBuffer();
}

// Worst case for size: pure noise compresses worst of anything a camera makes.
async function noisyPhoto(): Promise<Buffer> {
  const w = 1600;
  const raw = Buffer.alloc(w * w * 3);
  let s = 12345;
  for (let i = 0; i < raw.length; i++) {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    raw[i] = s >> 23;
  }
  return sharp(raw, { raw: { width: w, height: w, channels: 3 } }).png().toBuffer();
}

// A wide, transparent wordmark — in a dark colour, or white (made for dark cards).
async function wordmark(fill: string): Promise<Buffer> {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="200">
    <rect x="10" y="40" width="120" height="120" rx="24" fill="${fill}"/>
    <rect x="160" y="70" width="420" height="60" rx="12" fill="${fill}"/>
  </svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}

const PERSON = {
  name: "Alex Morgan",
  title: "Director of Originations",
  company: "Harbor Capital",
  email: "alex@harbor.example",
  phones: [{ number: "+1 404 555 0101", label: "mobile" }],
  website: "harbor.example",
  cardUrl: "https://swiftcard.me/alexmorgan-harborcapital",
  linkedin: "alex-morgan",
  address: { street: "26 Harbor Park Dr", city: "Port Washington", state: "NY", zip: "11050" },
  note: "Bridge loans, fix and flip.\nCall any time.",
};

type Case = {
  file: string;
  kind: ContactImageKind | "initials";
  photo: VCardPhoto | null;
  bg?: string;
  /** The server output carries a JFIF header by construction; a browser's encoder writes its own. */
  server: boolean;
};
const cases: Case[] = [];
let dir = "";

// The browser path (Save Contact building the file itself): the real
// lib/contact-photo-browser, bundled and run in each engine.
async function browserPhotos(
  type: BrowserType,
  bundle: string,
  inputs: Array<{ b64: string; mime: string; kind: ContactImageKind }>,
): Promise<Array<VCardPhoto | null>> {
  const browser = await type.launch();
  try {
    const page = await browser.newPage();
    await page.setContent(`<!doctype html><html><body><script>${bundle}</script></body></html>`);
    return await page.evaluate(async (items) => {
      const run = (window as unknown as { run: (b: Blob, k: string) => Promise<VCardPhoto | null> }).run;
      const out: Array<VCardPhoto | null> = [];
      for (const it of items) {
        const bytes = Uint8Array.from(atob(it.b64), (ch) => ch.charCodeAt(0));
        out.push(await run(new Blob([bytes], { type: it.mime }), it.kind));
      }
      return out;
    }, inputs);
  } finally {
    await browser.close();
  }
}

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "sc-contact-photo-"));
  const headshot = await portraitHeadshot();
  const darkLogo = await wordmark("#1f2937");
  const whiteLogo = await wordmark("#ffffff");
  cases.push(
    { file: "headshot.vcf", kind: "headshot", photo: await contactPhotoFromBytes(headshot, "headshot"), server: true },
    { file: "headshot-huge.vcf", kind: "headshot", photo: await contactPhotoFromBytes(await noisyPhoto(), "headshot"), server: true },
    { file: "logo-dark.vcf", kind: "logo", photo: await contactPhotoFromBytes(darkLogo, "logo"), bg: "#FFFFFF", server: true },
    { file: "logo-white.vcf", kind: "logo", photo: await contactPhotoFromBytes(whiteLogo, "logo"), bg: CONTACT_LOGO_DARK_BG, server: true },
    { file: "initials.vcf", kind: "initials", photo: await renderInitialsPhoto(PERSON.name), server: true },
  );

  const cache = resolve("node_modules/.cache");
  mkdirSync(cache, { recursive: true });
  const tmp = mkdtempSync(join(cache, "contact-photo-"));
  try {
    writeFileSync(join(tmp, "entry.ts"), `
      import { toContactPhoto } from "@/lib/contact-photo-browser";
      (window as any).run = (b: Blob, k: any) => toContactPhoto(b, k);
    `);
    const out = await build({
      entryPoints: [join(tmp, "entry.ts")], bundle: true, write: false, format: "iife", platform: "browser",
      alias: { "@": resolve("src") },
    });
    const bundle = out.outputFiles[0].text;
    const inputs = [
      { b64: headshot.toString("base64"), mime: "image/jpeg", kind: "headshot" as const },
      { b64: darkLogo.toString("base64"), mime: "image/png", kind: "logo" as const },
      { b64: whiteLogo.toString("base64"), mime: "image/png", kind: "logo" as const },
    ];
    for (const [engine, type] of [["chromium", chromium], ["webkit", webkit]] as const) {
      const [h, d, w] = await browserPhotos(type, bundle, inputs);
      cases.push(
        { file: `${engine}-headshot.vcf`, kind: "headshot", photo: h, server: false },
        { file: `${engine}-logo-dark.vcf`, kind: "logo", photo: d, bg: "#FFFFFF", server: false },
        { file: `${engine}-logo-white.vcf`, kind: "logo", photo: w, bg: CONTACT_LOGO_DARK_BG, server: false },
      );
    }
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }

  for (const c of cases) writeFileSync(join(dir, c.file), buildVCard(PERSON, c.photo));
  // CONTACT_PHOTO_DUMP=<dir> writes the pictures out to look at.
  const dump = process.env.CONTACT_PHOTO_DUMP;
  if (dump) for (const c of cases) if (c.photo) writeFileSync(join(dump, c.file.replace(".vcf", ".jpg")), bytesOf(c.photo));
}, 120_000);

afterAll(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
});

const bytesOf = (p: VCardPhoto) => Buffer.from(p.base64, "base64");
const hex = (n: number) => n.toString(16).padStart(2, "0");

describe("saved-contact picture: the shape iPhone keeps", () => {
  it("every picture — server, Chromium, WebKit — is a square JPEG under the iCloud ceiling", async () => {
    expect(cases.length).toBe(11);
    for (const c of cases) {
      expect(c.photo, c.file).not.toBeNull();
      const buf = bytesOf(c.photo!);
      expect(c.photo!.mime, c.file).toBe("image/jpeg");
      expect([...buf.subarray(0, 3)], c.file).toEqual([0xff, 0xd8, 0xff]);
      if (c.server) {
        // FF D8 FF E0 .. "JFIF" — the header Contacts itself writes.
        expect(buf[3], c.file).toBe(0xe0);
        expect(buf.subarray(6, 10).toString("latin1"), c.file).toBe("JFIF");
      }
      expect(buf.byteLength, c.file).toBeLessThanOrEqual(CONTACT_PHOTO_MAX_BYTES);
      const meta = await sharp(buf).metadata();
      expect([meta.width, meta.height], c.file).toEqual([CONTACT_PHOTO_EDGE, CONTACT_PHOTO_EDGE]);
    }
  });

  it("a logo sits whole in the middle, on white — or on dark when it is white itself", async () => {
    for (const c of cases.filter((x) => x.kind === "logo")) {
      const { data } = await sharp(bytesOf(c.photo!)).raw().toBuffer({ resolveWithObject: true });
      const corner = `#${hex(data[0])}${hex(data[1])}${hex(data[2])}`.toUpperCase();
      // JPEG rounding: within a few levels of the tile colour.
      const want = c.bg!.replace("#", "");
      const near = [0, 2, 4].every((i, k) => Math.abs(parseInt(want.slice(i, i + 2), 16) - data[k]) <= 6);
      expect(near, `${c.file} corner ${corner}, want ${c.bg}`).toBe(true);
    }
  });

  it("the vCard stays a small file (no picture pushes it past what phones import)", () => {
    for (const c of cases) {
      const size = Buffer.byteLength(buildVCard(PERSON, c.photo));
      expect(size, c.file).toBeLessThan(300_000);
    }
  });
});

describe.runIf(onMac)("saved-contact picture: read back by Apple's Contacts framework", () => {
  it("keeps the picture, the name, the phone and the links in every file", () => {
    const out = execFileSync(
      "swift",
      [join(process.cwd(), "scripts", "contact-photo-apple-check.swift"), ...cases.map((c) => join(dir, c.file))],
      { encoding: "utf8", timeout: 240_000 },
    );
    const rows = out.trim().split("\n").filter((l) => l.startsWith("{")).map((l) => JSON.parse(l));
    expect(rows.map((r) => r.file)).toEqual(cases.map((c) => c.file));
    for (const r of rows) {
      expect(r.error, r.file).toBeUndefined();
      expect([r.given, r.family], r.file).toEqual(["Alex", "Morgan"]);
      expect(r.phones, r.file).toBe(1);
      expect(r.urls, r.file).toBeGreaterThanOrEqual(3);
      expect(r.imageBytes, `${r.file}: Apple's parser dropped the picture`).toBeGreaterThan(0);
      expect([r.width, r.height], r.file).toEqual([CONTACT_PHOTO_EDGE, CONTACT_PHOTO_EDGE]);
    }
  }, 300_000);
});
