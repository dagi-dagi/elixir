import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { brand } from "@/config/brand";
import { AmbientBackground } from "@/components/brand/ambient-background";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const defaultTitle = `${brand.name} — ${brand.tagline}`;

export const metadata: Metadata = {
  metadataBase: new URL(brand.url),
  title: { default: defaultTitle, template: `%s · ${brand.name}` },
  description: brand.description,
  applicationName: brand.name,
  keywords: [...brand.keywords],
  authors: [{ name: brand.name, url: brand.url }],
  creator: brand.name,
  publisher: brand.name,
  category: "utilities",
  icons: {
    icon: [{ url: brand.icon, type: "image/svg+xml" }],
    shortcut: brand.icon,
    apple: brand.icon,
  },
  appleWebApp: { capable: true, title: brand.shortName, statusBarStyle: "default" },
  formatDetection: { telephone: false },
  openGraph: {
    type: "website",
    siteName: brand.name,
    title: defaultTitle,
    description: brand.description,
    url: "/",
    locale: brand.locale,
  },
  twitter: {
    card: "summary_large_image",
    title: defaultTitle,
    description: brand.description,
    site: brand.social.twitterHandle,
    creator: brand.social.twitterHandle,
  },
};

export const viewport: Viewport = {
  themeColor: brand.colors.themeColor,
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang={brand.locale.split("_")[0]}
      data-theme={brand.theme}
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full">
        <AmbientBackground />
        {children}
      </body>
    </html>
  );
}
