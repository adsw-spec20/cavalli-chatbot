import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { NextResponse } from "next/server";
import { safeTokenEqual } from "@/lib/admin-auth";

export const runtime = "nodejs";

/**
 * העלאה ישירה מהדפדפן ל-Blob (client upload). מסלול זה רק מנפיק טוקן קצר-מועד
 * ומאמת הרשאה - הקובץ עצמו עולה ישירות מהדפדפן ל-Blob, כך שעוקפים את מגבלת
 * ה-~4.5MB של פונקציות שרת ותומכים בסרטונים גדולים.
 */
export async function POST(req: Request): Promise<NextResponse> {
  const body = (await req.json()) as HandleUploadBody;
  try {
    const result = await handleUpload({
      body,
      request: req,
      onBeforeGenerateToken: async (_pathname, clientPayload) => {
        // הרשאה: הפאנל שולח את ה-ADMIN_TOKEN כ-clientPayload.
        // כמו בשאר הפאנל: בלי טוקן מוגדר - חסום בפרודקשן (fail closed).
        const expected = process.env.ADMIN_TOKEN;
        if (!expected) {
          if (process.env.NODE_ENV === "production" || process.env.VERCEL_ENV) {
            throw new Error("unauthorized");
          }
        } else if (!safeTokenEqual(expected, clientPayload ?? "")) {
          throw new Error("unauthorized");
        }
        return {
          allowedContentTypes: [
            "image/jpeg",
            "image/png",
            "image/webp",
            "image/gif",
            "image/heic",
            "video/mp4",
            "video/quicktime",
            "video/webm",
          ],
          maximumSizeInBytes: 100 * 1024 * 1024, // עד 100MB
          addRandomSuffix: true,
        };
      },
      onUploadCompleted: async () => {
        // לא נדרש - הדפדפן שומר את הכתובת בעצמו
      },
    });
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "upload failed" },
      { status: 400 }
    );
  }
}
