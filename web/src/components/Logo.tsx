/** ZhukoNet mark: a minimal black beetle (top view) on a white disc. */
export function LogoMark({ size = 32, className }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" className={className} role="img" aria-label="ZhukoNet">
      <circle cx="32" cy="32" r="32" fill="#fff" />
      <g transform="translate(0 2)">
        <path
          d="M29.5 14.5 25 9M34.5 14.5 39 9M24 25l-7-3.5M22 34h-8M23 43l-7 5M40 25l7-3.5M42 34h8M41 43l7 5"
          stroke="#0a0a0a"
          strokeWidth="2.2"
          strokeLinecap="round"
          fill="none"
        />
        <g fill="#0a0a0a">
          <path d="M28 20v-3a4 4 0 0 1 8 0v3z" />
          <path d="M23 28l2-7h14l2 7z" />
          <path d="M31.2 29.5V52C25.5 52 21.5 47 21.5 40.5V29.5z" />
          <path d="M32.8 29.5V52C38.5 52 42.5 47 42.5 40.5V29.5z" />
        </g>
      </g>
    </svg>
  );
}

export function Wordmark({ className }: { className?: string }) {
  return (
    <span className={className}>
      <span className="font-semibold tracking-tight">Zhuko</span>
      <span className="font-semibold tracking-tight text-muted">Net</span>
    </span>
  );
}
