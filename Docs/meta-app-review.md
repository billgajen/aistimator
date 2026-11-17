# Meta App Review for Qolumns (T-175)

What to record and what to write when you ask Meta for **advanced access** to the two WhatsApp permissions.
Written from Meta's own pages as they read on 16 November 2026 (App Review for solution providers; Get started
for Tech Providers; the screen-recording guide). Check Meta's form as you fill it in: it changes.

## Before you submit

1. **Business verification first.** Meta does not start App Review until the Great Billiom portfolio is
   verified.
2. **The app's basic settings are complete** (the list is in `OWNER-TODO.md`, T-175): icon, privacy policy
   URL, terms URL, category, contact email, data deletion instructions.
3. **The web app is live with the five WhatsApp settings**, and the webhook is verified in the Meta app.
4. **Your own number is connected** through "Connect WhatsApp" on `https://qolumns.com/app/whatsapp`. The app
   is in development mode, so only someone with a role on the Meta app (admin, developer or tester) can do
   this. Use a business and a number of your own: until Meta grants advanced access, calls on an account your
   portfolio does not own are refused.
5. **Each permission has been used at least once in the 30 days before you submit.** Steps 4 and the two
   recordings below do that: connecting uses `whatsapp_business_management`, and a reply uses
   `whatsapp_business_messaging`.
6. **A way in for the reviewer.** Meta asks for access instructions. Make a Qolumns account for the reviewer
   (a business with one service set up and your test number connected), and give its email and password in
   the form's "access instructions" box. Do not write the password in this file or anywhere in the repo.

## Rules for both recordings

- A **screen recording**, not screenshots. One recording **per permission**; do not mix the two.
- English on screen. 1080p or better, browser window no wider than 1440. No sound is needed.
- Start **signed out**, so the recording shows the sign-in.
- Nothing private on screen: use the test business, a test number and a second phone of your own. **Do not
  message a real customer.**
- If a step takes long (Meta's own window), let it run. Do not cut inside a flow.

## Recording 1: `whatsapp_business_messaging`

**What Meta asks to see:** "your app being used to send a message to a WhatsApp number, and the WhatsApp
client (either web or mobile app) receiving and displaying the sent message."

You need two things side by side on the screen: the browser with Qolumns, and WhatsApp for your **second**
phone (the "customer"): WhatsApp Web signed in as that phone is the easiest to capture.

1. Open `https://qolumns.com`, signed out. Press **Log in** and sign in as the test business.
2. In the menu, open **WhatsApp**. Pause on the page: it shows **Connected** and the business's number.
3. In WhatsApp (the customer phone), open a chat with that number and send: `Hi, I need a quote`.
4. Keep both windows in view. Within a few seconds **Qolumns' reply arrives in the chat** ("Hi! I'll get you
   an instant quote for …"). That reply was sent by the app through the Cloud API.
5. Answer its questions in the chat (what the job is, your name, an email, a phone number, an address, a
   photo, then "yes" to confirm), so the app's replies keep arriving. When it sends the link to the
   estimate, open the link so the estimate page shows.
6. Back in Qolumns, on the WhatsApp page, go to **Try it**. Type the customer phone's number and press
   **Send a test message**. Show the page saying "Sent", and the test message arriving in the chat.
7. Open **Quotes** in Qolumns and show the request that the chat created.

**What to write in the form** (plain words; change the business name to yours):

> Qolumns lets a trade business (a painter, a plumber, an HVAC company) give its customers a price estimate.
> A business connects its own WhatsApp number to Qolumns through Embedded Signup. When one of its customers
> sends that number a message asking for a quote, Qolumns replies in the same chat on the business's behalf:
> it asks what the job is, asks for the customer's name and contact details and for photos of the job, and
> then sends a link to the estimate, which is priced from that business's own price list.
>
> We use `whatsapp_business_messaging` to receive those customer messages (the `messages` webhook), to
> download the photos the customer sends, and to send the replies. Every message we send is a reply to a
> customer who has just written to the business, inside the customer service window. We do not send
> marketing messages, and we do not message anyone who has not written first. The business can also send
> one test message to its own phone from the Qolumns WhatsApp page, to check the connection works.
>
> The recording shows a customer writing to a connected number, Qolumns replying in the chat, the test
> message arriving, and the request appearing in the business's Qolumns dashboard.

## Recording 2: `whatsapp_business_management`

**What Meta asks to see:** "your app, or WhatsApp Manager, being used to create a message template."

Qolumns does not create message templates, so the template is created in **WhatsApp Manager**, which Meta
accepts. Record the app's own use of the permission first (connecting an account), then the template.

Disconnect the test number first (WhatsApp page → Disconnect), so the recording can show it being connected.

1. Open `https://qolumns.com`, signed out. Press **Log in** and sign in as the test business.
2. Open **WhatsApp**. The page shows the button **Connect WhatsApp**. Press it.
3. Meta's window opens. Go through it: sign in to Facebook, choose the business portfolio, choose (or
   create) the WhatsApp account, choose the phone number, and press **Finish** on the last screen.
4. Back in Qolumns the page changes to **Connected**, with the number and its name. Pause there: the number
   and name were read from the WhatsApp account with this permission. Show the "Add a payment method in
   WhatsApp Manager" step and press **Check again**.
5. Open WhatsApp Manager (`https://business.facebook.com/wa/manage/home/`), choose the same account, go to
   **Message templates** and press **Create template**. Make a simple utility template, for example named
   `estimate_ready` with the body `Your estimate is ready: {{1}}`, and submit it. Show it in the list.
6. Back in Qolumns, press **Disconnect WhatsApp**, then **Yes, disconnect**, and show the page return to
   "Connect WhatsApp". (Connect it again afterwards for recording 1.)

**What to write in the form:**

> A business connects its WhatsApp Business account to Qolumns with Embedded Signup. We use
> `whatsapp_business_management` for the set-up and upkeep of that connection, and for nothing else:
>
> - after sign-up, to read the phone numbers of the account the business shared, so we connect the number it
>   chose and can show its number and display name on its WhatsApp page;
> - to subscribe our app to that account's webhooks, so the business's incoming customer messages reach
>   Qolumns, and to unsubscribe when the business presses Disconnect;
> - to check whether the account is ready to send (for example whether a payment method has been added), so
>   we can show the business the one step it still has to do in WhatsApp Manager;
> - to receive the `account_update` webhook, so that when a business removes our app we delete the access
>   token we hold for it.
>
> We do not create, edit or delete message templates from Qolumns today, and we do not change the business's
> account settings. Businesses manage their templates and billing themselves in WhatsApp Manager.
>
> The recording shows a business connecting its account from Qolumns through Embedded Signup, Qolumns showing
> the connected number, a template being created in WhatsApp Manager, and the business disconnecting.

## Questions the form also asks

- **How will your app use the data?** To quote: customers' WhatsApp messages and photos are used to prepare
  the estimate for the business the customer wrote to. Each business sees only its own customers.
- **Do you share the data?** With the business the customer wrote to, and with the processors named in the
  privacy policy (`https://qolumns.com/privacy`). It is not sold and not used for advertising.
- **How does a user delete their data?** `https://qolumns.com/privacy`, section 8: by email to
  `hello@qolumns.com`. A business removes our access to its WhatsApp account itself, with Disconnect.
- **Where is the access token kept?** On our servers only, encrypted, one per business; it is never sent to a
  browser and never logged. It is deleted when the business disconnects or removes the app.

## After approval

Switch the Meta app to **Live** mode. Meta's page says some webhooks are not sent in development mode, so the
first real check after going live is: connect a number, message it, and see the reply.
