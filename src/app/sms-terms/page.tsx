import type { Metadata } from "next";
import Eyebrow from "@/components/site/Eyebrow";
import Link from "next/link";
import SiteNav from "@/components/site/SiteNav";
import SiteFooterMini from "@/components/site/SiteFooterMini";
import HomeHeadingReveal from "@/components/site/HomeHeadingReveal";
import "@/app/home.css";

export const metadata: Metadata = {
  title: "SMS & Messaging Terms | SwiftCard",
  description:
    "How text messaging works on SwiftCard: the messages we send, how consent is collected, message frequency, rates, and how to opt out with STOP or get help with HELP.",
};

const LAST_UPDATED = "July 27, 2026";

function H2({ children }: { children: React.ReactNode }) {
  return <h2 className="text-[1.25rem] font-bold tracking-[-0.01em] text-slate-900 mt-12 mb-3">{children}</h2>;
}
function P({ children }: { children: React.ReactNode }) {
  return <p className="text-slate-600 text-[0.96875rem] leading-[1.75] mb-4">{children}</p>;
}
function LI({ children }: { children: React.ReactNode }) {
  return <li className="text-slate-600 text-[0.96875rem] leading-[1.75] mb-2 ml-5 list-disc marker:text-slate-400">{children}</li>;
}

