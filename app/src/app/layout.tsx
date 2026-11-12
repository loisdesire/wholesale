import type { Metadata } from "next";
import { Geist, Geist_Mono, Bricolage_Grotesque } from "next/font/google";
import "./globals.css";

// UI/body face. Tabular figures (see .font-tabular) keep money columns aligned.
const sans = Geist({ variable: "--font-sans", subsets: ["latin"] });

// SKUs and order references only — where telling 0 from O matters.
const mono = Geist_Mono({ variable: "--font-mono", subsets: ["latin"] });

// Display face: page titles, headline figures and marketing headlines (see globals.css).
const display = Bricolage_Grotesque({ variable: "--font-display", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Adaeze Wholesale",
  description: "Turn WhatsApp enquiries into tracked wholesale orders — inbox, orders, stock, payments and reports in one place.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${sans.variable} ${mono.variable} ${display.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
