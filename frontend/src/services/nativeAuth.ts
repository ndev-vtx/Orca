/*
 * nativeAuth.ts
 * Google sign-in for the Android APK. Google blocks OAuth/Identity-Services
 * inside WebViews (disallowed_useragent), so on native the flow runs in the
 * SYSTEM browser: the app opens the deployed Orca web app's /auth/google
 * bridge page, the user signs in there (real browser user agent), and the
 * bridge page redirects back into the app via the "orca://auth?token=..."
 * deep link (intent-filter on MainActivity, delivered through the
 * @capacitor/app plugin's appUrlOpen event).
 */

import { Capacitor } from "@capacitor/core";

/** The deployed web app that hosts the OAuth bridge page and the API. */
export const NATIVE_WEB_ORIGIN = "https://orca-d.vercel.app";

/** True when running inside the Capacitor Android APK. */
export function isNativeApp(): boolean {
  try {
    return Capacitor.isNativePlatform();
  } catch {
    return false;
  }
}

/** Open a URL of the deployed web app in the system browser. */
export async function openSystemBrowser(path: string): Promise<void> {
  const url = `${NATIVE_WEB_ORIGIN}${path}`;
  const mod = await import("@capacitor/browser");
  await mod.Browser.open({ url });
}
