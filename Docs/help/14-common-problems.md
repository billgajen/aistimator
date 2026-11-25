# Common problems

## I cannot sign in. What should I do?
<!-- id: problems-cannot-sign-in; page: /app -->

The log-in page tells you why in one line. What to do depends on the line.

- "That email and password do not match an account." Check both for typing mistakes. If you are not sure of the password, press "Forgot your password?" and choose a new one.
- "Your email is not confirmed yet." Open the email we sent when you signed up and press "Confirm my email". To get a new link, sign up again with the same address.
- "Too many tries in a short time." Wait as long as the message says, then try again.
- "We could not reach the server. Check your connection and try again." Check your internet connection and try again.

## The confirmation email did not come, or its link does not work. What now?
<!-- id: problems-confirmation-email; page: /app/onboarding -->

Most often the address was typed wrong, the address already has an account, or the link is too old. The link in the email works once, for one hour.

- The "Check your email" page shows the address the email went to. If it is wrong, sign up again with the right one.
- If the address already has an account, no new account is made. You get an email titled "You already have a {{product}} account" instead. Log in, or press "Forgot your password?" on the log-in page.
- If you see "That link has expired or was already used.", sign up again with the same address to get a new link.
- If you see "This link is not complete", open the link from the email again so the whole link is used.
- If sign-up says "We could not send the email just now. Please try again in a few minutes.", wait a few minutes and press "Create account" again.

A password reset email is only sent when the address has an account, though the page says "Check your email" either way.

## Why does "Home" keep taking me to setup?
<!-- id: problems-home-opens-setup; page: /app/onboarding -->

"Home" opens setup whenever your business has no service that is switched on, unless you chose to set up by hand. This also happens if you disable or delete every service after finishing setup.

Do one of these:

1. Finish setup. Once your services are created, "Home" opens normally.
2. If your services exist but are all disabled, open "Services" from the menu and press "Enable" beside one.
3. To build your services by hand instead, press "Skip — set up manually instead" on the first setup screen. "Home" then stops sending you to setup.

## Why is a "Get set up" step still not ticked?
<!-- id: problems-setup-step-not-ticked; page: /app -->

Each step is ticked only by one particular action. If a step stays open, that action has not happened yet.

- "Add a service": you need at least one service that is switched on. On "Services", press "Enable" beside a disabled service, or add one. A service added with "Add from a template" starts switched off: check its prices, then press "Enable".
- "Check your prices": a service added with "Add from a template" does not tick it until you save. On "Services", press "Edit", go to "Test & Publish" with "Next", and press "Save Changes".
- "Share your quote link": opening the link does not tick it, whoever opens it. Copying the website code does not, and your own test estimate does not either. Press "Copy" under "Your quote link" on "Home". It is also ticked when your first real customer request arrives.
- "First real request received": only a request a customer sends in ticks it. Test estimates and unfinished requests do not.

## Why did an estimate come out at zero, or much lower than it should?
<!-- id: problems-price-zero; page: /app/services -->

The price is built only from the service's own price list, so a low price means a line was missing, was left off, or had no quantity. Check the service on "Services".

1. Press "Edit" beside the service and go to "Pricing Setup".
2. Under "Price Breakdown", check there are lines and that each amount is yours. With no lines and a "Base Fee" of 0 there is nothing to charge.
3. Open each "Per Unit" or "Per Hour" line and check "Multiply by" points at the right question. A line whose quantity comes to 0 is left off the estimate.
4. On "Customer Questions", tick "Required" on every question a line multiplies by, so a customer cannot skip it.
5. Check any line ticked "Only include when condition is met". It is left off when the condition is not met. A "Fixed Amount" line ticked with no "Question" chosen cannot be saved: "Test & Publish" lists it under "Fix Before Publishing".
6. Go to "Test & Publish", fill in "Sample Values" as that customer answered and press "Calculate Preview". Then press "Save Changes".

## Why does the form not ask the questions I set?
<!-- id: problems-questions-not-asked; page: /app/services -->

There are two causes you can check on "Services".

1. The changes were not saved. Questions are saved only when you reach "Test & Publish" and press "Save Changes". Closing the window before that loses them.
2. The service is "Inactive". The form does not offer it. Press "Enable". A service added with "Add from a template" starts "Inactive".

Questions are saved for every service, however it was made. Removing a question, even the last one, takes it off the form when you save.

A question shows only when the customer picks the service it belongs to. A question for every service is added on "Quote link" under "Advanced · extra questions on the form".

## Why is "Save Changes" or "Create Service" greyed out?
<!-- id: problems-service-wont-save; page: /app/services -->

