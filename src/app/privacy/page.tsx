import type { Metadata } from "next";
import Eyebrow from "@/components/site/Eyebrow";
import SiteNav from "@/components/site/SiteNav";
import Link from "next/link";
import SiteFooterMini from "@/components/site/SiteFooterMini";
import HomeHeadingReveal from "@/components/site/HomeHeadingReveal";
import "@/app/home.css";

export const metadata: Metadata = {
  title: "Privacy Policy — SwiftCard",
  description: "How SwiftCard collects, uses, and protects your information.",
};

// Plain-language privacy policy reflecting what the product actually does.
// Keep this accurate: every processor listed here must actually be in use, and
// every data practice (analytics, fraud-prevention signals, retention) must
// match the code. Update LAST_UPDATED whenever the policy meaningfully changes
// (CalOPPA requires an effective date).

const LAST_UPDATED = "September 18, 2026";

function H2({ children }: { children: React.ReactNode }) {
  return <h2 className="text-[1.25rem] font-bold tracking-[-0.01em] text-slate-900 mt-12 mb-3">{children}</h2>;
}
function H3({ children }: { children: React.ReactNode }) {
  return <h3 className="text-[1rem] font-semibold text-slate-900 mt-7 mb-2">{children}</h3>;
}
function P({ children }: { children: React.ReactNode }) {
  return <p className="text-slate-600 text-[0.96875rem] leading-[1.75] mb-4">{children}</p>;
}
function LI({ children }: { children: React.ReactNode }) {
  return <li className="text-slate-600 text-[0.96875rem] leading-[1.75] mb-2 ml-5 list-disc marker:text-slate-400">{children}</li>;
}

