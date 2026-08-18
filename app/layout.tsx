import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "RangeCraft · 德州扑克训练室",
  description: "本地单机德州扑克决策训练：6 人牌桌、差异化 AI、实时胜率与牌后复盘。",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
