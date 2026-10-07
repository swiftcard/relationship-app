import { detectNativeApp, detectNativePlatform } from "@/lib/platform";

// Opening SwiftCard's own notification settings from inside the app — the only
// road back after the phone said "Don't Allow".
//
//   iOS      "app-settings:" (UIApplication.openSettingsURLString); Capacitor
//            hands a non-http scheme to the system.
//   Android  no URL exists for it, so a small app-local plugin fires
//            ACTION_APP_NOTIFICATION_SETTINGS
//            (android/app/src/main/java/me/swiftcard/app/AppSettingsPlugin.java).
//            Builds before 1.0.1 do not have it — `false` tells the caller to
//            lean on the written path instead.

type AppSettingsPlugin = { openNotificationSettings: () => Promise<void> };

// Android is detected positively (androidBridge / getPlatform); any other
// native shell is the iPhone app — including an older one that exposes no
// getPlatform, which detectNativeApp() still answers "yes" for.
function platform(): "ios" | "android" | null {
  const p = detectNativePlatform();
  if (p) return p;
  return detectNativeApp() ? "ios" : null;
}

export function canOpenAppSettings(): boolean {
  const p = platform();
  if (p === "ios") return true;
  if (p === "android") return !!androidPlugin();
  return false;
}

export function openAppNotificationSettings(): boolean {
  const p = platform();
  try {
    if (p === "ios") {
      window.location.href = "app-settings:";
      return true;
    }
    const plugin = p === "android" ? androidPlugin() : undefined;
    if (plugin) {
      void plugin.openNotificationSettings().catch(() => {});
      return true;
    }
  } catch { /* ignore */ }
  return false;
}

function androidPlugin(): AppSettingsPlugin | undefined {
  if (typeof window === "undefined") return undefined;
  return (window as unknown as { Capacitor?: { Plugins?: { AppSettings?: AppSettingsPlugin } } })
    .Capacitor?.Plugins?.AppSettings;
}
