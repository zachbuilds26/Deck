import BrandMark from "@/components/BrandMark";

export default function Footer() {
  return (
    <footer className="border-t border-[#1c1c1c] bg-black">
      <div className="mx-auto flex max-w-[1440px] items-center justify-between gap-4 px-5 py-4 text-[12px] text-[#666] sm:px-8 lg:px-12">
        <span>Deck — BNB agent marketplace</span>
        <span className="hidden items-center gap-2 sm:inline-flex">
          {/* label={false}: the sentence beside it already says BNB Smart Chain. */}
          <BrandMark id="bnb" size={15} label={false} />
          Built on BNB Smart Chain
        </span>
      </div>
    </footer>
  );
}
