import type { ReactNode, SVGProps } from "react";

type IconProps = SVGProps<SVGSVGElement> & { size?: number };

function base({ size = 16, ...rest }: IconProps, children: ReactNode) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="currentColor"
      aria-hidden="true"
      {...rest}
    >
      {children}
    </svg>
  );
}

export const HomeIcon = (p: IconProps) =>
  base(p, <path d="M12 3 3 10.5V21h6v-6h6v6h6V10.5L12 3Z" />);

export const SearchIcon = (p: IconProps) =>
  base(
    p,
    <path d="M10.5 3a7.5 7.5 0 1 1-4.68 13.36l-3.23 3.23-1.42-1.42 3.23-3.23A7.5 7.5 0 0 1 10.5 3Zm0 2a5.5 5.5 0 1 0 0 11 5.5 5.5 0 0 0 0-11Z" />,
  );

export const LibraryIcon = (p: IconProps) =>
  base(
    p,
    <path d="M4 3h2v18H4V3Zm4 0h2v18H8V3Zm5.1.6 8.64 16.12-1.76.94L11.34 4.54l1.76-.94Z" />,
  );

export const PlayIcon = (p: IconProps) => base(p, <path d="M7 4.5v15l13-7.5-13-7.5Z" />);

export const PauseIcon = (p: IconProps) => base(p, <path d="M6 4h4v16H6V4Zm8 0h4v16h-4V4Z" />);

export const ShuffleIcon = (p: IconProps) =>
  base(
    p,
    <path d="M17 3.5 21.5 8 17 12.5V9.6c-3 .2-4.7 1.6-6.5 3.9C8.2 16.3 5.7 18 2 18v-2.6c2.8 0 4.4-1.1 6.2-3.4C10.4 9.2 12.8 7 17 6.7V3.5ZM2 6c3.7 0 6.2 1.7 8.5 4.5l.7.9c-1 1.3-1.9 2.3-2.8 3L7 13C5.5 11.3 4 10.6 2 10.6V6Zm15 8.5 4.5 4.5L17 23.5v-3.2c-2.9-.2-5.1-1.4-7-3.2l.9-1.2c.7-.9 1.5-.9 2.3-.2 1.2 1 2.4 1.6 3.8 1.7V14.5Z" />,
  );

export const PrevIcon = (p: IconProps) => base(p, <path d="M6 5h2.5v14H6V5Zm12 .8v12.4L8.8 12 18 5.8Z" />);

export const NextIcon = (p: IconProps) => base(p, <path d="M15.5 5H18v14h-2.5V5ZM6 5.8 15.2 12 6 18.2V5.8Z" />);

export const RepeatIcon = (p: IconProps) =>
  base(
    p,
    <path d="M7 7h10v3l4-4-4-4v3H5v6h2V7Zm10 10H7v-3l-4 4 4 4v-3h12v-6h-2v4Z" />,
  );

export const RepeatOneIcon = (p: IconProps) =>
  base(
    p,
    <path d="M7 7h10v3l4-4-4-4v3H5v6h2V7Zm10 10H7v-3l-4 4 4 4v-3h12v-6h-2v4Zm-5-8-2 .9v1.6L12 11v5h2V9h-2Z" />,
  );

export const HeartIcon = (p: IconProps) =>
  base(
    p,
    <path d="M12 21s-7.5-4.7-10-9.3C.3 8.6 2 5 5.5 5c2 0 3.4 1 4.5 2.6h4c1.1-1.6 2.5-2.6 4.5-2.6C22 5 23.7 8.6 22 11.7 19.5 16.3 12 21 12 21Z" />,
  );

export const HeartOutlineIcon = (p: IconProps) =>
  base(
    p,
    <path d="M12 21s-7.5-4.7-10-9.3C.3 8.6 2 5 5.5 5c2 0 3.4 1 4.5 2.6h4C15.1 6 16.5 5 18.5 5 22 5 23.7 8.6 22 11.7 19.5 16.3 12 21 12 21Zm-1.2-11.4C9.9 8 8.6 7 5.7 7 3.6 7 2.8 9 4 11.2 5.6 14.2 10.4 17.6 12 18.8c1.6-1.2 6.4-4.6 8-7.6C21.2 9 20.4 7 18.3 7c-2.9 0-4.2 1-5.1 2.6L12 11.2l-1.2-1.6Z" />,
  );

export const QueueIcon = (p: IconProps) =>
  base(
    p,
    <path d="M3 5h18v2H3V5Zm0 6h18v2H3v-2Zm0 6h12v2H3v-2Zm14.5-1 5 2.5-5 2.5v-5Z" />,
  );

export const VolumeIcon = (p: IconProps) =>
  base(
    p,
    <path d="M4 9v6h4l5 4V5L8 9H4Zm12.5 3a4.5 4.5 0 0 0-2-3.7v7.3a4.5 4.5 0 0 0 2-3.6Zm-2-8.5v2.1a7 7 0 0 1 0 12.8v2.1a9 9 0 0 0 0-17Z" />,
  );

export const MuteIcon = (p: IconProps) =>
  base(
    p,
    <path d="M4 9v6h4l5 4V5L8 9H4Zm11.3.9 1.4-1.4L19 10.6l2.3-2.1 1.4 1.4-2.3 2.1 2.3 2.1-1.4 1.4L19 13.4l-2.3 2.1-1.4-1.4 2.3-2.1-2.3-2.1Z" />,
  );

export const ChevronLeftIcon = (p: IconProps) => base(p, <path d="M15 4.5 7.5 12l7.5 7.5 1.4-1.4-6-6.1 6-6.1L15 4.5Z" />);

export const ChevronRightIcon = (p: IconProps) => base(p, <path d="M9 4.5 16.5 12 9 19.5l-1.4-1.4 6-6.1-6-6.1L9 4.5Z" />);

export const CloseIcon = (p: IconProps) =>
  base(p, <path d="m6.4 5 5.6 5.6L17.6 5 19 6.4 13.4 12l5.6 5.6-1.4 1.4-5.6-5.6L6.4 19 5 17.6 10.6 12 5 6.4 6.4 5Z" />);

export const PlusIcon = (p: IconProps) => base(p, <path d="M11 5h2v6h6v2h-6v6h-2v-6H5v-2h6V5Z" />);

export const TrashIcon = (p: IconProps) => base(p, <path d="M9 3h6v2h5v2H4V5h5V3Zm-3 6h12l-1 12H7L6 9Z" />);

export const LyricsIcon = (p: IconProps) =>
  base(
    p,
    <path d="M4 3h10v2H6v14h12v-8h2v10H4V3Zm4 6h8v2H8V9Zm0 4h8v2H8v-2Zm0-8h4v2H8V5Zm10-2 4-2v6.5a3 3 0 1 1-2-2.8V3Z" />,
  );

export const DeviceIcon = (p: IconProps) =>
  base(
    p,
    <path d="M7 2v5H5V2h2Zm5 0v8h-2V2h2Zm5 0v3h-2V2h2ZM5 9h14a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2h-1v3h-2v-3H8v3H6v-3H5a2 2 0 0 1-2-2v-6a2 2 0 0 1 2-2Zm0 2v6h14v-6H5Z" />,
  );
