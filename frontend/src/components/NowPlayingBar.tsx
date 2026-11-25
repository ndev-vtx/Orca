import { useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  HeartIcon,
  HeartOutlineIcon,
  MuteIcon,
  NextIcon,
  PauseIcon,
  PlayIcon,
  PrevIcon,
  QueueIcon,
  RepeatIcon,
  ShuffleIcon,
  VolumeIcon,
} from "./Icons";
import { MusicTile } from "./Shared";

type SliderKind = "seek" | "volume";

function percentFromEvent(el: HTMLElement, e: React.PointerEvent): number {
  const rect = el.getBoundingClientRect();
  if (rect.width === 0) return 0;
  const ratio = (e.clientX - rect.left) / rect.width;
  return Math.min(100, Math.max(0, Math.round(ratio * 100)));
}

export default function NowPlayingBar() {
  const navigate = useNavigate();
  const [playing, setPlaying] = useState(false);
  const [shuffle, setShuffle] = useState(false);
  const [repeat, setRepeat] = useState(false);
  const [seekPercent, setSeekPercent] = useState(0);
  const [volume, setVolume] = useState(78);
  const [muted, setMuted] = useState(false);
  const dragging = useRef<SliderKind | null>(null);
  const trackRef = useRef<HTMLDivElement | null>(null);
  const volumeRef = useRef<HTMLDivElement | null>(null);

  const volumeShown = muted ? 0 : volume;

  const setPercent = (kind: SliderKind, percent: number) => {
    if (kind === "seek") setSeekPercent(percent);
    else {
      setVolume(percent);
      if (percent > 0) setMuted(false);
    }
  };

  const onPointerDown = (kind: SliderKind, ref: React.RefObject<HTMLElement | null>) => (
    e: React.PointerEvent,
  ) => {
    if (!ref.current) return;
    dragging.current = kind;
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    setPercent(kind, percentFromEvent(ref.current, e));
  };

  const onPointerMove = (ref: React.RefObject<HTMLElement | null>) => (e: React.PointerEvent) => {
    if (!dragging.current || !ref.current) return;
    setPercent(dragging.current, percentFromEvent(ref.current, e));
  };

  const onPointerUp = () => {
    dragging.current = null;
  };

  return (
    <footer className="bar" aria-label="Now playing">
      <div className="bar__left">
        <div className="bar__cover">
          <MusicTile seed="orca-ambient" size={52} />
        </div>
        <div className="bar__meta">
          <span className="bar__title">Neon Currents</span>
          <span className="bar__sub">Orca Sound Lab</span>
        </div>
        <button
          className={`bar__heart${playing ? " bar__heart--on" : ""}`}
          aria-label="Save to your library"
        >
          {playing ? <HeartIcon size={16} /> : <HeartOutlineIcon size={16} />}
        </button>
      </div>

      <div className="bar__center">
        <div className="bar__controls">
          <button
            className={`bar__ctrl${shuffle ? " bar__ctrl--on" : ""}`}
            aria-label="Shuffle"
            title="Shuffle"
            onClick={() => setShuffle((v) => !v)}
          >
            <ShuffleIcon size={16} />
          </button>
          <button className="bar__ctrl" aria-label="Previous" title="Previous">
            <PrevIcon size={18} />
          </button>
          <button
            className="bar__play"
            aria-label={playing ? "Pause" : "Play"}
            title={playing ? "Pause" : "Play"}
            onClick={() => setPlaying((v) => !v)}
          >
            {playing ? <PauseIcon size={16} /> : <PlayIcon size={16} />}
          </button>
          <button className="bar__ctrl" aria-label="Next" title="Next">
            <NextIcon size={18} />
          </button>
          <button
            className={`bar__ctrl${repeat ? " bar__ctrl--on" : ""}`}
            aria-label="Repeat"
            title="Repeat"
            onClick={() => setRepeat((v) => !v)}
          >
            <RepeatIcon size={16} />
          </button>
        </div>
        <div className="bar__seek">
          <span className="bar__time">0:00</span>
          <div
            ref={trackRef}
            className="bar__track"
            role="slider"
            aria-label="Seek"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={seekPercent}
            tabIndex={0}
            onPointerDown={onPointerDown("seek", trackRef)}
            onPointerMove={onPointerMove(trackRef)}
            onPointerUp={onPointerUp}
          >
            <div className="bar__track-fill" style={{ width: `${seekPercent}%` }} />
            <div className="bar__thumb" style={{ left: `${seekPercent}%` }} />
          </div>
          <span className="bar__time">0:00</span>
        </div>
      </div>

      <div className="bar__right">
        <button
          className="bar__ctrl"
          aria-label="Queue"
          title="Queue"
          onClick={() => navigate("/library")}
        >
          <QueueIcon size={16} />
        </button>
        <button
          className="bar__ctrl"
          aria-label={muted ? "Unmute" : "Mute"}
          title={muted ? "Unmute" : "Mute"}
          onClick={() => setMuted((v) => !v)}
        >
          {volumeShown === 0 ? <MuteIcon size={16} /> : <VolumeIcon size={16} />}
        </button>
        <div
          ref={volumeRef}
          className="bar__volume"
          role="slider"
          aria-label="Volume"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={volumeShown}
          tabIndex={0}
          onPointerDown={onPointerDown("volume", volumeRef)}
          onPointerMove={onPointerMove(volumeRef)}
          onPointerUp={onPointerUp}
        >
          <div className="bar__volume-fill" style={{ width: `${volumeShown}%` }} />
          <div className="bar__thumb" style={{ left: `${volumeShown}%` }} />
        </div>
      </div>
    </footer>
  );
}
