# "Won through {{product}}" and Analytics

## What is "Won through {{product}}" on my Home page?
<!-- id: analytics-won-panel; page: /app -->

It is the money you won this calendar month from quotes your customers accepted. It shows on Home once you have had your first accepted estimate, and not before.

- "Won from customer requests" is the heading over the main figure.
- The big line reads "Won this month:" with the total of the accepted quotes and the number of jobs. When nothing has been accepted yet this month it reads "No jobs won yet this month".
- "Last month:" shows under it when you won something last month.
- Four steps follow: "Requests", "Estimates sent", "Opened" and "Accepted".
- "See all numbers" opens Analytics.

Before your first accepted estimate, Home shows "Last 30 days" at the bottom instead: "Requests", "Estimates sent", "Accepted" and "Value accepted", each with "up", "down" or "same" against the 30 days before. Once "Won through {{product}}" shows, those four numbers are no longer on Home.

## What do "Requests", "Estimates sent", "Opened" and "Accepted" count?
<!-- id: analytics-won-steps; page: /app; flags: app -->

Each step counts what happened this calendar month, from the 1st until now. The first three count requests your customers sent themselves.

- "Requests": requests that arrived this month.
- "Estimates sent": estimates sent to a customer this month.
- "Opened": estimates a customer opened for the first time this month.
- "Accepted": every estimate accepted this month. It is the same number as "Accepted" under "Where your quotes stand".

Under each step after the first, a small line gives its share of the step before, such as a percentage "of requests", "of sent" or "of opened". Each thing is counted in the month it happened, so an estimate sent last month and accepted this month counts under "Accepted" this month. Test estimates (made with "Try it yourself") never count.

