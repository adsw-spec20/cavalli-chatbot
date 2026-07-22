# Meta App Review — Caffe Cavalli Chatbot

Everything needed to submit App Review for the messaging permissions, ready to paste.
Meta reviewers read **English**, so the descriptions are in English; customer-facing test
phrases are in Hebrew (the app is a Hebrew-language assistant).

App: **CaffeCavalli Chatbot** · App ID **1499744815172250** · Type: Business
Privacy policy: https://cavalli-chatbot.vercel.app/privacy

---

## 1. App overview (paste into the App Review "App Verification" / use-case box)

CaffeCavalli Chatbot is a customer-support assistant for a single restaurant —
Caffe Cavalli (קפה קוואלי), a dairy-kosher café in Holon, Israel. It answers customer
questions in Hebrew (menu, opening hours, parking, kosher certification, reservations,
private events) on the business's own Facebook Page (Messenger) and its connected
Instagram professional account.

Key behaviors that support a smooth review:
- The assistant **discloses it is an AI assistant** in its first reply and offers to
  connect a human at any time.
- When it cannot answer, or the customer asks for a person, it **hands off to the
  restaurant's staff**, who reply to the same conversation through our private admin inbox.
- It only answers questions related to the business; off-topic requests are politely declined.
- No marketing/automated outbound messages — the assistant only **replies to messages the
  customer initiates** (standard messaging, within the 24-hour window).

---

## 2. Permissions to request

Primary (the messaging features):
- **pages_messaging** — receive and reply to messages on the Facebook Page.
- **instagram_manage_messages** — receive and reply to Instagram DMs.

Supporting (needed for the above to function):
- **pages_manage_metadata** — subscribe the Page to the `messages` webhook field.
- **instagram_basic** — access the Instagram professional account linked to the Page.
- **pages_show_list** — list the Page the user selects to connect.

(WhatsApp is handled through the WhatsApp Business product / Cloud API and is not part of
this App Review submission.)

---

## 3. Per-permission: usage description + reviewer test steps

### pages_messaging
**How the app uses it:** When a customer sends a message to the Caffe Cavalli Facebook
Page, our webhook receives it and the assistant replies with relevant business information.
If the assistant escalates (customer asks for a human, complaint, private-event request),
a staff member replies to the same thread from our admin panel. We send messages only in
response to a customer-initiated conversation.

**Step-by-step for the reviewer:**
1. Open Messenger and go to the Caffe Cavalli page conversation.
2. Send: `מה שעות הפתיחה היום?` ("What are today's opening hours?")
   → The assistant replies within a few seconds with the hours, and (on the first message)
   notes it is the business's AI assistant and a human is available.
3. Send: `יש חניה?` ("Is there parking?")
   → The assistant replies with parking details.
4. Send: `אני רוצה לדבר עם נציג אנושי` ("I want to talk to a human representative")
   → The assistant hands off; a staff member then replies from the admin inbox.

### instagram_manage_messages
**How the app uses it:** Same assistant, same behavior, for Direct Messages sent to the
Caffe Cavalli Instagram professional account (which is connected to the Facebook Page).

**Step-by-step for the reviewer:**
1. Open Instagram and send a DM to @caffe.cavalli.il.
2. Send: `היי, יש אפשרות להזמין מקום ל-6 אנשים?` ("Hi, can I reserve a table for 6?")
   → The assistant replies with reservation info.
3. Send: `תודה!` ("Thanks!") → The assistant replies naturally.

### Supporting permissions
- **pages_manage_metadata:** used once during setup to subscribe the Page to the `messages`
  webhook so the app is notified of incoming messages.
- **instagram_basic:** used to identify the Instagram professional account connected to the
  Page so messages can be routed correctly.
- **pages_show_list:** used so the business owner can select which Page to connect during setup.

---

## 4. Screencast shot list (record one short video, ~60–120s)

Record screen + narrate (or add captions). Show the REAL app end-to-end:
1. (5s) Show the Facebook Page "Caffe Cavalli" so the reviewer sees the business.
2. (20s) From a personal account, open Messenger → send "מה שעות הפתיחה?" → show the
   assistant's reply appearing, including the AI-assistant disclosure on the first message.
3. (15s) Send "יש חניה?" → show the reply.
4. (20s) Send "אני רוצה לדבר עם נציג" → show the assistant handing off.
5. (20s) Switch to the admin panel (/admin) → show the conversation arrived, the staff
   member types a reply, and it is delivered back to the customer in Messenger.
6. (20s) Repeat a short version on Instagram DM with @caffe.cavalli.il.
Keep it real and unedited; reviewers prefer to see the actual flow.

Tip: host the video unlisted (YouTube/Drive) and paste the link, or upload directly.

---

## 5. Compliance checklist (Meta looks for these)

- [x] Public privacy policy that covers what data is collected, why, retention, and deletion:
      https://cavalli-chatbot.vercel.app/privacy
- [x] AI disclosure — the assistant states it is an AI assistant on first contact.
- [x] Human handoff path — customers can always reach a person.
- [x] No medical/legal/financial advice; off-topic requests declined.
- [x] Messages sent only in response to customer-initiated conversations (no spam/outbound
      marketing in this submission).
- [x] Data not sold or shared for third-party marketing.

---

## 6. Pre-submission checklist (do these in order)

1. [ ] Business Verification **approved** (in review now, ~2 business days).
2. [ ] App linked to the "ליאל ימין" business portfolio (App settings → connect business).
3. [ ] Record the screencast (section 4).
4. [ ] In App Review → Permissions and Features, request each permission in section 2 and
       paste the matching description + test steps from section 3.
5. [ ] Add the screencast link.
6. [ ] Confirm the privacy policy URL is set in App settings → Basic.
7. [ ] Submit.

> Note: while in Development mode only people with an app role (admin/dev/tester) can message
> the bot. Once these permissions get Advanced Access and the app is switched to **Live**,
> any customer can message the page/Instagram and get replies.
