import { redirect } from "next/navigation";
import { requireOfficeAdmin } from "@/lib/office-admin-guard";
import { getOfficeLeads } from "@/lib/office-leads";
import { getOfficeContactDetail } from "@/lib/office-contact-detail";
import { FOLLOW_UP_STATES, type FollowUpState } from "@/lib/lead-followup";
import { PageHead } from "@/components/office/OfficeUI";
import LeadsTable from "./LeadsTable";

export const metadata = { title: "Contacts — Admin — SwiftCard" };

export default async function OfficeLeadsPage({
  searchParams,
}: {
  searchParams: Promise<{ followUp?: string; contact?: string }>;
}) {
  const { office, officeId, ownerId, userId } = await requireOfficeAdmin();
  // ?followUp=none — where the "team leads have no follow-up yet" notification
  // (bell row and push) opens, so the leads it counted are the ones on screen.
  const params = await searchParams;
  const requested = params.followUp;
  const initialFollowUp = FOLLOW_UP_STATES.includes(requested as FollowUpState) ? (requested as FollowUpState) : undefined;
  if (!office || !officeId) redirect("/office/admin");

  // ?contact=<id> — a row's link, followed before hydration, in a new tab, or
  // from another console page. The drawer opens already filled. Anything not
  // in THIS office comes back null and the drawer says so; the id is checked
  // inside getOfficeContactDetail before it is used.
  const contactId = typeof params.contact === "string" ? params.contact : null;

  // Server-scoped to THIS office (current team + leads stamped at removal time
  // for people who've left) — includes the slug → person-name mapping so the
  // table never shows a raw card URL.
  const [page, initialContact] = await Promise.all([
    getOfficeLeads(officeId).catch(() => ({ leads: [], total: 0, hasMore: false })),
    contactId && ownerId
      ? getOfficeContactDetail({ officeId, ownerId, viewerId: userId, contactId }).catch(() => null)
      : Promise.resolve(null),
  ]);

  return (
    <div>
      <PageHead
        title="Contacts"
        // The EXACT total, not the number loaded. This said "600 so far"
        // permanently once the office passed the old cap — and the Team tab's
        // per-person counts were uncapped, so the two tabs disagreed with no
        // way to reconcile them.
        desc={`Everyone your team has met — people who shared their info, plus contacts your team scanned or added${page.total ? ` — ${page.total.toLocaleString()} so far` : ""}.`}
      />
      <div data-tour="admin-leads-table">
        <LeadsTable
          leads={page.leads}
          total={page.total}
          hasMore={page.hasMore}
          initialFollowUp={initialFollowUp}
          initialContactId={contactId}
          initialContact={initialContact}
        />
      </div>
    </div>
  );
}
