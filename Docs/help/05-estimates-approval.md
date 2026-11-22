# Estimates, approval and what your customer sees

## What does the Quotes page show?
<!-- id: estimates-quotes-list; page: /app/quotes -->

Quotes lists every request, sorted by whose turn it is. Each row shows the customer, the service, the total, a status and one next step.

The tabs across the top, each with a count:

- "Needs you": you have something to do. This means an estimate to check and approve, a customer's question to answer, a request that could not be priced, or a request saved without a price. The page opens here when anything is waiting.
- "Waiting for customer": the estimate is with the customer. Nothing for you to do.
- "Accepted": the customer accepted.
- "Closed": the customer declined, or the estimate expired.
- "Unfinished": people who started a request and did not finish.
- "All": everything, including requests still being priced.

To find one, type in the box "Search by customer name or email...".

On each row, the button under "Next step" does the one thing that row needs, such as "Check and approve". "More" opens the rest: "Open quote", "Send again", "Copy link", "Download PDF" and "Pricing trace". An item shows only when it can be used for that quote.

## What do the statuses on a quote mean?
<!-- id: estimates-statuses; page: /app/quotes -->

The status says whose turn it is. A short line under it adds the detail.

- "Working out the price": the request has arrived and is being priced. Nothing to do yet.
- "Needs your approval": the price is ready and waits for you to check and approve it. If the line under it says "No price yet", add the price first.
- "Saved, not priced yet": the request arrived after your plan limit was reached, so it has no price.
- "Customer asked a question": the customer sent a message from their estimate page and is waiting for your answer.
- "Could not be priced": no price could be worked out. No estimate was sent.
- "Waiting for customer": the estimate is with the customer. The line under it says more: "Sent today, not opened yet", "Opened yesterday", "Updated quote sent" or "Waiting for their answers".
- "Customer accepted": they accepted. Contact them to book the job.
- "Customer declined": they turned it down.
- "Expired": the customer's link ran out without an answer. A link lasts 30 days from when it was last sent.

A quote's own page shows the same status at the top, with a sentence under "Next step" saying what to do.

## What is the "Unfinished" tab?
<!-- id: estimates-unfinished; page: /app/quotes?filter=unfinished -->

"Unfinished" lists people who gave their contact details on your form but never sent the request. They are not quotes and have no price. A quick call or email often wins the job.

1. Open "Quotes" and press the "Unfinished" tab, or press "Unfinished requests" in the menu.
2. Each person shows their name, the service, how far they got and when they started. Someone you have not seen before has a "New" tag.
3. Press "Call" or "Email" to reach them. The button shows their number or address.
4. Press "Done" when you have dealt with them. They will not show here again.

The list covers the last 30 days. Someone who finishes their request the same day leaves the list by themselves, and their request shows as a quote. If someone starts again on a later day and finishes, press "Done" on the old entry.

## When does my customer get the estimate: straight away, or after I approve?
<!-- id: estimates-when-sent; page: /app/services -->

You choose, for each service. The choice is called "When a customer asks for an estimate" and has three options:

- "Show the estimate, then I confirm it": the customer sees the estimate straight away, marked as an estimate you will confirm. They can accept once you approve it. This is the choice a new service starts with.
- "Hold until I approve": the customer sees "Your estimate is being prepared" and no price until you approve it.
- "Send automatically": the estimate goes to the customer straight away and they can accept it. You do not review it first.

To change it:

1. Open "Services" and open the service.
2. On the first step, "Basic Info", pick an option under "When a customer asks for an estimate".
3. Go on to the last step, "Test & Publish", and press "Save Changes".

With the first two options, each new estimate shows in Quotes as "Needs your approval". Even with "Send automatically", an estimate waits for your approval when an automatic check finds something you should look at first.

## How do I approve an estimate and send it?
<!-- id: estimates-approve-send; page: /app/quotes/[quoteId] -->

Open the quote, check the price, and press "Approve & send". The customer is emailed their quote, and their page changes from an estimate to a quote they can accept.

1. Open "Quotes". On the "Needs you" tab, press "Check and approve" on the row.
2. Read "Next step" at the top. A line under it tells you what the customer sees right now.
3. Check the lines and the total under "Pricing".
4. Press "Approve & send". To change something first, press "Edit" instead.

The page then says "Sent to the customer". If the customer gave no email address, it says no email went out. Press "Copy link" and send them the link yourself.

You can also approve from the email you get when an estimate is waiting. Press "Approve & send" in the email, check the lines on the page that opens, and press "Approve & send" there.

## How do I change a price or a line before I send it?
<!-- id: estimates-edit; page: /app/quotes/[quoteId] -->

Press "Edit" on the quote's page. You can change any line, add or remove lines, and change the wording the customer reads.

