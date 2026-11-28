import { useEffect } from "react";
import { usePlayerStore } from "../state/player";

/*
 * Desktop keyboard shortcuts, Spotify-style. Disabled while typing in any
 * field and while modifier combos are held so browser shortcuts survive.
 */
export function useKeyboardShortcuts(): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.tagName === "SELECT" ||
          target.isContentEditable)
      ) {
        return;
      }
      const store = usePlayerStore.getState();
      switch (e.key) {
        case " ":
          e.preventDefault();
          store.toggle();
          break;
        case "/":
          e.preventDefault();
          focusSearch();
          break;
        case "ArrowRight":
          e.preventDefault();
          if (e.shiftKey) {
            store.next(true);
          } else {
            store.seek(store.positionMs + 5000);
          }
          break;
        case "ArrowLeft":
          e.preventDefault();
          if (e.shiftKey) {
            store.previous();
          } else {
            store.seek(Math.max(0, store.positionMs - 5000));
          }
          break;
        case "ArrowUp":
          e.preventDefault();
          store.setVolume(Math.min(100, store.volume + 5));
          break;
        case "ArrowDown":
          e.preventDefault();
          store.setVolume(Math.max(0, store.volume - 5));
          break;
        case "n":
        case "N":
          store.next(true);
          break;
        case "p":
        case "P":
          store.previous();
          break;
        case "m":
        case "M":
          store.setMuted(!store.muted);
          break;
        case "l":
        case "L":
          store.toggleLyrics();
          break;
        default:
          break;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}

/*
 * `/` jumps straight to the Search input (Spotify behaviour): navigates to
 * /search when needed (via the router bridge in App.tsx), then focuses +
 * selects the field once it exists.
 */
function focusSearch(): void {
  const input = document.querySelector<HTMLInputElement>(".searchbar input");
  if (input) {
    input.focus();
    input.select();
    return;
  }
  type Bridge = { __orcaNavigate?: (path: string) => void };
  (window as unknown as Bridge).__orcaNavigate?.("/search");
  /* The SearchPage mounts asynchronously — retry on the next frames. */
  let tries = 0;
  const retry = (): void => {
    const el = document.querySelector<HTMLInputElement>(".searchbar input");
    if (el) {
      el.focus();
      el.select();
    } else if (tries < 20) {
      tries += 1;
      requestAnimationFrame(retry);
    }
  };
  requestAnimationFrame(retry);
}
