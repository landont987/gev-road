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

        web = createWeb();
    }

    /** The scanner page's WebView. Built again after its renderer dies. */
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
            public boolean onRenderProcessGone(WebView v, RenderProcessGoneDetail detail) {
                // Low memory killed the renderer. Without this the whole app would die;
                // instead the drawer closes and gets a fresh WebView for next time.
                Log.w(TAG, "Radio renderer gone, crashed=" + detail.didCrash());
                replaceWeb();
                return true;
            }
        });
        root.addView(view, new LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, 0, 1f));
        return view;
    }

    private void replaceWeb() {
        root.removeView(web);
        web.destroy();
        web = createWeb();
        root.setVisibility(View.GONE);
        report(0);
        if (onClosed != null) onClosed.run();
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
        setFolded(false);
        root.setVisibility(View.VISIBLE);
        web.loadUrl(url);
    }

    void close() {
        web.loadUrl(BLANK);
        root.setVisibility(View.GONE);
        report(0);
        if (onClosed != null) onClosed.run();
    }

    boolean isOpen() {
        return root.getVisibility() == View.VISIBLE;
    }

    void pause() {
        // Keep the audio going when the screen is off; only release on destroy.
    }

    void destroy() {
        root.removeView(web);
        web.destroy();
    }

    private void setFolded(boolean fold) {
        folded = fold;
        web.setVisibility(fold ? View.GONE : View.VISIBLE);
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
        String url = web.getUrl();
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
