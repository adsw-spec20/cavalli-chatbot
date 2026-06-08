import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "צ'אטבוט עסקי",
  description: "בוט חכם שעונה על שאלות לקוחות בוואטסאפ, מסנג'ר ואינסטגרם",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="he" dir="rtl">
      <body>{children}</body>
    </html>
  );
}
