/*
 * OrcaPermissionsPlugin.java
 * Tiny native bridge used by the first-launch permission dialog in the web
 * layer (NativePermissionGate.tsx). Requests POST_NOTIFICATIONS on Android
 * 13+ so the OS notification/lock-screen media menu can show Orca's
 * play/pause/next controls while music plays in the background. WAKE_LOCK and
 * the FOREGROUND_SERVICE permissions need no runtime prompt.
 */
package com.orca.music;

import android.Manifest;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.os.PowerManager;
import android.provider.Settings;

import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

@CapacitorPlugin(
    name = "OrcaPermissions",
    permissions = {
        @Permission(
            strings = { Manifest.permission.POST_NOTIFICATIONS },
            alias = OrcaPermissionsPlugin.NOTIFICATIONS_ALIAS
        )
    }
)
public class OrcaPermissionsPlugin extends Plugin {

    static final String NOTIFICATIONS_ALIAS = "notifications";

    @PluginMethod
    public void requestMediaPermissions(PluginCall call) {
        if (Build.VERSION.SDK_INT >= 33) {
            if (getPermissionState(NOTIFICATIONS_ALIAS) != PermissionState.GRANTED) {
                requestPermissionForAlias(NOTIFICATIONS_ALIAS, call, "notificationsCallback");
                return;
            }
        }
        resolveState(call);
    }

    @PluginMethod
    public void checkMediaPermissions(PluginCall call) {
        resolveState(call);
    }

    /*
     * Battery-optimization exemption: aggressive OEM power managers (Samsung,
     * Xiaomi, Oppo, Vivo...) kill foreground services after a few minutes
     * with the screen off unless the app is exempted. Sends the user to the
     * system dialog (Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS)
     * for this package. Best-effort — some ROMs/OEM skins drop the action.
     */
    @PluginMethod
    public void requestBatteryExemption(PluginCall call) {
        JSObject ret = new JSObject();
        Context context = getContext();
        PowerManager pm = (PowerManager) context.getSystemService(Context.POWER_SERVICE);
        if (pm != null && pm.isIgnoringBatteryOptimizations(context.getPackageName())) {
            ret.put("exempt", true);
            call.resolve(ret);
            return;
        }
        try {
            Intent intent = new Intent(
                Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS,
                Uri.parse("package:" + context.getPackageName()));
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            context.startActivity(intent);
            ret.put("exempt", false);
        } catch (Exception ex) {
            /* Action unsupported on this ROM — silently skip. */
            ret.put("exempt", false);
            ret.put("supported", false);
        }
        call.resolve(ret);
    }

    @PermissionCallback
    private void notificationsCallback(PluginCall call) {
        resolveState(call);
    }

    private void resolveState(PluginCall call) {
        boolean granted = Build.VERSION.SDK_INT < 33
            || getPermissionState(NOTIFICATIONS_ALIAS) == PermissionState.GRANTED;
        JSObject ret = new JSObject();
        ret.put("granted", granted);
        call.resolve(ret);
    }
}
