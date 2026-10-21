import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import sharp from "sharp";

// Owner, 2026-10-20: the LinkedIn photo is "a very blurry image". Every stored
// import was the 100px thumbnail upscaled to 400px. These drive the real
// helper against a fake LinkedIn: the full-size photo must win whenever any
// route to it works, and the thumbnail is only the last resort.

const API = "https://api.linkedin.com/v2/me?projection=(id,profilePicture(displayImage~:playableStreams))";
const THUMB = "https://media.licdn.com/dms/image/v2/ABC/profile-displayphoto-shrink_100_100/profile-displayphoto-shrink_100_100/0/1?e=1&v=beta&t=sig";
const SWAP_800 = THUMB.replaceAll("shrink_100_100", "shrink_800_800");
const API_800 = "https://media.licdn.com/dms/image/v2/ABC/profile-displayphoto-shrink_800_800/profile-displayphoto-shrink_800_800/0/1?e=2&v=beta&t=api800";
const API_200 = "https://media.licdn.com/dms/image/v2/ABC/profile-displayphoto-shrink_200_200/profile-displayphoto-shrink_200_200/0/1?e=2&v=beta&t=api200";

const jpeg = (px: number) => sharp({ create: { width: px, height: px, channels: 3, background: { r: 40, g: 90, b: 160 } } }).jpeg().toBuffer();

const sizesBody = {
  profilePicture: {
    "displayImage~": {
      elements: [200, 800].map((w) => ({
        data: { "com.linkedin.digitalmedia.mediaartifact.StillImage": { storageSize: { width: w, height: w } } },
        identifiers: [{ identifier: w === 800 ? API_800 : API_200 }],
      })),
    },
  },
};

let apiStatus = 200;
let images: Record<string, Buffer> = {};
const asked: string[] = [];

vi.mock("@/lib/safe-fetch", () => ({
  safeFetch: async (url: string, init: { headers?: Record<string, string> }) => {
    asked.push(url);
    expect(url).toBe(API);
    expect(init.headers?.Authorization).toBe("Bearer tok");
    return new Response(JSON.stringify(apiStatus === 200 ? sizesBody : { message: "Not enough permissions" }), { status: apiStatus });
  },
}));

beforeEach(() => {
  apiStatus = 200;
  images = {};
  asked.length = 0;
  vi.spyOn(console, "info").mockImplementation(() => {});
  vi.stubGlobal("fetch", async (url: string) => {
    asked.push(url);
    const b = images[url];
    return b ? new Response(new Uint8Array(b), { headers: { "content-type": "image/jpeg" } }) : new Response("Forbidden", { status: 403 });
  });
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const widthOf = async (b: Buffer) => (await sharp(b).metadata()).width;

describe("the LinkedIn photo is the full-size one whenever LinkedIn will give it", () => {
  it("takes the largest size from LinkedIn's own list and stores it at that size", async () => {
    images = { [API_800]: await jpeg(800), [API_200]: await jpeg(200), [THUMB]: await jpeg(100) };
    const { fetchLinkedInPhoto } = await import("@/lib/linkedin-photo");
    const photo = await fetchLinkedInPhoto(THUMB, { accessToken: "tok" });
    expect(photo).toMatchObject({ source: "api", sourceWidth: 800, wasSmall: false });
    expect(await widthOf(photo!.body)).toBe(800);
    expect(asked).not.toContain(THUMB);
  });

  it("when the list isn't allowed, the size swap (both segments) is tried before the thumbnail", async () => {
    apiStatus = 403;
    images = { [SWAP_800]: await jpeg(800), [THUMB]: await jpeg(100) };
    const { fetchLinkedInPhoto } = await import("@/lib/linkedin-photo");
    const photo = await fetchLinkedInPhoto(THUMB, { accessToken: "tok" });
    expect(photo).toMatchObject({ source: "swap", sourceWidth: 800, wasSmall: false });
    expect(asked).not.toContain(THUMB);
  });

  it("only a thumbnail anywhere: still enhanced to 400px, as before", async () => {
    apiStatus = 403;
    images = { [THUMB]: await jpeg(100) };
    const { fetchLinkedInPhoto } = await import("@/lib/linkedin-photo");
    const photo = await fetchLinkedInPhoto(THUMB, { accessToken: "tok" });
    expect(photo).toMatchObject({ source: "original", sourceWidth: 100, wasSmall: true });
    expect(await widthOf(photo!.body)).toBe(400);
  });

  it("nothing downloadable: null, so the import says so", async () => {
    apiStatus = 403;
    const { fetchLinkedInPhoto } = await import("@/lib/linkedin-photo");
    expect(await fetchLinkedInPhoto(THUMB, { accessToken: "tok" })).toBeNull();
  });

  it("reads only https URLs out of the list, largest first", async () => {
    const { linkedInPhotoSizes } = await import("@/lib/linkedin-photo");
    expect(linkedInPhotoSizes(sizesBody)).toEqual([API_800, API_200]);
    expect(linkedInPhotoSizes({ profilePicture: { "displayImage~": { elements: [{ identifiers: [{ identifier: "http://x/y.jpg" }] }] } } })).toEqual([]);
    expect(linkedInPhotoSizes(null)).toEqual([]);
    expect(linkedInPhotoSizes({ id: "abc" })).toEqual([]);
  });
});
