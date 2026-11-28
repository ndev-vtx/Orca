package com.orca.music;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    /*
     * Desktop Chrome user agent for the WebView: YouTube serves the same
     * IFrame player to desktop browsers and no mobile-embed restrictions
     * ("playback on other websites has been disabled" style limits) trigger
     * for mobile user agents. The OrcaPlayer marker lets us avoid re-setting
     * it on every onCreate.
     */
    private static final String DESKTOP_UA =
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
            + "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 OrcaPlayer/1.0";

    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(OrcaPermissionsPlugin.class);
        registerPlugin(OrcaMediaPlugin.class);
        super.onCreate(savedInstanceState);
        applyKeepAlive();
    }

    /*
     * Background-audio keep-alive hardening (WebView sink fallback path):
     *  - desktop Chrome UA (above) avoids mobile embed restrictions;
     *  - Android pauses WebView timers on lifecycle transitions, which stalls
     *    the YouTube IFrame player as soon as the screen locks or the user
     *    switches apps — re-resume the timers on every transition;
     *  - the web layer additionally pins document.visibilityState to "visible"
     *    and swallows visibilitychange (frontend/index.html inline script,
     *    re-injected on every page load).
     * The primary native path (ExoPlayer inside MediaPlaybackService) does
     * not depend on any of this — it is immune to WebView suspension.
     */
    private void applyKeepAlive() {
        if (bridge == null || bridge.getWebView() == null) return;
        try {
            String ua = bridge.getWebView().getSettings().getUserAgentString();
            if (ua == null || !ua.contains("OrcaPlayer")) {
                bridge.getWebView().getSettings().setUserAgentString(DESKTOP_UA);
            }
        } catch (Exception ignored) {
            /* UA hardening is best-effort */
        }
    }

    @Override
    public void onResume() {
        super.onResume();
        if (bridge != null && bridge.getWebView() != null) {
            bridge.getWebView().onResume();
            bridge.getWebView().resumeTimers();
        }
    }

    @Override
    public void onPause() {
        super.onPause();
        if (bridge != null && bridge.getWebView() != null) {
            bridge.getWebView().onResume();
            bridge.getWebView().resumeTimers();
        }
    }

    @Override
    public void onStop() {
        super.onStop();
        if (bridge != null && bridge.getWebView() != null) {
            bridge.getWebView().onResume();
            bridge.getWebView().resumeTimers();
        }
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (!hasFocus && bridge != null && bridge.getWebView() != null) {
            bridge.getWebView().resumeTimers();
        }
    }
}
