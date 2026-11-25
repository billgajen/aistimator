# Services, questions and prices

## What is a service?
<!-- id: services-what-is; page: /app/services -->

A service is one kind of job you sell. Each service has its own questions for the customer, its own photos to ask for and its own price list. Your website form and your quote link offer every service that is "Active", and {{product}} works out the estimate from that service's prices. The price always comes from the amounts you set.

The "Services" page lists your services. Each row shows the name, "Active" or "Inactive", and the buttons "Edit", "Disable" (or "Enable") and "Delete". A row marked "AI Draft" is a service that was started from a draft, a template or an import.

## How do I add a service?
<!-- id: services-add; page: /app/services -->

Press "Add Service" and go through five steps. Nothing is saved until you press "Create Service" on the last step.

1. Open "Services" and press "Add Service" (on an empty page, "Add your first service").
2. On "Basic Info", type the "Service Name" and a "Description" of the job. {{product}} drafts the service from the description. If you leave "Description" empty there is no draft, and you fill in the next steps yourself.
3. Under "When a customer asks for an estimate", choose whether you check each estimate first. Press "Next". {{product}} writes the draft and fills in the next steps.
4. On "Scope & Photos", check what the job includes and excludes and how many photos to ask for.
5. On "Customer Questions", check the questions the customer will be asked.
6. On "Pricing Setup", set your prices. The draft's amounts are only a starting point: replace every one with your own.
7. On "Test & Publish", press "Calculate Preview" to try the prices, then press "Create Service".

The new service is "Active" straight away, so your form offers it at once.

To start from a ready-made service for your trade instead, press "Add from a template". Templates have their own page in this guide.

## Can I bring in my services from my website or a price list?
<!-- id: services-import; page: /app/services -->

Yes. "Upload Services" reads your website or a price list and drafts a service for each thing it finds. You choose which ones to create.

1. On "Services", press "Upload Services". The "Import Services" window opens.
2. Choose "From your website", type your website address and press "Read My Site". It reads up to 4 pages. A price is only brought in when your site states it.
3. Or choose "Upload document" and add a PDF, a JPG or PNG picture, or a Word file of your prices.
4. Untick anything you do not want. Where one entry has several priced items, choose "One service with … items in breakdown" or "… separate services".
5. Press the "Create … Services" button, then "Done".

The new services are "Active" straight away. Press "Edit" on each one and check its questions and prices. Where no price was found, the list says so and you add the prices yourself.

## How do I change a service's prices or questions later?
<!-- id: services-edit; page: /app/services -->

Press "Edit" beside the service, make the change on its step, then go to the last step and press "Save Changes". Nothing is saved before that.

1. On "Services", press "Edit" beside the service. The "Edit service" window opens on "Basic Info".
2. Press "Next" until you reach the step you need: "Scope & Photos", "Customer Questions" or "Pricing Setup".
3. Make your change.
4. Press "Next" until "Test & Publish", then press "Save Changes".

If you close the window with the X before "Save Changes", your changes are lost. "Save Changes" stays greyed out while the last step shows "Fix Before Publishing".

## Can I describe my prices in plain words?
<!-- id: services-describe-prices; page: /app/services -->

Yes. On "Pricing Setup", the box "Describe your pricing" turns your own words, or a pasted price list, into price lines, questions and rules. It works from the amounts you state, and it lists anything unclear as a question for you instead of guessing. Nothing changes until you have read the result and applied it.

1. Press "Edit" beside the service and go to "Pricing Setup".
2. Under "Describe your pricing", write how you charge, with your amounts and rates.
3. Press "Compile Pricing".
4. Wait while it works: it shows "Reading your prices…", "Making questions…" and "Checking…", and usually takes about half a minute.
5. Read "Here's what your pricing will do:". If it shows "A few things weren't clear", add the answers to your description and press "Compile Pricing" again.
6. Press "Apply This Pricing" to use it, or "Discard" to drop it.
7. Go to "Test & Publish", test it, and press "Save Changes".

When you write that a price depends on something, the result links the line to the question it made for it, and the review says so in words:

- "Add so much if the unit is in an attic" becomes a line that reads "Only include when", then the question and the answer.
- "So much for the first system and so much for each additional one" becomes a line whose quantity is the customer's count minus 1, never below 0.
- "So much per pound, only if needed" becomes a line whose quantity is an optional question. If the customer leaves it empty it counts as 0, never 1.

