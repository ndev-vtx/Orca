import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ChevronLeftIcon, ChevronRightIcon } from "./Icons";

interface TopBarProps {
  title: string;
  backgroundColor?: string;
}

export default function TopBar({ title, backgroundColor }: TopBarProps) {
  const [scrolled, setScrolled] = useState(0);
  const navigate = useNavigate();

  useEffect(() => {
    const main = document.querySelector(".orca-main") as HTMLElement | null;
    if (!main) return;
    /*
     * Scroll fires far more often than React should re-render here — throttle
     * to one update per animation frame.
     */
    let raf = 0;
    const onScroll = () => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        setScrolled(main.scrollTop);
      });
    };
    main.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      main.removeEventListener("scroll", onScroll);
      if (raf) cancelAnimationFrame(raf);
    };
  }, []);

  const opacity = Math.min(1, scrolled / 160);
  const bg = backgroundColor ?? "#101010";

  return (
    <header
      className="topbar"
      style={{
        backgroundColor: scrolled > 24 ? bg : "transparent",
      }}
    >
      <div className="topbar__nav">
        <button className="topbar__circle" onClick={() => navigate(-1)} aria-label="Go back">
          <ChevronLeftIcon size={16} />
        </button>
        <button className="topbar__circle" onClick={() => navigate(1)} aria-label="Go forward">
          <ChevronRightIcon size={16} />
        </button>
      </div>
      <div
        className="topbar__title"
        style={{ opacity, transform: `translateY(${(1 - opacity) * 6}px)` }}
      >
        {title}
      </div>
    </header>
  );
}
