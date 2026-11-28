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
import android.os.Build;

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
