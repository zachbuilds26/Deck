/**
 * The site's external-link mark: arrow leaving a box, the same language
 * block explorers use. One shared glyph — text arrows (↗) render at the
 * font's mercy and drift per device, this one is identical everywhere.
 */
export default function ExternalArrow({ size = 10 }: { size?: number }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 16 16"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="shrink-0"
    >
      <path d="M7 3.5H3.5v9h9V9" />
      <path d="M9.5 3.5h3v3" />
      <path d="M12.5 3.5 7.5 8.5" />
    </svg>
  );
}
