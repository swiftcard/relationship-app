// Provider-flexible AI completion. Uses whichever pay-as-you-go key is set
// (OpenAI → Gemini → Anthropic), so there are no prepaid credits to run dry.
// Returns null when no provider is configured or the call fails — callers then
// fall back to templates so generation never hard-breaks.

export function hasAiProvider(): boolean {
  return !!(process.env.OPENAI_API_KEY || process.env.GEMINI_API_KEY || process.env.ANTHROPIC_API_KEY);
}

/**
 * The company that actually receives user data, named the way a person would
 * say it — resolved with the SAME waterfall the calls below use.
 *
 * App Review rejected 1.0.0 (3) partly under 5.1.1(i)/5.1.2(i) because the
 * consent notice said "our AI provider" without naming anyone. Apple requires
 * the recipient to be identified. Hardcoding a name would have been the same
 * bug one release later: swap a key and the disclosure silently becomes false.
 * So the disclosure reads the provider from the same place the request does.
 *
 * Returns null when nothing is configured, in which case no AI call can happen
 * and there is nothing to disclose.
 */
export function aiProviderName(): string | null {
  if (process.env.OPENAI_API_KEY) return "OpenAI";
  if (process.env.GEMINI_API_KEY) return "Google";
  if (process.env.ANTHROPIC_API_KEY) return "Anthropic";
  return null;
}

/**
 * A configured provider that answered nothing — a 429, a 5xx, an expired key,
 * an empty reply — used to vanish: every feature quietly fell back to its
 * generic template and nothing anywhere said the key had stopped working
 * (audit I-05). Reported now, naming the provider. Still ONE provider per call:
 * a second one would receive people's data the consent notice (aiProviderName,
 * App Review 5.1.1) doesn't name.
 */
async function reportAiFailure(kind: "complete" | "vision"): Promise<void> {
  try {
    const { reportError } = await import("@/lib/report-error");
    await reportError("ai.provider_failed", new Error(`${aiProviderName()} returned no ${kind} result`), { kind, provider: aiProviderName() });
  } catch { /* reporting must never break the caller's fallback */ }
}

export async function aiComplete(prompt: string, opts?: { maxTokens?: number; json?: boolean }): Promise<string | null> {
  const out = await aiCompleteOnce(prompt, opts);
  if (out === null && hasAiProvider()) await reportAiFailure("complete");
  return out;
}

async function aiCompleteOnce(prompt: string, opts?: { maxTokens?: number; json?: boolean }): Promise<string | null> {
  const maxTokens = opts?.maxTokens ?? 300;

  // ── OpenAI (gpt-4o-mini by default) ──
  if (process.env.OPENAI_API_KEY) {
    try {
      const r = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: process.env.OPENAI_MODEL || "gpt-4o-mini",
          max_tokens: maxTokens,
          messages: [{ role: "user", content: prompt }],
          ...(opts?.json ? { response_format: { type: "json_object" } } : {}),
        }),
      });
      const d = await r.json();
      if (r.ok) return (d.choices?.[0]?.message?.content ?? "").trim() || null;
    } catch { /* fall through to null */ }
    return null;
  }

  // ── Google Gemini (gemini-2.5-flash by default) ──
  if (process.env.GEMINI_API_KEY) {
    try {
      const model = process.env.GEMINI_MODEL || "gemini-2.5-flash";
      const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          // Key in a HEADER, not the query string: as a query param it rides in
          // the request URL, and outbound-HTTP span attributes carry the full
          // URL into Sentry once server tracing is on — where "url" is not a
          // scrubbed key and the scrubber never walks event.spans.
          "x-goog-api-key": process.env.GEMINI_API_KEY as string,
        },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            // Gemini 2.5 Flash "thinks" by default, and that thinking consumes the
            // output-token budget — at low limits it can return ZERO visible text,
            // which would silently fall back to a generic template. Disable thinking
            // so the whole budget produces the actual message.
            thinkingConfig: { thinkingBudget: 0 },
            maxOutputTokens: maxTokens,
            temperature: 0.9,
            ...(opts?.json ? { responseMimeType: "application/json" } : {}),
          },
        }),
      });
      const d = await r.json();
      if (r.ok) {
        const text = (d.candidates?.[0]?.content?.parts ?? []).map((p: { text?: string }) => p?.text ?? "").join("").trim();
        return text || null;
      }
    } catch { /* fall through */ }
    return null;
  }

  // ── Anthropic (back-compat; only if a key is still set) ──
  if (process.env.ANTHROPIC_API_KEY) {
    try {
      const r = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "x-api-key": process.env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
        body: JSON.stringify({
          model: process.env.ANTHROPIC_MODEL || "claude-haiku-4-5-20251001",
          max_tokens: maxTokens,
          messages: [{ role: "user", content: prompt }],
        }),
      });
      const d = await r.json();
      if (r.ok && Array.isArray(d.content)) return (d.content[0]?.text ?? "").trim() || null;
    } catch { /* fall through */ }
    return null;
  }

  return null;
}

// Vision completion (e.g. business-card OCR). Same provider preference.
export async function aiVision(opts: { imageBase64: string; mediaType: string; prompt: string; maxTokens?: number; json?: boolean }): Promise<string | null> {
  const out = await aiVisionOnce(opts);
  if (out === null && hasAiProvider()) await reportAiFailure("vision");
  return out;
}