1. Open the quote and press "Edit". The page changes to "Editing Quote".
2. Under "Pricing breakdown", change a line's name or amount. Press "Add line item" for a new line. To remove a line, press the cross on it, then "Yes". Drag a line by its handle to move it.
3. Change "Scope of work", "Assumptions", "Exclusions" or "Optional Extras" if you need to.
4. Press "Save & Send" to save and send it to the customer. Press "Save" to keep your changes without sending.

The total is worked out again from your lines. Tax is worked out again when you save.

If your lines come to less than your minimum charge, the total stays at the minimum and a note says so. Press "Remove" beside it to charge the lines only on this quote.

"Save & Send" on an estimate that was waiting for your approval also approves it. On one the customer already had, they are emailed an updated quote, and their page shows it as revised.

You cannot edit once the customer has accepted, while the price is still being worked out, or when a request could not be priced.

## How do I add a note to an estimate?
<!-- id: estimates-notes; page: /app/quotes/[quoteId] -->

There are two kinds of note. Both are in the editor.

1. Open the quote and press "Edit".
2. For a note the customer will read, type under "Notes". On their page it shows as "A note from" followed by your business name.
3. For a note only you see, type under "Business Notes (only visible to you)".
4. Press "Save", or "Save & Send" to send the estimate with the note.

"Pricing Notes" in the editor are also shown to the customer, under "Worth knowing".

## How do I send an estimate again, or get its link?
<!-- id: estimates-send-again; page: /app/quotes/[quoteId] -->

Use "Send again" to email it again, or "Copy link" to send it yourself.

- "Send again" emails the customer their estimate with a fresh link. It is offered on an estimate that is waiting for the customer, and on one that expired. The customer must have given an email address.
- "Copy link" copies the link to the customer's estimate page. Paste it in a text, an email or a chat. Use this for a customer who gave only a phone number. It shows once the estimate has been sent.

Both are at the top of the quote's page, and under "More" on its row in Quotes. Links the customer already has keep working after you send again or copy a new one.

The estimate your customer gets is a web page. No PDF is made or emailed by itself.

When an estimate has sat unopened for three days, "Send again" becomes the next step on its row. {{product}} also sends the customer one reminder email by itself, a few days after the estimate was sent, if they have not accepted or declined. An estimate you edited and sent again, or one with a question open, does not get a reminder.

## What is on a quote's page?
<!-- id: estimates-quote-page; page: /app/quotes/[quoteId] -->

A quote's page reads from top to bottom: what to do, what was understood, the price, then the rest.

- "Next step": one sentence saying whose turn it is, with the one button for it.
- "What {{product}} understood": what was read from the customer's photos and words, with the photos. It also lists what the customer was asked and what they answered. It shows only what there is to show.
- "Pricing": the total, each line and its amount, the subtotal and tax. A small line under a price line can say where its quantity came from.
- The grade, marked "Only visible to you": a letter A, B or C and a sentence on how sure the price is. If a check held the estimate, a line starting "Held because:" says why.
- "Progress": the four steps "Received", "Approve and send", "Opened" and "Accepted", with dates.
- "Scope of work", "Assumptions", "Exclusions", "Notes", "Business notes" and "Customer".
- "Version History", once the quote has been edited.

If the customer asked for something else in their own words, a box "Customer also asked for" shows it and where it stands.

At the very bottom, "Report a problem with this estimate" sends {{product}} a report about an estimate that looks wrong. It changes nothing on the estimate. The guide's page on reporting problems has the detail.

## What does my customer see on their estimate page?
<!-- id: estimates-customer-page; page: /app/quotes/[quoteId] -->

They see one page with your business name, your logo if you added one, and the price in large figures. It says "Your estimate" until you have approved it and "Your quote" after. A quote also says it was reviewed and confirmed by your business. An estimate that was sent automatically stays "Your estimate".

Below the price:

- "Scope of work": what the job covers.
- "Price breakdown": each line, the subtotal, tax and the total.
- "Measurement & takeoff": what was measured or read for the estimate, when anything was.
- "Optional extras": extras with their prices, if the estimate has any.
- "Assumptions" and "Not included": what the price assumes and what it leaves out.
- "A note from" your business, if you wrote one.
- "Your photos": the photos they sent.

At the bottom they can:

- Accept, with the button "Accept this quote" or "Accept this estimate", which also shows the total.
- Press "Ask a question" to send you a message. The same box is for asking for a change.
- Decline, with a small link under the buttons.

On an estimate you have not approved, when a quantity is not certain, a low and a high price show on a scale under the total. The customer never sees the grade letter.

While an estimate waits for your approval, the customer cannot accept. With "Show the estimate, then I confirm it" they see the price and a line saying they can accept once you confirm. They can also ask a question. With "Hold until I approve" they see "Your estimate is being prepared" and not the price. If a quantity was not certain, they see a low and a high figure in its place until you approve.

