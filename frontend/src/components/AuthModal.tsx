import { useEffect, useRef, useState } from "react";
import { useAuthStore } from "../state/authStore";
import { CloseIcon } from "./Icons";

/** Google Identity Services script id + minimal surface we use. */
const GSI_SRC = "https://accounts.google.com/gsi/client";

interface GoogleIdConfig {
  client_id: string;
  callback: (response: { credential?: string }) => void;
  auto_select?: boolean;
}

interface GoogleIdApi {
  accounts: {
    id: {
      initialize: (config: GoogleIdConfig) => void;
      renderButton: (
        parent: HTMLElement,
        options: {
          theme?: string;
          size?: string;
          shape?: string;
          text?: string;
          width?: number;
          logo_alignment?: string;
        },
      ) => void;
    };
  };
}

function loadGoogleScript(): Promise<void> {
  return new Promise((resolve, reject) => {
    if (typeof window === "undefined") {
      reject(new Error("no window"));
      return;
    }
    const w = window as typeof window & { google?: GoogleIdApi };
    if (w.google?.accounts?.id) {
      resolve();
      return;
    }
    const existing = document.getElementById("orca-gsi") as HTMLScriptElement | null;
    if (existing) {
      existing.addEventListener("load", () => resolve());
      existing.addEventListener("error", () => reject(new Error("gsi load failed")));
      return;
    }
    const script = document.createElement("script");
    script.id = "orca-gsi";
    script.src = GSI_SRC;
    script.async = true;
    script.defer = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("gsi load failed"));
    document.head.appendChild(script);
  });
}

type Tab = "signin" | "signup";

