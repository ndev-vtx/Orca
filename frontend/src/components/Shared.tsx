import { useMemo } from "react";
import { OrcaMark } from "./OrcaLogo";

const PALETTE = ["#4D6BFE", "#3b5bdb", "#2f4fd0", "#22367a", "#6E8BFF"];

function hue(seed: string): string {
  let hash = 0;
  for (let i = 0; i < seed.length; i += 1) {
    hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  }
  return PALETTE[hash % PALETTE.length];
}

export function MusicTile({ seed, size = 44 }: { seed: string; size?: number }) {
  const gradient = useMemo(() => {
    const from = hue(seed || "orca");
    return `linear-gradient(135deg, ${from}, #05070C)`;
  }, [seed]);
  return (
    <span
      className="music-tile"
      style={{ width: size, height: size, background: gradient }}
      aria-hidden="true"
    >
      <OrcaMark size={Math.round(size * 0.5)} />
    </span>
  );
}

export default MusicTile;
