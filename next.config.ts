import type { NextConfig } from "next";
import path from "path";

const nextConfig: NextConfig = {
  // נועל את שורש הפרויקט לתיקייה הזו (יש package-lock.json נוסף בתיקיית הבית)
  outputFileTracingRoot: path.join(__dirname),
};

export default nextConfig;
