import type { Metadata } from "next";
import SiteNav from "@/components/site/SiteNav";
import Link from "next/link";
import SiteFooterMini from "@/components/site/SiteFooterMini";
import HomeHeadingReveal from "@/components/site/HomeHeadingReveal";
import "@/app/home.css";
import NativeHidden from "@/components/NativeHidden";
import NativeOnly from "@/components/NativeOnly";

export const metadata: Metadata = {
  title: "Terms of Service | SwiftCard",
  description: "The terms that govern your use of SwiftCard.",
};

// Plain-language terms of service reflecting how the product actually works.
// NOTE: this is a good-faith starting template, not legal advice — have a
// lawyer review it before relying on it, especially the liability and
// governing-law sections.

function H2({ children }: { children: React.ReactNode }) {
  return <h2 className="text-[1.25rem] font-bold tracking-[-0.01em] text-slate-900 mt-12 mb-3">{children}</h2>;
}
function P({ children }: { children: React.ReactNode }) {
  return <p className="text-slate-600 text-[0.96875rem] leading-[1.75] mb-4">{children}</p>;
}
function LI({ children }: { children: React.ReactNode }) {
  return <li className="text-slate-600 text-[0.96875rem] leading-[1.75] mb-2 ml-5 list-disc marker:text-slate-400">{children}</li>;
}

