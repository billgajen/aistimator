# Reminders and follow-up

## How do I know if a customer has opened my quote?
<!-- id: followup-customer-opened; page: /app/quotes -->

Your dashboard shows it. {{product}} does not email you when a customer opens a quote.

1. Open "Quotes" in the menu and choose the "Waiting for customer" tab.
2. Read the line under each quote's status: "Sent today, not opened yet" or "Opened yesterday", for example.
3. Open a quote to see "Progress": "Received", "Approve and send", "Opened", "Accepted", each with its date once it has happened.

On Home, "Latest activity" also lists the newest things that happened, such as a customer opening or accepting a quote.

## Does {{product}} remind my customer about a quote?
<!-- id: followup-automatic-reminder; page: /app/quotes -->

Yes, once, unless you switch it off. {{product}} emails the customer one reminder when a quote has been waiting for three days with no answer. You do not have to do anything.

The reminder goes to the customer, never to you. It is sent only when all of these are true:

- the reminder is on in "Settings" (it is on unless you switched it off);
- the quote was sent at least three days ago, and its status is still "Waiting for customer" (sent, or opened but not answered);
- the customer has not accepted or declined it;
- the customer gave an email address;
- the quote has not expired;
- no reminder has been sent for this quote before.

{{product}} checks once a day, so the reminder goes out on the first check after the three days are up. The email's subject is "Reminder: your quote from" and your business name, and it has a "View your quote" button. If the customer replies to it, the reply comes to you.

No reminder is sent for a quote where the customer asked a question, or where you sent an updated quote. There is no second reminder. You can switch the reminder off in "Settings"; there is no setting to change the three days.

## How do I switch the reminder to my customers off?
<!-- id: followup-reminder-switch; page: /app/settings; section: Reminder to the customer -->

Untick the reminder in "Settings". It is on until you do.

1. Open "Settings" in the menu.
2. Find "Reminder to the customer".
3. Untick "Send one reminder to the customer if they haven’t answered the estimate after 3 days". It saves at once and says "Saved. No reminders will be sent."

With it off, {{product}} sends no reminder for any quote that has not had one yet, including quotes you sent before you switched it off. A reminder that already went out is not taken back.

Tick it again to switch it back on. A quote that is still waiting, has not expired and was never reminded gets its reminder at the next daily check.

"Answered" means accepted or declined. A customer who opened the quote and did nothing is reminded too.

## How do I chase a quote myself?
<!-- id: followup-send-again; page: /app/quotes/[quoteId] -->

Use "Send again". It emails the quote to the customer again with a fresh link. Links from earlier emails keep working.

1. Open "Quotes" in the menu and open the quote.
2. Press "Send again".

When a quote has not been opened for three days, "Send again" becomes the quote's "Next step" by itself, in the list and on the quote's page.

"Send again" needs the customer's email address. If they gave none, press "Copy link" on the quote's page and send the link yourself, by text message for example. After a customer has accepted, there is nothing to send again: the next step is "Contact customer", to book the job.

## What happens when a quote expires?
<!-- id: followup-expired; page: /app/quotes?tab=closed -->

A quote that is still waiting for the customer when its link runs out is marked "Expired". {{product}} checks for this once a day. Expired quotes are under the "Closed" tab of "Quotes".

1. Open the expired quote.
2. Press "Send again". The customer gets the quote again with a new link, and the quote goes back to "Waiting for customer".

If the customer gave no email address, the next step is "Contact customer" instead.

## What emails does {{product}} send me about my quotes?
<!-- id: followup-emails-to-business; page: /app/settings/notifications -->

{{product}} emails you when something needs you or when a customer decides. The subject line tells you which:

- "New quote:" a customer's request was priced and their quote was sent to them automatically.
- "Review and approve:" a quote is waiting for your approval. The email has an "Approve & send" button, and a link, "Open in dashboard to edit".
- "Quote accepted:" the customer accepted. The email includes when suits them, the job address and their phone number, when they gave them.
- "Quote declined:" the customer declined.
- A subject such as "Derek asked a question about their quote", with the customer's first name: the customer asked a question from their quote page. Their question is in the email.
- "Request updated:" the customer added a service to their quote, or took one off.
- A subject ending "asked for an estimate: please reply to them yourself": a request could not be priced.
- "New lead waiting:" a request arrived after your plan's quotes were used up. It is saved but not priced.

