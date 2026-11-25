import type { Metadata } from "next";
import { Figtree, Geist_Mono } from "next/font/google";
import "./globals.css";

// UI/body face. Tabular figures (see .font-tabular) keep money columns aligned.
const sans = Figtree({ variable: "--font-sans", subsets: ["latin"] });

// SKUs and order references only — where telling 0 from O matters.
const mono = Geist_Mono({ variable: "--font-mono", subsets: ["latin"] });

// Headings use the same family as the body (see .font-display in globals.css) so the app reads as one voice.

export const metadata: Metadata = {
  title: "Adaeze Wholesale",
  description: "Turn WhatsApp enquiries into tracked wholesale orders — inbox, orders, stock, payments and reports in one place.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${sans.variable} ${mono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
