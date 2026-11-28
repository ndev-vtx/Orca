/*
 * MediaPlaybackService.java
 * Foreground media-playback service for Orca's Android APK.
 *
 * The music itself streams in the WebView (YouTube IFrame player). This
 * service exists purely to keep the process alive and the OS media surface
 * healthy when the screen locks or the app is backgrounded:
 *   - runs as a foreground service with foregroundServiceType="mediaPlayback"
 *   - holds a partial PowerManager.WakeLock (CPU stays on for decoding)
 *   - publishes an active MediaSessionCompat so lock-screen / notification
 *     controls (prev / play-pause / next) appear and work
 *   - shows a persistent media-style notification while audio plays
 *
 * Commands from the notification/session are relayed to the web layer as
 * window events ("orcamedia") via the emitter the OrcaMedia plugin installs;
 * the web player performs the actual play/pause/skip in the WebView.
 */
package com.orca.music;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.os.Build;
import android.os.IBinder;
import android.os.PowerManager;
import android.support.v4.media.MediaMetadataCompat;
import android.support.v4.media.session.MediaSessionCompat;
import android.support.v4.media.session.PlaybackStateCompat;

import androidx.core.app.NotificationCompat;

import android.net.Uri;
import android.os.Handler;
import android.os.Looper;

import androidx.media3.common.AudioAttributes;
import androidx.media3.common.C;
import androidx.media3.common.MediaItem;
import androidx.media3.common.PlaybackException;
import androidx.media3.common.Player;
import androidx.media3.exoplayer.ExoPlayer;

public class MediaPlaybackService extends Service {

    public static final String CHANNEL_ID = "orca_playback";
    public static final int NOTIFICATION_ID = 4264;

    public static final String ACTION_PLAYPAUSE = "com.orca.music.MEDIA_PLAYPAUSE";
    public static final String ACTION_NEXT = "com.orca.music.MEDIA_NEXT";
    public static final String ACTION_PREV = "com.orca.music.MEDIA_PREV";
    public static final String ACTION_NATIVE_LOAD = "com.orca.music.NATIVE_LOAD";
    public static final String ACTION_NATIVE_PLAY = "com.orca.music.NATIVE_PLAY";
    public static final String ACTION_NATIVE_PAUSE = "com.orca.music.NATIVE_PAUSE";

    /** Web-command relay, installed by OrcaMediaPlugin (bridge -> window event). */
    public interface Emitter {
        void emit(String json);
    }

    private static volatile Emitter emitter;

    public static void setEmitter(Emitter e) {
        emitter = e;
    }

    private static MediaPlaybackService instance;

    private MediaSessionCompat session;
    private PowerManager.WakeLock wakeLock;
    private String title = "Orca";
    private String artist = "";
    private String playing = "false";

    /*
     * Native audio sink (Media3 / ExoPlayer). When the web layer hands the
     * service a direct stream URL, playback runs HERE — inside the foreground
     * service — so Android cannot suspend it when the screen locks or the app
     * is backgrounded (WebView/iframe audio gets suspended; this does not).
     * Position/duration/state stream back to the web UI as "orcaaudio"
     * window events relayed by OrcaMediaPlugin.
     */
    private ExoPlayer player;
    private final Handler mainHandler = new Handler(Looper.getMainLooper());
    private boolean progressTicking = false;

    @Override
    public void onCreate() {
        super.onCreate();
        createChannel();
        instance = this;

        session = new MediaSessionCompat(this, "OrcaPlayback");
        session.setCallback(new MediaSessionCompat.Callback() {
            @Override public void onPlay() { emitCommand("playpause"); }
            @Override public void onPause() { emitCommand("playpause"); }
            @Override public void onSkipToNext() { emitCommand("next"); }
            @Override public void onSkipToPrevious() { emitCommand("prev"); }
        });
        session.setActive(true);

        wakeLock = ((PowerManager) getSystemService(Context.POWER_SERVICE))
            .newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "orca:playback");
        wakeLock.setReferenceCounted(false);
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        String action = intent != null ? intent.getAction() : null;
        if (ACTION_PLAYPAUSE.equals(action)
                || ACTION_NEXT.equals(action)
                || ACTION_PREV.equals(action)) {
            /* A started-foreground service must call startForeground promptly
               on every startForegroundService() — even command-only relaunches. */
            if (session != null) startAsForeground();
            if (ACTION_NEXT.equals(action)) emitCommand("next");
            else if (ACTION_PREV.equals(action)) emitCommand("prev");
            else emitCommand("playpause");
            return START_STICKY;
        }