If something is left loose, the review shows "Worth a look before you apply". It lists any question that changes no price line ("This question does not change the price") and any line whose name says "if", "only", "per", "each additional" or "weekend" but which nothing decides, so it would be charged on every quote. You can still apply and save. The same list stays on "Test & Publish" until you link the line, or remove the question, on "Pricing Setup".

To change prices later, open "Your current pricing in plain English" in the same box and describe only the change. Anything you do not mention stays as it is. You can still change every amount by hand in the boxes below, under "Or fine-tune manually".

It keeps up to ten price lines and ten questions for one service. If your description has more, the result shows "Not everything fitted in one service" and names each price line and question that was left out, before you apply anything. Put those in a second service, or describe fewer in this one.

A service marked "AI Draft" also shows an "AI Refinement" box at the top of these steps. "Chat" takes a change typed in a sentence and applies it at once. "Upload Doc" reads prices from a PDF, a picture or a Word file. Check the result on "Pricing Setup" before you save.

## How do I add or change the questions a customer is asked?
<!-- id: services-questions; page: /app/services -->

Each service has its own questions, on the "Customer Questions" step. The customer is asked them when they pick that service.

1. Press "Edit" beside the service and go to "Customer Questions".
2. Press "Add Question" (or "Add your first question"). To change a question, click it to open it.
3. Type the question in "Label".
4. Choose a "Field Type": "Text" (a short answer), "Text Area" (a longer answer), "Number", "Dropdown" (pick one from a list), "Radio Buttons" (pick one, all shown), "Checkboxes" (pick several) or "Yes/No Toggle".
5. For "Dropdown", "Radio Buttons" and "Checkboxes", type each choice under "Options" and press Enter after each one.
6. "Help Text" is a hint shown under the question on the form.
7. Tick "Required" if the customer must answer. Ticking "Critical for Pricing" also makes the question required.
8. Use the arrows to move a question up or down, and the bin to remove it.
9. Go to "Test & Publish" and press "Save Changes".

Only a "Number" question can set the quantity of a price line. You can change a question's "Label" at any time: the price lines, adjustments and conditions that use the question stay linked to it. If you remove a question, choose another one for anything that used it on "Pricing Setup".

Questions are saved for every service, however it was made. A question for every service, such as how the customer heard of you, is added on "Quote link" under "Advanced · extra questions on the form".

## What kinds of price can I set?
<!-- id: services-price-kinds; page: /app/services -->

A service's price list is on the "Pricing Setup" step. It has five parts.

- "Base Fee": an amount added to every estimate for this service.
- "Price Breakdown": your price lines. A line is a "Fixed Amount" (the same every time), "Per Unit" (your price times a quantity) or "Per Hour" (your hourly rate times the hours). Each line shows on the estimate.
- "Adjustments": raise or lower the price by a percentage when the customer gives a certain answer.
- "Add-ons": optional extras, each with its own price.
- "Minimum Charge": the least you charge for a job. If the lines come to less, the price is raised to your minimum, and the estimate says so on a line of its own, with your amount. The lines themselves do not change.

Every amount box shows your business's own currency symbol.

Tax is not set here. It is under "Tax Settings" on the "Settings" page, and it is added on top of the price.

## How do I add a price line?
<!-- id: services-price-line; page: /app/services -->

Price lines are under "Price Breakdown" on the "Pricing Setup" step.

1. Press "Edit" beside the service and go to "Pricing Setup".
2. Under "Price Breakdown", press "Add Line Item" (or "Add your first line item").
3. Type the "Item Name". This is the line's name on the estimate.
4. Choose the "Pricing Type": "Fixed Amount", "Per Unit" or "Per Hour".
5. Type your price in "Amount", "Price Per Unit" or "Hourly Rate". A new line starts with an amount already filled in: replace it with yours.
6. For "Per Unit" and "Per Hour", choose what to multiply by under "Multiply by".
7. For "Per Unit", you can type a "Unit Label", for example rooms. It shows on the estimate beside the quantity.
8. Go to "Test & Publish" and press "Save Changes".

Use the arrows to change the order of the lines and the bin to remove one. A line marked "Needs link" has no quantity yet, and the service cannot be saved until it has one.

## How does it know the quantity for a price line?
<!-- id: services-quantity; page: /app/services; flags: app, roomScan -->

A "Per Unit" or "Per Hour" line gets its quantity from what you choose under "Multiply by".

