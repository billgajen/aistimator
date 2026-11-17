# Meta App Review for Qolumns (T-175, rewritten in T-176)

What to record and what to write when you ask Meta for **advanced access** to the two WhatsApp permissions.
Written from Meta's own pages as they read on 17 November 2026 (App Review for solution providers; Get started
for Tech Providers; the App Review submission guide; the template and pricing pages). Check Meta's form as you
fill it in: it changes.

**What Meta asks for, in its own words:**
- `whatsapp_business_messaging`: a recording "showing your app being used to send a message to a WhatsApp
  number", and the WhatsApp client "receiving and displaying the sent message".
- `whatsapp_business_management`: "your app, or WhatsApp Manager, being used to create a message template".
  Since T-176 the template is created **in Qolumns**, which is the stronger of the two.
- "You must submit a different video clip for each permission", with a written description for each. A
  screenshot is not accepted.
- "Requesting unnecessary permissions is a common reason for rejection": the configuration asks for these two
  only.

## Where things stand (17 November 2026)

- The test business **Bluum - Qolumns Test** is connected on production with Meta's number **+1 555-759-6002**.
- **Its display name is in Meta's review.** That number is one of Meta's own 555 numbers, and Meta's rule for
  those is that they "must have their display names approved before they can be used to send messages". So
  **recording 1 cannot be made until Meta approves the name.** Recording 2 (the template) does not send a
  message and can be made as soon as T-176 is live.
- Two test messages from the WhatsApp page (12:02 and 12:42 UTC) were accepted by Meta and not delivered. The
  phone had not written to the number first, and the name was in review: either is enough.
- **The webhook is set** (verified, with `messages` and `account_update` subscribed, on 17 November), but
  **Meta does not deliver real messages to an app that is not published.** Until the app is Live, Qolumns does
  not hear a customer's message, so it does not reply in the chat and the page cannot show "Delivered".
  Recording 1 is written to work without that.

## Before you record

1. **Business verification.** Meta does not start App Review until the Great Billiom portfolio is verified.
2. **The webhook is set** (done 17 November): callback URL `https://qolumns.com/api/whatsapp/webhook`,
   verified, fields **`messages`** and **`account_update`** (those two only).
3. **The permissions are already the minimum** (checked 17 November): the Embedded Signup configuration asks
   for `whatsapp_business_management` and `whatsapp_business_messaging` only. "Log events" on Meta's screen
   is Meta's own wording, not a third permission.
4. **The app's basic settings are complete** (the list is in `OWNER-TODO.md`, T-175): icon, privacy policy URL,
   terms URL, category, contact email, data deletion instructions.
5. **T-176 is live on `qolumns.com`** (it adds "Message templates" to the WhatsApp page).
6. **Do not press "Create the template" before recording 2.** A template can be created once; the recording
   has to show it being created. If it was pressed already: while it is still "In review" or "Rejected",
   delete it in WhatsApp Manager (Message templates) and record. If it was **approved** and then deleted, Meta
   blocks the same name for 30 days; in that case record WhatsApp Manager creating a template instead (Meta
   accepts that), using the steps at the end of this file.
7. **Each permission has been used in the 30 days before you submit.** Meta's button "Request advanced access"
   stays grey until it has logged a call, which can take up to two days. Connecting and creating the template
   use `whatsapp_business_management`; any reply or test message uses `whatsapp_business_messaging`.
8. **A way in for the reviewer.** Meta asks for access instructions. Make a Qolumns account for the reviewer
   (a business with one service set up), and give its email and password in the form's "access instructions"
   box. Meta says not to give a personal account. Do not write the password in this file or anywhere in the
   repo.

## Rules for both recordings

- A **screen recording**, not screenshots. One recording **per permission**; do not mix the two.
- English on screen. 1080p or better, browser window no wider than 1440. No sound: reviewers do not listen.
- Start **signed out**, so the recording shows the sign-in.
- Nothing private on screen: the test business, the test number, and your own phone. **Do not message a real
  customer.**
