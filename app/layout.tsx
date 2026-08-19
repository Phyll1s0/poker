import type { Metadata, Viewport } from "next";
import { headers } from "next/headers";
import "./globals.css";

const title = "RangeCraft · 德州扑克训练室";
const description = "从单人混合频率训练到 2–6 人私人牌桌：练决策、看复盘，也和朋友在线实战。";
const fallbackOrigin = "https://poker.phyll1s0.com";

export async function generateMetadata(): Promise<Metadata> {
  const requestHeaders = await headers();
  const forwardedHost = requestHeaders.get("x-forwarded-host")?.split(",")[0]?.trim();
  const requestHost = forwardedHost || requestHeaders.get("host")?.trim();
  const safeHost = requestHost && /^[a-z0-9.-]+(?::\d+)?$/i.test(requestHost) ? requestHost : null;
  const protocol = safeHost?.startsWith("localhost") || safeHost?.startsWith("127.0.0.1") ? "http" : "https";
  const origin = safeHost ? `${protocol}://${safeHost}` : fallbackOrigin;
  const socialImage = new URL("/og.png", origin).toString();

  return {
    title,
    description,
    applicationName: "RangeCraft",
    metadataBase: new URL(origin),
    manifest: "/manifest.webmanifest",
    appleWebApp: {
      capable: true,
      title: "RangeCraft",
      statusBarStyle: "black-translucent",
    },
    icons: {
      icon: "/favicon.svg",
      shortcut: "/favicon.svg",
      apple: "/apple-touch-icon.png",
    },
    openGraph: {
      type: "website",
      locale: "zh_CN",
      url: origin,
      siteName: "RangeCraft",
      title,
      description,
      images: [{ url: socialImage, width: 1200, height: 630, alt: "RangeCraft 深绿色德州扑克训练桌" }],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: [socialImage],
    },
  };
}

export const viewport: Viewport = {
  colorScheme: "dark",
  themeColor: "#111514",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