- From an answer: choose a question under "Customer Questions". Only "Number" questions are listed. The number the customer types is the quantity.
- Each additional one: choose a question under "Each additional (the answer minus 1)". The quantity is the customer's number minus 1, and never below 0. Use it for "so much for the first, so much for each additional".
- A set quantity: choose "Always 1" to "Always 5" under "Fixed Quantity".
- From the customer's photos: {{product}} measures the size or the count from the photos. These lines come with a template, or from "Describe your pricing" when its review says "quantity estimated by AI from photos". In "Price Breakdown" a "Per Unit" line like this shows "AI (legacy)" in place of a question's name.

When a line has no quantity yet and its name matches a "Number" question, the line offers to link them. Press "Yes, link it".

If the customer can skip the question and leaves it empty, it counts as 0 and the line is left off the estimate. The line says so: "This question is optional: left empty, it counts as 0 and the line is not charged." Tick "Required" on the question if every customer must give a number. A line that comes to nothing, for example a quantity of 0, is left off the estimate.

A line that uses a question or the photos also shows "When you scan on site, fill this from:". {{#soon app}}The phone app is {{soon}}.{{/soon}} {{#soon roomScan}}Its room scan is {{soon}} too, so today this setting changes nothing. Leave it on "Nothing (type it in)".{{/soon}}{{#live roomScan}}It is only for quotes you make in the phone app with a room scan: the scan fills in this quantity, and a number you type on site is used instead. Your customers' website form does not change.{{/live}}

## How do I change the price depending on an answer?
<!-- id: services-price-by-answer; page: /app/services -->

There are two ways, both on "Pricing Setup". First add the question on "Customer Questions".

To charge a line only on some jobs:

1. Under "Price Breakdown", open the line and tick "Only include when condition is met".
2. Under "When to include this item", choose the "Question".
3. Choose the "Condition": "Has any value", "Equals", "Greater than", "At least", "Less than" or "At most". Type the "Value" where it asks for one.

Always choose a "Question". A "Fixed Amount" line that is ticked with no question could never be charged, so it cannot be saved: the line shows "Needs a question", and "Test & Publish" lists it under "Fix Before Publishing" until you choose a question or untick the box.

A line made by "Describe your pricing" from words like "add so much if…" shows its condition as "Only include when", with a "Question" and an "Answer" you can change. It is charged only when the customer gives that answer. Untick "Only include when condition is met" to charge it on every quote.

To raise or lower the whole price by a percentage:

1. Under "Adjustments", press "Add".
2. After "When", choose the question, then the answer.
3. Choose "Increase" or "Reduce" and type the percentage.

The adjustment applies to the base fee, the lines and any add-ons together, and it shows as its own line on the estimate. Go to "Test & Publish" and press "Save Changes" when you are done.

## What are add-ons?
<!-- id: services-addons; page: /app/services -->

An add-on is an optional extra with its own price. {{product}} adds it to an estimate when the customer's description or photos show they need it. The price is always the one you set.

1. Press "Edit" beside the service and go to "Pricing Setup".
2. Under "Add-ons", press "Add".
3. Type a clear name and your price. The name is how {{product}} matches the add-on to what the customer asks for, so say plainly what it is.
4. Go to "Test & Publish" and press "Save Changes".

An add-on that was not added to an estimate is listed on it under "Optional extras", with its price, so the customer can ask for it.

An add-on is left off when its name matches something under "What's Typically Excluded", or when the service's name or "What's Typically Included" already covers it. The preview on "Test & Publish" does not include add-ons.

## What do the included, excluded and photo settings do?
<!-- id: services-scope-photos; page: /app/services -->

They are on the "Scope & Photos" step. They tell the customer what the job covers and how many photos to send.

- "What's Typically Included", "What's Typically Excluded" and "Standard Assumptions": type an item and press Enter. Press the × on an item to remove it. {{product}} uses these lists when it writes the estimate: what the job covers, what you have assumed, and the "Not included" list. They do not change your price lines.
- "Photos required": how many photos a customer must add before they can send a request, from 0 to 8. Set it to 0 to make photos optional. A template's service starts at the number its template sets (1 for most); it stays there until you change it.
- "Maximum Photos Allowed": the most photos a customer can add.
- "Photo Guidance for Customers": your words on what to photograph.

On a service marked "AI Draft" this step also has two links.

- "Regenerate" writes a new draft from the service name and description. It asks first: it lists what it will replace (the scope lists, the photo settings, your questions, your price lines and your add-ons, with how many of each you have) and you press "Replace with a new draft" or "Cancel". "Cancel" leaves everything as it was. Your base fee, minimum charge and adjustments are not replaced.
- "Clear" empties the setup and writes nothing in its place. It asks first: it lists what it will empty (what's included, what's excluded and your assumptions; the photo settings, which go back to 1 to 8 photos with no guidance; your questions; and your price lines with what each one measures from the photos, with how many of each you have) and you press "Empty the setup" or "Cancel". "Cancel" leaves everything as it was. Your service name, description, base fee, minimum charge, add-ons and adjustments are not emptied. If an adjustment uses a question that will be removed, the list says so: that adjustment stops applying until you choose a question for it again.
- Neither button saves anything. After "Replace with a new draft" or "Empty the setup", the service changes only when you press "Save Changes" (or "Create Service"); closing the window with the X keeps the service as it was.

## How do I test a service's prices?
<!-- id: services-test; page: /app/services -->

Use the last step, "Test & Publish". It works out the price a customer would get for the answers you type, from the prices in the window, saved or not. It is worked out the same way as a real request. It sends nothing, makes no estimate and counts nothing on your plan.

1. Press "Edit" beside the service and press "Next" until "Test & Publish".
2. Under "The customer's answers", fill in answers as a customer might. There is a box for each "Number", "Dropdown", "Radio Buttons", "Checkboxes" and "Yes/No Toggle" question. Leave a box empty to try it left empty.
3. Under "From the customer's photos", pick what to try for anything the photos would give: a detail read from a label, such as a size or a fuel, or a size that is measured. For a measured line, type a size, or leave it empty to use the sample size shown under it.
4. Press "Calculate Preview".
5. Read "Preview Breakdown". It shows each line and the "Total" (or "Sample total" when a sample size was used), with your tax when you charge it.
6. Under "Not charged with these answers" it lists the lines that were left out, each with the answer that decides it. Change an answer and press "Calculate Preview" again to see the line come in.

The preview leaves out add-ons, which are added when a customer's own words or photos call for them. If it says "The test price is not available right now", wait a moment and press "Calculate Preview" again.

Under the preview, "Ready to Publish" means the service can be saved. "Fix Before Publishing" lists what to put right on "Pricing Setup" first. "Worth a look before you publish" lists a question that changes no price line and a line whose name says it depends on something while nothing decides it; you can still save. A warning that starts "No pricing configured" means the service has no price lines and no base fee. A warning that starts "Service name includes" means the name promises a repair or a fix and no price line mentions one.

## What does "Check your prices" mean?
<!-- id: services-check-prices; page: /app -->

It is a step in the "Get set up" list on "Home". It asks you to look over the amounts each service charges and make them your own, because a draft or a template starts you with typical prices.

1. On "Home", press "Check your prices". It opens "Services".
2. Press "Edit" beside a service and go to "Pricing Setup".
3. Open "Your current pricing in plain English" to read every price in one list, and change any amount that is not yours.
4. Go to "Test & Publish" and press "Save Changes" (or "Create Service" for a new one).

The step is ticked the first time you save any service this way. It is also ticked when you press "These are my prices" during setup.

## Can I check an estimate before the customer sees it?
<!-- id: services-review-mode; page: /app/services -->

Yes. Each service has its own setting, on the "Basic Info" step under "When a customer asks for an estimate".

- "Show the estimate, then I confirm it": the customer sees the estimate straight away, marked as an estimate you will confirm. They can accept once you approve it. A new service starts on this.
- "Hold until I approve": the customer sees "Your estimate is being prepared" and no price until you approve it.
- "Send automatically": the estimate goes to the customer straight away and they can accept it. You do not review it first.

1. Press "Edit" beside the service.
2. On "Basic Info", choose one of the three.
3. Press "Next" until "Test & Publish", then press "Save Changes".

You approve estimates on the "Quotes" page.

## How do I turn a service off or delete it?
<!-- id: services-disable-delete; page: /app/services -->

Press "Disable" to stop offering a service and keep everything about it. Press "Delete" to remove it for good.

- "Disable": the service shows "Inactive", and your website form and quote link stop offering it. It happens at once. Nothing is removed. Press "Enable" to offer it again.
- You can also switch a service on from inside it: on "Test & Publish", a service that is switched off shows "This service is switched off." with two buttons. "Save Changes" saves it and leaves it off. "Save and switch on" saves it and offers it to customers at once.
- "Delete": you are asked "Are you sure you want to delete" with the service's name. The service and its prices are removed and cannot be brought back.

A service that already has estimates cannot be deleted. You see "Cannot delete service with existing quotes. Disable it instead." Press "Disable" for that service.