{{#soon app}}Every number here comes from requests your customers sent. Estimates you make yourself on site need the phone app, which is {{soon}}.{{/soon}}
{{#live app}}Estimates you made yourself on site, in the phone app, are not in "Requests", "Estimates sent", "Opened" or the main figure. One that was accepted this month is counted in "Accepted", and the step then says how many, such as "includes 1 made on site", in place of its share. It also has its own line under the steps that ends "you made on site." So "Accepted" is the jobs in "Won this month:" plus the estimates in that line.{{/live}}

## How does a quote become "accepted", or "won"?
<!-- id: analytics-how-accepted; page: /app/quotes?tab=accepted -->

Only the customer can accept. They open their quote page and press "Accept this quote". On an estimate that went out without your approval, the button reads "Accept this estimate". "Won" and "accepted" mean the same thing.

1. The customer presses the accept button on their quote page and says when suits them, with the job address and a phone number.
2. The quote's status becomes "Customer accepted" and it moves to the "Accepted" tab of "Quotes".
3. You get an email whose subject starts "Quote accepted:".
4. The quote's total is added to "Won this month:" on Home.

A quote that waits for your approval cannot be accepted until you approve it. There is no button in the dashboard to mark a quote as accepted yourself, so a job agreed by phone is not counted unless the customer also accepts on their quote page.

## What do the numbers under "Where your quotes stand" mean?
<!-- id: analytics-quotes-stand; page: /app -->

They count your quotes by whose turn it is. Press one to open that tab of "Quotes".

- "Needs you": quotes waiting for you right now. These wait for your approval, have a customer's question, or could not be priced.
- "Waiting for customer": quotes that are with the customer right now. They were sent or opened and not answered yet, or the customer was asked for more details.
- "Accepted", marked "this month": every estimate accepted since the 1st of this month. The "Accepted" step in "Won through {{product}}" shows the same number.

Test estimates are left out. A business with no quotes yet sees one line instead: "No quotes yet. When a customer sends a request, you will see here whose turn it is."

## What do the numbers on the Analytics page mean?
<!-- id: analytics-page-numbers; page: /app/analytics -->

The four figures at the top count all your quotes since you started, not one month.

- "Total Quotes": every quote in your account, whatever its status. This includes quotes still waiting for you.
- "Quotes Viewed": every quote a customer opened, whatever happened next. A quote that was opened and then declined or expired still counts.
- "Quotes Accepted": quotes the customer accepted.
- "Conversion Rate": "Quotes Accepted" as a share of every quote that was sent to a customer. Declined and expired quotes count as sent.

A test estimate is left out of all four, even one you approved and accepted yourself. It is left out of "Estimate accuracy" and "Quote Outcomes by Service" too.

Lower down:

- "Monthly Usage" shows the estimates created this month against your plan's limit, with "Estimates Created" and "Estimates Sent". Before you pick a plan it is headed "Free quotes" and counts in total, not per month.
- "Quote Funnel" shows "Created", "Viewed" and "Accepted", each with its count and its share of "Total Quotes".

## What period do the numbers cover, and can I pick my own dates?
<!-- id: analytics-date-ranges; page: /app/analytics -->

You cannot pick a date range. Each number has a fixed period:

- "Won through {{product}}" on Home, and "Accepted" under "Where your quotes stand": this calendar month, from the 1st until now. "Last month:" is the whole month before.
- "Needs you" and "Waiting for customer" on Home: right now, whatever the quote's age.
- "Last 30 days" on Home, shown until your first accepted estimate: the last 30 days, compared with the 30 days before.
- "Latest activity" on Home: the newest things from the last 30 days.
- The four figures at the top of Analytics, and "Quote Funnel": all your quotes since you started.
- "Monthly Usage" on Analytics: this calendar month.
- "Pricing Insights" and "Quote Outcomes by Service" on Analytics: the last 90 days.
- "Estimate accuracy" on Analytics: every quote you have recorded a final invoice for.

The month on Home starts and ends in your own time zone. {{product}} takes it from your browser the first time you open Home, and keeps it. This is for the numbers on Home only. Your plan's count of quotes for the month follows UTC (Greenwich time) instead.

## How do I record what I finally charged for a job?
<!-- id: analytics-final-invoice; page: /app/quotes/[quoteId] -->

Record it on the quote's page, under "Final invoice". This is what "Estimate accuracy" on Analytics is worked out from.

1. Open "Quotes" in the menu and open the quote.
2. Scroll down to "Final invoice".
3. Type the amount in "Invoiced amount". Add a "Note (optional)" if you like, such as why the job grew.
4. Press "Save". To change it later, type the new amount and press "Update".

An amount under half the quote's total, or over double it, is asked about first: "Is this the full amount you charged for the job?" Press "Yes, save it" to save it as typed, or "Change the amount" to correct it.

The card then shows what you invoiced against the quote's total, and the difference as a percentage. "Final invoice" shows on a quote that was sent or opened and is waiting, and on one that is accepted, declined or expired. It does not show while a customer's question is open, or while an updated quote you sent is waiting for the customer. It does not change the quote, what the customer sees, or "Won this month:", which uses the accepted quote's total.

## How do I compare my estimates with my final invoices?
<!-- id: analytics-estimate-accuracy; page: /app/analytics -->

Open Analytics and read "Estimate accuracy". It compares each quote's total with the final invoice you recorded for it.

1. Record the final invoice on your finished jobs (open a quote and use "Final invoice").
2. Open "Analytics" in the menu. "Estimate accuracy" fills in from the first invoice you record.

The tables are "Overall", "By service" and "By estimate grade". Each row has four figures:

- "Invoiced": how many quotes have a final invoice.
- "Median error": the middle gap between quote and invoice, as a percentage of the quote.
- "Within ±10%": the share of quotes that landed within ten percent of the invoice.
- "Bias": which way you tend to miss. Positive means your quotes run low.

The page gives the target beside the tables: a median error under 10%, and at least 80% of quotes within ±10%. A quote that covers more than one service counts in "Overall" only.

## What are "Pricing Insights", "Quote Outcomes by Service" and "Market Benchmarks"?
<!-- id: analytics-pricing-insights; page: /app/analytics -->

They are three sections lower down the Analytics page. None of them changes a price by itself.

- "Pricing Insights" are suggestions drawn from how your quotes did over the last 90 days. The section shows only when there is a suggestion. "Adjust pricing →" opens "Services", where you make the change yourself.
- "Quote Outcomes by Service" is a table with, for each service, "Sent", "Accepted", "Acceptance" and "Median edit before send", which is how much you usually changed the price before sending. It counts the way the figures at the top do: a quote you edited and sent again is still one quote, a declined or expired quote counts as sent, and a test estimate is left out. A quote you edited more than once counts as one change, from its first price to its last.
- "Market Benchmarks" compares your rates with what similar businesses charge, without naming anyone. You see it while you share your own rates into the same anonymous pool. Figures show only once at least three other businesses with similar services and your currency are sharing. Until then the section says "Not enough comparable businesses yet".

## How do I stop or start sharing my rates in "Market Benchmarks"?
<!-- id: analytics-benchmark-sharing; page: /app/settings; section: Market benchmarks -->

There is a switch in "Settings", under "Market benchmarks": "Share my rates, without my name, in market benchmarks". It is on for a new business. It saves as soon as you change it.

- On: the rates of your services (per room, per hour and so on) are added, without your name, to the typical range that similar businesses see on "Analytics", and you see theirs. Your customers, your quotes and your business name are never shared.
- Off: your rates are in nobody's benchmark, and "Market Benchmarks" on "Analytics" shows you no figures. It shows a "Share & See Benchmarks" button, which switches sharing on again.
