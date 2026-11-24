// Root layout: wraps every page with <html>/<body> and loads global styles.
import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Science Diagram Maker",
  description: "AI-generated animated GCSE science diagrams, checked in code.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en">
      <body className="bg-white text-gray-900 antialiased">{children}</body>
    </html>
  );
}
