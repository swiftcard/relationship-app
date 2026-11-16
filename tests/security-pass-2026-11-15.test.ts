import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join } from "node:path";

// 2026-11-15 security and backup pass. Each block pins one decision so it
// cannot be undone quietly. Scanner paths and the clock endpoints have their
// own files (scanner-paths, cron-endpoints-locked).

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

describe("security headers", () => {
  const cfg = read("next.config.ts");
  const header = (key: string) => cfg.match(new RegExp(`\\{ key: "${key}", value: "([^"]*)" \\}`))?.[1];

  it("every response carries the standard set", () => {
    expect(header("Strict-Transport-Security")).toBe("max-age=63072000; includeSubDomains; preload");
    expect(header("X-Frame-Options")).toBe("SAMEORIGIN");
    expect(header("X-Content-Type-Options")).toBe("nosniff");
    expect(header("Referrer-Policy")).toBe("strict-origin-when-cross-origin");
    expect(header("X-Permitted-Cross-Domain-Policies")).toBe("none");
    expect(header("Permissions-Policy")).toContain("camera=(self)"); // the card scanner
    expect(cfg).toContain('{ source: "/:path*", headers: securityHeaders },');
  });

  it("the CSP blocks framing, <base> hijacking and plugins, and nothing the app loads", () => {
    const csp = header("Content-Security-Policy")!;
    expect(csp.split(";").map((d) => d.trim()).sort()).toEqual(["base-uri 'self'", "frame-ancestors 'self'", "object-src 'none'"]);
    // A script/connect/style/img/default policy would need Stripe, Google,
    // Supabase, PostHog, Sentry and both app WebViews allow-listed. Adding
    // one untested is how sign-in or checkout breaks for everyone at once.
    expect(csp).not.toMatch(/default-src|script-src|connect-src|style-src|img-src|form-action/);
    // Same reason for COOP: the Google and LinkedIn windows talk to their opener.
    expect(cfg).not.toMatch(/key: "Cross-Origin-(Opener|Embedder|Resource)-Policy"/);
  });

  it("the app really has no <base>, <object> or <embed> for the CSP to break", () => {
    const hits: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const full = join(dir, name);
        if (statSync(full).isDirectory()) walk(full);
        else if (/\.tsx$/.test(name) && /<(base|object|embed)[\s>/]/.test(readFileSync(full, "utf8"))) hits.push(full);
      }
    };
    walk(join(process.cwd(), "src"));
    expect(hits).toEqual([]);
  });
});

describe("no secret can reach the browser", () => {
  // Next inlines every NEXT_PUBLIC_ variable into the JavaScript it sends to
  // browsers. This is the complete list the code reads; each one is a value
  // that is public by design (a URL, a publishable key, an ID). A new name
  // here needs a human to confirm it is not a secret.
  const PUBLIC_BY_DESIGN = [
    "NEXT_PUBLIC_APP_STORE_ID", "NEXT_PUBLIC_APP_STORE_URL", "NEXT_PUBLIC_APP_URL", "NEXT_PUBLIC_APPLE_SIGNIN_ENABLED",
    "NEXT_PUBLIC_GOOGLE_CLIENT_ID", "NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION", "NEXT_PUBLIC_PLAY_STORE_URL",
    "NEXT_PUBLIC_POSTHOG_HOST", "NEXT_PUBLIC_POSTHOG_KEY", "NEXT_PUBLIC_RC_APPLE_API_KEY", "NEXT_PUBLIC_RC_GOOGLE_API_KEY",
    "NEXT_PUBLIC_SENTRY_DSN", "NEXT_PUBLIC_SENTRY_RELEASE", "NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE",
    "NEXT_PUBLIC_STRIPE_ANNUAL_PRICE_ID", "NEXT_PUBLIC_STRIPE_ENTERPRISE_ANNUAL_PRICE_ID", "NEXT_PUBLIC_STRIPE_ENTERPRISE_PRICE_ID",
    "NEXT_PUBLIC_STRIPE_MONTHLY_PRICE_ID", "NEXT_PUBLIC_SUPABASE_ANON_KEY", "NEXT_PUBLIC_SUPABASE_URL",
    "NEXT_PUBLIC_TURNSTILE_SITE_KEY", "NEXT_PUBLIC_VAPID_PUBLIC_KEY", "NEXT_PUBLIC_VERCEL_ENV",
  ];

  const sourceFiles: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) walk(full);
      else if (/\.(ts|tsx|mjs|js)$/.test(name)) sourceFiles.push(full);
    }
  };
  walk(join(process.cwd(), "src"));
  for (const f of ["next.config.ts", "capacitor.config.ts", ".env.example"]) sourceFiles.push(join(process.cwd(), f));

  it("every NEXT_PUBLIC_ variable is on the reviewed list, and none is named like a secret", () => {
    const used = new Set<string>();
    for (const f of sourceFiles) for (const m of readFileSync(f, "utf8").matchAll(/NEXT_PUBLIC_[A-Z0-9_]+/g)) used.add(m[0]);
    expect([...used].filter((n) => !PUBLIC_BY_DESIGN.includes(n)).sort(), "new NEXT_PUBLIC_ variable: confirm it is safe to publish, then add it here").toEqual([]);
    for (const n of used) {
      expect(n, n).not.toMatch(/SECRET|SERVICE_ROLE|PRIVATE|PASSWORD|WEBHOOK|AUTH_TOKEN|_SK_|RESEND|TWILIO|ANTHROPIC|OPENAI/);
    }
  });

  it("no client component reads a server secret", () => {
    const SERVER_ONLY = /process\.env\.(SUPABASE_SERVICE_ROLE_KEY|STRIPE_SECRET_KEY|STRIPE_WEBHOOK_SECRET|TWILIO_AUTH_TOKEN|RESEND_API_KEY|ANTHROPIC_API_KEY|OPENAI_API_KEY|CRON_SECRET|CLOCK_SECRET|PUSH_CATCHUP_SECRET|CREW_TICK_SECRET)/;
    const offenders = sourceFiles.filter((f) => {
      const src = readFileSync(f, "utf8");
      return /^\s*["']use client["']/m.test(src.slice(0, 300)) && SERVER_ONLY.test(src);
    });
    expect(offenders).toEqual([]);
  });

  it("public/ holds no env file, key or dump", () => {
    const bad: string[] = [];
    const walkPublic = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const full = join(dir, name);
        if (statSync(full).isDirectory()) walkPublic(full);
        else if (/^\.env|\.(pem|p8|p12|key|sql|dump|bak|secrets\.md)$|secret|credential|service-account/i.test(name)) bad.push(full);
      }
    };
    walkPublic(join(process.cwd(), "public"));
    expect(bad).toEqual([]);
  });

  it("git ignores every place a secret is kept (the repo is public)", () => {
    const ignore = read(".gitignore");
    for (const line of [".env*", "!.env.example", "*.secrets.md", "CREDENTIALS-RUNBOOK.md", "*.p8", "*.pem"]) {
      expect(ignore.split("\n"), line).toContain(line);
    }
  });
});

