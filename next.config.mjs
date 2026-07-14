/** @type {import('next').NextConfig} */
const nextConfig = {
  serverExternalPackages: ["@sparticuz/chromium", "puppeteer-core"],
  outputFileTracingIncludes: {
    "/api/proxy": ["./node_modules/@sparticuz/chromium/**/*"],
    "/api/screenshot": ["./node_modules/@sparticuz/chromium/**/*"],
  },
};

export default nextConfig;
