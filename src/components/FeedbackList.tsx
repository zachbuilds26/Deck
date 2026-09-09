"use client";

import { useState } from "react";
import { timeAgo } from "@/lib/agent-status";
import type { AgentFeedback } from "@/lib/types";

function UserIcon() {
  return (
    <span
      aria-hidden="true"
      className="flex h-8 w-8 shrink-0 items-center justify-center border border-[#2f2f2f] bg-[#141414]"
    >
      <svg
        width="14"
        height="14"
        viewBox="0 0 24 24"
        fill="none"
        stroke="#F0B90B"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <circle cx="12" cy="8.5" r="3.75" />
        <path d="M4.5 20c1.6-3.6 4.2-5.4 7.5-5.4s5.9 1.8 7.5 5.4" />
      </svg>
    </span>
  );
}

const PER_PAGE = 5;

function Chevron({ dir }: { dir: "left" | "right" }) {
  return (
    <svg
      aria-hidden="true"
      width="13"
      height="13"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <polyline points={dir === "left" ? "14 6 8 12 14 18" : "10 6 16 12 10 18"} />
    </svg>
  );
}

function Stars({ value, size = 12 }: { value: number; size?: number }) {
  const full = Math.round(Math.min(5, Math.max(0, value)));
  return (
    <span
      className="inline-flex items-center gap-[3px]"
      role="img"
      aria-label={`${value.toFixed(1)} out of 5 stars`}
    >
      {[1, 2, 3, 4, 5].map((star) => (
        <svg
          key={star}
          aria-hidden="true"
          width={size}
          height={size}
          viewBox="0 0 24 24"
          fill={star <= full ? "#F0B90B" : "none"}
          stroke={star <= full ? "none" : "#4a4a4a"}
          strokeWidth="1.7"
        >
          <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
        </svg>
      ))}
    </span>
  );
}

function shortReviewer(address: string): string {
  if (!address) return "Unknown";
  // Non-address reviewer ids must not be sliced into misleading fragments.
  if (!/^0x/i.test(address)) return "Unknown";
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

export default function FeedbackList({ feedback }: { feedback: AgentFeedback[] }) {
  const [page, setPage] = useState(0);

  const pageCount = Math.max(1, Math.ceil(feedback.length / PER_PAGE));
  const current = Math.min(page, pageCount - 1);
  const start = current * PER_PAGE;
  const rows = feedback.slice(start, start + PER_PAGE);

  const navClasses =
    "flex h-8 w-8 items-center justify-center border border-[#2f2f2f] text-[#999] transition-colors hover:border-[#666] hover:text-[#f5f5f5] disabled:cursor-not-allowed disabled:border-[#232323] disabled:text-[#3f3f3f]";

  return (
    <div className="deck-frame mt-5 border border-[#2f2f2f] bg-[#141414]">
      <ul>
        {rows.map((item) => {
          const ago = timeAgo(item.createdAt);
          return (
            <li key={item.id} className="border-b border-[#242424] px-5 py-5 last:border-b-0 sm:px-6">
              <div className="flex items-center gap-3">
                <UserIcon />
                <span className="truncate text-[12px] font-semibold text-[#f5f5f5]">
                  {shortReviewer(item.reviewer)}
                </span>
                {ago && (
                  <span className="ml-auto shrink-0 text-[11px] text-[#666]">{ago}</span>
                )}
              </div>
              <div className="mt-2.5">
                <Stars value={item.rating} />
              </div>
              <p className="mt-2.5 text-[12px] leading-6 text-[#b5b5b5]">
                {item.comment || "No written comment."}
              </p>
            </li>
          );
        })}
      </ul>

      {feedback.length > PER_PAGE && (
        <div className="flex items-center justify-end gap-3 px-5 pb-4 pt-1">
          <span className="text-[10px] font-semibold uppercase text-[#666]">
            {start + 1}–{start + rows.length} of {feedback.length}
          </span>
          <button
            type="button"
            onClick={() => setPage(current - 1)}
            disabled={current === 0}
            aria-label="Previous feedback"
            className={navClasses}
          >
            <Chevron dir="left" />
          </button>
          <button
            type="button"
            onClick={() => setPage(current + 1)}
            disabled={current >= pageCount - 1}
            aria-label="Next feedback"
            className={navClasses}
          >
            <Chevron dir="right" />
          </button>
        </div>
      )}
    </div>
  );
}
