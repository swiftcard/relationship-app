import { cookies, headers } from "next/headers";
import type { ReactNode } from "react";
import { isNativeRequest } from "@/lib/native-request";
import NativeRequestProvider from "@/components/NativeRequestProvider";

// The server's answer to "is this the app?", handed to every gate below it
// (components/NativeRequestProvider, audit NS-04). It reads the request, so it
// belongs only on screens that are dynamic anyway — the signed-in app screens.
// Never in the root layout: that would make every marketing page dynamic (the
// same reason NativeSplash lives in the dashboard layout, not the root one).
export default async function NativeRequestBoundary({ children }: { children: ReactNode }) {
  const [h, c] = await Promise.all([headers(), cookies()]);
  const native = isNativeRequest(h.get("user-agent"), c.get("sc_shell")?.value ?? null);
  return <NativeRequestProvider native={native}>{children}</NativeRequestProvider>;
}