export default function AuthModal() {
  const modal = useAuthStore((s) => s.authModal);
  const closeAuth = useAuthStore((s) => s.closeAuth);
  const providers = useAuthStore((s) => s.providers);
  const busy = useAuthStore((s) => s.busy);
  const signIn = useAuthStore((s) => s.signIn);
  const signUp = useAuthStore((s) => s.signUp);
  const googleSignIn = useAuthStore((s) => s.googleSignIn);

  const [tab, setTab] = useState<Tab>("signin");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [googleReady, setGoogleReady] = useState(false);
  const [googleBlocked, setGoogleBlocked] = useState(false);
  const googleHostRef = useRef<HTMLDivElement | null>(null);

  // Sync tab with whatever mode the store opened on.
  useEffect(() => {
    if (modal) {
      setTab(modal);
      setError("");
      setPassword("");
      setConfirm("");
    }
  }, [modal]);

  // Escape closes, matching PlaylistModal behaviour.
  useEffect(() => {
    if (!modal) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeAuth();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [modal, closeAuth]);

  // Google Identity Services: load the script once and render the button.
  const googleEnabled = Boolean(providers?.google && providers.clientId);
  useEffect(() => {
    if (!modal || !googleEnabled || googleReady) return;
    let cancelled = false;
    void loadGoogleScript()
      .then(() => {
        if (cancelled || !googleHostRef.current) return;
        const w = window as typeof window & { google?: GoogleIdApi };
        w.google!.accounts.id.initialize({
          client_id: providers!.clientId,
          callback: (response) => {
            if (response.credential) void googleSignIn(response.credential).then((err) => {
              if (err) setError(err);
            });
          },
        });
        w.google!.accounts.id.renderButton(googleHostRef.current, {
          theme: "filled_black",
          size: "large",
          shape: "pill",
          text: "continue_with",
          width: 320,
          logo_alignment: "center",
        });
        setGoogleReady(true);
      })
      .catch(() => {
        if (!cancelled) setGoogleBlocked(true);
      });
    return () => {
      cancelled = true;
    };
  }, [modal, googleEnabled, googleReady, providers, googleSignIn]);

  if (!modal) return null;

  const submitSignup = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    const trimmedName = name.trim();
    const trimmedEmail = email.trim();
    if (!trimmedName) {
      setError("Tell us your name.");
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail)) {
      setError("That email address does not look right.");
      return;
    }
    if (password.length < 8) {
      setError("Password needs at least 8 characters.");
      return;
    }
    if (password !== confirm) {
      setError("Passwords do not match.");
      return;
    }
    const err = await signUp(trimmedName, trimmedEmail, password, confirm, true);
    if (err) setError(err);
  };

  const submitLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    if (!email.trim() || !password) {
      setError("Enter your email and password.");
      return;
    }
    const err = await signIn(email, password);
    if (err) setError(err);
  };

  return (
    <div
      className="modal-overlay auth-overlay"
      onClick={(e) => {
        if (e.target === e.currentTarget) closeAuth();
      }}
    >
      <div
        className="modal auth"
        role="dialog"
        aria-modal="true"
        aria-label={tab === "signin" ? "Sign in to Orca" : "Create an Orca account"}
      >
        <header className="auth__head">
          <div className="auth__brand" aria-hidden="true">
            <svg viewBox="0 0 24 24" width="26" height="26">
              <path
                d="M3 13.5c0-4.7 4-8.5 9-8.5s9 3.4 9 7.6c0 2.6-1.6 4.9-4.2 6.2-.6.3-1-.1-1-.7 0-1.6-1.7-2.6-3.8-2.6H7.6C4.9 15.5 3 14.8 3 13.5Z"
                fill="#4d6bfe"
              />
              <circle cx="14.6" cy="9.6" r="1.15" fill="#ffffff" />
            </svg>
          </div>
          <h2 className="auth__title">
            {tab === "signin" ? "Sign in to Orca" : "Create your account"}
          </h2>
          <p className="auth__sub">
            {tab === "signin"
              ? "Welcome back — pick up right where you drifted off."
              : "Save favorites, build playlists, sync your history."}
          </p>
          <button className="auth__close" onClick={closeAuth} aria-label="Close">
            <CloseIcon size={15} />
          </button>
        </header>

        <div className="auth__tabs" role="tablist">
          <button
            role="tab"
            aria-selected={tab === "signin"}
            className={`auth__tab${tab === "signin" ? " is-active" : ""}`}
            onClick={() => {
              setTab("signin");
              setError("");
            }}
          >
            Sign in
          </button>
          <button
            role="tab"
            aria-selected={tab === "signup"}
            className={`auth__tab${tab === "signup" ? " is-active" : ""}`}
            onClick={() => {
              setTab("signup");
              setError("");
            }}
          >
            Create account
          </button>
        </div>

        <div className="auth__google-slot">
          {googleEnabled && !googleBlocked ? (
            <>
              <div ref={googleHostRef} className="auth__google-host" />
              <div className="auth__divider" aria-hidden="true">
                <span>or with email</span>
              </div>
            </>
          ) : (
            <div className="auth__google-off" title="Google sign-in unavailable">
              <button className="auth__google-disabled" disabled aria-label="Google sign-in unavailable">
                <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
                  <path
                    fill="#4285F4"
                    d="M23.5 12.3c0-.9-.1-1.5-.3-2.2H12v4.3h6.5c-.1 1.1-.8 2.7-2.4 3.8l-.02.15 3.5 2.7.24.03c2.2-2.05 3.5-5.05 3.5-8.8Z"
                  />
                  <path
                    fill="#34A853"
                    d="M12 24c3.2 0 5.9-1.1 7.9-2.9l-3.7-2.9c-1 .7-2.4 1.2-4.2 1.2-3.2 0-5.9-2.1-6.8-5l-.14.01-3.6 2.8-.05.13C3.4 21.3 7.4 24 12 24Z"
                  />
                  <path
                    fill="#FBBC05"
                    d="M5.2 14.4c-.25-.74-.4-1.53-.4-2.4s.14-1.66.4-2.4l-.01-.16-3.7-2.85-.12.06C.5 8.3 0 10.1 0 12s.5 3.7 1.37 5.35l3.83-2.95Z"
                  />
                  <path
                    fill="#EA4335"
                    d="M12 4.6c2.3 0 3.8.96 4.7 1.77l3.4-3.3C18.1 1.16 15.2 0 12 0 7.4 0 3.4 2.7 1.37 6.65l3.83 2.95C6.1 6.76 8.8 4.6 12 4.6Z"
                  />
                </svg>
                Continue with Google
              </button>
              <p className="auth__google-note">
                {googleBlocked
                  ? "Google sign-in could not load right now — email sign-in still works."
                  : "Google sign-in isn't configured on this deployment — use email instead."}
              </p>
            </div>
          )}
        </div>

        {tab === "signin" ? (
          <form className="auth__form" onSubmit={(e) => void submitLogin(e)}>
            <label className="auth__label" htmlFor="auth-email">
              Email / Gmail
            </label>
            <input
              id="auth-email"
              className="auth__input"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@gmail.com"
              autoFocus
            />
            <label className="auth__label" htmlFor="auth-password">
              Password
            </label>
            <input
              id="auth-password"
              className="auth__input"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Your password"
            />
            {error && <p className="auth__error">{error}</p>}
            <button className="auth__submit" type="submit" disabled={busy}>
              {busy ? "Signing in…" : "Sign in"}
            </button>
          </form>
        ) : (
          <form className="auth__form" onSubmit={(e) => void submitSignup(e)}>
            <label className="auth__label" htmlFor="auth-name">
              Name
            </label>
            <input
              id="auth-name"
              className="auth__input"
              type="text"
              autoComplete="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Your name"
              maxLength={80}
            />
            <label className="auth__label" htmlFor="auth-email-signup">
              Email / Gmail
            </label>
            <input
              id="auth-email-signup"
              className="auth__input"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@gmail.com"
            />
            <label className="auth__label" htmlFor="auth-password-signup">
              Password
            </label>
            <input
              id="auth-password-signup"
              className="auth__input"
              type="password"
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="At least 8 characters"
            />
            <label className="auth__label" htmlFor="auth-confirm">
              Confirm password
            </label>
            <input
              id="auth-confirm"
              className="auth__input"
              type="password"
              autoComplete="new-password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              placeholder="Repeat your password"
            />
            {error && <p className="auth__error">{error}</p>}
            <button className="auth__submit" type="submit" disabled={busy}>
              {busy ? "Creating account…" : "Create account"}
            </button>
          </form>
        )}

        <p className="auth__footnote">
          Browsing works without an account — signing in syncs your library.
        </p>
      </div>
    </div>
  );
}
