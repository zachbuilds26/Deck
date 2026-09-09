import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    // Vestigial: AgentAvatar deliberately uses plain <img> through Deck's own
    // /api/avatar proxy (the optimiser timed out on the media endpoint), so
    // nothing reads remotePatterns today. Kept so next/image stays available.
    remotePatterns: [{ protocol: "https", hostname: "api.8004scan.io" }],
  },
};

export default nextConfig;