You are not emailed when a customer opens a quote, or when someone starts a request and does not finish it. Your dashboard shows both.

## What do the emails to my customer say?
<!-- id: followup-emails-to-customer; page: /app/quotes -->

Each email to a customer carries your business name, your logo if you added one, the price and one button that opens their estimate. A line under the price says where the estimate stands:

- "Waiting for" your business name "to confirm": the customer can already see the estimate, and you have not approved it yet.
- "Reviewed and confirmed by" your business name: you approved it, or you edited it and sent it yourself.
- "Estimate based on your photos and details": the service sends estimates automatically. Nobody reviewed it, so the email does not say anyone did.

When you answer a customer's question with "Save & Send", that email also shows your answer above the price.

Every email is the same width, and on a small screen it uses the width of the screen. The emails are light in colour. An email program set to dark mode may darken them itself; your logo and the text still show.

## How do I change where my notification emails go?
<!-- id: followup-notification-email; page: /app/settings/notifications; section: Notifications -->

Set the address under Settings, "Notifications". Every email about requests and quotes goes to that one address.

1. Open "Settings" in the menu and choose the "Notifications" tab.
2. Type the address in "Send notifications to".
3. Press "Save Notifications".

Leave the field empty to use the email address you sign in with. The same address is where a customer's reply lands when they answer one of their quote emails. There are no switches to turn single emails on or off.

## What is an unfinished request?
<!-- id: followup-unfinished-what; page: /app/quotes?filter=unfinished -->

It is someone who gave their contact details in your request form and then stopped before sending it. {{product}} saves them at that moment, so you can still reach them.

- Each one shows the person's name, the service, how far they got ("Gave contact details", "Answered the questions", "Added photos" or "Reached the last step") and when they started.
- An unfinished request has no price and does not use one of your plan's quotes.
- One person is one entry for each service. If the same email address or phone number starts the same service again within 24 hours, for example after reloading the form, they stay one entry, showing the furthest they got. The counts on "Home" and in the menu count entries the same way.
- When new people are waiting, Home shows a line ending "started a request but didn't finish. A quick call often wins the job." with "See who", and "Unfinished requests" in the menu shows a count. Both clear once you open the list.
- A request stays in the list for 30 days from when it was started, unless you mark it "Done".

{{product}} does not email you about unfinished requests, and it does not contact these people for you.

## What can I do with an unfinished request?
<!-- id: followup-unfinished-act; page: /app/quotes?filter=unfinished -->

Call or email the person yourself, then mark them as done.

1. Open "Unfinished requests" in the menu.
2. Press "Call" with their number, or "Email" with their address. Your phone or your email program opens, ready to go.
3. When you have dealt with them, press "Done". The note says "Marked as done. They won't show here again."

If the person comes back and sends their request, it leaves this list by itself and shows in "Quotes" like any other.

## What happens when a customer asks a question about their quote?
<!-- id: followup-customer-question; page: /app/quotes/[quoteId] -->

You get an email, and the quote moves to "Needs you" with the status "Customer asked a question".

The email's subject names the customer, for example "Derek asked a question about their quote", and the question itself is in the email.

1. Open the quote. The question is near the top, marked "Customer question".
2. To answer and send the quote in one go, press "Edit". The editor shows the question and a box, "Your answer to" with the customer's first name. Write your answer, change the quote if you need to, and press "Save & Send". The customer's email shows your answer above the price, and so does their estimate page whenever they open it. The question is marked answered.
3. Or answer the customer yourself, by email or phone, and press "Mark as answered". Their details are on the quote's page.

The quote then goes back to "Waiting for customer". The answer box is optional, and it is sent only with "Save & Send": a plain "Save" does not send it. The customer can still accept the quote while their question is open.
