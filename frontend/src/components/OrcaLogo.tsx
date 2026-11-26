interface OrcaLogoProps {
  collapsed?: boolean;
}

/*
 * Sharper mark: a sleek orca silhouette cutting through deep black, in the
 * DeepSeek dolphin-style gradient (#6E8BFF -> #4D6BFE) with the white eye
 * patch that makes an orca unmistakable.
 */
export function OrcaMark({ size = 30 }: { size?: number }) {
  return (
    <svg viewBox="0 0 64 64" width={size} height={size} aria-hidden="true">
      <defs>
        <linearGradient id="orca-body" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#6E8BFF" />
          <stop offset="1" stopColor="#4D6BFE" />
        </linearGradient>
      </defs>
      <rect width="64" height="64" rx="16" fill="#05070C" stroke="rgba(110,139,255,0.45)" strokeWidth="1.5" />
      <path
        d="M50.5 15.5c-1.8 7.2-5.4 12.4-10.4 16.4-4.4 3.6-9.6 5.7-14.6 8.1-3.4 1.6-6.6 3.4-8.6 6.6-1.2 1.9-1.9 4.1-2 6.9-2.4-1.5-4.3-3.4-5.5-5.9-1.3-2.6-1.7-5.4-1.4-8.4.6-6.2 3.9-11.2 8.6-15.2 4.2-3.6 9.2-6.1 14.2-8.2 3.1-1.3 6.2-2.5 9.2-3.8 3.5-1.5 7-2.7 10.5-3.5-.1 2.4-.2 4.7 0 7z"
        fill="url(#orca-body)"
      />
      <path
        d="M14.9 53.5c1.6-4.6 4.6-7.9 8.8-10.2-.9 3.6-.6 6.9.9 9.9-3.3.7-6.5 1-9.7.3z"
        fill="url(#orca-body)"
      />
      <path
        d="M31 38.5c2.6 1.4 4.4 3.6 5.3 6.7-2.9-.4-5.3-1.7-7.1-3.9-1.7-2.1-2.6-4.6-2.8-7.4 1.7 2 3.2 3.5 4.6 4.6z"
        fill="#6E8BFF"
        opacity="0.85"
      />
      <ellipse cx="41.5" cy="21.5" rx="4.4" ry="2.2" transform="rotate(-28 41.5 21.5)" fill="#F4F6FF" />
      <circle cx="43.4" cy="21" r="1.5" fill="#05070C" />
    </svg>
  );
}

export default function OrcaLogo({ collapsed = false }: OrcaLogoProps) {
  if (collapsed) {
    return (
      <div className="orca-logo orca-logo--collapsed" title="Orca">
        <OrcaMark />
      </div>
    );
  }
  return (
    <div className="orca-logo" title="Orca">
      <OrcaMark />
      <span className="orca-logo__word">
        Orca<span className="orca-logo__dot">.</span>
      </span>
    </div>
  );
}
