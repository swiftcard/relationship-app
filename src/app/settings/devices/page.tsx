import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase-server";
import { DEVICE_COOKIE, isDeviceId } from "@/lib/device";
import DeviceManager, { type DeviceRow } from "@/components/DeviceManager";
import { SwiftCardIcon } from "@/components/SwiftCardLogo";

// Where a third device lands, and where anyone manages the two they have.
//
// Deliberately NOT inside SettingsShell. The proxy exempts this one path from
// the device check precisely so a blocked device can reach it — wrapping it in
// the settings chrome would drag in navigation to places that device cannot go,
// and offer a way out of the only screen that can let it back in.
export const dynamic = "force-dynamic";

export default async function DevicesPage({
  searchParams,
}: {
  searchParams: Promise<{ full?: string }>;
}) {
  const { full } = await searchParams;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data } = await supabase
    .from("user_devices")
    .select("device_id, label, is_native, first_seen, last_seen")
    .order("last_seen", { ascending: false });

  const jar = await cookies();
  const raw = jar.get(DEVICE_COOKIE)?.value;
  const currentDeviceId = isDeviceId(raw) ? raw : null;

  return (
    <main className="sc-app min-h-screen bg-gray-950 px-5 py-10 flex flex-col">
      <div className="max-w-md mx-auto w-full">
        <div className="flex items-center gap-2.5 mb-7">
          <span className="shrink-0 rounded-lg overflow-hidden flex"><SwiftCardIcon size={30} /></span>
          <span className="text-white font-bold text-[1.0625rem]">SwiftCard</span>
        </div>
        <h1 className="text-white font-extrabold text-[1.5rem] leading-tight mb-1.5">Your devices</h1>
      </div>

      <DeviceManager
        devices={(data ?? []) as DeviceRow[]}
        currentDeviceId={currentDeviceId}
        full={full === "1"}
      />

      {full !== "1" && (
        <div className="max-w-md mx-auto w-full mt-8">
          <Link href="/dashboard" className="text-gray-400 hover:text-white text-[0.875rem] transition-colors">
            ← Back to dashboard
          </Link>
        </div>
      )}
    </main>
  );
}
