/*
 * NativePermissionGate.tsx
 * Android APK (Capacitor) only: a clean, on-brand first-launch dialog that
 * explains WHY notification/background permissions are needed, then triggers
 * the native POST_NOTIFICATIONS request through the registered
 * OrcaPermissions plugin (MainActivity). Never rendered in the browser or the
 * PWA — Capacitor.isNativePlatform() is false there. Shown once; the choice
 * is remembered for the install.
 */

import { useEffect, useState } from "react";
import { Capacitor } from "@capacitor/core";

const PROMPT_KEY = "orca.native.perms.v1";

interface OrcaPermissionsPlugin {
  requestMediaPermissions?: () => Promise<{ granted?: boolean }>;
  requestBatteryExemption?: () => Promise<{ exempt?: boolean } | undefined>;
}

function permissionsPlugin(): OrcaPermissionsPlugin | null {
  if (!Capacitor.isNativePlatform()) return null;
  const plugins = (Capacitor as unknown as {
    Plugins?: Record<string, OrcaPermissionsPlugin>;
  }).Plugins;
  return plugins?.OrcaPermissions ?? null;
}

export default function NativePermissionGate() {
  const [open, setOpen] = useState<boolean>(() => {
    try {
      return (
        Capacitor.isNativePlatform() &&
        window.localStorage.getItem(PROMPT_KEY) !== "1"
      );
    } catch {
      return false;
    }
  });
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    try {
      window.localStorage.setItem(PROMPT_KEY, "1");
    } catch {
      /* storage unavailable — dialog just re-offers next launch */
    }
  }, [open]);

  if (!open) return null;

  const accept = async (): Promise<void> => {
    setBusy(true);
    try {
      await permissionsPlugin()?.requestMediaPermissions?.();
    } catch {
      /* user denied or the bridge is missing — never block the app */
    }
    /*
     * Battery-optimization exemption: OEM power managers (Samsung, Xiaomi,
     * Oppo, Vivo) kill foreground services after a few minutes with the
     * screen off. Send the user to the system exemption dialog right after
     * the notification prompt; best-effort and skippable.
     */
    try {
      await permissionsPlugin()?.requestBatteryExemption?.();
    } catch {
      /* ROM dropped the action — never block the app */
    }
    setBusy(false);
    setOpen(false);
  };

  return (
    <div className="permgate" role="dialog" aria-modal="true" aria-label="Quyền ứng dụng">
      <div className="permgate__card">
        <h2 className="permgate__title">Cho phép Orca chạy nền?</h2>
        <p className="permgate__text">
          Cho phép thông báo &amp; chạy nền để Orca có thể tiếp tục phát nhạc nền
          khi thoát ứng dụng hoặc tắt màn hình.
        </p>
        <p className="permgate__sub">
          Allow notifications &amp; background activity so Orca can keep playing
          music when you leave the app or turn off the screen.
        </p>
        <div className="permgate__actions">
          <button
            className="permgate__later"
            onClick={() => setOpen(false)}
            disabled={busy}
          >
            Để sau
          </button>
          <button
            className="permgate__allow"
            onClick={() => void accept()}
            disabled={busy}
          >
            {busy ? "Đang mở…" : "Cho phép"}
          </button>
        </div>
      </div>
    </div>
  );
}
