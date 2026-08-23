import type { Metadata, Viewport } from "next";

/**
 * PWA: הופך את הפאנל לאפליקציה מותקנת אמיתית. "הוספה למסך הבית" נותנת
 * אייקון ממותג ופתיחה במסך מלא בלי כרום דפדפן (אנדרואיד דרך ה-manifest,
 * iOS דרך appleWebApp). בכוונה בלי service worker - קאש אופליין היה מחזיר
 * את בעיית הדאטה הישן שכבר טופלה ברענון בחזרה מרקע.
 */
export const metadata: Metadata = {
  title: "קפה קוואלי - פאנל ניהול",
  description: "פאנל ניהול ושירות הלקוחות של קפה קוואלי",
  manifest: "/admin-manifest.webmanifest",
  appleWebApp: { capable: true, title: "קוואלי", statusBarStyle: "default" },
  icons: { apple: "/icons/apple-touch-icon.png" },
};

// צבע שורת הסטטוס במצב מותקן - תואם לרקע ערכת הנושא הבהירה (ברירת המחדל)
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#f8f5ef",
};

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return children;
}
