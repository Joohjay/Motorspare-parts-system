interface GearMarkProps {
  className?: string;
}

export function GearMark({ className = '' }: GearMarkProps) {
  return (
    <svg
      viewBox="0 0 64 64"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      className={className}
    >
      <rect
        x="2"
        y="2"
        width="60"
        height="60"
        rx="14"
        fill="currentColor"
        opacity="0.12"
      />
      <circle
        cx="32"
        cy="32"
        r="9"
        stroke="currentColor"
        strokeWidth="5"
      />
      <path
        d="M32 6v7M32 51v7M6 32h7M51 32h7M14 14l5 5M45 45l5 5M50 14l-5 5M19 45l-5 5"
        stroke="currentColor"
        strokeWidth="5"
        strokeLinecap="round"
      />
    </svg>
  );
}