/*
 * AuthBridgePage.tsx — /auth/google
 * System-browser OAuth bridge for the Android APK. Google blocks Google
 * Identity Services inside WebViews (disallowed_useragent), so the app opens
 * this page in the phone's browser (?native=1); the user signs in with a real
 * browser user agent, the page exchanges the Google credential for an Orca
 * session token via the normal /api/auth/google endpoint, then hands the
 * token back to the app through a deep link:
 *   com.orca.music://oauth-callback?token=...  (canonical app-id scheme)
 *   orca://auth?token=...                      (legacy fallback)
 * Never hangs: hard timeouts on the providers fetch and the whole flow, with
 * a retry button so the user is never stuck on "Đang tải…".
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { authApi } from "../services/api";
import { isNativeApp } from "../services/nativeAuth";

type Phase = "loading" | "ready" | "signing" | "done" | "error";

interface GoogleIdConfig {
  client_id: string;
  callback: (response: { credential?: string }) => void;
}

const PROVIDERS_TIMEOUT_MS = 8000;
const OVERALL_TIMEOUT_MS = 12000;

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = window.setTimeout(() => reject(new Error("timeout")), ms);
    p.then(
      (v) => {
        window.clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        window.clearTimeout(timer);
        reject(e);
      },
    );
  });
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

/* Canonical deep link first, legacy scheme as an immediate backup. */
function handBackToApp(token: string): void {
  const enc = encodeURIComponent(token);
  window.location.href = `com.orca.music://oauth-callback?token=${enc}`;
  window.setTimeout(() => {
    /* If the canonical scheme was swallowed, try the legacy shape. */
    window.location.href = `orca://auth?token=${enc}`;
  }, 1200);
}

export default function AuthBridgePage() {
  const [phase, setPhase] = useState<Phase>("loading");
  const [message, setMessage] = useState("");
  const [token, setToken] = useState("");
  const [attempt, setAttempt] = useState(0);
  const buttonHost = useRef<HTMLDivElement | null>(null);

  const nativeParam =
    typeof window !== "undefined" &&
    new URLSearchParams(window.location.search).get("native") === "1";

  useEffect(() => {
    let cancelled = false;
    setPhase("loading");
    setMessage("");

    /* Hard cap on the setup flow — never hang on "Đang tải…". Only fires
       while still loading; an already-rendered sign-in button is a working
       state and must never be torn down by the timeout. */
    const overall = window.setTimeout(() => {
      if (!cancelled) {
        setPhase((prev) => {
          if (prev === "loading") {
            setMessage("Không thể tải trang đăng nhập — hãy thử lại.");
            return "error";
          }
          return prev;
        });
      }
    }, OVERALL_TIMEOUT_MS);

    (async () => {
      try {
        const providers = await withTimeout(authApi.providers(), PROVIDERS_TIMEOUT_MS);
        const clientId =
          providers.clientId ||
          (import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined) ||
          "";
        if (!providers.google || !clientId) {
          if (!cancelled) {
            setPhase("error");
            setMessage("Google sign-in is not configured on this deployment.");
          }
          return;
        }
        await withTimeout(loadGoogleScript(), PROVIDERS_TIMEOUT_MS);
        if (cancelled || !buttonHost.current) return;
        const w = window as unknown as {
          google?: {
            accounts: {
              id: {
                initialize: (c: GoogleIdConfig) => void;
                renderButton: (el: HTMLElement, o: Record<string, unknown>) => void;
              };
            };
          };
        };
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
                handBackToApp(res.token);
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
          const failed = err instanceof Error && err.message === "timeout";
          setMessage(
            failed
              ? "Kết nối máy chủ chậm hoặc bị chặn — hãy thử lại."
              : err instanceof Error
                ? err.message
                : "Could not reach the Orca backend.",
          );
        }
      }
    })();

    return () => {
      cancelled = true;
      window.clearTimeout(overall);
    };
  }, [attempt]);

  /* Re-offer the deep link from an explicit user gesture if the automatic
     navigation was swallowed by the browser. */
  const handBack = useCallback((): void => {
    if (token) handBackToApp(token);
  }, [token]);

  return (
    <div className="authbridge">
      <div className="authbridge__card">
        <p className="authbridge__brand">Orca</p>
        <h1 className="authbridge__title">Đăng nhập Google</h1>
        {phase === "loading" && (
          <p className="authbridge__note">Đang tải{nativeParam ? " (chế độ ứng dụng)…" : "…"}</p>
        )}
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
        {phase === "error" && (
          <>
            <p className="authbridge__error">{message}</p>
            <button
              className="authbridge__link"
              onClick={() => setAttempt((n) => n + 1)}
            >
              Thử lại
            </button>
          </>
        )}
      </div>
    </div>
  );
}
