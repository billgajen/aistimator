# Getting started

## What does {{product}} do?
<!-- id: start-what-it-does; page: /app -->

{{product}} gives your customers a price straight away. You set up your services and prices once; a customer opens your quote link or the form on your website, answers a few questions, adds photos, and gets an estimate worked out from your prices.

Every request shows in your dashboard, where you can check the estimate and approve it. The price always comes from the prices you set.

## How do I sign up?
<!-- id: start-sign-up; page: /app/onboarding -->

You sign up with your business name, an email address and a password. No card is asked for.

1. On the sign-up page, fill in "Business name", "Email" and "Password" (at least 8 characters).
2. Press "Create account". The page changes to "Check your email".
3. Open the email we sent and press "Confirm my email". The link works once, for one hour.
4. On the page that opens, "Confirm your email", press "Confirm my email" again.
5. You are now logged in, and the first-run setup starts.

## What happens in the first-run setup?
<!-- id: start-first-setup; page: /app/onboarding -->

Setup takes you from your trade to your first services in a few short screens. Until your business has a service, opening "Home" brings you back to setup. Once you have one, "Home" stays "Home", even if you switch every service off.

1. "What kind of work do you do?" Check "Where is your business?", pick the closest trade, and press "Continue". Each trade is a template: a ready-made set of services, questions and prices. If you do several kinds of work, tick more than one, up to four.
2. "Here's what we found" lists the services. With more than one trade picked, each trade's services sit under its name. Untick any you do not offer, then press "Looks right — continue".
3. "Check your prices" shows every number your estimates will charge. Change any number to match what you charge, then press "These are my prices".
4. "Last step — the basics": choose your "Currency", tick the box to add tax to estimates if you charge it (then fill in "Tax name" and "Rate (%)"), and fill in "Service area" and "Your logo" if you want to. Both are optional. Leave "Service area" blank to take requests from anywhere.
5. Press the button that starts "Create" and ends "& finish". Your services are created.
6. "Try it yourself" lets you see what your customers see with a test request, copy your quote link, and press "Go to dashboard".

You can change everything afterwards, on "Services" and in "Settings".

## My trade is not in the list. How do I set up?
<!-- id: start-something-else; page: /app/onboarding -->

Pick "Something else" on the first setup screen. {{product}} then reads your website, or your own description, and suggests your services.

1. On "What kind of work do you do?", pick "Something else". You can type what you do under "What do you do?". Press "Continue".
2. Choose "Read my website" and type your website address, or choose "I'll describe it" and say what you offer and how you charge. Press "Continue". This takes up to 30 seconds.
3. On "Here's what we found", untick anything you do not offer and press "Looks right — continue".
4. For a service with no price found, you are asked "How do you charge for" that service. Explain it the way you would to a customer and press "Set Pricing". Read "Here's what your pricing will do:", then press "That's right", or "Let me rephrase" to try again. "Skip for now" leaves that service without prices for the moment.
5. Carry on with "Check your prices" and the rest of setup.

If you would rather build your services by hand, press "Skip — set up manually instead" on the first screen. It opens "Services", and "Home" stops sending you to setup.

## Can I pick more than one trade in setup?
<!-- id: start-several-trades; page: /app/onboarding -->

Yes. On "What kind of work do you do?" you can tick up to four trades, for example heating and plumbing.

1. Tick each trade you do. Tick one again to untick it.
2. Press "Continue". "Here's what we found" offers the services of every trade you ticked, each trade under its own name.
3. Untick any service you do not offer, then press "Looks right — continue".

"Something else" cannot be ticked together with a trade: it is for a business whose trade is not in the list. After setup you can add more services from any trade's template on "Services".

## How do I see what a customer sees?
<!-- id: start-test-estimate; page: /app/onboarding -->

Press "Try it yourself". Your own request form opens in a new tab, in test mode, and what you send from it is a test estimate. A test estimate does not count toward your plan or your free quotes.

The button is on the last screen of setup, "Try it yourself", under "See what your customers see". It is also on "Home", in the "Try it yourself" box, until your first real customer request arrives. It needs at least one service switched on.

1. Press "Try it yourself". Your request form opens in a new tab, with a line at the top that starts "Test mode".
2. Fill in the form as a customer would and send it. You land on the estimate page your customer would get.
3. In setup, go back to the setup tab. It says "Waiting for your test request…", then "Got it. Pricing your test request…".
4. Under "Here's the estimate your customer got" you see each line and the "Total". If your form asked a question first, answer it in the other tab and the estimate appears.
5. If the estimate is waiting for your approval, press "Approve & send" to see what approving does. The page then says "Sent. Your customer now has your confirmed quote and can accept it."

