import { APP_STORE_URL, APP_STORE_WRITE_REVIEW_URL } from "@/lib/app-store";
import RateUsLink from "@/components/RateUsLink";
import {
  fetchAppStoreReviews,
  fetchAppStoreRating,
  MIN_DISPLAY_RATING,
} from "@/lib/app-store-reviews";

// Displays REAL App Store reviews (Apple's public RSS feed), filtered to
// MIN_DISPLAY_RATING and up — owner, 2026-09-22: "I only want the Apple reviews
// that are 4.5 stars or higher to show up", plus "a place for users to just
// leave a review too". Renders NOTHING when there are no reviews to show, so
// it stays invisible until the app has some, and never shows an invented
// rating/count. Async server component: both fetches are cached (1h) in the lib.
//
// The score beside the heading is APPLE'S OWN lifetime average and rating
// count, not the average of the cards below — averaging a set we filtered to
// the top would print 5.0 whatever the app's real score was. Featuring a
// selection is fine; misstating the score is what FTC 16 CFR Part 465 forbids,
// so the selection is disclosed in one line under the grid.

function Stars({ rating }: { rating: number }) {
  return (
    <span className="inline-flex items-center gap-0.5" aria-label={`${rating} out of 5 stars`}>
      {[1, 2, 3, 4, 5].map((n) => (
        <svg key={n} viewBox="0 0 24 24" className="w-3.5 h-3.5" fill={n <= rating ? "#f59e0b" : "none"} stroke={n <= rating ? "#f59e0b" : "#94a3b8"} strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M11.48 3.5l2.36 4.78 5.28.77-3.82 3.72.9 5.26L11.48 15.5 6.76 18l.9-5.26L3.84 9.05l5.28-.77 2.36-4.78z" />
        </svg>
      ))}
    </span>
  );
}

export default async function AppStoreReviews() {
  // Two independent public endpoints — no reason to wait for one before the
  // other, and a failure in either must not take the section down.
  const [reviews, rating] = await Promise.all([
    fetchAppStoreReviews(12),
    fetchAppStoreRating(),
  ]);
  if (!reviews.length) return null; // pre-launch / nothing at the threshold → render nothing

  return (
    // Light like the rest of the marketing site, with the site's kicker and the
    // gradient that fills as the heading drops in (redesign 2026-09-17).
    <section className="relative py-24" style={{ background: "#fff" }}>
      <div className="max-w-6xl mx-auto px-5 sm:px-6">
        <div className="max-w-2xl mx-auto text-center mb-12" data-hp-head>
          <span className="hp-kicker">From the App Store</span>
          <h2 className="rd-h2 text-slate-900 text-[clamp(1.9rem,4vw,3rem)] mt-4">
            What people say on the <span className="hp-fill">App Store</span>
          </h2>
          {rating && (
            <p className="text-slate-500 text-[1.05rem] mt-4 flex items-center justify-center gap-2 flex-wrap">
              <Stars rating={Math.round(rating.average)} />
              <span>
                <span className="font-bold text-slate-900">{rating.average.toFixed(1)}</span>
                {" on the App Store, across "}
                {rating.count === 1 ? "1 rating" : `${rating.count} ratings`}.
              </span>
            </p>
          )}
        </div>

        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-5">
          {reviews.map((r, i) => (
            <div key={r.id} className="hp-card !p-6 flex flex-col" data-reveal style={{ transitionDelay: `${(i % 3) * 70}ms` }}>
              <Stars rating={r.rating} />
              {r.title && <p className="text-slate-900 font-semibold text-[0.9375rem] mt-3">{r.title}</p>}
              <p className="text-slate-600 text-[0.875rem] leading-relaxed mt-2 flex-1 whitespace-pre-line line-clamp-6">{r.body}</p>
              <p className="text-slate-500 text-[0.78125rem] mt-4 font-medium">— {r.author}</p>
            </div>
          ))}
        </div>

        {/* The disclosure. Small and quiet, but present: the cards above are a
            selection, and this says so in the same breath as where the score
            came from. Without it, a filtered wall of five stars next to a
            number reads as "this is everything", which is the misrepresentation
            the rule is about. */}
        <p className="text-slate-400 text-[0.78125rem] text-center mt-8 max-w-xl mx-auto leading-relaxed">
          Reviews written on the App Store, shown here when they&apos;re rated {MIN_DISPLAY_RATING} stars or
          higher{rating ? ". The score above is Apple's own, across every rating the app has received" : ""}.
        </p>

        {/* Leave a review. RateUsLink is the one web "rate us" control (owner,
            2026-09-22: the reviews page is another place people can review):
            straight to Apple's review form on iPhone/iPad/Mac, the listing's
            web page elsewhere with a "Best on iPhone" tip, and every tap
            counted as cta rate_us / reviews_page. See lib/rate-us.ts. */}
        {APP_STORE_WRITE_REVIEW_URL && (
          // sc-apple-only: the panel is "write a review on the App Store", so
          // an Android browser gets none of it (globals.css, data-sc-os); the
          // reviews above stay — they are just what people said.
          <div className="sc-apple-only hp-card !p-8 mt-10 max-w-2xl mx-auto text-center" data-reveal>
            <p className="text-slate-900 font-semibold text-[1.0625rem]">Used SwiftCard? Leave a review.</p>
            <p className="text-slate-500 text-[0.90625rem] leading-relaxed mt-2">
              It takes a few seconds, it posts under your App Store name, and it&apos;s the one thing that
              helps other people find us.
            </p>
            <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
              <RateUsLink placement="reviews_page" className="rd-btn rd-btn-primary">
                Write a review
              </RateUsLink>
              {APP_STORE_URL && (
                <a
                  href={APP_STORE_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="rd-btn border border-slate-200 text-slate-700"
                >
                  Read more on the App Store →
                </a>
              )}
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
