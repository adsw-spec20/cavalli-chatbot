# תמונות (חניה ועוד)

שים כאן תמונות שהבוט יוכל לשלוח. כל קובץ בתיקייה הזו נגיש בכתובת:
`https://<your-app>.vercel.app/images/<שם-הקובץ>`

## דוגמה: תמונות חניה
1. שמור כאן: `public/images/parking-1.jpg`, `public/images/parking-2.jpg`
2. עדכן ב-`src/lib/business-config.ts` בתוך `parking.imageUrls`:
   ```ts
   imageUrls: [
     "/images/parking-1.jpg",
     "/images/parking-2.jpg",
   ],
   ```
3. ב-Playground הבוט ישתף את הקישור. בוואטסאפ (אחרי החיבור) הוא ישלח את התמונה
   עצמה כהודעת תמונה.

> טיפ: תמונות עד ~1MB, פורמט JPG/PNG, רוחב ~1080px מספיק.
