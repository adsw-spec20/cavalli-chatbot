/**
 * Service Worker של התראות פוש - וזהו.
 *
 * ⚠️ בכוונה אין כאן שום טיפול ב-fetch ושום קאש: בעבר החלטנו לא להוסיף
 * service worker לפאנל כי קאש אופליין החזיר דאטה ישן לצוות. הקובץ הזה
 * מטפל אך ורק באירועי push ולחיצה על התראה - הוא לא נוגע בשום בקשת רשת,
 * אז רעננות הנתונים לא מושפעת. אל תוסיפו כאן מאזין fetch.
 */

self.addEventListener("install", () => {
  // גרסה חדשה של הקובץ נכנסת לפעולה מיד, בלי לחכות לסגירת כל הטאבים
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    /* payload לא-JSON - נציג ברירת מחדל */
  }
  const title = data.title || "קפה קוואלי";
  event.waitUntil(
    self.registration.showNotification(title, {
      body: data.body || "",
      dir: "rtl",
      lang: "he",
      // tag מאחד התראות כפולות על אותו אירוע (מכשיר לא יוצף)
      tag: data.tag || undefined,
      icon: "/icons/icon-192.png",
      badge: "/icons/icon-192.png",
      data: { url: data.url || "/admin" },
    })
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || "/admin";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
      // אם הפאנל כבר פתוח - מתמקדים בו ומבקשים ממנו לנווט (למשל לפתוח את
      // השיחה שההתראה מדברת עליה) בלי טעינה מחדש של כל האפליקציה
      for (const client of list) {
        if (client.url.includes("/admin") && "focus" in client) {
          client.postMessage({ type: "open-url", url });
          return client.focus();
        }
      }
      return self.clients.openWindow(url);
    })
  );
});
