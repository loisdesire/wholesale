import type { Metadata } from "next";
import { Figtree, Geist_Mono } from "next/font/google";
import "./globals.css";
import { BRAND_DESCRIPTION, BRAND_NAME } from "@/lib/brand";

// UI/body face. Tabular figures (see .font-tabular) keep money columns aligned.
const sans = Figtree({ variable: "--font-sans", subsets: ["latin"] });

// SKUs and order references only — where telling 0 from O matters.
const mono = Geist_Mono({ variable: "--font-mono", subsets: ["latin"] });

// Headings use the same family as the body (see .font-display in globals.css) so the app reads as one voice.

export const metadata: Metadata = {
  // Each page sets its own title ("Orders"); the template adds the product name after it.
  title: { default: BRAND_NAME, template: `%s · ${BRAND_NAME}` },
  description: BRAND_DESCRIPTION,
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
