package com.landon.gevroad;

import android.app.Activity;
import android.content.Intent;
import android.graphics.Color;
import android.graphics.Typeface;
import android.net.Uri;
import android.util.Log;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.View;
import android.webkit.CookieManager;
import android.webkit.RenderProcessGoneDetail;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.TextView;

import java.util.function.IntConsumer;

/**
 * The radio drawer: a second WebView docked at the bottom of the screen that
 * shows a public scanner page (Broadcastify or OpenMHz) exactly as the site
 * serves it. The page keeps its own player, ads and terms; this app only
 * gives it a window. HIDE folds the drawer to its title bar and the audio
 * keeps playing; STOP unloads the page.
 */
final class RadioDrawer {
    private static final String TAG = "GevRadio";
    private static final String BLANK = "about:blank";
    private static final float DRAWER_SHARE = 0.46f; // of the screen height
    private static final int BAR_DP = 64;
    private static final int LEFT_CLEAR_DP = 96; // the page's zoom and menu buttons
    private static final int RIGHT_CLEAR_DP = 152; // the page's button rail
    /**
     * A Broadcastify feed page puts its player below the site header, out of
     * the drawer's short view (#14). This scrolls the page so the "Live Audio"
     * panel sits just under the site's sticky top bar, once the player is
     * built (it is drawn by their script, so it tries for up to 10 s). On an
     * Android browser the page also slides up its own "Squawster" app banner,
     * which covered the play button; the script presses that banner's own
     * dismiss button once (the site remembers it for 90 days), as the driver
     * would. Since October 2026 listening needs a free Broadcastify account:
     * a guest's play opens their "Sign in to listen" box, pinned with CSS
     * `inset: 0`, which WebView 66 does not know, so the box sat below the
     * page where it could not be reached. The script gives that one box
     * top/right/bottom/left 0 (what `inset: 0` means) when it opens.
     * It only scrolls and dismisses: the audio stays in their player.
     */
    static final String SHOW_PLAYER_JS = "(function(){if(window.__gevPlayer)return;window.__gevPlayer=1;var tries=0;"
            + "setInterval(function(){var a=document.getElementById('lp-auth-modal');"
            + "if(a&&!a.hidden&&a.style.top!=='0px'){a.style.top='0';a.style.right='0';a.style.bottom='0';a.style.left='0';}},500);"
            + "function go(){"
            + "var x=document.querySelector('#portalAppBanner:not([hidden]) .portal-app-banner-close');"
            + "if(x)x.click();"
            + "var m=document.getElementById('listenPlayerMount');"
            + "if(m&&m.offsetHeight>0){var p=m;"
            + "while(p&&p!==document.body&&!/(^|\\s)listen-panel(\\s|$)/.test(p.className))p=p.parentNode;"
            + "if(!p||p===document.body)p=m;"
            + "var bar=document.querySelector('.portalv2-topbar');"
            + "var top=p.getBoundingClientRect().top+window.pageYOffset-(bar?bar.offsetHeight:0)-4;"
            + "window.scrollTo(0,Math.max(0,top));return;}"
            + "if(++tries<20)setTimeout(go,500);}go();})();";

    private final Activity activity;
    private final LinearLayout root;
    private final TextView title;
    private final Button hideButton;
    private WebView web;
    private boolean folded;
    private Runnable onClosed;
    private IntConsumer onLayout; // drawer height in CSS px, 0 when closed

    RadioDrawer(Activity activity) {
        this.activity = activity;
        root = new LinearLayout(activity);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setBackgroundColor(Color.parseColor("#0f161e"));
        root.setVisibility(View.GONE);

        LinearLayout bar = new LinearLayout(activity);
        bar.setOrientation(LinearLayout.HORIZONTAL);
        bar.setGravity(Gravity.CENTER_VERTICAL);
        bar.setBackgroundColor(Color.parseColor("#16212c"));
        int pad = dp(10);
        bar.setPadding(pad, pad, pad, pad);

        title = new TextView(activity);
        title.setTextColor(Color.parseColor("#e8eef4"));
        title.setTextSize(TypedValue.COMPLEX_UNIT_SP, 18);
        title.setTypeface(Typeface.DEFAULT_BOLD);
        title.setSingleLine(true);
        bar.addView(title, new LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f));

        hideButton = barButton("HIDE");
        hideButton.setOnClickListener(v -> setFolded(!folded));
        bar.addView(hideButton);

        Button open = barButton("BROWSER");
        open.setOnClickListener(v -> openInBrowser());
        bar.addView(open);

        Button stop = barButton("STOP");
        stop.setOnClickListener(v -> close());
        bar.addView(stop);