async function aiVisionOnce(opts: { imageBase64: string; mediaType: string; prompt: string; maxTokens?: number; json?: boolean }): Promise<string | null> {
  const maxTokens = opts.maxTokens ?? 500;

  if (process.env.OPENAI_API_KEY) {
    try {
      const r = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: process.env.OPENAI_MODEL || "gpt-4o-mini",
          max_tokens: maxTokens,
          messages: [{ role: "user", content: [
            { type: "text", text: opts.prompt },
            { type: "image_url", image_url: { url: `data:${opts.mediaType};base64,${opts.imageBase64}` } },
          ] }],
          ...(opts.json ? { response_format: { type: "json_object" } } : {}),
        }),
      });
      const d = await r.json();
      if (r.ok) return (d.choices?.[0]?.message?.content ?? "").trim() || null;
    } catch { /* fall through */ }
    return null;
  }

  if (process.env.GEMINI_API_KEY) {
    try {
      const model = process.env.GEMINI_MODEL || "gemini-2.5-flash";
      const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          // Key in a HEADER, not the query string: as a query param it rides in
          // the request URL, and outbound-HTTP span attributes carry the full
          // URL into Sentry once server tracing is on — where "url" is not a
          // scrubbed key and the scrubber never walks event.spans.
          "x-goog-api-key": process.env.GEMINI_API_KEY as string,
        },
        body: JSON.stringify({
          contents: [{ parts: [
            { text: opts.prompt },
            { inline_data: { mime_type: opts.mediaType, data: opts.imageBase64 } },
          ] }],
          generationConfig: {
            thinkingConfig: { thinkingBudget: 0 },
            maxOutputTokens: maxTokens,
            ...(opts.json ? { responseMimeType: "application/json" } : {}),
          },
        }),
      });
      const d = await r.json();
      if (r.ok) {
        const text = (d.candidates?.[0]?.content?.parts ?? []).map((p: { text?: string }) => p?.text ?? "").join("").trim();
        return text || null;
      }
    } catch { /* fall through */ }
    return null;
  }

  if (process.env.ANTHROPIC_API_KEY) {
    try {
      const r = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "x-api-key": process.env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
        body: JSON.stringify({
          model: process.env.ANTHROPIC_MODEL || "claude-haiku-4-5-20251001",
          max_tokens: maxTokens,
          messages: [{ role: "user", content: [
            { type: "image", source: { type: "base64", media_type: opts.mediaType, data: opts.imageBase64 } },
            { type: "text", text: opts.prompt },
          ] }],
        }),
      });
      const d = await r.json();
      if (r.ok && Array.isArray(d.content)) return (d.content[0]?.text ?? "").trim() || null;
    } catch { /* fall through */ }
    return null;
  }

  return null;
}

// ── Image EDITING (design transfer) ─────────────────────────────────────────
//
// Gemini only — unlike aiComplete/aiVision there is no provider waterfall,
// because the feature this exists for (rebuild an uploaded card design with
// the owner's own details on it) needs an image-to-image editing model, and
// Gemini's image model is the only one an existing key here can reach.
// Callers must treat null as "feature unavailable", exactly like hasAiProvider.
export function hasImageEditProvider(): boolean {
  return !!process.env.GEMINI_API_KEY;
}

/**
 * Edit `image` per `prompt`, optionally passing extra reference images (the
 * owner's headshot/logo for the model to place). Returns raw PNG/JPEG bytes,
 * or null on any failure — same never-throw contract as the other helpers.
 */
export async function aiImageEdit(opts: {
  imageBase64: string;
  mediaType: string;
  prompt: string;
  /** Additional reference images, e.g. the owner's headshot and logo. */
  references?: { imageBase64: string; mediaType: string }[];
}): Promise<{ data: Buffer; mediaType: string } | null> {
  if (!process.env.GEMINI_API_KEY) return null;
  try {
    const model = process.env.GEMINI_IMAGE_MODEL || "gemini-2.5-flash-image";
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        // Header, not query string — see the note in aiComplete.
        "x-goog-api-key": process.env.GEMINI_API_KEY as string,
      },
      body: JSON.stringify({
        contents: [{ parts: [
          { text: opts.prompt },
          { inline_data: { mime_type: opts.mediaType, data: opts.imageBase64 } },
          ...(opts.references ?? []).map((ref) => ({
            inline_data: { mime_type: ref.mediaType, data: ref.imageBase64 },
          })),
        ] }],
        generationConfig: {
          // REQUIRED for the image model: without declaring IMAGE, the call
          // can 400 or come back text-only — which is exactly what "couldn't
          // rebuild that design, every time" looked like in production.
          // TEXT rides along because the model interleaves commentary.
          responseModalities: ["TEXT", "IMAGE"],
          // A business card is 1.75:1; 16:9 (1.78) is the closest ratio the
          // model offers, and asking for it beats cover-cropping a square.
          imageConfig: { aspectRatio: "16:9" },
        },
      }),
    });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) {
      // The response body is safe to log (the key rides in a request header),
      // and without this line every failure mode collapses into one silent
      // null — undebuggable from the outside, as proven the first time.
      console.error(`[aiImageEdit] ${model} → ${r.status}:`, JSON.stringify(d).slice(0, 500));
      return null;
    }
    const part = (d.candidates?.[0]?.content?.parts ?? []).find(
      (p: { inlineData?: { data?: string; mimeType?: string } }) => p?.inlineData?.data,
    );
    if (!part) {
      console.error(
        "[aiImageEdit] no image in response:",
        JSON.stringify({
          finishReason: d.candidates?.[0]?.finishReason,
          parts: (d.candidates?.[0]?.content?.parts ?? []).map((p: { text?: string }) =>
            p?.text ? `text:${p.text.slice(0, 120)}` : "other"),
          promptFeedback: d.promptFeedback,
        }).slice(0, 500),
      );
      return null;
    }
    return {
      data: Buffer.from(part.inlineData.data as string, "base64"),
      mediaType: (part.inlineData.mimeType as string) || "image/png",
    };
  } catch (e) {
    console.error("[aiImageEdit] request failed:", e);
    return null;
  }
}