- If a step takes long (Meta's review of a template, a reply arriving), let it run. Do not cut inside a flow.

## Recording 1: `whatsapp_business_messaging`

**Needs:** the display name approved (the WhatsApp page no longer shows "Meta is reviewing the name on this
number"). It does not need Meta to call our webhook.

Put two windows side by side: the browser with Qolumns, and WhatsApp for **your own phone** (WhatsApp Web
signed in as your phone is the easiest to capture).

1. Open `https://qolumns.com`, signed out. Press **Log in** and sign in as Bluum - Qolumns Test.
2. In the menu, open **WhatsApp**. Pause on the page: it shows **Connected** and **+1 555-759-6002**.
3. In WhatsApp (your phone), open a chat with +1 555-759-6002 and send: `Hi`. This opens WhatsApp's 24 hours
   for that phone, which is what lets the next message arrive.
4. Back in Qolumns, on the WhatsApp page, go to **Try it**. Type your phone's number with its country code
   and press **Send a test message**.
5. Keep both windows in view. **The test message arrives in the chat** ("This is a test message from your
   Qolumns connection. It is working."). That is the app sending a message through the Cloud API, and
   WhatsApp receiving and showing it: what Meta asks to see.

While the app is not published, two things on the page differ from what you might expect, and neither
matters to the reviewer:
- Qolumns does not answer your `Hi` in the chat, because Meta does not pass it on to us yet.
- Under the button the page may say the message "will probably not arrive", because your `Hi` never reached
  Qolumns. The message arrives all the same. If you would rather the recording did not show that line, tell me
  and I will change it before you record.

If Meta does pass your message on (it does once the app is Live), Qolumns replies in the chat. Then also show:
answering its questions (the job, your name, an email, `skip` for the phone number, an address, `skip` for
photos, then `yes`), the link to the estimate arriving, and, after you press **Approve & send** on that
request in **Quotes**, the message "Your estimate from Bluum is ready. Open it here: …".

**What to write in the form** (plain words; your own, not copied from another app's submission):

> Qolumns lets a trade business (a painter, a plumber, an HVAC company) give its customers a price estimate.
> A business connects its own WhatsApp number to Qolumns through Embedded Signup. When one of its customers
> sends that number a message asking for a quote, Qolumns replies in the same chat on the business's behalf:
> it asks what the job is, asks for the customer's name and contact details and for photos of the job, and
> then sends a link to the estimate, which is priced from that business's own price list.
>
> We use `whatsapp_business_messaging` to receive those customer messages (the `messages` webhook), to
> download the photos the customer sends, and to send the replies. When the business approves the estimate,
> we tell the same customer it is ready: with an ordinary message if they wrote in the last 24 hours, and
> otherwise with the business's approved utility template "estimate_ready". We message only customers who
> wrote to the business first and asked for an estimate. We do not send marketing messages. The business can
> also send one test message to its own phone from the Qolumns WhatsApp page, to check the connection works.
>
> The recording shows a business signed in to Qolumns with its number connected, and a message sent from
> the Qolumns WhatsApp page arriving in WhatsApp on a phone.

## Recording 2: `whatsapp_business_management`

**Needs:** T-176 live, and "Create the template" never pressed for this business (step 6 above). The display
name does not need to be approved for this one.

1. Open `https://qolumns.com`, signed out. Press **Log in** and sign in as Bluum - Qolumns Test.
2. In the menu, open **WhatsApp**. Pause on the top of the page: **Connected**, the number and its name. Those
   were read from the WhatsApp account with this permission.
3. Scroll to **Message templates**. The page shows the template's wording ("Your estimate from Bluum is
   ready. Open it here: …") and the button **Create the template**. Pause so the wording can be read.
4. Press **Create the template**. The status changes to **In review with Meta**. That call created the
   template in the business's WhatsApp account.
5. Press **See it in WhatsApp Manager**. WhatsApp Manager opens on Message templates and lists
   `estimate_ready`. This shows the template really exists at Meta. Go back to the Qolumns tab.
6. Wait a minute and press **Refresh**. If Meta has decided, the status reads **Approved** (it can take up
   to a day; "In review" is enough for the recording, so stop here if it has not changed).

Do not disconnect and reconnect the number for this recording. Meta asks to see the template being created,
and nothing is gained by putting a working connection through Meta's window again.

**What to write in the form:**

> A business connects its WhatsApp Business account to Qolumns with Embedded Signup. We use
> `whatsapp_business_management` for the set-up and upkeep of that connection:
>
> - after sign-up, to read the phone numbers of the account the business shared, so we connect the number it
>   chose and can show its number and display name on its WhatsApp page;
> - to subscribe our app to that account's webhooks, so the business's incoming customer messages reach
>   Qolumns, and to unsubscribe when the business presses Disconnect;
> - to create one utility message template in the business's account, "estimate_ready", when the business
>   presses "Create the template", and to read that template's review status so the business can see whether
>   Meta has approved it. The template tells a customer their estimate is ready when more than 24 hours have
>   passed since they wrote;
> - to read whether the display name is still in review and whether a payment method is on the account, so
>   we can tell the business plainly what, if anything, is left for it to do;
> - to receive the `account_update` webhook, so that when a business removes our app we delete the access
>   token we hold for it.
>
> We do not edit or delete templates, and we do not change the business's account settings. Businesses
> manage billing themselves in WhatsApp Manager.
>
> The recording shows a business signed in to Qolumns, its connected number, and the business creating its
> message template from the Qolumns WhatsApp page, with the template then listed in WhatsApp Manager.

## Questions the form also asks

- **How will your app use the data?** To quote: customers' WhatsApp messages and photos are used to prepare
  the estimate for the business the customer wrote to. Each business sees only its own customers.
- **Do you share the data?** With the business the customer wrote to, and with the processors named in the
  privacy policy (`https://qolumns.com/privacy`). It is not sold and not used for advertising.
- **How does a user delete their data?** `https://qolumns.com/privacy`, section 8: by email to
  `hello@qolumns.com`. A business removes our access to its WhatsApp account itself, with Disconnect.
- **Where is the access token kept?** On our servers only, encrypted, one per business; it is never sent to a
  browser and never logged. It is deleted when the business disconnects or removes the app.
- **Why not `whatsapp_business_manage_events`?** We do not ask for it. It is for the Marketing Messages API
  and ad reporting, which Qolumns does not use.

## If the template has to be made in WhatsApp Manager instead

Only for the case in step 6 of "Before you record". Meta accepts this for the management recording.

1. Record signing in to Qolumns and the WhatsApp page showing **Connected**, as in recording 2, steps 1 to 2.
2. Open WhatsApp Manager (`https://business.facebook.com/wa/manage/message-templates/`), choose the Bluum
   account and press **Create template**.
3. Category **Utility**, a new name (for example `estimate_ready_2`), language English (US), and the body:
   `Your estimate from Bluum is ready. Open it here: {{1}}` followed by a second line `Thank you for asking
   Bluum for a price.` Give the sample value `https://qolumns.com/q/example?token=example` and submit.
4. Show it in the list.

Qolumns only sends a template named `estimate_ready`, so one made this way is for the recording only.

## After approval

Switch the Meta app to **Live** mode. In Live mode Meta's window offers only the permissions that have
advanced access. The first real check after going live: connect a number, message it, and see the reply.