export default function SmsTermsPage() {
  return (
    // bg-cream stays only for the native shell's status-bar canvas rule in
    // globals.css (html.native-app:has(main.bg-cream)); .hp paints the page
    // itself white (owner, 2026-09-17: light pages, no cream).
    <main className="hp sc-canvas-white min-h-screen bg-cream flex flex-col">
      <SiteNav />
      <HomeHeadingReveal />

      <section className="hp-page-hero border-b border-slate-200/70">
        <div className="relative max-w-3xl mx-auto px-5 sm:px-6 pt-28 sm:pt-36 pb-10 sm:pb-12 w-full" data-hp-head>
          <h1 className="rd-display text-[clamp(2.1rem,4.4vw,3rem)] text-slate-900 [text-wrap:balance]">SMS &amp; Messaging Terms</h1>
          <p className="text-slate-500 text-[0.9375rem] mt-3">Last updated: {LAST_UPDATED}</p>
        </div>
      </section>

      <div className="max-w-3xl mx-auto px-5 sm:px-6 pt-10 pb-20 w-full">

        <P>
          These terms describe SwiftCard&apos;s text-messaging program. SwiftCard is operated by{" "}
          <strong>Swift Card Inc.</strong> (see our <Link href="/company" className="text-brand underline">Company page</Link>).
          They apply to any text message sent through SwiftCard, and they supplement our{" "}
          <Link href="/terms" className="text-brand underline">Terms of Service</Link> and{" "}
          <Link href="/privacy" className="text-brand underline">Privacy Policy</Link>.
        </P>

        {/* At-a-glance summary card */}
        <div className="rounded-2xl border border-slate-200/80 bg-[#F5F7FB] p-5 sm:p-6 my-6">
          <div className="mb-3"><Eyebrow dark={false}>The short version</Eyebrow></div>
          <ul>
            <LI><strong>Swift Card Inc. is the sender</strong> of every text in this program. We send them from our own registered number, using our own templates, to people who ticked the SMS consent box when sharing their contact information with a SwiftCard user: a card link and follow-ups about that exchange. Our users do not send texts through SwiftCard and do not write the content of an automated one.</LI>
            <LI>SwiftCard does <strong>not</strong> send marketing text blasts of its own, and never texts its own account holders.</LI>
            <LI>Every SwiftCard text comes from one number: <strong>(917) 905-7335</strong>.</LI>
            <LI>Message frequency varies. Message and data rates may apply.</LI>
            <LI>Reply <strong>STOP</strong> to any message to opt out. Reply <strong>HELP</strong> for help.</LI>
            <LI>We never sell or share your mobile number or opt-in data for third-party marketing.</LI>
          </ul>
        </div>

        <H2>The SwiftCard messaging program</H2>
        <P>
          SwiftCard is a digital business card platform operated by Swift Card Inc. When you share your
          contact information with a SwiftCard user (for example, through the share form on their card
          page), you may also tick the optional box asking us to text you follow-ups about that exchange.
          If you do, Swift Card Inc. sends those texts. They go out from our own registered number,{" "}
          <strong>(917) 905-7335</strong>, using message templates we write and control, and they name the
          SwiftCard user you met so you know which conversation the message is about. That user is the
          subject of the message, not its sender: they may write the wording of a follow-up they schedule,
          but Swift Card Inc. sends it, every message identifies SwiftCard, and they never receive your
          mobile number to message you themselves.
        </P>

        <H2>The types of messages we send</H2>
        <ul className="mb-3">
          <LI>
            <strong>Replies and conversation messages:</strong> a message a SwiftCard user personally writes
            and sends to you after you reached out or shared your info with them.
          </LI>
          <LI>
            <strong>Contact-card messages:</strong> a one-time text with a link to a user&apos;s digital
            business card when they choose to share their contact information with you.
          </LI>
          <LI>
            <strong>Follow-up messages:</strong> messages a SwiftCard user schedules to stay in touch after
            you connect (for example, a &quot;great meeting you&quot; note). These only go to contacts whose
            texts are enabled, and every one honors STOP.
          </LI>
        </ul>
        <P>
          SwiftCard itself does not send promotional text campaigns, and account holders are never texted by
          the platform. All platform notices to account holders go by email or in-app notification.
        </P>

        <H2>How consent is collected</H2>
        <P>
          Sharing your contact information with a SwiftCard user, on their card or by handing it over
          in person, is <strong>not</strong> a subscription to text messages, and we do not treat it as
          one. Nobody is texted automatically because they filled in a share form.
          {" "}Texts happen only when the SwiftCard user you met sets up a follow-up for you personally and
          confirms they have your permission to text you; that confirmation is what allows a message to be
          sent, and it is recorded on their account. The messages are follow-ups about your conversation:
          their contact details, their replies, and any follow-up they set up. Message frequency varies,
          msg &amp; data rates may apply, and you can reply STOP to opt out or HELP for help at any time.
          Consent is never bundled into an unrelated action and is never a condition of sharing your
          details, of purchase, or of creating an account. See the{" "}
          <Link href="/sms-consent" className="text-brand underline">SMS Consent Overview</Link> for the
          whole flow.
        </P>
        <P>
          Your consent applies to messages from the SwiftCard user you shared your information with, sent
          through SwiftCard. <strong>Consent is not transferable.</strong> It does not extend to unrelated
          companies, and we do not pass your opt-in to anyone else.
        </P>

        <H2>Message frequency</H2>
        <P>
          Message frequency varies. It depends on the conversation and on any follow-up messages the
          SwiftCard user you connected with has set up. This is not a recurring subscription program with a
          fixed cadence.
        </P>

        <H2>Message and data rates</H2>
        <P>
          Message and data rates may apply, depending on your mobile carrier and plan. SwiftCard does not
          charge you to receive messages; your carrier&apos;s standard rates apply.
        </P>

        <H2>Opting out (STOP)</H2>
        <P>
          Reply <strong>STOP</strong> (or STOPALL, UNSUBSCRIBE, CANCEL, END, or QUIT) to any SwiftCard text
          to opt out. Your number is suppressed across all of SwiftCard, so no SwiftCard user can text you
          through the platform after that, and automated messages stop immediately. You&apos;ll receive one
          confirmation of your opt-out. Reply <strong>START</strong> to resume messages if you change your
          mind.
        </P>

        <H2>Getting help (HELP)</H2>
        <P>
          Reply <strong>HELP</strong> to any SwiftCard text for assistance, or contact us any time at{" "}
          <a href="mailto:hello@swiftcard.me" className="text-brand underline">hello@swiftcard.me</a> or
          through the <Link href="/contact" className="text-brand underline">contact page</Link>.
        </P>

        <H2>Your mobile information is not sold or shared</H2>
        <P>
          We do not share, sell, or otherwise provide your mobile phone number or messaging consent
          information to any third parties or affiliates for marketing or promotional purposes. Text
          messages are delivered through our messaging provider (Twilio), which processes them only to
          provide the service on our instructions, never for its own marketing. See the{" "}
          <Link href="/privacy" className="text-brand underline">Privacy Policy</Link> for full details.
        </P>

        <H2>Supported carriers &amp; liability</H2>
        <P>
          Messages are supported on major U.S. carriers. Carriers are not liable for delayed or undelivered
          messages.
        </P>

        <H2>Contact</H2>
        <P>
          Questions about these terms:{" "}
          <a href="mailto:hello@swiftcard.me" className="text-brand underline">hello@swiftcard.me</a>.
          SwiftCard is operated by Swift Card Inc. · New York, NY, USA.
        </P>
      </div>

      <SiteFooterMini />
    </main>
  );
}
