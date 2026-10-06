"use client";

import { useState } from "react";
import Link from "next/link";
import { QRCodeCanvas } from "qrcode.react";
import { relativeTime, shortDate } from "@/lib/relative-time";
import { useDisplayClock } from "@/components/DisplayClock";
// MEMBER_STATUS_LABEL comes from lib/member-status, NOT lib/office-team:
// office-team reaches for the service-role database client, and importing a
// value from it here would put that module on this client bundle's path. The
// row types stay TYPE imports, which the compiler erases entirely.
import { MEMBER_STATUS_LABEL, type MemberStatus } from "@/lib/member-status";
import type { TeamPerson, TeamInvite } from "@/lib/office-team";
import { InviteRowActions, RemoveMemberButton, DeleteMemberAccountButton } from "@/components/office/TeamActions";

// One list for real members and pending invitations, plus the detail drawer.
// Everything is plain English: no slugs, no enums, no ids on screen.

/** The viewer's own "View live card" link (lib/self-pass) — opening your own card is not a view. */
type SelfLive = { userId: string; href: string };

type Caps = {
  canInvite: boolean; canRemove: boolean; canManageCards: boolean; canManageSeats: boolean;
  /** The person looking is the office owner (not a delegated admin). The
   *  owner's own card is theirs alone — a delegated admin's "Edit card" on it
   *  opened an editor whose every save came back 403. */
  viewerIsOwner: boolean;
};

const STATUS_TONE: Record<MemberStatus, string> = {
  active: "bg-green-500/10 text-green-400 border-green-500/20",
  card_incomplete: "bg-amber-500/10 text-amber-400 border-amber-500/20",
  card_deactivated: "bg-gray-800 text-gray-400 border-gray-700",
  idle: "bg-amber-500/10 text-amber-400 border-amber-500/20",
  invite_sent: "bg-gray-800 text-gray-400 border-gray-700",
  invite_expired: "bg-red-500/10 text-red-400 border-red-500/20",
};

function StatusChip({ status }: { status: MemberStatus }) {
  return (
    <span className={`text-[0.625rem] font-bold px-2 py-0.5 rounded-full border whitespace-nowrap ${STATUS_TONE[status]}`}>
      {MEMBER_STATUS_LABEL[status]}
    </span>
  );
}

function Avatar({ name, photoUrl, size = 36 }: { name: string; photoUrl: string | null; size?: number }) {
  if (photoUrl) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={photoUrl} alt="" className="rounded-full object-cover shrink-0 bg-gray-800" style={{ width: size, height: size }} />;
  }
  const initials = name.split(/\s+/).map((w) => w[0]).filter(Boolean).slice(0, 2).join("").toUpperCase() || "?";
  return (
    <span
      className="rounded-full bg-purple-500/15 border border-purple-500/20 text-purple-300 font-bold flex items-center justify-center shrink-0"
      style={{ width: size, height: size, fontSize: size >= 36 ? 12 : 10 }}
      aria-hidden="true"
    >
      {initials}
    </span>
  );
}

function CopyButton({ value, label, copiedLabel = "Copied ✓", className }: {
  value: string; label: string; copiedLabel?: string; className?: string;
}) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={() => {
        try { navigator.clipboard?.writeText(value); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch { /* older browsers */ }
      }}
      className={className ?? "text-[0.6875rem] font-semibold text-gray-400 hover:text-white bg-gray-800 hover:bg-gray-700 px-2.5 py-1 rounded-full transition-colors"}
    >
      {copied ? copiedLabel : label}
    </button>
  );
}

// ── QR modal ─────────────────────────────────────────────────────────────────

