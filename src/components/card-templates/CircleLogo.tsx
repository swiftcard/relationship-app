"use client";

import { useCallback, useState } from "react";
import { circleLogoPadding } from "./shared";

// The logo on its round plate — the "Circle" choice under Logo shape.
//
// logoCircleStyle pads every mark as if it were square, which is right until
// the mark's shape is known and leaves a wide wordmark a sliver in the middle
// of the plate (owner, 2026-10-15: a wide or banner logo in a circle must fit,
// not too small). So once the image has loaded, its own proportions pick the
// padding (circleLogoPadding): the mark is as large as the circle allows,
// corners on the same radius a square mark's sit on.
//
// Until then — the server's HTML, and a browser that has not run the page's
// script yet — it is exactly the square-safe plate it always was. The image
// can finish loading before React attaches, when onLoad never fires for it,
// so the ref reads an already-complete image too.

export default function CircleLogo({ src, style, className, diameter, border = 1 }: {
  src: string;
  /** logoCircleStyle(…) — its height is the plate's diameter. */
  style: React.CSSProperties;
  className?: string;
  /** The plate's diameter when the image sits INSIDE the plate rather than
   *  being it (Logo First's tile); defaults to style.height. */
  diameter?: number;
  /** The image's own border width (logoCircleStyle draws a 1px ring). */
  border?: number;
}) {
  const [aspect, setAspect] = useState<number | null>(null);
  const read = useCallback((img: HTMLImageElement | null) => {
    if (img && img.complete && img.naturalWidth > 0 && img.naturalHeight > 0) {
      setAspect(img.naturalWidth / img.naturalHeight);
    }
  }, []);
  const d = diameter ?? (typeof style.height === "number" ? style.height : null);
  const fitted = d && aspect ? { ...style, padding: circleLogoPadding(d, aspect, border) } : style;
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img ref={read} onLoad={(e) => read(e.currentTarget)} src={src} alt="logo" className={className} style={fitted} />
  );
}