describe("rate limits leave room for a whole office behind one address", () => {
  it("lead capture: 20 per 10 minutes per address per card, with the per-card ceiling behind it", () => {
    const s = read("src/app/api/leads/route.ts");
    // The limiter's default is 3 per 10 minutes: four open-house visitors on
    // one Wi-Fi sharing their details with the same agent hit it.
    expect(s).toContain("if (await isRateLimited(rateKey, 20, 10 * 60 * 1000)) {");
    expect(s).not.toMatch(/isRateLimited\(rateKey\)/);
    expect(s.indexOf("isRateLimited(rateKey, 20")).toBeLessThan(s.indexOf("isRateLimited(`lead-card:"));
    expect(s.indexOf("isRateLimited(`lead-card:")).toBeLessThan(s.indexOf("isLikelyBot("));
  });

  it("the sign-in email check and first-card design have office-sized budgets", () => {
    expect(read("src/app/api/account-exists/route.ts")).toContain("isRateLimited(`acct-exists:${clientIp(req)}`, 120, 10 * 60 * 1000)");
    const design = read("src/app/api/design-generate/route.ts");
    expect(design).toContain("isRateLimited(`design-generate:ip:${clientIp(request)}`, 60, HOUR)");
    // The bill is protected by the all-visitor ceiling, not the per-address one.
    expect(design).toContain('isRateLimited("ai-global:design-generate:guest", 5000, DAY)');
  });

  it("the public endpoints that had no limit now have one, keyed on the trusted address", () => {
    expect(read("src/app/api/auth/google/native/start/route.ts")).toContain("isRateLimited(`native-google-start:${clientIp(request)}`, 120, 10 * 60 * 1000)");
    expect(read("src/app/api/auth/google/native/redeem/route.ts")).toContain("isRateLimited(`native-google-redeem:${clientIp(request)}`, 120, 10 * 60 * 1000)");
    expect(read("src/app/api/card/[username]/vcard/route.ts")).toContain("isRateLimited(`vcard:${clientIp(req)}:${username}`, 300, 10 * 60 * 1000)");
    const log = read("src/app/api/wallet/v1/log/route.ts");
    expect(log).toContain("isRateLimited(`wallet-log:${clientIp(req)}`, 60, 10 * 60 * 1000)");
    // Apple's log sink must keep answering 200 with an empty object.
    expect(log).toContain("10 * 60 * 1000)) return NextResponse.json({});");
  });

  it("a limiter outage never blocks real users", () => {
    const rl = read("src/lib/rate-limit.ts");
    // Upstash unreachable -> the per-instance counter, not an error and not a block.
    expect(rl).toMatch(/catch \(e\) \{[\s\S]*?return inMemoryLimited\(key, max, windowMs\);/);
    // Either naming of the Upstash credentials turns the shared limiter on.
    expect(rl).toContain("process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL");
  });
});

describe("the nightly database backup", () => {
  const wf = read(".github/workflows/db-backup.yml");

  it("runs nightly and by hand, and never for a pull request", () => {
    expect(wf).toMatch(/\non:\n  schedule:\n    - cron: "\d+ \d+ \* \* \*"/);
    expect(wf).toContain("workflow_dispatch:");
    // The repo is public: a pull request must never start a job holding the
    // database password.
    expect(wf.slice(wf.indexOf("\non:\n"), wf.indexOf("\nconcurrency:"))).not.toMatch(/^\s*(pull_request|pull_request_target|push|deployment_status|issue_comment):/m);
    expect(wf).not.toMatch(/self-hosted/);
  });

  it("uses the session pooler and refuses any other address", () => {
    expect(wf).toContain("*pooler.supabase.com:5432*) ;;");
    expect(wf).toContain("postgresql-client-17");
  });

  it("only ever uploads the encrypted file, kept for 90 days", () => {
    expect(wf).toContain("--symmetric --cipher-algo AES256");
    expect(wf).toContain('"${#BACKUP_PASSPHRASE}" -lt 20');
    // The passphrase goes in on a file descriptor, never on the command line.
    expect(wf).not.toMatch(/--passphrase[ =]["$]/);
    const upload = wf.slice(wf.indexOf("uses: actions/upload-artifact@v4"));
    expect(upload).toMatch(/path: out\/\*\.tar\.gpg\n/);
    expect(upload).toMatch(/retention-days: 90\n/);
    expect(wf.match(/uses: actions\/upload-artifact/g)).toHaveLength(1);
    // The plain dump is deleted before the upload step, and proven restorable first.
    expect(wf.indexOf('rm -rf "$WORK"')).toBeLessThan(wf.indexOf("uses: actions/upload-artifact@v4"));
    expect(wf.indexOf("pg_restore\" --list")).toBeLessThan(wf.indexOf("--symmetric"));
    expect(wf).toContain("--decrypt --passphrase-fd 3");
  });

  it("no secret value is written in the workflow, and it never calls the site", () => {
    expect(wf).not.toMatch(/postgres(ql)?:\/\/[^\s"<]+:[^\s"<@]+@/);
    expect(wf).not.toMatch(/https?:\/\/(www\.)?swiftcard\.(me|app)/);
    expect(wf.match(/secrets\.([A-Z_]+)/g)!.filter((s, i, a) => a.indexOf(s) === i).sort()).toEqual(["secrets.BACKUP_PASSPHRASE", "secrets.SUPABASE_DB_URL"]);
  });

  it("the restore steps and the two secrets are written down", () => {
    expect(existsSync(join(process.cwd(), "docs/BACKUP-RESTORE.md"))).toBe(true);
    const doc = read("docs/BACKUP-RESTORE.md");
    for (const s of ["SUPABASE_DB_URL", "BACKUP_PASSPHRASE", "gpg --decrypt", "pg_restore", "Session pooler", "public"]) expect(doc).toContain(s);
    const env = read("ENV_KEYS_NEEDED.md");
    expect(env).toContain("| `SUPABASE_DB_URL` |");
    expect(env).toContain("| `BACKUP_PASSPHRASE` |");
  });
});

describe("the two Supabase migrations are written, not applied, and safe", () => {
  it("search_path is pinned on the four office stats functions, by exact signature", () => {
    const sql = read("supabase/office-stats-search-path-2026-11-15.sql");
    for (const sig of [
      "public.office_employee_view_stats(text[], timestamptz, timestamptz)",
      "public.office_employee_lead_stats(text[], timestamptz, timestamptz)",
      "public.office_unique_visitors(text[], timestamptz, timestamptz)",
      "public.office_daily_views_tz(text[], timestamptz, timestamptz, text)",
    ]) {
      expect(sql).toContain(`alter function ${sig}\n  set search_path = public, pg_temp;`);
    }
    // ALTER only: no body is replaced, no grant changes, nothing is dropped.
    expect(sql.replace(/^--.*$/gm, "")).not.toMatch(/\b(create|drop|grant|revoke|delete|truncate|cron\.)\b/i);
  });

  it("the storage file adds limits and no policy (a policy would be a door)", () => {
    const sql = read("supabase/storage-bucket-limits-2026-11-15.sql").replace(/^--.*$/gm, "");
    expect(sql).not.toMatch(/\b(create policy|drop|delete|truncate|grant|public\s*=)\b/i);
    expect(sql.match(/update storage\.buckets/g)).toHaveLength(2);
    expect(sql).toContain("where id = 'pins';");
    expect(sql).toContain("where id = 'crew-media';");
  });
});
