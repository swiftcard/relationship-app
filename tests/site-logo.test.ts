import { describe, it, expect } from "vitest";
import { extractSiteLogoUrls, extractSiteName, websiteToDomain } from "@/lib/site-logo";

// Owner ask 2026-10-02: when the name / work-email search can't find the logo,
// the website the user typed is the third source — its exact Logo.dev match,
// else the logo the homepage declares about itself.

describe("websiteToDomain", () => {
  it("reduces any typed form of a website to its bare domain", () => {
    expect(websiteToDomain("https://www.Acme.com/about?x=1")).toBe("acme.com");
    expect(websiteToDomain("acme.co.uk")).toBe("acme.co.uk");
    expect(websiteToDomain("http://shop.acme.com")).toBe("shop.acme.com");
  });
  it("rejects junk and personal mail hosts", () => {
    expect(websiteToDomain("")).toBeNull();
    expect(websiteToDomain("acme")).toBeNull();
    expect(websiteToDomain("my site.com")).toBeNull();
    expect(websiteToDomain("gmail.com")).toBeNull();
  });
});

describe("extractSiteLogoUrls", () => {
  const page = "https://acme.com/";

  it("prefers the schema.org logo, then a header <img> marked logo, then icons", () => {
    const html = `
      <head>
        <link rel="icon" href="/favicon.ico">
        <link rel="icon" type="image/svg+xml" href="/icon.svg">
        <link rel="apple-touch-icon" sizes="180x180" href="/apple.png">
        <meta property="og:image" content="/banner.jpg">
        <script type="application/ld+json">{"@type":"Organization","logo":{"url":"https://cdn.acme.com/brand.png"}}</script>
      </head>
      <body><header><img class="site-logo" src="/img/acme-logo.svg" alt="Acme"></header>
      <section><img src="/partners/logo-bigco.png" alt="Partner logo"></section></body>`;
    expect(extractSiteLogoUrls(html, page)).toEqual([
      "https://cdn.acme.com/brand.png",
      "https://acme.com/img/acme-logo.svg",
      "https://acme.com/apple.png",
      "https://acme.com/icon.svg",
    ]);
  });

  it("never offers the share banner, a .ico, a data: URL or a partner strip", () => {
    const html = `<meta property="og:image" content="/banner.jpg"><link rel="icon" href="/favicon.ico">
      <img src="data:image/png;base64,AAAA" alt="logo"><img src="/clients/logo-x.png">`;
    expect(extractSiteLogoUrls(html, page)).toEqual([]);
  });

  it("upgrades http assets to https and resolves relative paths", () => {
    const html = `<img src="http://acme.com/logo.png">`;
    expect(extractSiteLogoUrls(html, "https://acme.com/en/")).toEqual(["https://acme.com/logo.png"]);
  });
});

describe("extractSiteName", () => {
  it("uses og:site_name, else the first part of the title, else the domain", () => {
    expect(extractSiteName(`<meta property="og:site_name" content="Acme &amp; Co">`, "acme.com")).toBe("Acme & Co");
    expect(extractSiteName(`<title>Acme Realty | Homes in Queens</title>`, "acme.com")).toBe("Acme Realty");
    expect(extractSiteName(``, "acme.com")).toBe("acme.com");
  });
});

describe("extractSiteName — apostrophes", () => {
  it("keeps the whole name through quotes and numeric entities", () => {
    expect(extractSiteName(`<meta property="og:site_name" content="Joe's Pizza">`, "x.com")).toBe("Joe's Pizza");
    expect(extractSiteName(`<title>Katz&#039;s Delicatessen</title>`, "x.com")).toBe("Katz's Delicatessen");
    expect(extractSiteName(`<meta property="og:site_name" content="Joe&amp;#39;s Pizza">`, "x.com")).toBe("Joe's Pizza");
  });
});