The last step shows "Fix Before Publishing" with a list. Each item names a price line that could not be charged as it is.

1. Read the list under "Fix Before Publishing" on "Test & Publish".
2. Press "Back" to "Pricing Setup" and open the line it names under "Price Breakdown".
3. If it says the line "needs a quantity link", choose a question or a fixed quantity under "Multiply by".
4. If it says the line "links to a question that doesn't exist", the question was removed. Choose another question under "Multiply by". Changing a question's "Label" does not cause this: a renamed question stays linked.
5. If it says the line is set to "Only include when condition is met", but no question is chosen, choose the "Question" under "When to include this item", or untick the box.
6. Press "Next" to "Test & Publish". When it shows "Ready to Publish", press "Save Changes".

The same box can also say that an adjustment or a line uses a question this service no longer has. That does not stop the save, but the adjustment or line is not applied until you choose its question again on "Pricing Setup".

The button is also greyed out when "Service Name" on "Basic Info" is empty.

## Why do the price boxes show a dollar sign when I charge in another currency?
<!-- id: problems-price-box-dollar-sign; page: /app/services -->

The dollar sign beside "Base Fee", "Minimum Charge", the price lines and "Add-ons" is only a mark on the screen. It does not convert anything. Type your amounts in your own currency.

The review under "Describe your pricing", the preview on "Test & Publish" and the estimates your customers get all show your business's own currency.

## My customer says they did not get their estimate. What do I do?
<!-- id: problems-customer-no-estimate; page: /app/quotes -->

Find the request in Quotes and read its status. The status tells you where the estimate is.

1. Open "Quotes", press the "All" tab and type the customer's name or email in the search box.
2. If the status is "Needs your approval", the estimate is waiting for you. Open it and press "Approve & send". Until you do, a service set to "Hold until I approve" shows the customer no price.
3. If it is "Waiting for customer" and the line under it says "not opened yet", the email went out and has not been opened. Ask them to check their junk folder, or press "Send again". It is under "More" on the row and at the top of the quote's page.
4. If the customer gave only a phone number, no email was sent. Open the quote, press "Copy link" and send them the link in a text or a chat.
5. If the line under the status says "Waiting for their answers", the customer was asked for a detail and has not answered. Open the quote and press "Answer for the customer" if they have told you the answer.
6. If it is "Saved, not priced yet" or "Could not be priced", no estimate was sent. Open the quote and follow "Next step".
7. If the customer is not in the list at all, press the "Unfinished" tab. They may have started the form and not finished it.

## An estimate is stuck on "Working out the price", or says "Could not be priced". What now?
<!-- id: problems-estimate-stuck-or-failed; page: /app/quotes/[quoteId] -->

"Working out the price" usually lasts a minute or two. "Could not be priced" means no price could be worked out.

For "Working out the price":

1. Wait a few minutes, then reload the page. A job with photos to measure takes longer.
2. If it still says so after ten minutes, email {{support.email}} and say which customer it is.

For "Could not be priced":

1. Open the quote on the website. No estimate was sent. The customer was told you have their request and will be in touch.
2. Under "Next step", press "Try again". The price is worked out again from the same answers and photos. It does not use another quote from your plan, and you can try one request up to five times.
3. If it still cannot be priced, read "What the customer sent" and look at their photos.
4. Press the "Email" or "Call" button under "Next step" and give them a price yourself.

## The form does not show on my website. What should I check?
<!-- id: problems-form-not-showing; page: /app/quote-link -->

Most often part of the code was left out, or the website did not accept code in the place it was pasted.

1. Open "Quote link" and press "Open" beside your link. If your request page works there, the form itself is fine and the problem is on the website.
2. Under "Add it to your website", choose your "Placement" and "Experience" again and press "Copy code".
3. On your website, delete the old code and paste the new code whole. Use a block made for HTML or custom code. A plain text box shows the code as words and does not run it.
4. For "Inline (on your page)", the code has two parts: a short line that marks where the form goes, and the part that loads it. Keep both, together, at the spot where the form should appear.
5. For "Floating button", look for the button "Get an instant quote" in the bottom right corner of the page.
6. Save and publish the website, then reload the page.

If your website cannot take code at all, add a button or a menu link that goes to your quote link. It opens the same form.

If the form shows but lists no services under "What do you need?", open "Services" and make sure at least one service is marked "Active".

## The price on an estimate looks wrong. How do I check it and put it right?
<!-- id: problems-price-looks-wrong; page: /app/quotes/[quoteId] -->

Every price comes from your own price list, applied to what was read from the customer's answers and photos. So a wrong price is either a wrong reading or a price to change in your list.

