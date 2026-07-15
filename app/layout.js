import "./globals.css";
import Providers from "./providers";

export const metadata = {
  title: "Nexoos — Website Reviewer",
  description:
    "Review, comment, and annotate website copy with your team. Collaborate on web content effortlessly.",
  icons: {
    icon: "/favicon.png",
  },
};

// Server-rendered build timestamp — visible in HTML source to debug caching
const BUILD_STAMP = new Date().toISOString();

export default function RootLayout({ children }) {
  return (
    <html lang="en" data-build={BUILD_STAMP}>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
