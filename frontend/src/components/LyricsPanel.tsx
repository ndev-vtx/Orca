import { useEffect, useMemo, useRef, useState } from "react";
import { usePlayerStore } from "../state/player";
import { CloseIcon } from "./Icons";
import { resolveArtist } from "../utils/artist";

export default function LyricsPanel() {
  const open = usePlayerStore((s) => s.lyricsOpen);
  const status = usePlayerStore((s) => s.lyricsStatus);
  const lines = usePlayerStore((s) => s.lyrics);
  const plain = usePlayerStore((s) => s.lyricsPlain);
  const current = usePlayerStore((s) => s.current);
  const positionMs = usePlayerStore((s) => s.positionMs);
  const toggleLyrics = usePlayerStore((s) => s.toggleLyrics);
  const ensureLyrics = usePlayerStore((s) => s.ensureLyrics);
  const seek = usePlayerStore((s) => s.seek);
  const videoId = current?.videoId ?? null;
  const lineRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const bodyRef = useRef<HTMLDivElement | null>(null);
  /*
   * Auto-follow UX: the panel scrolls the active line to centre smoothly and
   * never on the very first activation (no jump-to-bottom on open/load).
   * When the user scrolls manually, following pauses and a "Sync" pill
   * appears to resume it — auto-scroll never fights the user's scroll.
   */
  const [follow, setFollow] = useState(true);
  const followRef = useRef(true);
  const prevActiveRef = useRef(-1);
  const loadedForRef = useRef<string | null>(null);

  useEffect(() => {
    if (open && videoId) void ensureLyrics();
    if (loadedForRef.current !== videoId) {
      /* New track (or first open): reset follow and skip the initial jump. */
      loadedForRef.current = videoId;
      prevActiveRef.current = -1;
      followRef.current = true;
      setFollow(true);
    }
  }, [open, videoId, ensureLyrics]);

  const activeIdx = useMemo(() => {
    if (lines.length === 0) return -1;
    let idx = -1;
    for (let i = 0; i < lines.length; i += 1) {
      if (lines[i].timeMs <= positionMs) idx = i;
      else break;
    }
    return idx;
  }, [lines, positionMs]);

  useEffect(() => {
    if (activeIdx < 0) return;
    /*
     * Scroll only the lyrics body: scrollIntoView would also scroll every
     * ancestor scroll container, yanking the page behind the panel on each
     * new line. The very first activation after a track change centres the
     * current line instantly (without animation) so the panel opens in the
     * right place instead of visibly sliding from the top to the bottom.
     */
    if (!followRef.current) return;
    const line = lineRefs.current[activeIdx];
    const body = bodyRef.current;
    if (!line || !body) return;
    const firstActivation = prevActiveRef.current === -1;
    prevActiveRef.current = activeIdx;
    const target = Math.max(0, line.offsetTop - body.clientHeight / 2 + line.clientHeight / 2);
    body.scrollTo({ top: target, behavior: firstActivation ? "auto" : "smooth" });
  }, [activeIdx]);

  /* Any manual scroll gesture pauses auto-follow until Sync is pressed. */
  const pauseFollow = (): void => {
    if (!followRef.current) return;
    followRef.current = false;
    setFollow(false);
  };

  const resumeFollow = (): void => {
    followRef.current = true;
    setFollow(true);
    if (activeIdx >= 0) {
      const line = lineRefs.current[activeIdx];
      const body = bodyRef.current;
      if (line && body) {
        body.scrollTo({
          top: Math.max(0, line.offsetTop - body.clientHeight / 2 + line.clientHeight / 2),
          behavior: "smooth",
        });
      }
    }
  };

  if (!open) return null;

  return (
    <section className="lyrics" aria-label={`Lyrics for ${current?.title ?? "current track"}`}>
      <header className="lyrics__head">
        <div className="lyrics__meta">
          <span className="lyrics__title">{current ? current.title : "No track selected"}</span>
          <span className="lyrics__sub">{current ? resolveArtist(current) || "Unknown artist" : ""}</span>
        </div>
        <div className="lyrics__head-actions">
          {!follow && activeIdx >= 0 && (
            <button className="lyrics__sync" onClick={resumeFollow} title="Re-sync lyrics to playback">
              Sync
            </button>
          )}
          <button
            className="lyrics__close"
            onClick={toggleLyrics}
            aria-label="Close lyrics"
            title="Close lyrics"
          >
            <CloseIcon size={16} />
          </button>
        </div>
      </header>

      <div
        className="lyrics__body"
        ref={bodyRef}
        onWheel={pauseFollow}
        onTouchMove={pauseFollow}
        onPointerDown={(e) => {
          /* Scrollbar drags land as pointerdown on the container. */
          if (e.pointerType === "mouse") pauseFollow();
        }}
      >
        {status === "loading" && <p className="lyrics__note">Reading the current…</p>}
        {status === "error" && (
          <p className="lyrics__note">Lyrics could not be loaded.</p>
        )}
        {status === "empty" && (
          <p className="lyrics__note">
            No lyrics found for this track. Instrumental currents, perhaps.
          </p>
        )}
        {status === "ready" && lines.length === 0 && plain && (
          <div className="lyrics__plain">{plain}</div>
        )}
        {status === "ready" && lines.length > 0 && (
          <div className="lyrics__lines">
            {lines.map((line, i) => (
              <button
                key={`${line.timeMs}-${i}`}
                ref={(el) => {
                  lineRefs.current[i] = el;
                }}
                className={`lyrics__line${i === activeIdx ? " lyrics__line--active" : ""}`}
                onClick={() => {
                  seek(line.timeMs);
                  if (!usePlayerStore.getState().playing) usePlayerStore.getState().toggle();
                }}
                title="Jump to this line"
              >
                {line.text}
              </button>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
