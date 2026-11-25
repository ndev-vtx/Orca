import { useEffect, useMemo, useRef } from "react";
import { usePlayerStore } from "../state/player";
import { CloseIcon } from "./Icons";

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

  useEffect(() => {
    if (open && videoId) void ensureLyrics();
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
    lineRefs.current[activeIdx]?.scrollIntoView({
      block: "center",
      behavior: "smooth",
    });
  }, [activeIdx]);

  if (!open) return null;

  return (
    <section className="lyrics" aria-label={`Lyrics for ${current?.title ?? "current track"}`}>
      <header className="lyrics__head">
        <div className="lyrics__meta">
          <span className="lyrics__title">{current ? current.title : "No track selected"}</span>
          <span className="lyrics__sub">{current ? current.artist || "Unknown artist" : ""}</span>
        </div>
        <button
          className="lyrics__close"
          onClick={toggleLyrics}
          aria-label="Close lyrics"
          title="Close lyrics"
        >
          <CloseIcon size={16} />
        </button>
      </header>

      <div className="lyrics__body" ref={bodyRef}>
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