        root.addView(bar, new LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, dp(BAR_DP)));
        // The WebView is built on the first open and destroyed on STOP (#60): a drawer
        // nobody opened costs nothing, and a stopped one gives its memory back.
    }

    /** The scanner page's WebView, built on open. */
    private WebView createWeb() {
        WebView view = new WebView(activity);
        WebSettings settings = view.getSettings();
        settings.setJavaScriptEnabled(true); // their players need it
        settings.setDomStorageEnabled(true);
        settings.setMediaPlaybackRequiresUserGesture(true); // the driver presses play on their page
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(false);
        view.setBackgroundColor(Color.parseColor("#0f161e"));
        view.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView v, WebResourceRequest request) {
                // Stay on the scanner sites; anything else (ads, store links) goes to the unit's browser.
                Uri url = request.getUrl();
                String host = url.getHost() == null ? "" : url.getHost();
                if (isScannerHost(host)) return false;
                openExternal(url);
                return true;
            }

            @Override
            public void onPageFinished(WebView v, String url) {
                Uri uri = Uri.parse(url);
                String host = uri.getHost() == null ? "" : uri.getHost();
                if (host.equals("broadcastify.com") || host.endsWith(".broadcastify.com")) {
                    v.evaluateJavascript(SHOW_PLAYER_JS, null);
                }
            }

            @Override
            public boolean onRenderProcessGone(WebView v, RenderProcessGoneDetail detail) {
                // Low memory killed the renderer, which the map page shares. Without this the
                // whole app would die; instead the drawer drops its WebView (a new one is built
                // on the next open). The page callbacks are posted, so the activity's own
                // handler runs first and the dead map WebView is never called.
                Log.w(TAG, "Radio renderer gone, crashed=" + detail.didCrash());
                dropWeb();
                root.setVisibility(View.GONE);
                root.post(() -> {
                    report(0);
                    if (onClosed != null) onClosed.run();
                });
                return true;
            }
        });
        root.addView(view, new LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, 0, 1f));
        return view;
    }

    private void dropWeb() {
        if (web == null) return;
        root.removeView(web);
        web.destroy();
        web = null;
    }

    /** The view to add to the activity's layout, docked at the bottom. */
    View view() {
        return root;
    }

    /** Docked at the bottom, between the page's corner buttons and its button rail. */
    FrameLayout.LayoutParams layoutParams() {
        FrameLayout.LayoutParams lp = new FrameLayout.LayoutParams(
                screenWidth() - dp(LEFT_CLEAR_DP) - dp(RIGHT_CLEAR_DP), openHeight());
        lp.gravity = Gravity.BOTTOM | Gravity.START;
        lp.leftMargin = dp(LEFT_CLEAR_DP);
        return lp;
    }

    void setOnClosed(Runnable r) {
        onClosed = r;
    }

    void setOnLayout(IntConsumer r) {
        onLayout = r;
    }

    void open(String url, String name) {
        Uri uri = Uri.parse(url);
        String host = uri.getHost() == null ? "" : uri.getHost();
        if (!"https".equals(uri.getScheme()) || !isScannerHost(host)) {
            Log.w(TAG, "Refused radio url " + url);
            return;
        }
        title.setText(name);
        if (web == null) web = createWeb();
        setFolded(false);
        root.setVisibility(View.VISIBLE);
        web.loadUrl(url);
    }

    void close() {
        dropWeb(); // their page and its caches go with it; the sign-in cookie stays (CookieManager)
        root.setVisibility(View.GONE);
        report(0);
        if (onClosed != null) onClosed.run();
    }

    boolean isOpen() {
        return root.getVisibility() == View.VISIBLE;
    }

    void pause() {
        // Keep the audio going when the screen is off; only release on destroy.
        // Save cookies now, so a Broadcastify sign-in in the drawer survives the app being killed.
        CookieManager.getInstance().flush();
    }

    void destroy() {
        dropWeb();
    }

    private void setFolded(boolean fold) {
        folded = fold;
        if (web != null) web.setVisibility(fold ? View.GONE : View.VISIBLE);
        hideButton.setText(fold ? "SHOW" : "HIDE");
        // Folded: the drawer is just its bar, so the map gets the room back.
        int height = fold ? dp(BAR_DP) : openHeight();
        root.getLayoutParams().height = height;
        root.requestLayout();
        report(height);
    }

    private int openHeight() {
        return Math.round(screenHeight() * DRAWER_SHARE);
    }

    /** Tell the page how tall the drawer is, in its own CSS pixels. */
    private void report(int heightPx) {
        if (onLayout == null) return;
        float density = activity.getResources().getDisplayMetrics().density;
        onLayout.accept(Math.round(heightPx / density));
    }

    private int screenWidth() {
        return activity.getResources().getDisplayMetrics().widthPixels;
    }

    private void openInBrowser() {
        String url = web == null ? null : web.getUrl();
        if (url == null || BLANK.equals(url)) return;
        openExternal(Uri.parse(url));
    }

    private void openExternal(Uri url) {
        try {
            activity.startActivity(new Intent(Intent.ACTION_VIEW, url));
        } catch (RuntimeException e) {
            Log.w(TAG, "No browser for " + url, e);
        }
    }

    /** The two scanner sites and their subdomains, nothing that merely ends in their name. */
    private static boolean isScannerHost(String host) {
        for (String domain : new String[] {"broadcastify.com", "openmhz.com"}) {
            if (host.equals(domain) || host.endsWith("." + domain)) return true;
        }
        return false;
    }

    private int screenHeight() {
        return activity.getResources().getDisplayMetrics().heightPixels;
    }

    private Button barButton(String label) {
        Button b = new Button(activity);
        b.setText(label);
        b.setAllCaps(true);
        b.setTextColor(Color.parseColor("#e8eef4"));
        b.setBackgroundColor(Color.parseColor("#1d2b38"));
        b.setTextSize(TypedValue.COMPLEX_UNIT_SP, 14);
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(dp(96), dp(48));
        lp.leftMargin = dp(8);
        b.setLayoutParams(lp);
        return b;
    }

    private int dp(int value) {
        return Math.round(TypedValue.applyDimension(
                TypedValue.COMPLEX_UNIT_DIP, value, activity.getResources().getDisplayMetrics()));
    }
}