function QrModal({ url, name, onClose }: { url: string; name: string; onClose: () => void }) {
  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center px-5"
      style={{
        paddingTop: "calc(1.25rem + env(safe-area-inset-top))",
        paddingBottom: "calc(1.25rem + env(safe-area-inset-bottom))",
      }}
      role="dialog" aria-modal="true" aria-label={`QR code for ${name}`}
    >
      <div className="absolute inset-0 bg-black/70" onClick={onClose} />
      <div className="relative bg-gray-900 border border-gray-800 rounded-2xl p-6 text-center max-w-xs w-full">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-white font-bold text-sm">{name}&apos;s card</h2>
          <button onClick={onClose} aria-label="Close" className="text-gray-500 hover:text-white text-xl leading-none px-1">×</button>
        </div>
        <div className="bg-white rounded-2xl p-4 inline-block">
          <QRCodeCanvas value={url} size={168} />
        </div>
        <p className="text-gray-500 text-[0.6875rem] mt-3">Anyone who scans this opens their card.</p>
        <div className="mt-3">
          <CopyButton value={url} label="Copy card link" className="w-full text-xs font-semibold text-white bg-gray-800 hover:bg-gray-700 py-2 rounded-full transition-colors" />
        </div>
      </div>
    </div>
  );
}

// ── Detail drawer ────────────────────────────────────────────────────────────

function Drawer({ person, appUrl, caps, self, onClose }: {
  person: TeamPerson; appUrl: string; caps: Caps; self?: SelfLive; onClose: () => void;
}) {
  const [qr, setQr] = useState(false);
  const clock = useDisplayClock();
  const cardUrl = person.username ? `${appUrl}/${person.username}` : null;
  const hasCard = person.totalCards > 0;

  return (
    <>
      <div className="fixed inset-0 z-50 flex justify-end" role="dialog" aria-modal="true" aria-label={`${person.name} details`}>
        <div className="absolute inset-0 bg-black/70" onClick={onClose} />
        {/* SAFE AREA. This is `fixed inset-0`, so it opens flush with the
            PHYSICAL top of the screen under viewport-fit=cover — body's
            safe-area padding does not move a fixed element. Without the insets
            below, the avatar, the name and the × close button all sat under the
            clock and the Dynamic Island: unreachable, and visibly clipped. Same
            defect and same remedy as .sc-overlay-topbar in globals.css.

            Additive rather than max(): the person still needs the normal 1.25rem
            of breathing room BELOW the island, not padding that merely reaches
            it. env() resolves to 0 where there is no inset, so this is a no-op
            on desktop and correct on a notched phone in Safari too. */}
        <aside
          className="relative w-full sm:max-w-md bg-gray-900 border-l border-gray-800 h-full overflow-y-auto px-5"
          style={{
            paddingTop: "calc(1.25rem + env(safe-area-inset-top))",
            paddingBottom: "calc(1.25rem + env(safe-area-inset-bottom))",
          }}
        >
          <div className="flex items-start justify-between gap-3 mb-5">
            <div className="flex items-center gap-3 min-w-0">
              <Avatar name={person.name} photoUrl={person.photoUrl} size={44} />
              <div className="min-w-0">
                <p className="text-white font-bold truncate">{person.name}</p>
                <p className="text-gray-500 text-xs truncate">{person.title || "No job title yet"}</p>
                {person.email && <p className="text-gray-600 text-[0.6875rem] truncate">{person.email}</p>}
              </div>
            </div>
            <button onClick={onClose} aria-label="Close" className="text-gray-500 hover:text-white text-2xl leading-none px-1 shrink-0">×</button>
          </div>

          <div className="mb-4"><StatusChip status={person.status} /></div>

          <div className="grid grid-cols-3 gap-2 mb-5">
            {[
              ["Card views", person.views.toLocaleString("en-US")],
              ["Leads", person.leads.toLocaleString("en-US")],
              ["Cards", String(person.totalCards)],
            ].map(([k, v]) => (
              <div key={k} className="rounded-xl border border-gray-800 bg-gray-950/50 px-3 py-2.5">
                <p className="text-white font-bold tabular-nums">{v}</p>
                <p className="text-[0.625rem] text-gray-500 mt-0.5">{k}</p>
              </div>
            ))}
          </div>

          <p className="text-xs text-gray-500 mb-5">
            Last active: <span className="text-gray-300">{person.lastActiveAt ? relativeTime(person.lastActiveAt, clock.now) : "No activity yet"}</span>
          </p>

          {!hasCard ? (
            <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 px-3.5 py-3 mb-5">
              <p className="text-amber-300 text-xs font-semibold">They haven&apos;t made their card yet</p>
              <p className="text-amber-200/70 text-[0.6875rem] mt-0.5">
                They joined but never finished setup, so they have nothing to share yet. When they sign in to SwiftCard, their dashboard opens on &quot;Create your card →&quot;.
              </p>
            </div>
          ) : (
            <div className="flex flex-wrap gap-2 mb-5">
              {cardUrl && (
                <a href={self && self.userId === person.userId ? self.href : cardUrl} target="_blank" rel="noopener noreferrer"
                  className="text-xs font-semibold text-gray-300 hover:text-white bg-gray-800 hover:bg-gray-700 px-3.5 py-2 rounded-full transition-colors">
                  View live card ↗
                </a>
              )}
              {cardUrl && <CopyButton value={cardUrl} label="Copy card link" className="text-xs font-semibold text-gray-300 hover:text-white bg-gray-800 hover:bg-gray-700 px-3.5 py-2 rounded-full transition-colors" />}
              {cardUrl && (
                <button onClick={() => setQr(true)}
                  className="text-xs font-semibold text-gray-300 hover:text-white bg-gray-800 hover:bg-gray-700 px-3.5 py-2 rounded-full transition-colors">
                  Show QR code
                </button>
              )}
              {caps.canManageCards && (!person.isOwner || caps.viewerIsOwner) && (
                // Opens the person's page (their cards, each with "View & edit card"),
                // not an editor — so it is not labelled "Edit card".
                <Link href={`/office/admin/team/${person.userId}`}
                  className="text-xs font-semibold text-gray-300 hover:text-white bg-gray-800 hover:bg-gray-700 px-3.5 py-2 rounded-full transition-colors">
                  Manage their cards
                </Link>
              )}
            </div>
          )}

          {!person.isOwner && person.memberRowId && caps.canRemove && (
            <div className="pt-4 border-t border-gray-800">
              <RemoveMemberButton memberId={person.memberRowId} personName={person.name} canManageSeats={caps.canManageSeats} />
              {/* Owner only (2026-09-23): members can't delete their own account. */}
              {caps.viewerIsOwner && <DeleteMemberAccountButton memberId={person.memberRowId} personName={person.name} />}
            </div>
          )}
          {person.isOwner && (
            <p className="text-[0.6875rem] text-gray-600 pt-4 border-t border-gray-800">
              {/* Was "Your card sets the look for everyone else's." True only
                  of the ONE-TIME seed at provisioning: after that the brand
                  lives on the offices row and is edited on the Branding page,
                  and editing this card changes nothing for the team. */}
              This is you. Your team&apos;s look is set on the Branding page, not here.
            </p>
          )}
        </aside>
      </div>
      {qr && cardUrl && <QrModal url={cardUrl} name={person.name} onClose={() => setQr(false)} />}
    </>
  );
}

