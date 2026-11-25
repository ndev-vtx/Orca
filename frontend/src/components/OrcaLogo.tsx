interface OrcaLogoProps {
  collapsed?: boolean;
}

export function OrcaMark({ size = 30 }: { size?: number }) {
  return (
    <svg viewBox="0 0 64 64" width={size} height={size} aria-hidden="true">
      <rect width="64" height="64" rx="14" fill="#05070C" stroke="rgba(77,107,254,0.55)" strokeWidth="2" />
      <path
        d="M14 40c4-14 14-22 26-22 5 0 9 2 10 6-8-2-14 1-19 8 7-3 13-2 17 3-4 5-10 7-17 5 3 4 3 8 0 12-6-1-13-5-17-12z"
        fill="#4D6BFE"
      />
      <circle cx="42" cy="22" r="2.6" fill="#05070C" />
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
