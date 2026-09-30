package me.swiftcard.app;

import android.content.Intent;
import android.net.Uri;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.util.Arrays;
import java.util.List;
import java.util.Locale;

/**
 * The Android half of lib/external-purchase.ts — the one way a link leaves the
 * app entirely.
 *
 * ⚠️ THE CLASS NAME IS A COMPATIBILITY ARTEFACT, NOT A DESCRIPTION.
 * It matches ios/App/App/ExternalPurchase.swift so the web layer can call
 * Capacitor.Plugins.ExternalPurchase on both platforms with no branch. On iOS
 * that plugin exists to satisfy App Review Guideline 3.1.1, whose US-storefront
 * carve-out lets the app link out to the default browser for payment. Android
 * has no such rule and no such permission: an in-app link to a web checkout is
 * what Google Play calls steering. THE ANDROID APP MUST NEVER SURFACE A
 * PURCHASE LINK THROUGH THIS PLUGIN — lib/external-purchase.ts keeps
 * canOfferExternalPurchase() iOS-only for exactly that reason, and
 * tests/android-no-selling.test.ts fails if that changes.
 *
 * What it IS for on Android: handing a card or Swift Links page that reached
 * the app back to the real browser. Owner, 2026-09-29: a SwiftCard link
 * someone sends you must never render inside the app, on a public page with no
 * chrome and no way out.
 *
 * A Chrome Custom Tab was the obvious shortcut here and is deliberately not
 * used: it is still an overlay within this app's task, which is the thing the
 * rule above forbids. ACTION_VIEW hands the link to whichever browser the
 * person actually uses, which is what the iOS side does with
 * UIApplication.open.
 */
@CapacitorPlugin(name = "ExternalPurchase")
public class ExternalPurchasePlugin extends Plugin {

    /**
     * Same allow-list as the iOS plugin, and it is a security boundary rather
     * than tidiness: this method takes a URL from web content and asks the OS
     * to open it, so without it any script that reached the webview could
     * launch an arbitrary intent. play.google.com is listed for the store
     * links a future Play build will need; apps.apple.com is deliberately
     * absent, because nothing on Android should ever be sent to the App Store.
     */
    private static final List<String> ALLOWED_HOSTS = Arrays.asList(
            "swiftcard.me",
            "www.swiftcard.me",
            "play.google.com"
    );

    @PluginMethod
    public void open(PluginCall call) {
        String url = call.getString("url");
        JSObject result = new JSObject();

        if (url == null || url.isEmpty()) {
            result.put("opened", false);
            call.resolve(result);
            return;
        }

        Uri uri = Uri.parse(url);
        String scheme = uri.getScheme() == null ? "" : uri.getScheme().toLowerCase(Locale.ROOT);
        String host = uri.getHost() == null ? "" : uri.getHost().toLowerCase(Locale.ROOT);

        if (!"https".equals(scheme) || !ALLOWED_HOSTS.contains(host)) {
            result.put("opened", false);
            call.resolve(result);
            return;
        }

        try {
            Intent intent = new Intent(Intent.ACTION_VIEW, uri);
            // The activity is started from outside an Activity context's task
            // stack, so this flag is required or the launch throws.
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            // CATEGORY_BROWSABLE plus the https scheme keeps this to browsers.
            // Without it, our OWN swiftcard:// filter could be offered as a
            // handler and the link would bounce straight back into the app.
            intent.addCategory(Intent.CATEGORY_BROWSABLE);

            if (intent.resolveActivity(getContext().getPackageManager()) == null) {
                // No browser at all. Report it honestly rather than resolving
                // true and leaving the caller thinking the link was handed off:
                // the web side renders a real failure when this is false.
                result.put("opened", false);
                call.resolve(result);
                return;
            }

            getContext().startActivity(intent);
            result.put("opened", true);
            call.resolve(result);
        } catch (Exception e) {
            result.put("opened", false);
            call.resolve(result);
        }
    }
}
