import Link from "next/link";

export default function Home() {
  return (
    <main className="min-h-screen flex flex-col items-center justify-center gap-8 p-8">
      <div className="text-center max-w-xl">
        <h1 className="text-4xl font-bold mb-4">צ'אטבוט עסקי חכם</h1>
        <p className="text-neutral-400 text-lg mb-8">
          בוט שעונה על שאלות לקוחות בוואטסאפ, מסנג'ר ואינסטגרם — עם שליטה מלאה
          ומידע ספציפי על העסק שלך.
        </p>
        <Link
          href="/playground"
          className="inline-block bg-emerald-600 hover:bg-emerald-500 transition-colors text-white font-semibold px-8 py-3 rounded-lg"
        >
          פתח את ה-Playground לבדיקה ←
        </Link>
      </div>
      <p className="text-neutral-600 text-sm">
        ה-Playground מדבר עם אותו "מוח" בדיוק שיענה ללקוחות בוואטסאפ.
      </p>
    </main>
  );
}
