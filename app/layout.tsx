import type { Metadata, Viewport } from "next";
import { t } from "@/lib/textos";
import "./globals.css";

export const metadata: Metadata = {
  title: t.app.titol,
  description: t.app.descripcio,
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ca">
      <body className="bg-gray-50 text-gray-900 antialiased">{children}</body>
    </html>
  );
}
