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

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
