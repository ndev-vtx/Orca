/*
 * AuthBridgePage.tsx — /auth/google
 * System-browser OAuth bridge for the Android APK. Google blocks Google
 * Identity Services inside WebViews (disallowed_useragent), so the app opens
 * this page in the phone's browser; the user signs in with a real browser
 * user agent, the page exchanges the Google credential for an Orca session
 * token via the normal /api/auth/google endpoint, then hands the token back
 * to the app through the orca://auth?token=... deep link. Also a graceful
 * standalone fallback for browsers where the deep link is refused.
 */

import { useEffect, useRef, useState } from "react";
import { authApi } from "../services/api";
import { isNativeApp } from "../services/nativeAuth";

type Phase = "loading" | "ready" | "signing" | "done" | "error";

interface GoogleIdConfig {
  client_id: string;
  callback: (response: { credential?: string }) => void;
}

function loadGoogleScript(): Promise<void> {
  return new Promise((resolve, reject) => {
    if ((window as unknown as { google?: unknown }).google) {
      resolve();
      return;
    }
    const existing = document.getElementById("orca-gsi");
    if (existing) {
      existing.addEventListener("load", () => resolve());
      existing.addEventListener("error", () => reject(new Error("gsi load failed")));
      return;
    }
    const script = document.createElement("script");
    script.src = "https://accounts.google.com/gsi/client";
    script.async = true;
    script.defer = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("gsi load failed"));
    document.body.appendChild(script);
  });
}

export default function AuthBridgePage() {
  const [phase, setPhase] = useState<Phase>("loading");
  const [message, setMessage] = useState("");
  const [token, setToken] = useState("");
  const buttonHost = useRef<HTMLDivElement | null>(null);
  const deepLinked = useRef(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const providers = await authApi.providers();
        const clientId = providers.clientId || (import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined) || "";
        if (!providers.google || !clientId) {
          if (!cancelled) {
            setPhase("error");
            setMessage("Google sign-in is not configured on this deployment.");
          }
          return;
        }
        await loadGoogleScript();
        if (cancelled || !buttonHost.current) return;
        const w = window as unknown as { google?: { accounts: { id: { initialize: (c: GoogleIdConfig) => void; renderButton: (el: HTMLElement, o: Record<string, unknown>) => void } } } };
        w.google!.accounts.id.initialize({
          client_id: clientId,
          callback: (response) => {
            if (!response.credential || cancelled) return;
            setPhase("signing");
            void authApi
              .google(response.credential)
              .then((res) => {
                if (cancelled) return;
                setToken(res.token);
                setPhase("done");
                /* Hand the session back to the app (user-gesture-adjacent:
                   Chrome may show an "Open Orca?" confirmation). */
                deepLinked.current = true;
                window.location.href = `orca://auth?token=${encodeURIComponent(res.token)}`;
              })
              .catch((err: unknown) => {
                if (!cancelled) {
                  setPhase("error");
                  setMessage(err instanceof Error ? err.message : "Sign-in failed.");
                }
              });
          },
        });
        w.google!.accounts.id.renderButton(buttonHost.current, {
          theme: "filled_black",
          size: "large",
          shape: "pill",
          text: "continue_with",
          width: 300,
          logo_alignment: "center",
        });
        if (!cancelled) setPhase("ready");
      } catch (err) {
        if (!cancelled) {
          setPhase("error");
          setMessage(err instanceof Error ? err.message : "Could not reach the Orca backend.");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  /* Re-offer the deep link from an explicit user gesture if the automatic
     navigation was swallowed by the browser. */
  const handBack = (): void => {
    if (token) window.location.href = `orca://auth?token=${encodeURIComponent(token)}`;
  };

  return (
    <div className="authbridge">
      <div className="authbridge__card">
        <p className="authbridge__brand">Orca</p>
        <h1 className="authbridge__title">Đăng nhập Google</h1>
        {phase === "loading" && <p className="authbridge__note">Đang tải…</p>}
        {phase === "ready" && (
          <>
            <p className="authbridge__note">Đăng nhập để tiếp tục trong ứng dụng Orca.</p>
            <div ref={buttonHost} className="authbridge__button" />
          </>
        )}
        {phase === "signing" && <p className="authbridge__note">Đang xác thực…</p>}
        {phase === "done" && (
          <>
            <p className="authbridge__ok">Đã đăng nhập! Đang quay lại ứng dụng Orca…</p>
            {!isNativeApp() && (
              <button className="authbridge__link" onClick={handBack}>
                Mở lại ứng dụng Orca
              </button>
            )}
            <p className="authbridge__sub">You can close this tab and return to the app.</p>
          </>
        )}
        {phase === "error" && <p className="authbridge__error">{message}</p>}
      </div>
    </div>
  );
}
