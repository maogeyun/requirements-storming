import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "需求风暴 · Requirement Storm",
  description: "Web 联机职场卡牌游戏",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
