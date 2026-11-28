/*
 * OrcaMediaPlugin.java
 * Capacitor bridge for native media-playback keep-alive. The web player calls
 * start()/update() whenever a track loads or play state changes, and stop()
 * when playback ends. The plugin starts the MediaPlaybackService foreground
 * service (partial wake lock + MediaSessionCompat + media notification) and
 * relays lock-screen/notification commands back to the web layer as
 * window events ("orcamedia").
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
        MediaPlaybackService.setEmitter(json ->
            getBridge().triggerWindowJSEvent("orcamedia", json));
    }

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
}
