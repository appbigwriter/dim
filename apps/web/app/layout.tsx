import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = {
  title: {
    default: "DIM — Digital Influencer Management",
    template: "%s | DIM",
  },
  description:
    "Gestão corporativa de influenciadores, governança e operações editoriais.",
  robots: { index: false, follow: false },
};
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="pt-BR">
      <body>{children}</body>
    </html>
  );
}