export default function TermsPage() {
  return (
    // bg-cream stays only for the native shell's status-bar canvas rule in
    // globals.css (html.native-app:has(main.bg-cream)); .hp paints the page
    // itself white (owner, 2026-09-17: light pages, no cream).
    <main className="hp sc-canvas-white min-h-screen bg-cream flex flex-col">
      <SiteNav />
      <HomeHeadingReveal />

      <section className="hp-page-hero border-b border-slate-200/70">
        <div className="relative max-w-3xl mx-auto px-5 sm:px-6 pt-28 sm:pt-36 pb-10 sm:pb-12 w-full" data-hp-head>
          <h1 className="rd-display text-[clamp(2.1rem,4.4vw,3rem)] text-slate-900 [text-wrap:balance]">Terms of Service</h1>
          <p className="text-slate-500 text-[0.9375rem] mt-3">Last updated: July 21, 2026</p>
        </div>
      </section>

      <div className="max-w-3xl mx-auto px-5 sm:px-6 pt-10 pb-20 w-full">

        <P>
          These terms are an agreement between you and SwiftCard (&quot;SwiftCard&quot;, &quot;we&quot;, &quot;us&quot;)
          for your use of the digital business cards, link-in-bio pages, and contact-management tools at
          swiftcard.me (the &quot;Service&quot;). By creating an account or using the Service, you agree to these
          terms. If you don&apos;t agree, please don&apos;t use the Service. We&apos;ve kept this in plain English on purpose.
        </P>

        <H2>Company information</H2>
        <P>
          SwiftCard is a digital business card and link-in-bio platform operated by <strong>Swift Card Inc.</strong>,
          a corporation. More details are on our{" "}
          <Link href="/company" className="text-brand underline">Company page</Link>.
        </P>
        <dl className="mt-4 mb-3 rounded-2xl border border-slate-200/80 bg-[#F5F7FB] divide-y divide-slate-200/80">
          <div className="flex flex-col sm:flex-row sm:items-baseline gap-1 sm:gap-4 px-4 py-3">
            <dt className="text-slate-500 text-[0.8125rem] font-semibold sm:w-44 shrink-0">Operating entity</dt>
            <dd className="text-slate-800 text-[0.9375rem]">Swift Card Inc.</dd>
          </div>
          <div className="flex flex-col sm:flex-row sm:items-baseline gap-1 sm:gap-4 px-4 py-3">
            <dt className="text-slate-500 text-[0.8125rem] font-semibold sm:w-44 shrink-0">Brand</dt>
            <dd className="text-slate-800 text-[0.9375rem]">SwiftCard (swiftcard.me)</dd>
          </div>
          <div className="flex flex-col sm:flex-row sm:items-baseline gap-1 sm:gap-4 px-4 py-3">
            <dt className="text-slate-500 text-[0.8125rem] font-semibold sm:w-44 shrink-0">Contact</dt>
            <dd className="text-slate-800 text-[0.9375rem]">
              <a href="mailto:hello@swiftcard.me" className="text-brand underline">hello@swiftcard.me</a>
              {" · "}
              <Link href="/contact" className="text-brand underline">swiftcard.me/contact</Link>
            </dd>
          </div>
        </dl>

        <H2>Who can use SwiftCard</H2>
        <P>
          <strong>You must be at least 16 years old to use SwiftCard.</strong> The Service is not directed to
          children, and people under 13 may not use it under any circumstances. If you are under the age of legal
          majority where you live (for example, under 18 in most U.S. states), you may only use SwiftCard with the
          permission and supervision of a parent or legal guardian who agrees to these terms on your behalf. By
          creating an account you represent that you meet these requirements and are able to form a binding
          contract. We may suspend or terminate any account we reasonably believe belongs to an underage user, and
          we will delete its personal information as described in our{" "}
          <Link href="/privacy" className="text-brand underline">Privacy Policy</Link>. If you use SwiftCard on
          behalf of a company or team (for example, an Office account), you confirm you&apos;re authorized to accept
          these terms for that organization.
        </P>

        <H2>Your account</H2>
        <ul className="mb-3">
          <LI>You&apos;re responsible for keeping your login secure and for everything that happens under your account.</LI>
          <LI>Provide accurate information and keep it current, especially your email, which we use for account and billing notices.</LI>
          <LI>Tell us promptly if you suspect unauthorized access.</LI>
        </ul>

        <H2>Your content and your card</H2>
        <P>
          You own the content you put on your card and Swift Links page: your name, details, photos, logo, links,
          and anything else you add. You give us the limited permission we need to host, display, and deliver that
          content as part of running the Service (for example, showing your card to anyone who opens its link, which
          is public by design). You&apos;re responsible for making sure you have the rights to everything you upload and
          that it doesn&apos;t infringe anyone else&apos;s rights.
        </P>

        <H2>Contacts and the data you collect</H2>
        <P>
          When people share their information through your card, or you import or scan contacts, that data is stored
          in your account for you to use. Because that information belongs to real people, you agree that:
        </P>
        <ul className="mb-3">
          <LI>You&apos;ll only collect and use it for legitimate business follow-up, in line with applicable privacy and anti-spam laws (including, where they apply to you, GDPR, CCPA/CPRA, CAN-SPAM, and TCPA).</LI>
          <LI>You have a lawful basis to contact the people you message, and you&apos;ll honor opt-outs. Automated follow-up emails you set up are sent on your behalf, and you&apos;re the sender responsible for them.</LI>
          <LI><strong>Text messages are different.</strong> Swift Card Inc. is the sender of every automated text message sent through SwiftCard. We send them from our own registered number, using our own message templates, only to a contact whose permission you have confirmed to us when you set the follow-up up, and only about the exchange that person started. You may write the wording of a follow-up you schedule, but we send it, every message identifies SwiftCard, and you never receive the recipient&apos;s mobile number to message yourself. Text messaging is governed by our <Link href="/sms-terms" className="text-brand underline">SMS &amp; Messaging Terms</Link>.</LI>
          <LI>You won&apos;t upload contact data you obtained unlawfully, or use SwiftCard to send unsolicited bulk messages.</LI>
        </ul>
        <P>
          For the contact records you collect, you are the data controller and SwiftCard acts as your processor.
          Mobile numbers and SMS consent are the exception: because Swift Card Inc. is the sender of every automated
          text, we are the controller of the mobile number and the consent record for that purpose, and we do not
          share either with you, with other users, or with any third party or affiliate for marketing or promotional
          purposes. See our{" "}
          <Link href="/privacy" className="text-brand underline">Privacy Policy</Link> for how we handle personal information.
        </P>

        {/* A2P 10DLC / TCR vetting reads THIS url as the Terms & Conditions
            and looks for the program disclosures on the page itself. Our first
            campaign was rejected 30882 (Terms and Conditions issues) while all
            of this existed only on /sms-terms behind a link. Keep this block
            here and in sync with /sms-terms — a link is not a disclosure. */}
        <H2>SMS &amp; text messaging program</H2>
        <P>
          <strong>Program description.</strong>{" "}Swift Card Inc. (SwiftCard) sends transactional text messages to
          people who gave a SwiftCard user permission to text them after an exchange, which that user confirms to
          us before anything is sent. Messages
          contain the contact details of the SwiftCard user you just met, and the follow-ups about that exchange
          that you consented to receive. We are the sender of every message.
        </P>
        <ul className="mb-3">
          <LI><strong>How you opt in.</strong> By giving the SwiftCard user you met permission to text you, in the exchange where you swapped details. They confirm that permission to us before any message can be sent, and it is the only thing that allows one. Consent is never a condition of sharing your details or of any purchase.</LI>
          <LI><strong>Message frequency.</strong> Message frequency varies, typically 1–5 messages per exchange you opt into.</LI>
          <LI><strong>Cost.</strong> Message and data rates may apply. SwiftCard does not charge you for these messages; your mobile carrier&apos;s standard rates apply.</LI>
          <LI><strong>Opting out.</strong> Reply <strong>STOP</strong> to any message to stop all further messages. You will receive a single confirmation and then no further texts.</LI>
          <LI><strong>Help.</strong> Reply <strong>HELP</strong> for assistance, or contact us at <a href="mailto:hello@swiftcard.me" className="text-brand underline">hello@swiftcard.me</a> or via our <Link href="/contact" className="text-brand underline">contact page</Link>.</LI>
          <LI><strong>Carriers.</strong> Carriers are not liable for delayed or undelivered messages.</LI>
          <LI><strong>Your data.</strong> We do not share, sell, or otherwise provide your mobile phone number or messaging consent information to any third parties or affiliates for marketing or promotional purposes. See our <Link href="/privacy" className="text-brand underline">Privacy Policy</Link>.</LI>
        </ul>
        <P>
          Full program terms: <Link href="/sms-terms" className="text-brand underline">SMS &amp; Messaging Terms</Link>.
        </P>

        <H2>Acceptable use</H2>
        <P>Don&apos;t use SwiftCard to:</P>
        <ul className="mb-3">
          <LI>Break the law, infringe intellectual property, or impersonate someone else.</LI>
          <LI>Post or distribute malware, phishing, spam, or misleading, hateful, or unlawful content.</LI>
          <LI>Attack, overload, reverse-engineer, scrape, or attempt to gain unauthorized access to the Service or its data.</LI>
          <LI>Resell or white-label the Service without our written permission.</LI>
        </ul>
        <P>We may suspend or terminate accounts that violate these rules.</P>

        <H2>Plans, billing, and cancellation</H2>
        <ul className="mb-3">
          {/* App Store 3.1.1: the app must not link users out to a purchase
              page, so the link is web-only — but dropping it would leave "shown
              on the ." So the app gets equivalent wording with no link. */}
          <LI>SwiftCard offers a Free plan and paid plans (Pro and Office). Current pricing is shown on the{" "}
            <NativeHidden><Link href="/pricing" className="text-brand underline">pricing page</Link></NativeHidden>
            <NativeOnly>subscription sheet in the app</NativeOnly>.</LI>
          <LI>Paid plans are billed in advance on a recurring basis (monthly or annually) through our payment processor, Stripe, until you cancel. By subscribing you authorize those recurring charges.</LI>
          <LI>You can cancel anytime from your billing settings; cancellation stops future renewals and takes effect at the end of the current billing period. Except where required by law, payments already made are non-refundable.</LI>
          <LI>If a payment fails, we&apos;ll give you a short grace period to update it; if it stays unresolved, your account moves to the Free plan. Your existing cards and contacts aren&apos;t deleted; some paid features simply lock until you upgrade again.</LI>
          <LI>We may change prices or plan features. We&apos;ll give reasonable notice of material changes before they affect your next renewal.</LI>
        </ul>

        <H2>Free trials and promotional offers</H2>
        <P>
          When you subscribe to Pro for the first time, your subscription starts with a free trial (currently 14 days).
          You provide a payment method at checkout, and <strong>when the trial ends your subscription begins and your
          payment method is charged automatically</strong>{" "}at the price shown, unless you cancel before the trial ends.
          You can cancel anytime from Settings or the billing portal. Cancel during the trial and you won&apos;t be
          charged. One trial per customer. Promotional free months work similarly: when they end, the account returns
          to the Free plan unless a paid subscription is active. Referral and promotional rewards have no cash value
          and may be changed or withdrawn if abused.
        </P>

        <H2>Third-party services</H2>
        <P>
          SwiftCard works with third parties to deliver the Service, including Stripe (payments), Supabase (hosting
          and authentication), Resend (email), Twilio (text messaging), and optional integrations you connect such as
          Salesforce, GoHighLevel, Pipedrive, HubSpot, Google Contacts, and Zapier. Your use of those integrations is also subject to their terms, and
          we&apos;re not responsible for third-party services we don&apos;t control.
        </P>

        <H2>Availability and changes</H2>
        <P>
          We work to keep SwiftCard reliable, but the Service is provided &quot;as is&quot; and we can&apos;t promise it will always
          be uninterrupted or error-free. We may add, change, or remove features, and we may update these terms; if we
          make material changes, we&apos;ll take reasonable steps to let you know. Continuing to use the Service after changes
          take effect means you accept the updated terms.
        </P>

        <H2>Our intellectual property</H2>
        <P>
          The Service itself (the software, design, templates, logos, and everything that makes SwiftCard work) is
          owned by Swift Card Inc. and its licensors, and is protected by copyright, trademark, and other laws.
          These terms give you a limited, revocable, non-exclusive, non-transferable right to use the Service; they
          don&apos;t give you any ownership of it. If you send us ideas or feedback, we may use them freely, without
          any obligation or payment to you.
        </P>

        <H2>Disclaimers</H2>
        <P>
          The Service is provided <strong>&quot;as is&quot; and &quot;as available.&quot;</strong>{" "}To the fullest
          extent permitted by law, we disclaim all warranties, express or implied, including implied warranties of
          merchantability, fitness for a particular purpose, and non-infringement. We don&apos;t warrant that the
          Service will be uninterrupted, error-free, or secure, that defects will be corrected, or that the Service
          will produce any particular business result. SwiftCard is a networking tool, and we make no promise that you
          will gain leads, contacts, or revenue from using it. Content on other users&apos; cards belongs to those
          users; we don&apos;t verify it and aren&apos;t responsible for it.
        </P>

        <H2>Limitation of liability</H2>
        <P>
          To the fullest extent permitted by law: (a) we are not liable for indirect, incidental, special,
          consequential, exemplary, or punitive damages, or for lost profits, revenue, data, goodwill, or business
          opportunities, even if we&apos;ve been advised such damages are possible; (b) we are not liable for the
          conduct or content of any user or third party, or for events beyond our reasonable control; and (c) our
          total, cumulative liability for all claims relating to the Service is limited to the greater of{" "}
          <strong>$50</strong> or the amount you paid us in the <strong>12 months</strong>{" "}before the event giving
          rise to the claim. These limits apply regardless of the theory of liability (contract, tort, negligence,
          statute, or otherwise) and even if a remedy fails of its essential purpose. Some jurisdictions don&apos;t
          allow certain limitations, so some of these may not apply to you; in that case our liability is limited to
          the smallest amount the law allows.
        </P>

        <H2>Indemnification</H2>
        <P>
          You agree to defend, indemnify, and hold harmless Swift Card Inc., SwiftCard, and their officers,
          employees, and agents from any claims, damages, liabilities, and expenses (including reasonable
          attorneys&apos; fees) arising out of: your content; the contacts you collect and the messages you send
          through the Service; your use of the Service in violation of these terms or of applicable law (including
          privacy and anti-spam laws); or your infringement of anyone else&apos;s rights.
        </P>

        <H2>Dispute resolution: arbitration &amp; class-action waiver</H2>
        <P>
          <strong>Please read this section carefully. It affects your legal rights.</strong> If you have a dispute
          with us, contact us first through the{" "}
          <Link href="/contact" className="text-brand underline">Contact page</Link>; most issues can be resolved
          informally, and we&apos;ll try in good faith for 30 days before either side starts formal proceedings.
        </P>
        <ul className="mb-3">
          <LI><strong>Binding arbitration.</strong> Any dispute that isn&apos;t resolved informally will be settled by binding individual arbitration administered by the American Arbitration Association under its Consumer Arbitration Rules, rather than in court. The Federal Arbitration Act governs this section. Either party may instead bring an individual claim in small-claims court, and either party may seek injunctive relief in court for infringement or misuse of intellectual property.</LI>
          <LI><strong>Class-action waiver.</strong> Disputes will be resolved only on an individual basis. <strong>You and SwiftCard each waive the right to a jury trial and to participate in a class action, class arbitration, or representative proceeding.</strong> If this waiver is found unenforceable for a particular claim, that claim (and only that claim) proceeds in court.</LI>
          <LI><strong>Time limit.</strong> Any claim must be filed within <strong>one year</strong> after it arises, or it is permanently barred, unless a longer period is required by law.</LI>
          <LI><strong>Opt-out.</strong> You may opt out of this arbitration agreement within 30 days of first accepting these terms by telling us through the Contact page with the subject &quot;Arbitration opt-out&quot; and the email on your account. Opting out doesn&apos;t affect any other part of these terms.</LI>
        </ul>

        <H2>Termination</H2>
        <P>
          You can stop using SwiftCard and delete your account at any time from your settings. We may suspend or
          terminate your account if you violate these terms or if we&apos;re required to by law. After deletion, we remove
          your data as described in our Privacy Policy, subject to a short recovery window and any records we&apos;re
          legally required to keep. Sections that by their nature should survive termination (including Your content,
          Disclaimers, Limitation of liability, Indemnification, and Dispute resolution) survive.
        </P>

        <H2>Governing law</H2>
        <P>
          These terms are governed by the laws of the State of New York, without regard to its conflict-of-laws rules.
          Any dispute not subject to arbitration will be handled in the state or federal courts located in New York,
          and both parties consent to their jurisdiction, unless applicable law requires otherwise.
        </P>

        <H2>Miscellaneous</H2>
        <P>
          These terms (with the Privacy Policy) are the entire agreement between you and us about the Service. If any
          part is found unenforceable, the rest remains in effect. Our not enforcing a provision isn&apos;t a waiver
          of it. You may not assign these terms; we may assign them in connection with a merger, acquisition, or sale
          of assets. Nothing in these terms creates a partnership, employment, or agency relationship.
        </P>

        <H2>Apple App Store</H2>
        <P>
          If you download SwiftCard from the Apple App Store, the following also applies, and these terms are the
          end-user license agreement (EULA) between you and SwiftCard for the app:
        </P>
        <ul className="mb-3">
          <LI><strong>Party to this agreement.</strong> This agreement is between you and SwiftCard only, not Apple. SwiftCard, not Apple, is solely responsible for the app and its content.</LI>
          <LI><strong>Scope of license.</strong> Your license to use the app is limited to a non-transferable license to use it on any Apple-branded device you own or control, as permitted by the App Store Usage Rules, except that it may be accessed by other accounts associated with you through Family Sharing or volume purchasing.</LI>
          <LI><strong>Maintenance and support.</strong> SwiftCard is solely responsible for providing any maintenance and support for the app. Apple has no obligation to furnish any maintenance or support services.</LI>
          <LI><strong>Warranty.</strong> To the maximum extent permitted by law, Apple has no warranty obligation with respect to the app. If the app fails to conform to any applicable warranty, you may notify Apple and Apple will refund the purchase price (if any); Apple has no other warranty obligation, and any other claims are SwiftCard&apos;s responsibility.</LI>
          <LI><strong>Product claims.</strong> SwiftCard, not Apple, is responsible for addressing any claims relating to the app, including product-liability claims, claims that the app fails to conform to legal or regulatory requirements, and consumer-protection or privacy claims.</LI>
          <LI><strong>Intellectual property.</strong> If a third party claims the app infringes its intellectual property, SwiftCard, not Apple, is solely responsible for the investigation, defense, settlement, and discharge of that claim.</LI>
          <LI><strong>Third-party beneficiary.</strong> Apple and its subsidiaries are third-party beneficiaries of these terms and, upon your acceptance, will have the right to enforce them against you as a third-party beneficiary.</LI>
          <LI><strong>Compliance.</strong> You represent that you are not located in a country subject to a U.S. Government embargo or designated as terrorist-supporting, and that you are not on any U.S. Government restricted-parties list.</LI>
        </ul>

        <H2>Contact</H2>
        <P>
          Questions about these terms? Reach us through the{" "}
          <Link href="/contact" className="text-brand underline">Contact page</Link>.
        </P>
      </div>

      <SiteFooterMini />
    </main>
  );
}
