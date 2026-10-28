import UserDetailClient from "./UserDetailClient";

export const metadata = { title: "User — SwiftCard Admin" };

// ?tab=cards|contacts|plan|referrals opens that tab of the user's page.
export default async function AdminUserDetailPage({ params, searchParams }: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { id } = await params;
  const { tab } = await searchParams;
  return <UserDetailClient userId={id} initialTab={tab} />;
}