1. Open the quote. Under "Pricing", read each line and its amount.
2. Under "What {{product}} understood", check what was read from the photos and the customer's words. A wrong reading gives a wrong quantity.
3. For the full sums, go to "Quotes", press "More" on the quote's row, then "Pricing trace". This is offered once the estimate has been sent.
4. To put this estimate right, press "Edit", change the line, and press "Save & Send". The customer is emailed the corrected quote.
5. To put future estimates right, open "Services" and correct the prices on that service.
6. If your prices are right and the estimate is still wrong, press "Report a problem with this estimate" at the bottom of the quote's page.

To see every estimate before the customer can accept it, set the service to "Show the estimate, then I confirm it" or "Hold until I approve". It is on the service's first step, under "When a customer asks for an estimate".

## A request says "Saved, not priced yet". Why, and how do I price it?
<!-- id: problems-saved-not-priced; page: /app/quotes/[quoteId] -->

The request arrived after your plan limit was reached: your {{free.quotes}} free quotes were used, or your plan's quotes for the month. The request was kept, but no price was worked out. The customer was told you will send their estimate shortly.

1. Open the quote. "Next step" explains what happened.
2. Press "Upgrade plan" and choose a plan on the billing page.
3. Wait a minute or so. When you pick a plan, requests saved in the last 30 days are priced for you, oldest first, as far as the plan's quotes for the month go.
4. If the request still says "Saved, not priced yet", press "Price this request". The page says pricing has started.
5. When the price is ready, the estimate goes on as any other: it is sent, or it waits for your approval, as that service is set.

If you press "Price this request" before your plan has room, a message says the limit is reached and nothing changes.

## Why am I not getting emails about new quotes?
<!-- id: problems-no-notification-emails; page: /app/settings/notifications; section: Notifications -->

Most often they are going to another address. {{product}} sends every email about requests and quotes to one address: the one in "Send notifications to", or the email you sign in with when that field is empty.

1. Open "Settings" in the menu and choose the "Notifications" tab.
2. Read "Send notifications to". If an old or mistyped address is there, correct it, or clear the field to use the email you sign in with.
3. Press "Save Notifications".

Two things never send you an email, so nothing is wrong when none comes: a customer opening a quote, and someone who starts a request and does not finish it. Look under "Quotes" for the first and under "Unfinished requests" for the second.

## Why do the numbers on my Home page look low?
<!-- id: problems-home-numbers-low; page: /app -->

Usually because of what they count. Check these before you worry:

- "Won through {{product}}" and "Accepted" count this calendar month only, from the 1st. They start again at zero each month. "Last month:" shows the month before.
- A quote counts as accepted only when the customer presses the accept button on their quote page. A job agreed by phone or in person is not counted, and there is no button to mark a quote as accepted yourself.
- "Requests" counts requests your customers sent themselves. Someone who started the form and stopped is not a request: they are under "Unfinished requests".
- Test estimates (made with "Try it yourself") never count on Home.
- A quote the customer has not accepted adds nothing to "Won this month:", whatever its price.

For every quote since you started, open "See all numbers". The Analytics page counts all of them, with no monthly reset.

## Why did my customer not get a reminder?
<!-- id: problems-no-reminder; page: /app/quotes/[quoteId] -->

{{product}} sends one reminder by email, and only when a quote has waited three days with no answer. It sends none when:

- the customer gave no email address;
- the quote was sent less than three days ago (pressing "Send again" starts the three days again);
- the customer asked a question, or you sent an updated quote;
- the customer already accepted or declined, or the quote has expired;
- this quote has already had its one reminder.

To chase it yourself:

1. Open the quote.
2. Press "Send again" to email it with a fresh link.
3. If the customer gave no email address, press "Copy link" and send the link yourself.

## Why does Home keep telling me people did not finish a request?
<!-- id: problems-unfinished-banner; page: /app/quotes?filter=unfinished -->

The line on Home counts people you have not looked at yet. It clears when you open the list, and comes back only when another person starts a request and stops.

1. Press "See who" on Home, or open "Unfinished requests" in the menu. That clears the count.
2. Call or email each person from the list.
3. Press "Done" on the ones you have dealt with. They leave the list for good.

Anyone you do not mark as done stays in the list for 30 days from when they started, then drops off by themselves.

## New requests are arriving without a price. Why have my quotes stopped?
<!-- id: problems-quotes-stopped; page: /app/settings/billing -->

Your business has no quotes left, or your account is paused. The requests are not lost: each one is saved in "Quotes", marked "Saved, not priced yet", and your customer was told you will send their estimate shortly.

