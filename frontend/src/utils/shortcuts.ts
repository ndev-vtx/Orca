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
        case "ArrowRight":
          e.preventDefault();
          store.seek(store.positionMs + 5000);
          break;
        case "ArrowLeft":
          e.preventDefault();
          store.seek(Math.max(0, store.positionMs - 5000));
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
