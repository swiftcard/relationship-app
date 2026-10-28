import UsersClient from "./UsersClient";

export const metadata = { title: "Users — SwiftCard Admin" };

// ?tab=free|pro|office|closed opens that list; ?create=1 opens Create card
// (the Overview's shortcut).
export default async function AdminUsersPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  return <UsersClient initialTab={sp.tab} openCreate={sp.create === "1"} />;
}
