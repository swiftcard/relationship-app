import { redirect } from "next/navigation";
import OfficeBranding from "@/components/OfficeBranding";
import { requireOfficeAdmin } from "@/lib/office-admin-guard";
import { PageHead } from "@/components/office/OfficeUI";

export const metadata = { title: "Branding — Admin — SwiftCard" };

export default async function OfficeBrandingPage() {
  const { office, officeId, caps } = await requireOfficeAdmin();
  if (!office || !officeId) redirect("/office/admin");
  if (!caps.canBrand) redirect("/office/admin");
  const locks = office.brand_locks as { saved?: boolean } | null;
  const d = office.brand_design as Record<string, unknown> | null;
  const prefilled = locks?.saved !== true && !!(
    office.brand_company || office.brand_logo_url || office.brand_website || office.brand_template ||
    office.brand_phone || office.brand_address || (d && Object.keys(d).length)
  );

  return (
    <div>
      <PageHead
        title="Branding"
        // "including yours" was false. Three independent code paths deliberately
        // exempt the OWNER from brand propagation (office-brand.ts's
        // propagateBrandToOfficeCards excludes ownerId by an explicit owner
        // decision), and the brand lives on the offices row, not on the owner's
        // card. So an owner set a logo, company and colours, was told their own
        // card was included, and found it unchanged with no explanation
        // anywhere in the product.
        desc="Set this once — every card on your team automatically uses it. Your own cards stay yours to design."
      />

      {/* This page IS the brand source — logo, company, website, template and
          the colors/fonts all live on the office row and push to every card. */}
      <div data-tour="admin-branding-note" className="bg-purple-500/5 border border-purple-500/20 rounded-2xl px-4 py-3 mb-5">
        {/* Named both halves once the page gained tabs. An admin who opened
            Branding looking for the Swift Links design and read "for every
            card" would reasonably conclude it wasn't here. */}
        <p className="text-sm text-purple-200 font-medium">This page sets the look for every card and Swift Links page</p>
        <p className="text-xs text-purple-200/70 mt-1 leading-relaxed">
          {/* NOT "yours included" — that was false and contradicted the line
              directly above this panel ("Your own cards stay yours to design"),
              eight lines apart in the same file. The owner is excluded twice
              over in code: resolveBrandTargetIds and propagateBrandToOfficeCards
              both skip ownerId. An admin who set a logo, saw "Applied to every
              card ✓", then opened their own card and found no logo would
              reasonably conclude the feature was broken. */}
          Logo, company details, template, colors and fonts set here apply to your team&apos;s
          cards. Change them once, and every teammate&apos;s card updates with them. Use
          the <strong>Links</strong> tab to do the same for their Swift Links pages.
          Your own cards are yours — they stay exactly as you designed them.
        </p>
      </div>

      {/* Prefilled from the owner's first card (lib/office-brand
          seedBrandFromOwnersFirstCard) and not yet saved here: say so, so the
          admin reviews it instead of re-entering everything, and knows what
          was deliberately left behind. Gone after the first save. */}
      {prefilled && (
        <div className="bg-blue-500/5 border border-blue-500/20 rounded-2xl px-4 py-3 mb-5">
          <p className="text-sm text-blue-200 font-medium">We started this from your card</p>
          <p className="text-xs text-blue-200/80 mt-1 leading-relaxed">
            The company details your card had — name, logo, website, and any office phone, fax and address — plus
            its card design and Swift Links design are filled in below. Your name, title, photo, mobile and email
            stay on your card only.
            Your team&apos;s cards use it as it is now — check it over, change anything you like, and tap <strong>Save &amp; apply to team cards</strong> at the bottom.
          </p>
        </div>
      )}

      <div data-tour="admin-branding-form"><OfficeBranding office={office} /></div>
    </div>
  );
}
