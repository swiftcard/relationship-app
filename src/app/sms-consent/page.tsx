import type { Metadata } from "next";
import Link from "next/link";
import SiteNav from "@/components/site/SiteNav";
import SiteFooterMini from "@/components/site/SiteFooterMini";
import HomeHeadingReveal from "@/components/site/HomeHeadingReveal";
import "@/app/home.css";

export const metadata: Metadata = {
  title: "SMS Consent Overview | SwiftCard",
  description:
    "How people opt in to receive text messages on SwiftCard: where the consent disclosure appears, the exact wording shown, and how opt-out works.",
};

const LAST_UPDATED = "August 12, 2026";

function H2({ children }: { children: React.ReactNode }) {
  return <h2 className="text-[1.25rem] font-bold tracking-[-0.01em] text-slate-900 mt-12 mb-3">{children}</h2>;
}
function P({ children }: { children: React.ReactNode }) {
  return <p className="text-slate-600 text-[0.96875rem] leading-[1.75] mb-4">{children}</p>;
}
function LI({ children }: { children: React.ReactNode }) {
  return <li className="text-slate-600 text-[0.96875rem] leading-[1.75] mb-2 ml-5 list-disc marker:text-slate-400">{children}</li>;
}

export default function SmsConsentPage() {
  return (
    // bg-cream stays only for the native shell's status-bar canvas rule in
    // globals.css (html.native-app:has(main.bg-cream)); .hp paints the page
    // itself white (owner, 2026-09-17: light pages, no cream).
    <main className="hp sc-canvas-white min-h-screen bg-cream flex flex-col">
      <SiteNav />
      <HomeHeadingReveal />

      <section className="hp-page-hero border-b border-slate-200/70">
        <div className="relative max-w-3xl mx-auto px-5 sm:px-6 pt-28 sm:pt-36 pb-10 sm:pb-12 w-full" data-hp-head>
          <h1 className="rd-display text-[clamp(2.1rem,4.4vw,3rem)] text-slate-900 [text-wrap:balance]">SMS Consent Overview</h1>
          <p className="text-slate-500 text-[0.9375rem] mt-3">Last updated: {LAST_UPDATED}</p>
        </div>
      </section>

      <div className="max-w-3xl mx-auto px-5 sm:px-6 pt-10 pb-20 w-full">

        <P>
          This page shows exactly how SwiftCard collects consent to send text messages. SwiftCard is a
          digital business card platform operated by <strong>Swift Card Inc.</strong> (see our{" "}
          <Link href="/company" className="text-brand underline">Company page</Link>). The full program terms
          are in our <Link href="/sms-terms" className="text-brand underline">SMS &amp; Messaging Terms</Link>{" "}
          and <Link href="/privacy" className="text-brand underline">Privacy Policy</Link>.
        </P>

        <H2>Who sends the messages, and who they go to</H2>
        <P>
          Every SwiftCard user has a public card page (for example,
          swiftcard.me/their-name). People they meet share their contact details with them: in person,
          at an event, or through the &quot;Share your info&quot; form on that card page. Sharing contact
          details is not a subscription to text messages, and SwiftCard does not treat it as one: a
          contact captured that way is never sent an automated text.
        </P>

        <H2>How consent is obtained</H2>
        <P>
          Consent is given to the SwiftCard user, by the person they met, in the conversation where
          they exchanged details. It is the same permission any professional asks for before texting
          someone. SwiftCard does not text anyone on its own behalf and never markets to these contacts.
        </P>
        <ul className="mb-3">
          <LI>
            A SwiftCard user opens a contact in their Contacts list and sets up a text follow-up for
            that one person.
          </LI>
          <LI>
            Before it can be switched on, the screen states:{" "}
            <em>&quot;Only switch this on if [contact] agreed you could text them. They can reply STOP at
            any time, which stops texts from SwiftCard for good.&quot;</em>{" "}
            Switching it on is the user confirming they have that person&apos;s permission.
          </LI>
          <LI>
            Only that confirmation allows a text. It is recorded server-side as an{" "}
            <strong>sms-ok</strong> flag that can only be set from the user&apos;s own signed-in account.
            No public page, and nothing a visitor&apos;s browser sends, can set it.
          </LI>
          <LI>
            Contacts without that flag (everyone captured by the share form, the business-card scanner,
            manual entry or an import) are <strong>never</strong> sent an automated text. The user can
            still reply by email.
          </LI>
          <LI>
            The user can switch text follow-ups off for any contact at any time, and the contact&apos;s own
            STOP always overrides everything.
          </LI>
        </ul>

        <H2>What the messages are</H2>
        <P>
          Texts are one-to-one follow-ups about the conversation the two people already had: the
          user&apos;s contact details, their replies, and any follow-up messages that user set up for that
          contact. Message frequency varies. Msg &amp; data rates may apply. Reply STOP to opt out, HELP
          for help. There is no marketing, no promotional blasting and no third-party content, and
          mobile numbers or consent are never sold or shared for anyone else&apos;s marketing.
        </P>

        <H2>See it for yourself</H2>
        <P>
          The share form, which collects contact details and nothing else, is on a public page, with no
          login and no demo environment:
        </P>

        <div className="rounded-2xl border border-slate-200/80 bg-[#F5F7FB] p-5 sm:p-6 my-6">
          <a
            href="https://swiftcard.me/swift-card-swift-card-inc"
            target="_blank"
            rel="noopener"
            className="text-brand underline font-semibold text-[0.9375rem] break-all"
          >
            swiftcard.me/swift-card-swift-card-inc
          </a>
          <p className="text-slate-600 text-[0.9375rem] leading-relaxed mt-3">
            Scroll to <strong>&quot;Share your info&quot;</strong>. It asks for a name, phone and email so
            those details reach the card&apos;s owner. It does not sign anyone up for text messages, and
            nothing submitted there can start one.
          </p>
        </div>

        <H2>The number messages come from</H2>
        <P>
          Every SwiftCard text (replies, card links, and follow-ups alike) is sent from one shared
          number: <strong>(917) 905-7335</strong>. The SwiftCard user who is writing to you is named in the
          message itself.
        </P>

        <H2>Opting out</H2>
        <P>
          Replying <strong>STOP</strong> to any SwiftCard text suppresses that number across the entire
          platform, so no SwiftCard user can text it through SwiftCard afterwards. Replying{" "}
          <strong>HELP</strong> returns program information and support contact details. Questions:{" "}
          <a href="mailto:hello@swiftcard.me" className="text-brand underline">hello@swiftcard.me</a>.
        </P>
      </div>

      {/* SMS Terms stays in this page's footer specifically — the consent
          overview exists to point at it, and A2P vetting follows that link. */}
      <SiteFooterMini extra={[{ label: "SMS Terms", href: "/sms-terms" }]} />
    </main>
  );
}
