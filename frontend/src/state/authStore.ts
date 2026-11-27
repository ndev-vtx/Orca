import { create } from "zustand";
import { AUTH_TOKEN_KEY, authApi, storedToken } from "../services/api";
import type { AuthProviders, UserDto } from "../types";

export type AuthModalMode = "signin" | "signup";

interface AuthState {
  user: UserDto | null;
  /** null = modal closed; "signin" / "signup" = which tab it opens on */
  authModal: AuthModalMode | null;
  providers: AuthProviders | null;
  bootstrapped: boolean;
  busy: boolean;

  bootstrap: () => Promise<void>;
  loadProviders: () => Promise<void>;
  openAuth: (mode: AuthModalMode) => void;
  closeAuth: () => void;
  signIn: (email: string, password: string) => Promise<string>;
  signUp: (
    name: string,
    email: string,
    password: string,
    confirm: string,
    agreed: boolean,
  ) => Promise<string>;
  googleSignIn: (credential: string) => Promise<string>;
  signOut: () => Promise<void>;
}

/** Persist the session token; every authed api helper reads it from here. */
function rememberToken(token: string) {
  localStorage.setItem(AUTH_TOKEN_KEY, token);
}

export const useAuthStore = create<AuthState>((set, get) => ({
  user: null,
  authModal: null,
  providers: null,
  bootstrapped: false,
  busy: false,

  bootstrap: async () => {
    // Restore an existing session (if any) and fetch provider capabilities once.
    const [user, providers] = await Promise.all([
      storedToken() ? authApi.me() : Promise.resolve(null),
      authApi
        .providers()
        .then((p) => p)
        .catch(() => ({ google: false, clientId: "" })),
    ]);
    set({ user, providers, bootstrapped: true });
    // A stored token that no longer resolves server-side is dead — drop it.
    if (storedToken() && !user) localStorage.removeItem(AUTH_TOKEN_KEY);
  },

  loadProviders: async () => {
    if (get().providers) return;
    try {
      set({ providers: await authApi.providers() });
    } catch {
      set({ providers: { google: false, clientId: "" } });
    }
  },

  openAuth: (mode) => set({ authModal: mode }),
  closeAuth: () => set({ authModal: null }),

  signIn: async (email, password) => {
    set({ busy: true });
    try {
      const res = await authApi.login(email.trim(), password);
      rememberToken(res.token);
      set({ user: res.user, authModal: null, busy: false });
      return "";
    } catch (err) {
      set({ busy: false });
      return err instanceof Error ? err.message : "Could not sign in.";
    }
  },

  signUp: async (name, email, password, confirm, agreed) => {
    set({ busy: true });
    try {
      const res = await authApi.signup(name.trim(), email.trim(), password, confirm, agreed);
      rememberToken(res.token);
      set({ user: res.user, authModal: null, busy: false });
      return "";
    } catch (err) {
      set({ busy: false });
      return err instanceof Error ? err.message : "Could not create the account.";
    }
  },

  googleSignIn: async (credential) => {
    set({ busy: true });
    try {
      const res = await authApi.google(credential);
      rememberToken(res.token);
      set({ user: res.user, authModal: null, busy: false });
      return "";
    } catch (err) {
      set({ busy: false });
      return err instanceof Error ? err.message : "Google sign-in failed.";
    }
  },

  signOut: async () => {
    await authApi.logout();
    set({ user: null });
  },
}));
