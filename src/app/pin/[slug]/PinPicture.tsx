"use client";

import { ALL_PERSONAS } from "@/components/site/HeroShowcase";
import { PIN_H, PIN_W, type PinIdea } from "@/lib/pinterest-pins";

// The picture itself. A client component because the personas (and the card
// templates they wear) live in the client-only HeroShowcase module; it still
// prerenders, so /pin/<slug> stays static.
export default function PinPicture({ idea }: { idea: PinIdea }) {
  const persona = ALL_PERSONAS.find((p) => p.key === idea.persona);
  if (!persona) return null;
  const { Template } = persona;
  // The card renders at its natural 460px and is scaled as one unit (same as
  // the homepage phone), so it looks exactly like the real thing.
  const scale = 1.7;

  return (
    <div style={{ width: PIN_W, height: PIN_H, overflow: "hidden", position: "relative", background: `linear-gradient(170deg, #FBF8F3 0%, #F3EDE4 55%, ${persona.accent}22 100%)`, fontFamily: "-apple-system, 'Segoe UI', Helvetica, Arial, sans-serif", color: "#1C1612" }}>
      <div style={{ position: "absolute", top: 84, left: 72, right: 72, textAlign: "center" }}>
        <p style={{ margin: 0, fontSize: 64, lineHeight: 1.08, fontWeight: 800, letterSpacing: -1.5 }}>{idea.headline}</p>
        <p style={{ margin: "22px 0 0", fontSize: 30, lineHeight: 1.3, color: "#5A524A" }}>{idea.sub}</p>
      </div>
      <div style={{ position: "absolute", top: 530, left: "50%", width: 460 * scale, marginLeft: -(460 * scale) / 2 }}>
        <div style={{ width: 460, transformOrigin: "top left", transform: `scale(${scale})`, filter: "drop-shadow(0 40px 60px rgba(28,22,18,0.18))" }}>
          <Template data={persona.data} />
        </div>
      </div>
      <div style={{ position: "absolute", bottom: 84, left: 72, right: 72, textAlign: "center" }}>
        <p style={{ margin: 0, fontSize: 28, color: "#5A524A" }}>Free digital business card · saved to their phone in one tap</p>
        <p style={{ margin: "14px 0 0", fontSize: 40, fontWeight: 800, color: persona.accent }}>swiftcard.me</p>
      </div>
    </div>
  );
}
