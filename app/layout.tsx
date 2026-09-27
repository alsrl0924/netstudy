import type { Metadata } from "next";
import "./globals.css";
import { PwaRegister } from "@/components/pwa-register";

export const metadata: Metadata = {
  title: "네트워크관리사 문제은행",
  description: "회차별 기출, 오답, 클립, 랜덤 및 고빈도 문제를 학습하는 문제은행",
  manifest: "./manifest.webmanifest",
  applicationName: "네트워크관리사 문제은행",
  appleWebApp: {
    capable: true,
    title: "네트워크관리사 문제은행",
    statusBarStyle: "black-translucent",
  },
  icons: {
    icon: "./favicon.svg",
    shortcut: "./favicon.svg",
    apple: "./favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko">
      <body className="antialiased">
        {children}
        <PwaRegister />
      </body>
    </html>
  );
}
