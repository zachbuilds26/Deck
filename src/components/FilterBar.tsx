"use client";

import { useState } from "react";
import { AGENT_CATEGORIES } from "@/lib/constants";

function CategoryButton({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onMouseDown={(event) => event.preventDefault()}
      onClick={onClick}
      aria-pressed={active}
      className={`filter-category-button chamfer-sm h-9 whitespace-nowrap border px-3 text-[12px] font-semibold transition-colors ${
        active
          ? "border-[#F0B90B] bg-[#F0B90B] text-black"
          : "border-transparent text-[#999] hover:border-[#2f2f2f] hover:text-white"
      }`}
    >
      {label}
    </button>
  );
}

function CategoryDropdown({
  activeCategory,
  onCategoryChange,
}: {
  activeCategory: string;
  onCategoryChange: (cat: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const currentCategory = CATEGORIES.find((category) => category.id === activeCategory) || CATEGORIES[0];

  return (
    <div
      className="relative sm:hidden"
      onKeyDown={(event) => {
        if (event.key === "Escape") setOpen(false);
      }}
    >
      <button
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        className="flex h-9 max-w-[92px] items-center gap-2 overflow-hidden border border-[#2f2f2f] bg-[#141414] px-3 text-[12px] font-bold text-[#999] transition-colors hover:border-[#666] hover:text-[#d3d3d3]"
      >
        {/* Capped and truncated, exactly like the sort button beside it. Without a
            max width the control grew to fit whatever was selected, so picking
            "Yield Optimisation" pushed it into the search box. The label is
            already repeated in the open menu, so a clipped one loses nothing. */}
        <span className="truncate">{currentCategory.label}</span>
        <svg
          className="shrink-0"
          width="12"
          height="12"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute left-0 top-full z-50 mt-1 w-44 border border-[#2f2f2f] bg-[#141414] py-1 shadow-2xl">
            {CATEGORIES.map((category) => (
              <button
                key={category.id}
                onClick={() => {
                  onCategoryChange(category.id);
                  setOpen(false);
                }}
                className={`w-full px-4 py-2.5 text-left text-xs transition-colors ${
                  activeCategory === category.id
                    ? "bg-[#F0B90B] text-black"
                    : "text-[#999] hover:bg-[#1c1c1c] hover:text-white"
                }`}
              >
                {category.label}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

// The four categories the hackathon scores on, straight from AGENT_CATEGORIES so
// the filter bar can never drift from what the backend matches against.
const CATEGORIES: { id: string; label: string }[] = [
  { id: "all", label: "All" },
  ...AGENT_CATEGORIES.map((category) => ({ id: category.id, label: category.label })),
];

const SORT_OPTIONS = [
  { id: "default", label: "Default" },
  { id: "paid", label: "Paid First" },
  { id: "score", label: "Highest Rated" },
  { id: "feedback", label: "Most Feedback" },
  { id: "newest", label: "Newest" },
];

interface FilterBarProps {
  searchQuery: string;
  onSearchQueryChange: (query: string) => void;
  activeCategory: string;
  onCategoryChange: (cat: string) => void;
  sortBy: string;
  onSortChange: (sort: string) => void;
}

export default function FilterBar({
  searchQuery,
  onSearchQueryChange,
  activeCategory,
  onCategoryChange,
  sortBy,
  onSortChange,
}: FilterBarProps) {
  const [sortOpen, setSortOpen] = useState(false);
  const currentSort = SORT_OPTIONS.find((s) => s.id === sortBy);

  return (
    <div className="sticky top-0 z-40 bg-black/95 backdrop-blur-md">
      <div className="mx-auto flex max-w-[1440px] items-center justify-between gap-4 px-5 sm:px-8 lg:px-12">
        <div className="min-w-0 flex-1 py-3">
          <div className="hidden w-max gap-1 sm:flex">
            {CATEGORIES.map((cat) => (
              <CategoryButton
                key={cat.id}
                label={cat.label}
                active={activeCategory === cat.id}
                onClick={() => onCategoryChange(cat.id)}
              />
            ))}
          </div>
          <CategoryDropdown
            activeCategory={activeCategory}
            onCategoryChange={onCategoryChange}
          />
        </div>

        <label className="relative w-[180px] flex-shrink-0 overflow-hidden transition-all duration-200 sm:w-[230px]">
          <span className="sr-only">Search agents by name or agent ID</span>
          <svg aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[#666]" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="7" /><path d="m20 20-4-4" /></svg>
          <input value={searchQuery} onChange={(event) => onSearchQueryChange(event.target.value)} placeholder="Search name or agent ID" aria-label="Search agents by name or agent ID" className="h-9 w-full border border-[#2f2f2f] bg-[#0d0d0d] pl-9 pr-3 text-[11px] text-[#f5f5f5] placeholder:text-transparent outline-none transition-colors focus:border-[#F0B90B] sm:placeholder:text-[#666]" />
        </label>

        <div className="flex flex-shrink-0 items-center gap-2 py-3">
          <div
            className="relative"
            onKeyDown={(event) => {
              if (event.key === "Escape") setSortOpen(false);
            }}
          >
            <button
              aria-haspopup="menu"
              aria-expanded={sortOpen}
              onClick={() => setSortOpen(!sortOpen)}
              className="flex h-9 max-w-[92px] items-center gap-2 overflow-hidden border border-[#2f2f2f] px-3 text-[11px] font-bold text-[#999] transition-colors hover:border-[#666] hover:text-[#d3d3d3] sm:max-w-none"
            >
              <span className="truncate">{currentSort?.label}</span>
              <svg
                width="12"
                height="12"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <polyline points="6 9 12 15 18 9" />
              </svg>
            </button>

            {sortOpen && (
              <>
                <div
                  className="fixed inset-0 z-40"
                  onClick={() => setSortOpen(false)}
                />
                <div className="absolute right-0 top-full z-50 mt-1 w-44 border border-[#2f2f2f] bg-[#141414] py-1 shadow-2xl">
                  {SORT_OPTIONS.map((opt) => (
                    <button
                      key={opt.id}
                      onClick={() => {
                        onSortChange(opt.id);
                        setSortOpen(false);
                      }}
                      className={`w-full px-4 py-2.5 text-left text-xs transition-colors ${
                        sortBy === opt.id
                          ? "bg-[#F0B90B] text-black"
                          : "text-[#999] hover:bg-[#1c1c1c] hover:text-white"
                      }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
