"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import type { ComponentProps } from "react";

// ── A link to the homepage that prefetches on intent, not on sight ──────────
//
// The homepage is static, so a default <Link href="/"> prefetches the WHOLE
// route — its full RSC payload, ~170 KB — the moment the link is on screen.
// The logo sits in the nav of every marketing page, so every visit to /pricing,
// /login, /blog or /compare (and to "/" itself) downloaded the homepage a
// second time in the background, on a phone, competing with the page the
// person actually asked for (perf audit 2026-10-06).
//
// Prefetching on hover / touchstart / focus keeps the click instant for anyone
// who is actually heading home — a touch begins ~100 ms before the tap lands,
// and a mouse hovers for longer — without charging everyone else for it.
export default function HomeLink({ onPointerEnter, onTouchStart, onFocus, ...props }: Omit<ComponentProps<typeof Link>, "href" | "prefetch">) {
  const router = useRouter();
  const warm = () => {
    if (window.location.pathname !== "/") router.prefetch("/");
  };
  return (
    <Link
      {...props}
      href="/"
      prefetch={false}
      onPointerEnter={(e) => { warm(); onPointerEnter?.(e); }}
      onTouchStart={(e) => { warm(); onTouchStart?.(e); }}
      onFocus={(e) => { warm(); onFocus?.(e); }}
    />
  );
}
