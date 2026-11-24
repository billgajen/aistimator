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

While any are left, and you have never had a plan, your business works like {{freeStart.plan}}: every feature that plan includes. The site says it this way: "{{free.offer}}".

These do not use up a free quote:

- a test request you send yourself during setup;
- a request a customer started but did not finish;
- a request that was saved without a price because you had none left;
- a quote priced while you were on a plan. So if your plan ends, the free quotes you never used are still there.

The "Billing" tab shows how many you have used, under "Free quotes used". When you are nearly out, {{product}} emails you once and shows a line on the "Billing" tab.

## What do my free quotes include, and what happens when they are used up?
<!-- id: billing-free-start; page: /app/settings/billing; flags: whatsapp, app, roomScan, ownAddress -->

A new business that has never had a plan and still has free quotes left works like {{freeStart.plan}}: every feature of that plan, with no card. The number of free quotes is the same as before: {{free.quotes}} priced quotes in total. The site says it this way: "{{free.offer}}".

What that includes:

- Estimates without the "Prepared with {{product}}" line.
- The comparison of your estimates with your final invoices, on "Analytics".
- {{#soon whatsapp}}Quotes inside a WhatsApp chat, on your own business number. This is {{soon}} for every business.{{/soon}}{{#live whatsapp}}Quotes inside a WhatsApp chat, on your own business number.{{/live}}
- {{#soon app}}On-site quotes in the phone app. The phone app is {{soon}}.{{/soon}}{{#live app}}On-site quotes in the phone app.{{/live}}
- {{#soon roomScan}}The room scan, which measures a room with your phone. It is {{soon}}.{{/soon}}{{#live roomScan}}The room scan, which measures a room with your phone.{{/live}}
- {{#soon ownAddress}}Choosing your own address for your quote page. This is {{soon}}.{{/soon}}{{#live ownAddress}}Choosing your own address for your quote page, like {{ownAddress.example}}.{{/live}}

While you are on your free quotes, "Home" shows one quiet line under your business name: "You're trying everything in {{freeStart.plan}}." followed by how many free quotes are left. Where one of these features shows in your dashboard, a small "{{freeStart.plan}}" tag sits beside it, for example beside the title of the "WhatsApp" page.

When the free quotes are used up, you are on no plan. New requests are saved but not priced until you pick a plan. On a plan, that plan's features apply: {{plan.starter.name}} has what {{plan.starter.name}} includes, and no more.

You can end up without one of these features in four ways: your free quotes are used up, you pick a plan without it, you cancel, or you move down from a plan that has it. Then:

- The "Prepared with {{product}}" line returns on your quote pages.

{{#live whatsapp}}- The WhatsApp assistant stops pricing in your chats. Your own WhatsApp is untouched and the connection is kept.{{/live}}

{{#live roomScan}}- A room scan is refused with the line "Room scan is part of Pro."{{/live}}

{{#live app}}- "New quote" in the phone app opens a screen headed "On-site quotes are part of Pro", and no quote is started. The rest of the phone app keeps working.{{/live}}

{{#live ownAddress}}- Your own address forwards to your normal quote link, and stays reserved for you.{{/live}}

Nothing you already made is lost. Your quotes, scans, chats and settings stay, and each feature works again as soon as you move to a plan that includes it.

## What counts as a quote on my plan, and when does the count start again?
<!-- id: billing-what-counts; page: /app/settings/billing -->

Each customer request that gets a price counts as one quote. It is counted when the request arrives.

- A request with several services still counts once.
- Pricing the same request again, after an edit or an answer, does not count again.
- Test requests from setup, unfinished requests and requests saved without a price do not count.
- A saved request counts when it is priced: by itself when you pick a plan, or when you press "Price this request".

On a plan, the count is for the calendar month. It starts again on the first day of each month, not on the day your plan renews. The "Billing" tab shows it under "Quotes this month".

This month is counted in UTC (Greenwich time), not in your own time zone. So the count can start again some hours before or after midnight where you are.

## What happens when I run out of quotes?
<!-- id: billing-limit-reached; page: /app/settings/billing -->

Nothing is lost. A new request is saved with its photos and answers, but it is not priced.

- Your customer is told that you have their request and will send their estimate shortly. Nothing about your plan is shown to them.
- You get an email about each saved request. It is in "Quotes", marked "Saved, not priced yet".
- The "Billing" tab says "Free quotes used" or "Limit reached", with how many requests are waiting.
- Quotes you have already sent still open for your customers.

When you pick a plan, or move to a bigger one, the saved requests are priced for you:

- It starts within a minute or so of your payment. The oldest request is priced first.
- Each one counts as one quote on the new plan. It stops when the plan has no quotes left for the month.
- Each estimate then goes on as any other: it is sent to the customer, or it waits for your approval, as that service is set.
- Only requests from the last 30 days are priced this way, and at most 20 at a time.

Any saved request that is left, you price yourself. So do you when the new month gives your plan more quotes: nothing is priced by itself then.

1. Open "Quotes" and open the saved request.
2. Press "Price this request". It is priced, and it counts as one quote.

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
- When the smaller plan starts, anything it does not include stops. Nothing you made is deleted, and it works again if you move back up.

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
- Your plan keeps everything it includes while the payment is tried again, the estimate without the "Prepared with {{product}}" line too.

To fix it:

1. Press "Update your card" in the notice at the top of the page, or open "Settings", "Billing", "Manage billing".
2. Change your card on Stripe's page.

If the payment still cannot be taken, your plan ends. New requests then use any free quotes you never used. After that they are saved for you but not priced until you pick a plan again.

## How do I cancel my plan?
<!-- id: billing-cancel; page: /app/settings/billing -->

You cancel on Stripe's billing page. Your plan keeps working until the end of the time you have paid for.

1. Open "Settings", then the "Billing" tab.
2. Press "Manage billing".
3. Cancel the plan on Stripe's page.

After you cancel, the "Billing" tab says your plan "ends on" a date and "works as normal until then". To keep the plan after all, open "Manage billing" again before that date.

When the plan has ended:

- The tab shows "No plan".
- Free quotes you never used are still yours. Only the quotes you priced before you had a plan count against your {{free.quotes}}; quotes priced on the plan do not. If you had used them all, new requests are saved without a price.
- The other features you had while you were new and on free quotes do not come back: they were for a business that had never had a plan.
- Your services, prices, settings and quotes stay. Quotes you have sent still open for your customers.
- Anything that only your plan included stops. Nothing you made is deleted, and it works again when you pick a plan that includes it.
- You can pick a plan again with "Select Plan".

Cancelling a plan does not close your account.

## Can I get a refund?
<!-- id: billing-refunds; page: /app/settings/billing -->

The Terms of Service say plans are billed in advance and fees are not refundable, except where the law requires it. There is no refund button in the dashboard. Ask the team at {{support.email}}.

If the payment for the period you are in is refunded in full, the plan ends straight away. A part refund, or a refund of an earlier period, does not change your plan.

## Which plans remove the "Prepared with" line?
<!-- id: billing-badge; page: /app/settings/billing -->

The line is removed on {{badge.plans}}. It is also removed for a new business that has never had a plan, while it still has free quotes left. On other plans, and on no plan once the free quotes are used up, your quote pages say "Prepared with {{product}}" at the bottom and your request form says "Powered by {{product}}".

There is no switch for it: it goes when you are on one of those plans and comes back if the plan ends. It also comes back when your free quotes are used up, until you pick one of those plans. Your logo and your colour work on every plan.

## Where do I see how many quotes I have used?
<!-- id: billing-usage; page: /app/settings/billing -->

On the "Billing" tab, under "Current Plan".

- "Free quotes used" (without a plan) or "Quotes this month" (on a plan) shows how many you have used and how many you have.
- "Renews on" shows the date of your next payment, or "Ends on" if you have cancelled.
- "Monthly cost" or "Yearly cost" shows what the plan costs before tax.

{{product}} also emails you when you have used all your quotes.

## Which plans include WhatsApp quotes, on-site quotes in the phone app, the room scan and your own address?
<!-- id: billing-coming-soon-features; page: /app/settings/billing; flags: whatsapp, app, roomScan, ownAddress -->

Each plan card under "Available Plans" lists what the plan includes, and marks any line that cannot be used yet. A new business that has never had a plan and still has free quotes left works like {{freeStart.plan}}, so what {{freeStart.plan}} includes applies to it too.

{{#soon whatsapp}}Quotes inside a WhatsApp chat, on your own business number: {{soon}}. They are part of {{whatsapp.plans}}. Today you can send your quote link in any WhatsApp chat, on every plan.{{/soon}}
{{#live whatsapp}}Quotes inside a WhatsApp chat, on your own business number, are included in {{whatsapp.plans}}.{{/live}}

{{#soon app}}The phone app: {{soon}}. It will come with every plan, and with no plan at all. Starting a quote on site in it will be part of {{onsite.plans}}. Today you work from the dashboard.{{/soon}}
{{#live app}}The phone app comes with every plan, and with no plan at all. Starting a quote on site in it is part of {{onsite.plans}}.{{/live}}

{{#soon roomScan}}Measuring a room by scanning it with your phone: {{soon}}. The room scan is part of {{roomScan.plans}}.{{/soon}}
{{#live roomScan}}The room scan, which measures a room with your phone, is included in {{roomScan.plans}}.{{/live}}

{{#soon ownAddress}}Your own address for your quote page, like {{ownAddress.example}}: {{soon}}. It is part of {{ownAddress.plans}}. Today your quote link works on every plan.{{/soon}}
{{#live ownAddress}}Your own address for your quote page, like {{ownAddress.example}}, is included in {{ownAddress.plans}}. Your quote link keeps working on every plan.{{/live}}
