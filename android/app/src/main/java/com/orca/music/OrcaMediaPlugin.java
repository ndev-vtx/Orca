/*
 * OrcaMediaPlugin.java
 * Capacitor bridge for Orca's native audio + media-notification layer.
 *
 *   - start/update/stop: foreground MediaPlaybackService lifecycle for the
 *     media notification + wake lock (WebView sink path).
 *   - nativeLoad/nativePlay/nativePause/nativeSeek/nativeStop/nativeVolume:
 *     direct control of the Media3/ExoPlayer instance that lives INSIDE the
 *     foreground service (native sink path). Playing the resolved stream
 *     URL natively means Android cannot suspend audio when the screen locks
 *     or the app is backgrounded.
 *
 * Service events are relayed to the web layer as window events:
 *   - {"kind":"cmd",...}        -> "orcamedia"  (notification buttons)
 *   - {"kind":"audio",...}      -> "orcaaudio" (native player state)
 */
package com.orca.music;

import android.content.Intent;

import androidx.core.content.ContextCompat;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "OrcaMedia")
public class OrcaMediaPlugin extends Plugin {

    @Override
    public void load() {
        MediaPlaybackService.setEmitter(json -> {
            String event = json != null && json.contains("\"kind\":\"audio\"")
                ? "orcaaudio"
                : "orcamedia";
            getBridge().triggerWindowJSEvent(event, json);
        });
    }

    /* ------------------- foreground service (notification) ---------------- */

    @PluginMethod
    public void start(PluginCall call) {
        String title = call.getString("title", "Orca");
        String artist = call.getString("artist", "");
        String playing = call.getBoolean("playing", false) ? "true" : "false";
        if (MediaPlaybackService.isRunning()) {
            MediaPlaybackService.updateInstance(title, artist, playing);
            call.resolve();
            return;
        }
        Intent intent = new Intent(getContext(), MediaPlaybackService.class)
            .putExtra("title", title)
            .putExtra("artist", artist)
            .putExtra("playing", playing);
        try {
            ContextCompat.startForegroundService(getContext(), intent);
            call.resolve();
        } catch (Exception ex) {
            call.reject("could not start media service", ex);
        }
    }

    @PluginMethod
    public void update(PluginCall call) {
        MediaPlaybackService.updateInstance(
            call.getString("title", "Orca"),
            call.getString("artist", ""),
            call.getBoolean("playing", false) ? "true" : "false");
        call.resolve();
    }

    @PluginMethod
    public void stop(PluginCall call) {
        getContext().stopService(new Intent(getContext(), MediaPlaybackService.class));
        call.resolve();
    }

    /* ------------------------ native sink (ExoPlayer) --------------------- */

    @PluginMethod
    public void nativeLoad(PluginCall call) {
        String url = call.getString("url", "");
        if (url.isEmpty()) {
            call.reject("url required");
            return;
        }
        long resumeMs = call.getDouble("resumeMs") == null
            ? 0L
            : (long) (double) call.getDouble("resumeMs");
        if (MediaPlaybackService.isRunning()) {
            MediaPlaybackService.running().nativeLoad(url, resumeMs);
            call.resolve();
            return;
        }
        Intent intent = new Intent(getContext(), MediaPlaybackService.class)
            .setAction(MediaPlaybackService.ACTION_NATIVE_LOAD)
            .putExtra("url", url)
            .putExtra("resumeMs", resumeMs)
            .putExtra("title", call.getString("title", "Orca"))
            .putExtra("artist", call.getString("artist", ""));
        try {
            ContextCompat.startForegroundService(getContext(), intent);
            call.resolve();
        } catch (Exception ex) {
            call.reject("could not start media service", ex);
        }
    }

    @PluginMethod
    public void nativePlay(PluginCall call) {
        if (MediaPlaybackService.isRunning()) MediaPlaybackService.running().nativePlay();
        call.resolve();
    }

    @PluginMethod
    public void nativePause(PluginCall call) {
        if (MediaPlaybackService.isRunning()) MediaPlaybackService.running().nativePause();
        call.resolve();
    }

    @PluginMethod
    public void nativeSeek(PluginCall call) {
        Double ms = call.getDouble("positionMs");
        if (ms != null && MediaPlaybackService.isRunning()) {
            MediaPlaybackService.running().nativeSeek((long) (double) ms);
        }
        call.resolve();
    }

    @PluginMethod
    public void nativeStop(PluginCall call) {
        if (MediaPlaybackService.isRunning()) MediaPlaybackService.running().nativeStop();
        call.resolve();
    }

    @PluginMethod
    public void nativeVolume(PluginCall call) {
        Double volume = call.getDouble("volume");
        if (volume != null && MediaPlaybackService.isRunning()) {
            MediaPlaybackService.running().nativeSetVolume((float) (double) volume);
        }
        call.resolve();
    }
}
