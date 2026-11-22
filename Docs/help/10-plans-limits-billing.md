# Plans, limits and billing

## What plans are there, and what do they cost?
<!-- id: billing-plans; page: /app/settings/billing -->

{{plans}}

Every price is before tax. You pay for the plan only: there is no commission and no fee for each estimate.

1. Open "Settings", then the "Billing" tab.
2. Your plan is at the top, under "Current Plan". The plans you can choose are under "Available Plans".

## How many quotes can I try for free?
<!-- id: billing-free-quotes; page: /app/settings/billing -->

A new business gets {{free.quotes}} priced quotes free, with no card. They are counted in total, not each month, so they do not start again when a new month begins.

These do not use up a free quote:

- a test request you send yourself during setup;
- a request a customer started but did not finish;
- a request that was saved without a price because you had none left.

The "Billing" tab shows how many you have used, under "Free quotes used". When you are nearly out, {{product}} emails you once and shows a line on the "Billing" tab.

## What counts as a quote on my plan, and when does the count start again?
<!-- id: billing-what-counts; page: /app/settings/billing -->

Each customer request that gets a price counts as one quote. It is counted when the request arrives.

- A request with several services still counts once.
- Pricing the same request again, after an edit or an answer, does not count again.
- Test requests from setup, unfinished requests and requests saved without a price do not count.
- A saved request counts when you price it with "Price this request".

On a plan, the count is for the calendar month. It starts again on the first day of each month, not on the day your plan renews. The "Billing" tab shows it under "Quotes this month".

This month is counted in UTC (Greenwich time), not in your own time zone. So the count can start again some hours before or after midnight where you are.

## What happens when I run out of quotes?
<!-- id: billing-limit-reached; page: /app/settings/billing -->

Nothing is lost. A new request is saved with its photos and answers, but it is not priced.

- Your customer is told that you have their request and will send their estimate shortly. Nothing about your plan is shown to them.
- You get an email about each saved request. It is in "Quotes", marked "Saved, not priced yet".
- The "Billing" tab says "Free quotes used" or "Limit reached", with how many requests are waiting.
- Quotes you have already sent still open for your customers.

Saved requests are not priced by themselves when you get more quotes. You price each one:

1. Open "Settings", then "Billing", and pick a plan (or a bigger one). On a plan you can also wait for the new month.
2. Open "Quotes" and open the saved request.
3. Press "Price this request". It is priced, and it counts as one quote.

## How do I pick a plan?
<!-- id: billing-choose-plan; page: /app/settings/billing -->

You pick a plan on the "Billing" tab and pay on Stripe's checkout page. There is no trial: a plan is paid from the day you choose it.

1. Open "Settings", then the "Billing" tab.
2. Under "Available Plans", choose "Monthly" or "Annual".
3. Press "Select Plan" on the plan you want. If you chose a plan when you signed up, it is marked "The plan you picked".
4. Pay on Stripe's page. Tax is added there.
5. You come back to the "Billing" tab. It says your plan is active.

If you leave the checkout page without paying, the tab says "Checkout was not finished. Nothing was charged."

## How do I change my plan, or switch between monthly and yearly?
<!-- id: billing-change-plan; page: /app/settings/billing -->

Once you have a plan, you change it on Stripe's billing page, not with the plan cards.

1. Open "Settings", then the "Billing" tab.
2. Press "Change plan" (under "Available Plans") or "Manage billing" (under "Current Plan"). Both open Stripe's billing page.
3. Choose the new plan, or switch between monthly and yearly, and confirm.

- Moving up to a bigger plan happens at once. Stripe charges the difference.
- Moving down to a smaller plan, or from yearly to monthly, happens at the end of the time you have already paid for. Until then the "Billing" tab says "Changes to" with the new plan and the date, and your plan works as normal.

If the plan you want is not offered on Stripe's billing page, email {{support.email}}.

## Why is tax added to the price of my plan?
<!-- id: billing-tax; page: /app/settings/billing -->

Stripe sells the plan and takes the payment. Stripe adds any sales tax or VAT that applies at checkout. That is why every plan price says "plus tax", and why your own cost on the "Billing" tab says "Before tax. Tax is added by Stripe, who sells the plan."

This is the tax on your subscription. The tax on the estimates you send to your customers is set separately, under "Tax Settings" on the "Business" tab.

