/** @type {import('next').NextConfig} */
const nextConfig = {
  serverExternalPackages: ["puppeteer-core", "puppeteer-extra", "puppeteer-extra-plugin-stealth"],

  // Unique build ID per deployment — forces all chunk filenames to change
  generateBuildId: async () => {
    return `build-${Date.now()}`;
  },

  headers: async () => [
    {
      // All page routes — no caching at all
      source: "/((?!_next/static|_next/image|favicon.ico).*)",
      headers: [
        { key: "Cache-Control", value: "no-store, no-cache, must-revalidate, proxy-revalidate" },
        { key: "Pragma", value: "no-cache" },
        { key: "Expires", value: "0" },
        { key: "Surrogate-Control", value: "no-store" },
      ],
    },
    {
      // Even static assets — short cache, must revalidate (override immutable)
      source: "/_next/static/:path*",
      headers: [
        { key: "Cache-Control", value: "public, max-age=60, must-revalidate" },
      ],
    },
  ],
};

export default nextConfig;