// ── The list ─────────────────────────────────────────────────────────────────

export default function TeamList({ people, invites, appUrl, caps, self }: {
  people: TeamPerson[]; invites: TeamInvite[]; appUrl: string; caps: Caps; self?: SelfLive;
}) {
  const [open, setOpen] = useState<TeamPerson | null>(null);
  // Hydration-safe times (components/DisplayClock): a UTC server printing
  // "Invited Sep 23" to a New York browser printing "Invited Sep 22" was
  // React error 418 on every evening load of this page.
  const clock = useDisplayClock();

  return (
    <>
      <div className="bg-gray-900 border border-gray-800 rounded-2xl overflow-hidden">
        <div className="hidden lg:grid grid-cols-12 gap-3 px-5 py-2.5 border-b border-gray-800 bg-gray-900/60 text-[0.6875rem] font-semibold text-gray-500 uppercase tracking-wider">
          <p className="col-span-4">Person</p>
          <p className="col-span-1 text-right">Views</p>
          <p className="col-span-1 text-right">Leads</p>
          <p className="col-span-2">Last active</p>
          <p className="col-span-2">Status</p>
          <p className="col-span-2 text-right">Actions</p>
        </div>

        <div className="divide-y divide-gray-800">
          {people.map((p) => (
            <div key={p.userId} className="grid grid-cols-12 gap-3 px-5 py-3.5 items-center hover:bg-gray-800/40 transition-colors">
              <button
                onClick={() => setOpen(p)}
                className="col-span-12 lg:col-span-4 min-w-0 flex items-center gap-3 text-left"
                aria-label={`Open ${p.name}'s details`}
              >
                <Avatar name={p.name} photoUrl={p.photoUrl} />
                <span className="min-w-0">
                  <span className="flex items-center gap-2">
                    <span className="text-sm text-white font-medium truncate">{p.name}</span>
                    {p.isOwner && <span className="text-[0.625rem] text-purple-400 shrink-0">{caps.viewerIsOwner ? "You" : "Owner"}</span>}
                  </span>
                  <span className="block text-[0.6875rem] text-gray-500 truncate">{p.title || "No job title yet"}</span>
                  {p.email && <span className="block text-[0.6875rem] text-gray-600 truncate">{p.email}</span>}
                </span>
              </button>

              <p className="col-span-4 lg:col-span-1 text-sm text-gray-300 tabular-nums lg:text-right">
                <span className="lg:hidden text-gray-600 text-[0.6875rem]">Views </span>{p.views.toLocaleString("en-US")}
              </p>
              <p className="col-span-4 lg:col-span-1 text-sm text-gray-300 tabular-nums lg:text-right">
                <span className="lg:hidden text-gray-600 text-[0.6875rem]">Leads </span>{p.leads.toLocaleString("en-US")}
              </p>
              <p className="col-span-4 lg:col-span-2 text-xs text-gray-500">
                {p.lastActiveAt ? relativeTime(p.lastActiveAt, clock.now) : "No activity yet"}
              </p>
              <div className="col-span-6 lg:col-span-2"><StatusChip status={p.status} /></div>
              <div className="col-span-6 lg:col-span-2 flex lg:justify-end">
                <button
                  onClick={() => setOpen(p)}
                  className="text-[0.6875rem] font-semibold text-gray-400 hover:text-white bg-gray-800 hover:bg-gray-700 px-2.5 py-1 rounded-full transition-colors"
                >
                  Manage
                </button>
              </div>
            </div>
          ))}

          {invites.map((inv) => (
            <div key={inv.memberRowId} className="grid grid-cols-12 gap-3 px-5 py-3.5 items-center">
              <div className="col-span-12 lg:col-span-4 min-w-0 flex items-center gap-3">
                <Avatar name={inv.name || inv.email} photoUrl={null} />
                <div className="min-w-0">
                  {/* Show WHO the invite went to: their name (when the admin
                      gave one) as the headline, the email under it. */}
                  <p className="text-sm text-white font-medium truncate">{inv.name || inv.email}</p>
                  {inv.name && <p className="text-[0.6875rem] text-gray-500 truncate">{inv.email}</p>}
                  <p className="text-[0.6875rem] text-gray-600">
                    {inv.status === "invite_expired"
                      ? "Invitation expired"
                      : `Invited ${shortDate(inv.sentAt, clock.timeZone)}`}
                  </p>
                </div>
              </div>
              <p className="col-span-4 lg:col-span-1 text-sm text-gray-600 lg:text-right">—</p>
              <p className="col-span-4 lg:col-span-1 text-sm text-gray-600 lg:text-right">—</p>
              <p className="col-span-4 lg:col-span-2 text-xs text-gray-600">—</p>
              <div className="col-span-6 lg:col-span-2"><StatusChip status={inv.status} /></div>
              <div className="col-span-12 lg:col-span-2 flex lg:justify-end">
                {caps.canInvite && (
                  <InviteRowActions
                    memberId={inv.memberRowId}
                    name={inv.name}
                    email={inv.email}
                    inviteUrl={inv.inviteToken ? `${appUrl}/join/${inv.inviteToken}` : null}
                  />
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      {open && <Drawer person={open} appUrl={appUrl} caps={caps} self={self} onClose={() => setOpen(null)} />}
    </>
  );
}
