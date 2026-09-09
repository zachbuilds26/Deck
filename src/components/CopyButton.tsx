"use client";

import { useEffect, useRef, useState } from "react";

/** Small inline copy control. Sits next to the value it copies. */
export default function CopyButton({
  value,
  label = "Copy",
}: {
  value: string;
  label?: string;
}) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<number | undefined>(undefined);

  useEffect(() => () => window.clearTimeout(timer.current), []);

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => setCopied(false), 1600);
    } catch {
      // Clipboard access needs a secure context; leave the icon unchanged.
      setCopied(false);
    }
  }

  return (
    <button
      type="button"
      onClick={copy}
      title={copied ? "Copied" : label}
      aria-label={copied ? "Copied" : label}
      className="inline-flex h-6 w-6 items-center justify-center align-middle text-[#666] transition-colors hover:text-[#d3d3d3] focus-visible:text-[#d3d3d3] focus-visible:outline-none"
    >
      <svg
        aria-hidden="true"
        width="12"
        height="12"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        {copied ? (
          <path d="m5 12.5 4.5 4.5L19 7.5" />
        ) : (
          <>
            <rect x="9" y="9" width="11.5" height="11.5" rx="2" />
            <path d="M15 5.5A2 2 0 0 0 13 3.5H5.5a2 2 0 0 0-2 2V13a2 2 0 0 0 2 2" />
          </>
        )}
      </svg>
      <span aria-live="polite" className="sr-only">
        {copied ? "Copied" : ""}
      </span>
    </button>
  );
}
