# Instagram launch posts (sources)

The first SwiftCard posts: the "One card / One tap / One link" trio and the
light pinned redo (`src/pinned-v2.html`). `captions.md` has the final captions,
bio, pin order and rules. The social media manager agent learns its style from
these (see `src/lib/crew/marketing/social-style.ts`) and draws new posts in the
same visual system with `scripts/crew-render-social.mjs`.

Committed: the HTML, captions, render/capture scripts, the logo and the three
Daniel Whitfield product captures the social renderer uses (`src/assets/dw-*.png`).
Not committed: the rendered PNG outputs and the other captures (regenerate them
with the capture scripts). `capture-persona.ts` and `wallet-pass-maya.tsx` stay
local because they import app components outside the build.
