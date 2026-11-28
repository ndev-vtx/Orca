package com.orca.music;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(OrcaPermissionsPlugin.class);
        registerPlugin(OrcaMediaPlugin.class);
        super.onCreate(savedInstanceState);
    }

    /*
     * Background-audio keep-alive: Android pauses WebView timers when the
     * Activity pauses/stops, which stalls the YouTube IFrame player as soon
     * as the screen locks or the user switches apps. Re-resuming the timers
     * on every lifecycle transition keeps the audio decoding; the web layer
     * additionally pins document.visibilityState to "visible" (see index.html)
     * so the YouTube player never treats the app as hidden.
     */
    @Override
    public void onPause() {
        super.onPause();
        if (bridge != null && bridge.getWebView() != null) {
            bridge.getWebView().resumeTimers();
        }
    }

    @Override
    public void onStop() {
        super.onStop();
        if (bridge != null && bridge.getWebView() != null) {
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
