// Sign a seeded QA account in WITHOUT the login form.
//
// The form's password sign-in goes through Supabase's CAPTCHA switch (Cloudflare
// Turnstile, components/HumanCheck.tsx). A headless browser is exactly what it
// exists to stop, so once the switch is on, every QA script that typed into
// #auth-password would sit on the login page — and every screen after it would
// "pass" as a clean login wall.
//
// Instead: mint a one-time sign-in link with the service key (no email is sent)
// and open it through /auth/confirm, the same route real emailed links land on.
// verifyOtp is not CAPTCHA-gated, the session cookies are set server-side, and
// the device-slot claim, onboarding and landing are the real ones.
//
//   await signInByLink(page, { adm, base: BASE, email });
//
// `adm` is the script's own admin fetch (path, init) → Response, the helper
// every QA script already defines.
export async function signInByLink(page, { adm, base, email, next = "/dashboard" }) {
  const res = await adm("/auth/v1/admin/generate_link", {
    method: "POST",
    body: JSON.stringify({ type: "magiclink", email }),
  });
  const body = await res.json().catch(() => ({}));
  const hashed = body.hashed_token ?? body.properties?.hashed_token;
  const type = body.verification_type ?? body.properties?.verification_type ?? "magiclink";
  if (!res.ok || !hashed) {
    throw new Error(`sign-in link for ${email} failed (${res.status}): ${JSON.stringify(body).slice(0, 200)}`);
  }
  const url = `${base}/auth/confirm?token_hash=${encodeURIComponent(hashed)}&type=${type}&next=${encodeURIComponent(next)}`;
  await page.goto(url, { waitUntil: "domcontentloaded" });
}