        /* Native-sink control actions (ExoPlayer inside this service). */
        if (ACTION_NATIVE_LOAD.equals(action)) {
            String url = intent.getStringExtra("url");
            long resumeMs = intent.getLongExtra("resumeMs", 0L);
            if (intent.getStringExtra("title") != null) title = intent.getStringExtra("title");
            if (intent.getStringExtra("artist") != null) artist = intent.getStringExtra("artist");
            startAsForeground();
            nativeLoad(url, resumeMs);
            if (wakeLock != null && !wakeLock.isHeld()) wakeLock.acquire();
            return START_STICKY;
        }
        if (ACTION_NATIVE_PLAY.equals(action)) {
            nativePlay();
            return START_STICKY;
        }
        if (ACTION_NATIVE_PAUSE.equals(action)) {
            nativePause();
            return START_STICKY;
        }

        title = intent != null ? intent.getStringExtra("title") : null;
        artist = intent != null ? intent.getStringExtra("artist") : null;
        playing = intent != null ? intent.getStringExtra("playing") : "false";
        if (title == null || title.isEmpty()) title = "Orca";

        startAsForeground();
        updateSession();
        if (wakeLock != null && !wakeLock.isHeld()) wakeLock.acquire();
        return START_STICKY;
    }

    /** Live state updates (track change / play-pause) without a restart. */
    public void update(String newTitle, String newArtist, String newPlaying) {
        if (newTitle != null && !newTitle.isEmpty()) title = newTitle;
        if (newArtist != null) artist = newArtist;
        if (newPlaying != null) playing = newPlaying;
        updateSession();
        NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm != null) nm.notify(NOTIFICATION_ID, buildNotification());
    }

    private void startAsForeground() {
        Notification notification = buildNotification();
        if (Build.VERSION.SDK_INT >= 29) {
            startForeground(NOTIFICATION_ID, notification,
                ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK);
        } else {
            startForeground(NOTIFICATION_ID, notification);
        }
    }

    private void updateSession() {
        if (session == null) return;
        MediaMetadataCompat.Builder meta = new MediaMetadataCompat.Builder()
            .putString(MediaMetadataCompat.METADATA_KEY_TITLE, title)
            .putString(MediaMetadataCompat.METADATA_KEY_ARTIST, artist)
            .putString(MediaMetadataCompat.METADATA_KEY_ALBUM, "Orca");
        session.setMetadata(meta.build());

        final int state = "true".equals(playing)
            ? PlaybackStateCompat.STATE_PLAYING
            : PlaybackStateCompat.STATE_PAUSED;
        session.setPlaybackState(new PlaybackStateCompat.Builder()
            .setActions(
                PlaybackStateCompat.ACTION_PLAY
                    | PlaybackStateCompat.ACTION_PAUSE
                    | PlaybackStateCompat.ACTION_PLAY_PAUSE
                    | PlaybackStateCompat.ACTION_SKIP_TO_NEXT
                    | PlaybackStateCompat.ACTION_SKIP_TO_PREVIOUS)
            .setState(state, 0, 1f)
            .build());
    }

    /* --------------------------------------------- native (ExoPlayer) ---- */

    private void ensurePlayer() {
        if (player != null) return;
        player = new ExoPlayer.Builder(this)
            .setAudioAttributes(
                new AudioAttributes.Builder()
                    .setUsage(C.USAGE_MEDIA)
                    .setContentType(C.AUDIO_CONTENT_TYPE_MUSIC)
                    .build(),
                true /* handle audio focus */)
            .setHandleAudioBecomingNoisy(true) /* pause on headphone unplug */
            .setWakeMode(C.WAKE_MODE_NETWORK) /* keep wifi/cpu awake while streaming */
            .build();
        player.addListener(new Player.Listener() {
            @Override public void onIsPlayingChanged(boolean isPlaying) {
                playing = isPlaying ? "true" : "false";
                emitAudioState(isPlaying ? "playing" : "paused");
                updateSession();
                NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
                if (nm != null) nm.notify(NOTIFICATION_ID, buildNotification());
                setProgressTicking(isPlaying);
            }

            @Override public void onPlaybackStateChanged(int state) {
                if (state == Player.STATE_ENDED) emitAudioState("ended");
                else if (state == Player.STATE_BUFFERING) emitAudioState("buffering");
            }

            @Override public void onPlayerError(PlaybackException error) {
                String msg = error.getMessage() == null ? "native playback error" : error.getMessage();
                emitAudioMessage("error", msg);
                setProgressTicking(false);
            }
        });
    }

    /** Hand a direct stream URL to the service's own ExoPlayer. */
    public void nativeLoad(String url, long resumeMs) {
        if (url == null || url.isEmpty()) return;
        ensurePlayer();
        player.setMediaItem(MediaItem.fromUri(Uri.parse(url)), Math.max(0L, resumeMs));
        player.prepare();
        player.setPlayWhenReady(true);
        playing = "true";
    }

    public void nativePlay() {
        if (player != null) player.play();
    }

    public void nativePause() {
        if (player != null) player.pause();
    }

    public void nativeSeek(long positionMs) {
        if (player != null) player.seekTo(Math.max(0L, positionMs));
    }

    public void nativeSetVolume(float volume) {
        if (player != null) player.setVolume(Math.max(0f, Math.min(1f, volume)));
    }

    /** Full stop: drop the stream and let the process idle (wake lock released by onDestroy caller). */
    public void nativeStop() {
        if (player != null) {
            player.stop();
            player.clearMediaItems();
        }
        setProgressTicking(false);
    }

    public boolean hasNativeStream() {
        return player != null && player.getMediaItemCount() > 0;
    }

    private long nativePosition() {
        return player == null ? 0L : Math.max(0L, player.getCurrentPosition());
    }

    private long nativeDuration() {
        if (player == null) return 0L;
        long d = player.getDuration();
        return d < 0 ? 0L : d;
    }

    private void emitAudioState(String state) {
        Emitter e = emitter;
        if (e == null) return;
        e.emit("{\"kind\":\"audio\",\"state\":\"" + state
            + "\",\"positionMs\":" + nativePosition()
            + ",\"durationMs\":" + nativeDuration() + "}");
    }

    private void emitAudioMessage(String state, String message) {
        Emitter e = emitter;
        if (e == null) return;
        String safe = message.replace("\\", "\\\\").replace("\"", "\\\"").replace("\n", " ");
        e.emit("{\"kind\":\"audio\",\"state\":\"" + state
            + "\",\"positionMs\":" + nativePosition()
            + ",\"durationMs\":" + nativeDuration()
            + ",\"message\":\"" + safe + "\"}");
    }

    /* 500ms position ticker while the native sink is playing. */
    private final Runnable progressTick = new Runnable() {
        @Override public void run() {
            if (player == null || !player.isPlaying()) {
                progressTicking = false;
                return;
            }
            emitAudioState("progress");
            mainHandler.postDelayed(this, 500);
        }
    };

    private void setProgressTicking(boolean running) {
        if (running && !progressTicking) {
            progressTicking = true;
            mainHandler.postDelayed(progressTick, 500);
        } else if (!running) {
            progressTicking = false;
            mainHandler.removeCallbacks(progressTick);
        }
    }

    private Notification buildNotification() {
        boolean isPlaying = "true".equals(playing);
        Intent openApp = getPackageManager().getLaunchIntentForPackage(getPackageName());
        PendingIntent contentPi = PendingIntent.getActivity(
            this, 0, openApp,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        PendingIntent playPausePi = servicePendingIntent(ACTION_PLAYPAUSE, 1);
        PendingIntent nextPi = servicePendingIntent(ACTION_NEXT, 2);
        PendingIntent prevPi = servicePendingIntent(ACTION_PREV, 3);

        return new NotificationCompat.Builder(this, CHANNEL_ID)
            .setSmallIcon(android.R.drawable.ic_media_play)
            .setContentTitle(title)
            .setContentText(artist.isEmpty() ? "Orca" : artist)
            .setContentIntent(contentPi)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .addAction(android.R.drawable.ic_media_previous, "Previous", prevPi)
            .addAction(
                isPlaying ? android.R.drawable.ic_media_pause : android.R.drawable.ic_media_play,
                isPlaying ? "Pause" : "Play",
                playPausePi)
            .addAction(android.R.drawable.ic_media_next, "Next", nextPi)
            .setStyle(new androidx.media.app.NotificationCompat.MediaStyle()
                .setMediaSession(session.getSessionToken())
                .setShowActionsInCompactView(0, 1, 2))
            .build();
    }

    private PendingIntent servicePendingIntent(String action, int requestCode) {
        Intent intent = new Intent(this, MediaPlaybackService.class).setAction(action);
        return PendingIntent.getService(
            this, requestCode, intent,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    private void emitCommand(String command) {
        Emitter e = emitter;
        if (e != null) e.emit("{\"action\":\"" + command + "\"}");
    }

    private void createChannel() {
        if (Build.VERSION.SDK_INT >= 26) {
            NotificationChannel channel = new NotificationChannel(
                CHANNEL_ID, "Orca playback", NotificationManager.IMPORTANCE_LOW);
            channel.setDescription("Media controls while Orca plays music");
            channel.setShowBadge(false);
            NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
            if (nm != null) nm.createNotificationChannel(channel);
        }
    }

    @Override
    public void onDestroy() {
        setProgressTicking(false);
        if (player != null) {
            player.release();
            player = null;
        }
        if (wakeLock != null && wakeLock.isHeld()) wakeLock.release();
        if (session != null) {
            session.release();
            session = null;
        }
        instance = null;
        super.onDestroy();
    }

    public static boolean isRunning() {
        return instance != null;
    }

    /** Live instance for same-process direct calls (may be null). */
    public static MediaPlaybackService running() {
        return instance;
    }

    public static void updateInstance(String title, String artist, String playing) {
        MediaPlaybackService svc = instance;
        if (svc != null) svc.update(title, artist, playing);
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }
}
