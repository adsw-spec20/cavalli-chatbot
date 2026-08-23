import type { NextConfig } from "next";
import path from "path";

const nextConfig: NextConfig = {
  // נועל את שורש הפרויקט לתיקייה הזו (יש package-lock.json נוסף בתיקיית הבית)
  outputFileTracingRoot: path.join(__dirname),

  // כותרות אבטחה לכל התשובות
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          // הדפדפן חייב לכבד את סוג התוכן שהשרת הצהיר (חוסם הברחות MIME)
          { key: "X-Content-Type-Options", value: "nosniff" },
          // אסור להטמיע את האתר בתוך iframe באתר אחר (חוסם clickjacking)
          { key: "X-Frame-Options", value: "DENY" },
          // תמיד HTTPS, שנה קדימה, כולל תתי-דומיינים
          { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" },
          // לא מדליפים כתובות פנימיות מלאות לאתרים חיצוניים
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          // הפאנל לא משתמש במצלמה/מיקרופון/מיקום - חוסם מראש
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
        ],
      },
    ];
  },
};

export default nextConfig;
