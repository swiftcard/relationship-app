package me.swiftcard.app;

import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;

import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * The Android road back from "Notifications are off for SwiftCard".
 *
 * iOS gets there with window.location = "app-settings:" (EnablePushButton).
 * Android has no URL for it — Capacitor hands non-http schemes to ACTION_VIEW,
 * and nothing answers that for a settings screen — so the web layer calls
 * Capacitor.Plugins.AppSettings.openNotificationSettings() instead
 * (src/lib/app-settings.ts). It takes no input from web content: it can only
 * ever open SwiftCard's own notification page, so there is nothing to
 * allow-list.
 *
 * Registered in MainActivity.onCreate — an app-local plugin is never
 * discovered on its own.
 */
@CapacitorPlugin(name = "AppSettings")
public class AppSettingsPlugin extends Plugin {

    @PluginMethod
    public void openNotificationSettings(PluginCall call) {
        String pkg = getContext().getPackageName();
        Intent intent;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            intent = new Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS)
                    .putExtra(Settings.EXTRA_APP_PACKAGE, pkg);
        } else {
            intent = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:" + pkg));
        }
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        try {
            getContext().startActivity(intent);
            call.resolve();
        } catch (Exception e) {
            // Some OEM builds drop the notification screen; the app details
            // page always exists and has Notifications one tap away.
            try {
                Intent fallback = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:" + pkg))
                        .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                getContext().startActivity(fallback);
                call.resolve();
            } catch (Exception again) {
                call.reject("Could not open settings", again);
            }
        }
    }
}
