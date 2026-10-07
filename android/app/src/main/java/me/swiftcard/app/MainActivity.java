package me.swiftcard.app;

import android.os.Bundle;
import android.view.View;
import android.webkit.CookieManager;
import android.webkit.WebView;

import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowInsetsCompat;

import com.getcapacitor.BridgeActivity;
import com.getcapacitor.WebViewListener;

/**
 * The Android twin of ios/App/App/MainViewController.swift.
 *
 * This is a REMOTE-URL shell: the webview loads https://swiftcard.me/dashboard
 * and everything the person sees is the live site. That makes the native half
 * small, but two of the things it does are not optional — without them the app
 * signs people out at random and draws its header behind the clock.
 */
public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        // BEFORE super.onCreate, and not optional: Capacitor builds its plugin
        // registry from capacitor.plugins.json, which `cap sync` generates from
        // INSTALLED NPM PACKAGES only. An app-local plugin class is never
        // discovered on its own — the iOS side hits the same wall and answers
        // it with registerPluginInstance in MainViewController.swift. Miss this
        // and the plugin is simply undefined in JS, with no error anywhere.
        registerPlugin(ExternalPurchasePlugin.class);
        registerPlugin(AppSettingsPlugin.class);
        super.onCreate(savedInstanceState);
        applyWindowInsets();

        // RE-APPLY ON EVERY PAGE LOAD. The inline style below lives on the
        // <html> element of ONE document, and this is a remote-URL shell that
        // does real page loads — so every navigation to a new server-rendered
        // page throws the insets away and the chrome jumps back under the
        // status bar. The listener above only fires when the insets CHANGE,
        // which a navigation is not, so ask for them again explicitly.
        // ios/App/App/MainViewController.swift re-applies its own platform
        // flags on every navigation for exactly this reason.
        getBridge().addWebViewListener(new WebViewListener() {
            @Override
            public void onPageLoaded(WebView webView) {
                ViewCompat.requestApplyInsets(webView);
            }
        });
    }

    /**
     * FLUSH COOKIES WHEN THE APP GOES TO THE BACKGROUND.
     *
     * Android's WebView keeps cookies in memory and gives no guarantee they
     * reach disk before the process is killed — and Android kills backgrounded
     * processes routinely, without warning. The Supabase session lives in a
     * cookie, so without this an ordinary "app was swiped away, or the system
     * reclaimed memory" turns into "SwiftCard logged me out again", with
     * nothing in any log to explain it and no way to reproduce it on demand.
     *
     * iOS has no equivalent because WKWebView persists its own cookie store.
     */
    @Override
    public void onPause() {
        super.onPause();
        CookieManager.getInstance().flush();
    }

    /**
     * HAND THE PAGE THE SAFE-AREA NUMBERS, BECAUSE IT CANNOT READ THEM ITSELF.
     *
     * The web layer is built edge-to-edge and positions its glass chrome from
     * env(safe-area-inset-*). In an Android WebView those commonly compute to
     * 0 even while the page really is drawn under the status bar and the
     * gesture pill — and from targetSdk 35 Android forces edge-to-edge, so the
     * header lands behind the clock and the bottom tab bar behind the pill.
     *
     * This is the mirror image of the iOS problem that produced "a white bar
     * under the clock on every screen", and it gets the same kind of answer:
     * the page owns the whole canvas, and the native side tells it the one
     * number it has no way to work out. The values are written as the same
     * custom properties globals.css already reads
     * (--sc-inset-top/bottom/left/right), as an inline style on <html>, which
     * outranks the stylesheet's env() defaults. iOS never runs this code, so
     * env() stays authoritative there and nothing about the iPhone app or the
     * website changes.
     *
     * Re-applied on every inset change rather than once at startup: rotation,
     * a keyboard, a call banner and split-screen all move these numbers.
     */
    private void applyWindowInsets() {
        final WebView webView = getBridge().getWebView();
        if (webView == null) return;

        ViewCompat.setOnApplyWindowInsetsListener(webView, (View v, WindowInsetsCompat insets) -> {
            Insets bars = insets.getInsets(
                    WindowInsetsCompat.Type.systemBars() | WindowInsetsCompat.Type.displayCutout());
            float density = getResources().getDisplayMetrics().density;
            if (density <= 0) density = 1f;

            // CSS pixels, not device pixels: the webview's viewport is in CSS
            // pixels, so handing it raw insets would over-pad by the density
            // factor — roughly three times too much on a modern phone.
            final String js =
                    "(function(d){var s=d.documentElement.style;"
                            + "s.setProperty('--sc-inset-top','" + (bars.top / density) + "px');"
                            + "s.setProperty('--sc-inset-bottom','" + (bars.bottom / density) + "px');"
                            + "s.setProperty('--sc-inset-left','" + (bars.left / density) + "px');"
                            + "s.setProperty('--sc-inset-right','" + (bars.right / density) + "px');"
                            + "})(document);";
            webView.evaluateJavascript(js, null);

            // Return the insets unconsumed: this listener only observes them,
            // and swallowing them would stop anything else from laying out.
            return insets;
        });
    }
}