## What happens when a customer asks a question or asks for a change?
<!-- id: estimates-customer-question; page: /app/quotes/[quoteId] -->

The quote moves to "Needs you" with the status "Customer asked a question", and you are emailed. Their message is on the quote's page, in a box marked "Customer question".

1. Open the quote and read the message.
2. Answer them yourself. Under "Next step" there is an "Email" button and, when you have their number, a "Call" button, each with the customer's first name. {{product}} does not send your reply for you.
3. If the answer changes the estimate, press "Edit", make the change and press "Save & Send".
4. If nothing on the estimate changes, press "Mark as answered".

The quote then goes back to "Waiting for customer". The customer can still accept or decline while their question is open. They cannot send a second message until you have dealt with the first.

## What happens when a customer accepts?
<!-- id: estimates-customer-accepts; page: /app/quotes/[quoteId] -->

Before they accept, the customer is asked three things: when suits them, the address of the job and their best phone number. Then they press "Confirm and accept". Nothing is charged. {{product}} does not take payment from your customer.

On your side:

- You get an email saying the quote was accepted.
- The quote moves to the "Accepted" tab with the status "Customer accepted".
- The quote's page shows a box "The customer accepted. Here's what they told you", with "When suits them", "Job address" and "Phone".
- "Next step" tells you to contact them to book the job, with buttons to email or call.

The customer's page shows that it is accepted and that you will get in touch.

An accepted quote can no longer be edited.

If the customer declines instead, you get an email with their reason if they gave one, and the quote moves to "Closed" as "Customer declined".

You can stop customers accepting on the page. In Settings, under Branding, untick "Allow customers to accept quotes directly".

## Can I mark a job as won or lost, or record what I invoiced?
<!-- id: estimates-final-invoice; page: /app/quotes/[quoteId] -->

There is no button to mark a job won or lost. A quote is won when the customer accepts it on their page. One they decline, or that expires, moves to "Closed".

You can record what you finally charged:

1. Open the quote and scroll to "Final invoice". It shows on a quote that was sent, accepted, declined or expired. It is not shown while a customer's question is open, or on a quote you edited and sent again that the customer has not yet answered.
2. Type the amount under "Invoiced amount".
3. Add a "Note (optional)", for example why the job changed.
4. Press "Save". To correct it later, change the amount and press "Update".

The page then shows what you invoiced against the quote, and the difference as a percentage. Analytics uses these figures to show how close your estimates are.

## What is a "Test" estimate, and how do I make one?
<!-- id: estimates-test; page: /app/quotes -->

A test estimate is one you made yourself during setup, to see what your customers see. It has a "Test" tag beside the name in Quotes and on its own page. It does not count toward your plan.

You make one on the last step of setup, "Now try it as your customer":

1. Press "Try it as your customer". Your request page opens in a new tab, with a "Test mode" line at the top.
2. Fill in the form as a customer would and press "Get my estimate".
3. Go back to the setup tab. The estimate appears there. If it is waiting for your approval, you can press "Approve & send" to see how approving works.

There is a limit on how many test requests you can make in a day.

A request you send from your ordinary quote link, without the "Test mode" line, is a real request and counts like any other.

## How was this price worked out?
<!-- id: estimates-how-priced; page: /app/quotes/[quoteId]/trace -->

Every price comes from your own price list. The "Pricing Trace" page shows the sums, step by step.

1. Open "Quotes".
2. On the quote's row, press "More", then "Pricing trace". It is offered once the estimate has been sent to the customer, and not on one that was declined or has expired.

The page shows:

- "Quote Summary": the customer, the service, the status and when it was created.
- "Calculation Steps": each step in order, marked "Base Fee", "Work Step", "Add-on", "Multiplier" or "Tax". Each shows what was added, the sum behind it, the answers it used, and the running total. If your minimum charge was used, a line says so.
- "Summary": the totals for each kind of step, tax and the final total.
- "Customer wording": shown only when words customers should not see were found in the estimate's wording, with what was rewritten or removed.
- "Extracted Signals": the raw details read from the photos and the form. This part is technical.

For a shorter view, the quote's own page shows each line under "Pricing" and what was read under "What {{product}} understood".

## What does "Could not be priced" mean, and can I try again?
<!-- id: estimates-failed; page: /app/quotes/[quoteId] -->

It means no price could be worked out for that request, so no estimate was sent. There is no "try again" button. You quote this one yourself.

- The customer was told that you have their request and will be in touch. They were not shown an error.
- You get one email about it, with how to reach them.
- The request stays in "Needs you" with the status "Could not be priced".

What to do:

1. Open the quote. The box "What the customer sent" has their answers, and their photos are on the page.
2. Under "Next step", press the "Email" or "Call" button to reach them.
3. Give them a price yourself.

A request that could not be priced cannot be edited or approved.
