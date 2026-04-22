import type { Metadata } from "next";
import "./globals.css";

// Fuentes del sistema para evitar fetch a Google Fonts durante build (deploy en entornos restringidos)
const fontVars = "font-sans antialiased";

export const metadata: Metadata = {
  title: "NotificasHub",
  description: "Hub central WhatsApp multi-tenant",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="es">
      <body className={fontVars}>{children}</body>
    </html>
  );
}