Started from "Home", the test estimate is in "Quotes" once you have sent it.

You can make 5 test estimates in 24 hours. After that the button tells you when you can make another, for example: "You have made 5 test estimates in the last 24 hours. You can make another after 3:40 PM tomorrow." A test shows in "Quotes" with a "Test" tag and is left out of the counts on "Home" and in "Analytics". You can delete a test on its own page with "Delete this test".

Only this button makes a test. It works only while you are signed in to your dashboard, so a customer cannot make one. If you open your quote link yourself and send a request, it is treated as a real request and it counts.

## What is on the Home page?
<!-- id: start-home-page; page: /app; flags: ownAddress -->

"Home" shows what needs you first, then how your quotes are doing. The page's title is your business name.

A new business that has never had a plan and still has free quotes left sees one quiet line under its name: "You're trying everything in {{freeStart.plan}}." followed by how many free quotes are left.

{{#soon ownAddress}}A card for choosing your own address for your quote page is {{soon}}. It is not on "Home" today.{{/soon}}
{{#live ownAddress}}If you can choose your own address for your quote page and have not chosen one yet, the card "Choose your own address" comes next. "Later" hides it on "Home". It stays on the "Quote link" page.{{/live}}

If every one of your services is switched off, a notice comes first: "All your services are off, so customers can’t get an estimate." Press "Go to Services" and switch one on.

Then, from top to bottom:

1. "Waiting for you": quotes to approve, customer questions and requests that could not be priced. A quote to approve has an "Approve & send" button right there. This part is hidden when nothing is waiting.
2. A line saying how many new people started a request but did not finish, with "See who". It only counts ones you have not seen yet.
3. A notice about your plan or your free quotes, when you are close to the limit or have reached it.
4. "Won through {{product}}": what you won this calendar month. It appears once a customer has accepted an estimate.
5. "Get set up": four steps, shown until all four are done.
6. "Where your quotes stand": three counts by whose turn it is.
7. "Latest activity": the newest things that happened to your quotes. Each line opens its quote.
8. "Your quote link": the link you give customers, with "Copy", "Open" and "QR code and website form".
9. "Last 30 days": "Requests", "Estimates sent", "Accepted" and "Value accepted", each compared with the 30 days before. "See all numbers" opens "Analytics". These four numbers are hidden once "Won through {{product}}" shows.

Test estimates, the ones you make with "Try it yourself", are left out of every count on this page. While you have had no real customer request, "Home" also shows a "Try it yourself" box.

## Do I need to refresh the page to see a new request?
<!-- id: start-updates-itself; page: /app -->

No. "Home" and "Quotes" update by themselves, within a few seconds.

- A new request, an estimate a customer opened, accepted or declined, and a customer's question all show without a reload. So does someone who starts a request and does not finish: the number beside "Unfinished requests" in the menu follows too.
- The page checks only while its tab is on screen. When you come back to a tab that was in the background, it checks at once.
- What you are doing stays as it is: your place on the page, an open "More" menu and a search you have typed.

Other pages, such as a quote's own page, show what was true when you opened them. Open the page again to see a change.

## What is the "Get set up" list, and what ticks each step?
<!-- id: start-get-set-up; page: /app -->

"Get set up" on "Home" has four steps. Each one is ticked only by something you or a customer really did. The heading shows how many are done, such as "2 of 4 done", and the list goes away when all four are ticked.

1. "Add a service" is ticked when you have at least one service, switched on or off. Pressing it opens "Services".
2. "Check your prices" is ticked when you finish setup after pressing "These are my prices", or when you save a service on "Services" with "Create Service" or "Save Changes". Pressing it opens "Services".
3. "Share your quote link" is ticked the first time you press "Copy" on your quote link (on "Home", on the "Quote link" page or at the end of setup), copy one of the ready-made texts on the "Quote link" page, send your link with the send button there, or press "Download PNG" on the QR code there. It is also ticked when your first real customer request arrives. Opening the link does not tick it, whoever opens it. Your own test estimate does not tick it, and copying the website code does not. Pressing it opens "Quote link".
4. "First real request received" is ticked when a customer sends you a request. A test estimate does not count, and an unfinished request does not count. Pressing it opens "Quotes".

Nothing is switched off while a step is unticked. The list is only a guide.

## What does "Where your quotes stand" show?
<!-- id: start-quotes-stand; page: /app -->

It shows three counts, by whose turn it is. Pressing a count opens that tab in "Quotes".

1. "Needs you": quotes waiting for you, such as one to approve, a customer's question, or a request that could not be priced. When the count is above zero it is marked in yellow.
2. "Waiting for customer": quotes where the next move is the customer's, such as a quote you sent that has not been accepted yet.
3. "Accepted", marked "this month": every estimate accepted since the 1st of this month. The "Accepted" step in "Won through {{product}}" shows the same number.

Before your first quote it says "No quotes yet. When a customer sends a request, you will see here whose turn it is." Test estimates are not counted.

## What is each item in the menu for?
<!-- id: start-menu; page: /app; flags: whatsapp -->

The menu is on the left, in three groups: "Work", "Set up" and "Account". On a phone, open it with the button at the top left.

- "Home": what needs you today and where your quotes stand.
- "Quotes": every quote, in tabs by whose turn it is ("Needs you", "Waiting for customer", "Accepted", "Closed", "Unfinished", "All").
- "Unfinished requests": people who started a request and did not finish. A number beside it shows how many new ones you have not seen.
- "Analytics": how your quotes are doing, such as how many were created, viewed and accepted.
- "Services": your services and what you charge for each. Add, edit, disable or delete a service here, or add one from a template.
- "Quote link": the link you give customers, its QR code, and the code that puts the form on your website.
- "WhatsApp": {{#soon whatsapp}}quotes inside a WhatsApp chat, on your own business number. {{soon}}. Today you can share your quote link in a WhatsApp chat: see "Use it on WhatsApp" on the "Quote link" page.{{/soon}}{{#live whatsapp}}connect your business number so customers can ask for a quote inside a WhatsApp chat. It comes with {{whatsapp.plans}}, and with a new business's free quotes while some are left.{{/live}}
- "Settings": four tabs, "Business", "Branding", "Billing" and "Notifications".
- "Help": at the bottom of the menu. It opens a panel with "Ask {{product}}" (an assistant that answers questions about using {{product}}), "Report a problem", "Suggest a feature" and "Your reports and requests". A "New" mark beside it means we have replied to you.
- "Sign out": under "Help".

## What do I get for free, and how are the free quotes counted?
<!-- id: start-free-offer; page: /app/settings/billing -->

You get {{free.quotes}} free quotes, and no card is needed. They are counted in total: they do not start again each month. The site says it this way: "{{free.offer}}".

While you have never had a plan and still have free quotes left, your business works like {{freeStart.plan}}: you can use every feature that plan includes. "Home" says so in one line under your business name, with how many free quotes are left. The "Billing" tab lists what each plan includes.

- Each request a customer sends in counts as one, however many services it asks for.
- Test estimates (made with "Try it yourself") do not count.
- Unfinished requests (someone started and did not finish) do not count.

When you have only a few left, "Home" shows a notice with a "Pick a plan" button, and we email you once. After they are used up, you are on no plan. New requests are still saved, but they are not priced: the customer is told you will send their estimate shortly. Pick a plan to price them. The features of {{freeStart.plan}} stop as well, until you pick a plan that includes them. Nothing you made is lost.

"Settings", then "Billing", shows "Free quotes used". A business set to the United Kingdom has a free allowance that is counted by calendar month instead; "Billing" shows it as "Quotes this month". That monthly allowance does not come with the features of {{freeStart.plan}}.

## How do I sign in and sign out?
<!-- id: start-sign-in-out; page: /app -->

You sign in with your email and password. You sign out from the bottom of the menu.

To sign in:

1. Open the log-in page. If you open a dashboard page while signed out, you are sent there.
2. Fill in "Email" and "Password".
3. Press "Log in". You land on "Home".

To sign out:

1. On a phone, open the menu with the button at the top left.
2. Press "Sign out", at the bottom of the menu under "Help". You are taken to the log-in page.

## How do I reset my password?
<!-- id: start-reset-password; page: /app -->

Ask for a reset link from the log-in page. The link works once, for one hour.

1. On the log-in page, press "Forgot your password?".
2. Type your "Email" and press "Send the link". The page says "Check your email". It says the same whether or not the address has an account.
3. Open the email and press "Choose a new password". On the page that opens, "Reset your password", press "Choose a new password" again.
4. Type your "New password" (at least 8 characters) and press "Save the new password". You are logged in and land on "Home".

The new password must be one you have not used on this account before. If you are signed in and know your current password, you do not need a reset link: use "Change password" in "Settings".