## How do I update my card, or get my invoices?
<!-- id: billing-card-invoices; page: /app/settings/billing -->

Both are on Stripe's billing page. Your card details are held by Stripe, not by {{product}}.

1. Open "Settings", then the "Billing" tab.
2. Press "Manage billing". If your plan has ended, the button says "Invoices and card".
3. On Stripe's page, change your card or open your invoices.

The button is there only once you have bought a plan.

## My payment failed. What happens now?
<!-- id: billing-payment-failed; page: /app/settings/billing -->

Your plan keeps working while the payment is tried again over the next days. New requests are still priced.

- Every page of the dashboard shows "Your payment didn't go through. Update your card to keep your quotes running."
- You get one email about it.
- The "Billing" tab shows "Payment problem".
- Until the payment goes through, the "Prepared with {{product}}" line shows again on your quote pages, even on a plan that removes it.

To fix it:

1. Press "Update your card" in the notice at the top of the page, or open "Settings", "Billing", "Manage billing".
2. Change your card on Stripe's page.

If the payment still cannot be taken, your plan ends. New requests are then saved for you but not priced until you pick a plan again.

## How do I cancel my plan?
<!-- id: billing-cancel; page: /app/settings/billing -->

You cancel on Stripe's billing page. Your plan keeps working until the end of the time you have paid for.

1. Open "Settings", then the "Billing" tab.
2. Press "Manage billing".
3. Cancel the plan on Stripe's page.

After you cancel, the "Billing" tab says your plan "ends on" a date and "works as normal until then". To keep the plan after all, open "Manage billing" again before that date.

When the plan has ended:

- The tab shows "No plan". New requests are saved for you but not priced until you pick a plan.
- Your free quotes do not come back. Every quote you have ever priced counts against them.
- Your services, prices, settings and quotes stay. Quotes you have sent still open for your customers.
- You can pick a plan again with "Select Plan".

Cancelling a plan does not close your account.

## Can I get a refund?
<!-- id: billing-refunds; page: /app/settings/billing -->

The Terms of Service say plans are billed in advance and fees are not refundable, except where the law requires it. There is no refund button in the dashboard. Ask the team at {{support.email}}.

If the payment for the period you are in is refunded in full, the plan ends straight away. A part refund, or a refund of an earlier period, does not change your plan.

## Which plans remove the "Prepared with" line?
<!-- id: billing-badge; page: /app/settings/billing -->

The line is removed on {{badge.plans}}. On other plans, and without a plan, your quote pages say "Prepared with {{product}}" at the bottom and your request form says "Powered by {{product}}".

There is no switch for it: it goes when you are on one of those plans and comes back if the plan ends. Your logo and your colour work on every plan.

## Where do I see how many quotes I have used?
<!-- id: billing-usage; page: /app/settings/billing -->

On the "Billing" tab, under "Current Plan".

- "Free quotes used" (without a plan) or "Quotes this month" (on a plan) shows how many you have used and how many you have.
- "Renews on" shows the date of your next payment, or "Ends on" if you have cancelled.
- "Monthly cost" or "Yearly cost" shows what the plan costs before tax.

{{product}} also emails you when you have used all your quotes.

## Which plans include WhatsApp quotes, the phone app and the room scan?
<!-- id: billing-coming-soon-features; page: /app/settings/billing; flags: whatsapp, app, roomScan -->

Each plan card under "Available Plans" lists what the plan includes, and marks any line that cannot be used yet.

{{#soon whatsapp}}Quotes inside a WhatsApp chat, on your own business number: {{soon}}. They are part of {{whatsapp.plans}}. Today you can send your quote link in any WhatsApp chat, on every plan.{{/soon}}
{{#live whatsapp}}Quotes inside a WhatsApp chat, on your own business number, are included in {{whatsapp.plans}}.{{/live}}

{{#soon app}}The phone app for pricing a job on site: {{soon}}. It is part of {{app.plans}}. Today you work from the dashboard.{{/soon}}
{{#live app}}The phone app for pricing a job on site is included in {{app.plans}}.{{/live}}

{{#soon roomScan}}Measuring a room by scanning it with your phone: {{soon}}. The room scan is part of {{roomScan.plans}}.{{/soon}}
{{#live roomScan}}The room scan, which measures a room with your phone, is included in {{roomScan.plans}}.{{/live}}
