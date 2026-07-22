import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "צ'אטבוט עסקי",
  description: "בוט חכם שעונה על שאלות לקוחות בוואטסאפ, מסנג'ר ואינסטגרם",
};

// במפורש בלי maximum-scale / user-scalable - זום של המשתמש נשאר פעיל (נגישות)
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
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