Open "Settings", then the "Billing" tab, and read what it says under "Current Plan":

- "Free quotes used": you have used your {{free.quotes}} free quotes. They do not start again each month. Pick a plan. The features of {{freeStart.plan}} that you had while free quotes were left have stopped too, until you pick a plan that includes them.
- "Limit reached": you have used this month's quotes on your plan. Move to a bigger plan, or wait for the first day of next month.
- "Your … plan has ended", then "Your … free quotes are used": the plan was cancelled, or a failed payment could not be taken, and any free quotes you had never used are now used too. Pick a plan again. (If the line says you still have free quotes, new requests are still being priced from those.)
- "Your account is paused": press "Email us" in the notice at the top of the page.

When you pick a plan, or a bigger one, requests saved in the last 30 days are priced for you, oldest first, as far as the plan's quotes for the month go. Nothing is priced by itself when a new month starts, or when a paused account is restored. For a saved request that is left:

1. Open "Quotes" and open a saved request.
2. Press "Price this request".
3. Do the same for each saved request.

## My payment failed. What do I do?
<!-- id: problems-payment-failed; page: /app/settings/billing -->

Change your card. Your plan keeps working while the payment is tried again over the next days, so new requests are still priced.

1. Press "Update your card" in the notice at the top of any dashboard page. If that does not open, go to "Settings", "Billing", and press "Manage billing".
2. Change your card on Stripe's page.

The notice goes away once the payment has gone through. If the payment still cannot be taken, your plan ends. New requests then use any free quotes you never used, and after that they are saved without a price until you pick a plan again. The email about the failed payment says how many free quotes you still have.

## My logo does not show. Why?
<!-- id: problems-logo-missing; page: /app/settings/branding -->

Check where you are looking, and the file you uploaded.

- Your logo shows on your request form, the quote page, the PDF and the emails to your customers. An email sent before you added the logo does not have it.
- Some email programs hide pictures until the reader allows them. The reader then sees your business name where the logo would be.
- The file must be a PNG, JPG or WebP of 2MB or less. Any other file is refused, with "Logo must be a PNG, JPG or WebP image" or "Logo must be 2MB or smaller" at the top of the tab.

To put it right:

1. Open "Settings", then the "Branding" tab.
2. Look under "Logo". If your logo is not shown there, press "Click to upload your logo" and choose a file of the right kind and size.
3. Check it in "Preview" on the right. A logo is saved as soon as it has uploaded.

## A customer says the form told them "Location is outside service area". Why?
<!-- id: problems-outside-service-area; page: /app/settings; section: Service Area -->

Your "Service Area" limits where you take jobs, and the code the customer typed is outside it. Their request was not sent.

- With "Postcode/ZIP allowlist", the customer's code does not start with any code on your list.
- With "County/State", the customer's ZIP code is in a state that is not on your list.

1. Open "Settings" and go to "Service Area".
2. Add the customer's code, or the first part of it, to "Allowed Postcodes/ZIP Codes". With "County/State", add the customer's state on its own line. To take requests from anywhere, choose "No restrictions".
3. Press "Save Service Area".
4. Ask the customer to send the form again.

## What does {{product}} not do?
<!-- id: problems-not-offered; page: /app -->

These are not part of {{product}} today. If you need one of them, suggest it with "Suggest a feature" in the Help panel.

- Quoting by text message. {{product}} does not send or answer text messages. You can paste your quote link into a text yourself.
- Taking payment from your customers. Nothing is charged when a customer accepts, and there are no deposits or card payments on a quote.
- Sending invoices. You can record what you finally invoiced on a quote, for your own figures, but {{product}} does not make or send the invoice.
- Booking the job. When a customer accepts they say when suits them, and you arrange the date with them yourself. There is no calendar.
- A login for a second person. A business has one login.
- Marking a job as won or lost yourself. A quote is won when the customer accepts it on their quote page.

## Can I quote my customers by text message?
<!-- id: problems-text-messages; page: /app/quote-link -->

No. {{product}} does not quote by text message, and it does not send or answer texts.

What works today: copy your quote link on the "Quote link" page and paste it into a text yourself. The ready-made line "Text message reply" under "Where to put it" has your link in it. The customer taps the link and gets their estimate on your request page.

## Something is broken, or I cannot find the answer here. What do I do?
<!-- id: problems-something-broken; page: /app -->

Tell the team. Press "Help" at the bottom of the menu and press "Report a problem". Say what you did and what you saw. Add a screenshot if you can.

If the problem is with one estimate, open that quote and press "Report a problem with this estimate" at the bottom of its page.

You can also email {{support.email}}.
