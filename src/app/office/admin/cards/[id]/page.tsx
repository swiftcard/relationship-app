import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { requireOfficeAdmin } from "@/lib/office-admin-guard";
import { listOfficeCards } from "@/lib/office-cards";
import { getCardStats } from "@/lib/office-analytics";
import { StatTile, PageHead, Badge } from "@/components/office/OfficeUI";
import OfficeCardActions from "@/components/office/OfficeCardActions";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "https://swiftcard.me";

export const metadata = { title: "Card — Admin — SwiftCard" };

export default async function OfficeCardDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { office, officeId, caps } = await requireOfficeAdmin();
  if (!office || !officeId) redirect("/office/admin");
  if (!caps.canManageCards) redirect("/office/admin");

  // Authorization: resolve the card from THIS office's own list, so a card id
  // from another office can't be opened by pasting it into the URL.
  const cards = await listOfficeCards(officeId).catch(() => []);
  const card = cards.find((c) => c.id === id);
  if (!card) notFound();

  const stats = await getCardStats(card).catch(() => ({ views: 0, swiftlinkViews: 0, leads: 0, contactsSaved: 0 }));

  return (
    <div>
      <Link
        href={card.user_id ? `/office/admin/team/${card.user_id}` : "/office/admin"}
        className="text-xs text-gray-500 hover:text-gray-300 transition-colors"
      >
        ← Back
      </Link>

      <div className="mt-3 flex items-start justify-between gap-4 mb-5">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="text-xl font-bold text-white tracking-tight truncate">
              {card.label || card.name || "Untitled card"}
            </h1>
            {card.is_offline ? <Badge tone="gray">Offline</Badge> : <Badge tone="green">Live</Badge>}
          </div>
          <p className="text-gray-500 text-sm mt-0.5">/{card.username}</p>
        </div>
      </div>

      {/* This card alone, all time — counted like everything else in the console. */}
      <p className="text-[0.6875rem] font-semibold text-gray-500 uppercase tracking-wider mb-2">All time</p>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-8">
        <StatTile label="Card views" value={stats.views} />
        <StatTile label="Swift Link views" value={stats.swiftlinkViews} />
        <StatTile label="Contacts captured" value={stats.leads} />
        <StatTile label="Contact downloads" value={stats.contactsSaved} />
      </div>

      <p className="text-[0.6875rem] font-semibold text-gray-500 uppercase tracking-wider mb-2">Details</p>
      <div className="bg-gray-900 border border-gray-800 rounded-2xl divide-y divide-gray-800 mb-6">
        {([
          ["Owner", card.ownerName || card.ownerEmail || "—"],
          ["Name on card", card.name || "—"],
          ["Title", card.title || "—"],
          ["Email", card.email || "—"],
          ["Phone", card.phone || "—"],
          ["Template", card.template || "—"],
          ["Created", card.created_at ? new Date(card.created_at).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" }) : "—"],
        ] as const).map(([k, v]) => (
          <div key={k} className="flex items-center justify-between gap-4 px-5 py-2.5">
            <span className="text-xs text-gray-500 shrink-0">{k}</span>
            <span className="text-sm text-gray-200 truncate">{v}</span>
          </div>
        ))}
      </div>

      <PageHead title="Manage" desc="Edit this person's details, or pull the card offline." />
      <OfficeCardActions
        card={{
          id: card.id,
          username: card.username,
          name: card.name,
          title: card.title,
          email: card.email,
          phone: card.phone,
          is_offline: card.is_offline,
        }}
        appUrl={APP_URL}
      />
    </div>
  );
}
