import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "LPL Advisor Copilot — Agent Dashboard",
  description: "AI-powered portfolio risk intelligence for financial advisors",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-slate-50 font-sans text-sm leading-relaxed text-slate-800">
        {children}
      </body>
    </html>
  );
}