export default function PrivacyPage() {
  return (
    // bg-cream stays only for the native shell's status-bar canvas rule in
    // globals.css (html.native-app:has(main.bg-cream)); .hp paints the page
    // itself white (owner, 2026-09-17: light pages, no cream).
    <main className="hp sc-canvas-white min-h-screen bg-cream flex flex-col">
      <SiteNav />
      <HomeHeadingReveal />

      <section className="hp-page-hero border-b border-slate-200/70">
        <div className="relative max-w-3xl mx-auto px-5 sm:px-6 pt-28 sm:pt-36 pb-10 sm:pb-12 w-full" data-hp-head>
          <h1 className="rd-display text-[clamp(2.1rem,4.4vw,3rem)] text-slate-900 [text-wrap:balance]">Privacy Policy</h1>
          <p className="text-slate-500 text-[0.9375rem] mt-3">Last updated: {LAST_UPDATED}</p>
        </div>
      </section>

      <div className="max-w-3xl mx-auto px-5 sm:px-6 pt-10 pb-20 w-full">

        <P>
          SwiftCard (&quot;SwiftCard&quot;, &quot;we&quot;, &quot;us&quot;), a brand operated by Swift Card Inc,
          provides digital business cards, link-in-bio pages, and contact-management tools at swiftcard.me and in our
          mobile app (together, the &quot;Service&quot;). This policy explains what information we collect, how we use
          it, and the choices and rights you have. We keep it in plain English on purpose. For personal information of
          account holders, SwiftCard is the data controller; for the contacts you collect through your card, you are
          the controller and we process that data on your instructions. Mobile numbers and SMS consent are the one
          exception: because Swift Card Inc is the sender of every automated text we send, we are the controller of
          that number and that consent record, and we never hand either to the account holder or to anyone else for
          their own messaging.
        </P>

        {/* At-a-glance summary — the four promises people actually care about */}
        <div className="rounded-2xl border border-slate-200/80 bg-[#F5F7FB] p-5 sm:p-6 my-6">
          <div className="mb-3"><Eyebrow dark={false}>Privacy at a glance</Eyebrow></div>
          <ul className="space-y-2">
            {[
              "We never sell your personal information — or your contacts' — to anyone.",
              "No third-party advertising trackers, and no cross-app \"tracking\" as Apple defines it.",
              "Your card shows only what you choose to make public. Everything else stays private.",
              "You can export or permanently delete your data anytime from Settings.",
            ].map((t) => (
              <li key={t} className="flex items-start gap-2.5 text-slate-700 text-[0.875rem] leading-relaxed">
                <span className="mt-[3px] w-[18px] h-[18px] rounded-full flex items-center justify-center shrink-0 text-white" style={{ background: "var(--rd-aurora)" }}>
                  <svg viewBox="0 0 20 20" className="w-2.5 h-2.5" fill="none" stroke="#ffffff" strokeWidth={3}><path d="M4 10.5l4 4 8-9" strokeLinecap="round" strokeLinejoin="round" /></svg>
                </span>
                {t}
              </li>
            ))}
          </ul>
        </div>

        <H2>Information you give us</H2>
        <ul className="mb-3">
          <LI><strong>Account details</strong> — your name and email address when you sign up (or the profile shared by Google if you sign in with Google).</LI>
          <LI><strong>Card content</strong> — everything you choose to put on your card or Swift Links page: name, title, company, phone numbers, email, website, address, photo, logo, bio, and social links. This content is public by design — anyone with your card link can see it.</LI>
          <LI><strong>Contacts you collect</strong> — when someone fills out the &quot;share your info&quot; form on your card, their name, phone, email, company, and message are stored in your account&apos;s contact list.</LI>
          <LI><strong>Payment details</strong> — handled entirely by Stripe. We never see or store your card number.</LI>
          <LI><strong>Business-card photos</strong> — if you use the AI card scanner, the photo you take is sent to Google (our AI provider) to extract the contact details, then used only to create the contact. Because the card belongs to someone else, that photo can contain their personal details; we ask your permission before the first time anything is sent, and you can decline.</LI>
          <LI><strong>Messages to us</strong> — anything you send through the contact form, feedback, or support.</LI>
        </ul>

        <H2>Information collected automatically</H2>
        <ul className="mb-3">
          <LI><strong>View analytics</strong> — when someone opens a card or Swift Links page, we record the view with an approximate location (city/country derived from IP address by our hosting provider), the source (QR code, link, etc.), and basic device info. We do not store visitors&apos; IP addresses with these views.</LI>
          <LI><strong>A visitor cookie</strong> — opening a card or Swift Links page sets a first-party cookie (used only by SwiftCard, lasting up to two years) so that one visit is counted once. On its own it identifies no one.</LI>
          <LI><strong>Return visits by people who shared their details</strong> — if you share your details through someone&apos;s card, or open a personal link a SwiftCard user sent you, we connect that browser&apos;s visitor cookie to the details you gave that person. When you open their card again, they can see that it was you, when, how often, and which of their links you tapped, and they may get a notification about it. We only connect a visit to you for the card owner you shared your details with or who sent you the link, never for anyone else. People who have never shared their details stay anonymous. (One exception you control: if you are signed in to your own SwiftCard account when you open someone&apos;s card, they see the name on your card.)</LI>
          <LI><strong>Product analytics</strong> — we record which parts of the app get used (for example: a card was started, a plan was chosen, an upgrade button was clicked) so we can improve it. These records are kept in our own systems, are not tied to your name or email, and are deleted after 90 days. We may also use PostHog for the same purpose. Product improvement only, never third-party advertising.</LI>
          <LI><strong>Fraud-prevention signals</strong> — when you create an account we record your IP address and a coarse, non-unique device signature (derived from your browser type and language). If you subscribe, our payment processor (Stripe) also gives us a non-reversible fingerprint of your payment card — a one-way hash, never your card number. We use these solely to detect abuse of our referral program and free offers (for example, one person inviting themselves, or starting a second free trial from another account) and to rate-limit abuse. We do not use them for advertising.</LI>
          <LI><strong>Usage basics</strong> — standard server logs and cookies needed to keep you signed in, keep the service secure, and count card visits accurately (the first-party visitor cookie described above). We don&apos;t run third-party advertising trackers, and we do not use your data for cross-context behavioral advertising.</LI>
        </ul>

        <H2>App privacy — what our app collects (Apple disclosure)</H2>
        <P>
          Apple requires apps to disclose the categories of data they collect. Whether you use SwiftCard in the
          browser or in our iOS app, the data practices are identical, and here they are in Apple&apos;s categories.
          None of this data is used for &quot;tracking&quot; as Apple defines it — we do not link your data with
          third-party data for advertising, and we do not share it with data brokers.
        </P>
        <div className="overflow-x-auto rounded-2xl border border-slate-200/80 bg-[#F5F7FB] my-4">
          <table className="w-full text-[0.84375rem]" style={{ minWidth: 560 }}>
            <thead>
              <tr className="text-left text-slate-500 text-[0.6875rem] uppercase tracking-wide border-b border-slate-200">
                <th className="px-4 py-3 font-semibold">Category</th>
                <th className="px-4 py-3 font-semibold">What it includes</th>
                <th className="px-4 py-3 font-semibold">Linked to you?</th>
                <th className="px-4 py-3 font-semibold">Used to track you?</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-slate-700">
              {[
                ["Contact info", "Name, email, phone number you add to your account or card", "Yes", "No"],
                ["User content", "Card content, photos & logo, bio, the contacts you collect and their return visits to your card, messages to support", "Yes", "No"],
                ["Identifiers", "Your account ID", "Yes", "No"],
                ["Purchases", "Subscription/purchase history (payments handled by Stripe)", "Yes", "No"],
                ["Usage data", "Pages visited and features used (product analytics)", "Yes", "No"],
                ["Diagnostics", "Standard server logs used for security and reliability", "Yes", "No"],
                ["Coarse location", "City/country of card views, derived from IP (visitor IPs not stored with views)", "No", "No"],
              ].map(([cat, what, linked, track]) => (
                <tr key={cat}>
                  <td className="px-4 py-2.5 font-semibold text-slate-900 whitespace-nowrap">{cat}</td>
                  <td className="px-4 py-2.5">{what}</td>
                  <td className="px-4 py-2.5">{linked}</td>
                  <td className="px-4 py-2.5">{track}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <H2>How we use information</H2>
        <ul className="mb-3">
          <LI>To run the product: host your card, deliver your Swift Links page, store your contacts, and show you your analytics.</LI>
          <LI>To send messages you set up: follow-up emails (and, where enabled, texts) to your contacts, sent on your behalf with your name.</LI>
          <LI>To notify you: new-contact alerts, and alerts when a contact you already have comes back to your card, by in-app notification and by push notification if you turn push on.</LI>
          <LI>To bill you (Stripe) and to send service emails like receipts. Marketing emails are optional — every one includes an unsubscribe link.</LI>
          <LI>To keep the Service secure, prevent fraud and abuse, and comply with law.</LI>
          <LI>We <strong>never sell your personal information</strong>, we don&apos;t &quot;share&quot; it for cross-context behavioral advertising (as those terms are defined in the California Consumer Privacy Act), and we never sell your contacts&apos; data. Your contact list is yours.</LI>
        </ul>
        <P>
          Where the GDPR or UK GDPR applies, our legal bases are: <strong>performance of a contract</strong> (running
          the Service you signed up for), <strong>legitimate interests</strong> (security, fraud prevention, product
          analytics, and improving the Service), <strong>consent</strong> (optional marketing and push notifications —
          withdrawable anytime), and <strong>legal obligation</strong> (tax and accounting records).
        </P>

        <H2>Who we share it with</H2>
        <P>
          Only the service providers needed to run SwiftCard, under contracts limiting them to processing on our
          instructions. Each is required to protect your data to at least the same standard this policy describes:
        </P>
        <ul className="mb-3">
          <LI><strong>Supabase</strong> — database, file storage, and authentication.</LI>
          <LI><strong>Vercel</strong> — hosting and content delivery.</LI>
          <LI><strong>Stripe</strong> — payments and subscriptions.</LI>
          <LI><strong>Resend</strong> — sending email.</LI>
          <LI><strong>Twilio</strong> — sending text messages (where SMS features are enabled).</LI>
          <LI><strong>PostHog</strong> — product analytics.</LI>
          <LI><strong>Upstash</strong> — rate limiting (helps stop abuse of our forms and APIs).</LI>
          <LI>
            <strong>Google</strong> (the Gemini API) — our AI provider. Data reaches Google only when you use a feature that needs it,
            and only the data that feature needs: the photograph you take when you scan a business card; a contact&apos;s name, company,
            where you met and your notes, together with your own name, title, company and About text, when AI drafts a follow-up for
            them; the design photo you upload to rebuild a card, including your photo, logo and contact details shown on it; and the
            messages you type to the in-app assistant. Google processes it to return the result and we do not send it anywhere else.
            We ask for your permission in the app before any of this is sent, and you can decline — the rest of SwiftCard keeps working
            and AI features stay off. We use the Gemini API under{" "}
            <a href="https://ai.google.dev/gemini-api/terms" className="underline" target="_blank" rel="noopener noreferrer">
              Google&apos;s API terms
            </a>
            , which bind Google to protect this data to a standard at least equal to this policy: Google processes it to
            return the response, may not use it for advertising or sell it, and — because we use the paid API tier —
            does not use it to train its models.
          </LI>
        </ul>
        <P>
          If you connect an integration yourself — Salesforce, GoHighLevel, Pipedrive, HubSpot, Google Contacts or Zapier — we send new contacts to that
          service because you asked us to. Disconnect anytime in Settings → Integrations. SwiftCard&apos;s use of
          information received from Google APIs adheres to the Google API Services User Data Policy, including the
          Limited Use requirements.
        </P>
        <P>
          We may also disclose information if required by law or legal process, to protect the rights, safety, or
          property of SwiftCard or others, or as part of a merger, acquisition, or sale of assets (in which case this
          policy continues to apply and we&apos;ll notify you of any successor).
        </P>

        <H2>YouTube API Services</H2>
        <P>
          SwiftCard&apos;s own marketing tools use{" "}
          <a href="https://developers.google.com/youtube/terms/developer-policies" className="underline" target="_blank" rel="noopener noreferrer">
            YouTube API Services
          </a>{" "}
          for one purpose: to upload SwiftCard&apos;s videos to SwiftCard&apos;s own YouTube channel. Only our team uses
          this, with our own Google account; it never reads, stores or shows any other person&apos;s YouTube data.
          What we keep is the id and name of our connected channel and the sign-in tokens Google issues us, stored
          encrypted and deleted the moment the channel is disconnected. By using it we are bound by the{" "}
          <a href="https://www.youtube.com/t/terms" className="underline" target="_blank" rel="noopener noreferrer">
            YouTube Terms of Service
          </a>{" "}
          and the{" "}
          <a href="https://www.google.com/policies/privacy" className="underline" target="_blank" rel="noopener noreferrer">
            Google Privacy Policy
          </a>
          . Access granted to SwiftCard can be revoked at any time from the Google account&apos;s{" "}
          <a href="https://security.google.com/settings/security/permissions" className="underline" target="_blank" rel="noopener noreferrer">
            security settings
          </a>
          .
        </P>

        <H2>Text messaging (SMS) and mobile information</H2>
        <P>
          <strong>
            We do not share, sell, or otherwise provide your mobile phone number or messaging consent
            information to any third parties or affiliates for marketing or promotional purposes.
          </strong>{" "}
          Mobile numbers and SMS opt-in data are used only to deliver the messages described in our{" "}
          <Link href="/sms-terms" className="text-brand underline">SMS &amp; Messaging Terms</Link> — replies
          and follow-ups from the SwiftCard user you shared your information with.
        </P>
        <P>
          Necessary service providers (such as Twilio, our text-messaging provider) process mobile numbers
          solely to deliver those messages on our instructions — never for their own marketing. Consent to
          receive texts is collected on the share form via a checkbox next to the submit button, which
          states the types of messages you would receive and is never pre-ticked. Ticking it is the opt-in;
          it is optional, so you can share your contact information without it and we will not text you. It
          is never a condition of submitting the form, of creating an account, or of making a purchase.
        </P>
        <P>
          <strong>Message frequency varies</strong> — messages are sent by the individual SwiftCard user you
          shared your information with, so volume depends on that person and is typically only a few messages
          following your meeting. <strong>Message and data rates may apply.</strong> Reply <strong>STOP</strong>{" "}
          to any message to opt out across all of SwiftCard, or <strong>HELP</strong> for help. Messages are
          sent from <strong>(917) 905-7335</strong>.
        </P>

        <H2>International transfers</H2>
        <P>
          We are based in the United States and our providers process data primarily in the U.S. If you use SwiftCard
          from outside the U.S. (including the EEA, UK, or Switzerland), your information is transferred to the U.S.
          Where required, we rely on our processors&apos; safeguards for those transfers, such as Standard Contractual
          Clauses and Data Privacy Framework certifications.
        </P>

        <H2>Your privacy rights</H2>
        <P>
          Everyone can access, correct, export, or delete their information — most of it directly in the app
          (Settings → Manage account, and CSV export for contacts), or by contacting us via the{" "}
          <Link href="/contact" className="text-brand underline">contact page</Link>. We respond to verifiable requests
          within the time required by applicable law, and we never discriminate against you for exercising a privacy right.
        </P>
        <H3>If you&apos;re in California</H3>
        <P>
          The CCPA/CPRA gives you the right to know what personal information we collect and how it&apos;s used (this
          policy), to access it, correct it, delete it, and to opt out of &quot;sale&quot; or &quot;sharing&quot; of
          personal information. <strong>We do not sell or share personal information</strong> (including that of anyone
          under 16), and we do not use or disclose sensitive personal information for purposes requiring a right to
          limit. You may designate an authorized agent to make requests for you. Because we don&apos;t sell or share
          data, browser opt-out signals such as Global Privacy Control and &quot;Do Not Track&quot; don&apos;t change how
          we process your data; we treat all visitors by the standards in this policy.
        </P>
        <H3>If you&apos;re in the EEA, UK, or Switzerland</H3>
        <P>
          You have the rights of access, rectification, erasure, restriction, portability, and objection (including to
          processing based on legitimate interests), and the right to withdraw consent at any time without affecting
          prior processing. You can also lodge a complaint with your local supervisory authority, though we&apos;d
          appreciate the chance to resolve any concern directly first.
        </P>
        <H3>Contacts collected through cards</H3>
        <P>
          If your information was collected by a SwiftCard user (you filled out someone&apos;s card form), that user
          controls it — contact them directly, or contact us and we&apos;ll assist. You can opt out of their messages at
          any time: replying STOP to a text suppresses texts to your number across SwiftCard (reply HELP for help), and
          every automated email includes an unsubscribe link. See our{" "}
          <Link href="/sms-terms" className="text-brand underline">SMS &amp; Messaging Terms</Link> for the full
          messaging program.
        </P>
        <P>
          After you share your details, that SwiftCard user can see when you come back to their card and which of their
          links you tap (see &quot;Return visits&quot; above). Links they send you through SwiftCard carry a short code
          that does the same for the browser you open them in; if you forward the message, visits from other devices are
          shown to them as &quot;opened on another device&quot;, not under your name. This history is kept until they
          delete you as a contact or close their account. To stop it: unsubscribing from their emails also stops their
          links from recognising you, clearing your browser&apos;s cookies for swiftcard.me ends the connection on that
          browser, and you can ask the SwiftCard user, or us at{" "}
          <a href="mailto:hello@swiftcard.me" className="text-brand underline">hello@swiftcard.me</a>, to remove it.
        </P>

        <H2>Data retention &amp; deleting your account</H2>
        <P>
          We keep your data while your account is active. You can delete your account in Settings → Manage account —
          after deletion you have one month to reopen it by logging back in; after that the deletion is permanent and
          your data is removed from our production systems (residual copies in encrypted backups expire on their
          normal rotation). We retain billing records as required by tax law. You can export your contacts to CSV
          before deleting.
        </P>
        <P>
          One exception, so free offers stay one per person: if you ever started a Pro free trial or took free Pro
          days when deleting, we keep a one-way scrambled code made from your email address and, for a trial, the card
          it used. It can&apos;t be turned back into your email or card details and is linked to nothing else about
          you. It is used only to recognise that the same person has already had that free offer.
        </P>

        <H2>Security</H2>
        <P>
          Data is encrypted in transit (HTTPS everywhere) and at rest by our database provider. Integration tokens
          (like your Google connection) are stored encrypted. No system is 100% secure, but we design so that a
          visitor can only ever see what you chose to make public. If a breach affecting your personal information
          occurs, we&apos;ll notify you and regulators as required by law.
        </P>

        <H2>Children</H2>
        <P>
          SwiftCard is a professional networking tool. It is not directed to children, and{" "}
          <strong>you must be at least 16 years old to create an account</strong> (see our{" "}
          <Link href="/terms" className="text-brand underline">Terms of Service</Link>). We do not knowingly collect
          personal information from anyone under 16 — and never from children under 13, consistent with the
          U.S. Children&apos;s Online Privacy Protection Act (COPPA). If we learn that an account belongs to someone
          under 16, we will terminate it and delete the associated personal information. If you believe a child has
          provided us personal information, contact us via the{" "}
          <Link href="/contact" className="text-brand underline">contact page</Link>{" "}and we&apos;ll delete it promptly.
        </P>

        <H2>Changes</H2>
        <P>
          If we make meaningful changes to this policy we&apos;ll update the &quot;Last updated&quot; date above and,
          for significant changes, notify you by email or in the app before they take effect.
        </P>

        <H2>Contact us</H2>
        <P>
          Questions or requests (including data access, correction, or deletion): email{" "}
          <a href="mailto:hello@swiftcard.me" className="text-brand underline">hello@swiftcard.me</a> or reach us
          through the <Link href="/contact" className="text-brand underline">contact page</Link>.
          SwiftCard is operated by Swift Card Inc · New York, NY, USA.
        </P>
      </div>

      <SiteFooterMini />
    </main>
  );
}
