# Meta App Review for Qolumns (T-175, rewritten in T-176, updated in T-177)

**T-177 changed three things that matter here** (they apply once T-177 is deployed):
- **The template is automatic.** There is no "Create the template" button. Connecting a number sets the
  template up (used if Meta already has it, created if not). Bluum's template is already on Meta.
- **The assistant is silent unless a customer asks for a price.** A plain "Hi" gets no reply, by design.
- **WhatsApp needs a plan that includes it, with an active subscription.** Bluum has no subscription in
  production: until it has one, its WhatsApp page shows an upgrade line and a test message is refused.
  Settle that first (`OWNER-TODO.md`, T-177, section 1).

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
5. **Bluum is on a plan that includes WhatsApp** (needed from T-177 on, or the page is paused).
6. **The template.** Bluum's is on Meta already. If recording 2 was made with T-176's button, it is done and
   needs nothing more. If it still has to be made, see "Recording 2" below: the button no longer exists.
7. **Each permission has been used in the 30 days before you submit.** Meta's button "Request advanced access"
   stays grey until it has logged a call, which can take up to two days. Connecting, and opening the WhatsApp
   page (which reads the template's status), use `whatsapp_business_management`; any reply or test message
   uses `whatsapp_business_messaging`.
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

Qolumns does not answer your `Hi` in the chat. That is by design since T-177 (it only answers a request
for a price), and while the app is not published Meta does not pass your message on to us anyway.

Once the app is Live you can also show the assistant at work: send
`How much for <a job one of Bluum's services covers, with a size>?` from your phone. Qolumns replies in the
chat with the link to the estimate; after you press **Approve & send** on that request in **Quotes**, the
message "Your estimate from Bluum is ready. Open it here: …" arrives.

**What to write in the form** (plain words; your own, not copied from another app's submission):

> Qolumns lets a trade business (a painter, a plumber, an HVAC company) give its customers a price estimate.
> A business connects its own WhatsApp number to Qolumns through Embedded Signup. When one of its customers
> sends that number a message asking for a price for one of the business's services, Qolumns replies in the
> same chat on the business's behalf: it asks only for what it still needs (what the job is, the postcode
> where the business limits its area, photos where the service requires them), and then sends a link to the
> estimate, which is priced from that business's own price list. It does not reply to any other message.
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

**If this recording was made with T-176's "Create the template" button, it is done.** That button was removed
in T-177; the notes below are for making the recording after T-177 is live.

Meta asks to see "your app, or WhatsApp Manager, being used to create a message template". From T-177 the
app creates the template **when a number is connected**, so the recording shows a connection:

1. Use a business whose WhatsApp account has **no** `estimate_ready` template yet: a second test business
   with its own number. (Bluum's account already has the template; connecting Bluum again finds it and
   creates nothing, which is correct but shows nothing being created.)
2. Open `https://qolumns.com`, signed out. Press **Log in** and sign in as that business.
3. In the menu, open **WhatsApp**. Press **Connect WhatsApp** and go through Meta's window to **Finish**.
4. Back in Qolumns the page shows **Connected**. Scroll to **Message templates**: the wording, and the
   status **In review with Meta**. Qolumns created that template in the business's account as part of
   connecting.
5. Press **See it in WhatsApp Manager**. It opens on Message templates and lists `estimate_ready`.

If a second test business is not practical, record WhatsApp Manager creating a template instead (the last
section of this file). Meta accepts that.

**What to write in the form:**

> A business connects its WhatsApp Business account to Qolumns with Embedded Signup. We use
> `whatsapp_business_management` for the set-up and upkeep of that connection:
>
> - after sign-up, to read the phone numbers of the account the business shared, so we connect the number it
>   chose and can show its number and display name on its WhatsApp page;
> - to subscribe our app to that account's webhooks, so the business's incoming customer messages reach
>   Qolumns, and to unsubscribe when the business presses Disconnect;
> - to create one utility message template in the business's account, "estimate_ready", when the business
>   connects (only if the account does not have it yet), and to read that template's review status so the
>   business can see whether Meta has approved it. The template tells a customer their estimate is ready when more than 24 hours have
>   passed since they wrote;
> - to read whether the display name is still in review and whether a payment method is on the account, so
>   we can tell the business plainly what, if anything, is left for it to do;
> - to receive the `account_update` webhook, so that when a business removes our app we delete the access
>   token we hold for it.
>
> We do not edit or delete templates, and we do not change the business's account settings. Businesses
> manage billing themselves in WhatsApp Manager.
>
> The recording shows a business connecting its number from Qolumns, the message template Qolumns set up
> for it as part of connecting, and that template listed in WhatsApp Manager.

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

For when the template cannot be shown being created by the app. Meta accepts this for the management
recording.

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
