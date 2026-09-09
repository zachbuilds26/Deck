"use client";

import Image from "next/image";

/** The four ecosystems Deck actually runs on, in one place so a logo swap is one
 *  edit rather than nine.
 *
 *  `inset` is a PERCENTAGE, not pixels, so a mark stays correctly padded at every
 *  size it gets used at. BNB, TermiX and PancakeSwap's circle variant all ship
 *  with their own round backdrop and fill the badge edge to edge; Altana is a
 *  bare diamond on transparency and collides with the ring without padding. */
const MARKS = {
  bnb: { src: "/bnb.png", name: "BNB Chain", inset: "" },
  termix: { src: "/termix.png", name: "TermiX", inset: "" },
  pancakeswap: { src: "/pancakeswap-circle.png", name: "PancakeSwap", inset: "" },
  altana: { src: "/altana.png", name: "Altana", inset: "p-[16%]" },
} as const;

export type BrandId = keyof typeof MARKS;

export function brandName(id: BrandId): string {
  return MARKS[id].name;
}

/**
 * One brand logo, optionally ringed.
 *
 * `label` says whether the name is announced. Default is on. Turn it off where
 * adjacent text already names the brand — an eyebrow reading "Altana Keystore /
 * Onchain" next to an image alt of "Altana" makes a screen reader say it twice.
 */
export default function BrandMark({
  id,
  size = 16,
  ring = false,
  label = true,
  priority = false,
  className = "",
}: {
  id: BrandId;
  size?: number;
  ring?: boolean;
  label?: boolean;
  /** Preload this mark. Set it for anything above the fold — without it the
   *  optimiser is only asked for the image after hydration, so the badges
   *  visibly arrive a beat after the text they sit beside. */
  priority?: boolean;
  className?: string;
}) {
  const mark = MARKS[id];

  return (
    <span
      title={mark.name}
      style={{ width: size, height: size }}
      className={`relative inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full ${
        ring ? "border border-[#2f2f2f] bg-black" : ""
      } ${className}`}
    >
      <Image
        src={mark.src}
        alt={label ? mark.name : ""}
        aria-hidden={label ? undefined : true}
        width={size}
        height={size}
        priority={priority}
        className={`h-full w-full object-contain ${mark.inset}`}
      />
    </span>
  );
}

/**
 * Overlapping row of marks, first one on top.
 *
 * Later siblings paint over earlier ones by default, so the z-index descends —
 * otherwise the last logo in the list buries the first, and the first is the one
 * that leads for a reason.
 */
export function BrandStack({
  ids,
  size = 22,
  priority = false,
  className = "",
}: {
  ids: readonly BrandId[];
  size?: number;
  priority?: boolean;
  className?: string;
}) {
  return (
    <span className={`flex items-center ${className}`}>
      {ids.map((id, index) => (
        <span
          key={id}
          style={{ zIndex: ids.length - index, marginLeft: index === 0 ? 0 : -size * 0.36 }}
          className="relative inline-flex"
        >
          <BrandMark id={id} size={size} ring priority={priority} />
        </span>
      ))}
    </span>
  );
}
