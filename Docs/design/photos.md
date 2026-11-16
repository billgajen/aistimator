# Photographs made for the site

Every photograph on the site that we did not take is listed here: what it shows, how it was made, the exact
prompt, and what was thrown away. `Docs/design/system.md` (Imagery) sets the rules; this file is the record.

Two tickets made photographs: T-168 (Home's hero, first below) and T-170 (the six trade pages' heroes, Home's
closing band, the van in "Add it anywhere" and the demo's two sample photos, second below).

## Home's hero photograph (T-168, 2026-11-15)

**Status: option b is the hero on the production site** (the owner's choice, 2026-11-15). Four scenes were made
and compared on a preview behind a switch (`?hero=a|b|c|d`). The switch is removed, and the files of a, c and d
are not in the repo; their prompts and what was done to them stay recorded below.

**In the repo:** `apps/web/public/photos/hero-b-2400.webp` (2400 x 1451, 119 KB) and `hero-b-1200.webp`
(1200 x 726, 38 KB). Alt text: "A house painter in white overalls stands on a front porch, checking a phone; a
paint roller rests in a tray at their feet." It is attempt 1 of scene b with its right-hand 7.7% cut off.

### How they were made

- **Model:** `gemini-3-pro-image` (Google's Gemini image model), through the Gemini API's interactions
  endpoint (`POST /v1beta/interactions`, `response_format: { type: "image", aspect_ratio: "16:9", image_size: "2K" }`).
  Google's current documentation was checked on 2026-11-15 (ai.google.dev, "Image generation"). The other image
  models the key can use are `gemini-nano-banana-2.1`, `gemini-3.1-flash-image`, `gemini-3.1-flash-lite-image` and
  `gemini-2.5-flash-image`; the pro model was chosen for hands and faces.
- **Script:** `scripts/design/generate-hero-photos.mjs`, one call per run (`--scene a|b|c|d`; `--dry` prints the
  prompt and calls nothing; `--list` shows the count). The model comes from `HERO_IMAGE_MODEL` (default
  `gemini-3-pro-image`). The key is `GEMINI_API_KEY`, read from the environment or the local env files; it is
  never printed. The script keeps a ledger and refuses a fourth attempt at a scene or a thirteenth call.
- **Candidates are written outside the repo** (`HERO_PHOTOS_OUT`, by default a folder in the system's temp
  directory). Only the chosen four are in the repo. No rejected image was committed.
- **Size:** each image came back at 2752 x 1536. `scripts/design/photos-to-webp.mjs` writes the WebP files (it
  uses the browser the verify scripts use, because this machine's image tool cannot write WebP).
- Every image from this model carries Google's invisible SynthID watermark.

**Calls used: 9 of 12** (a: 3, b: 1, c: 3, d: 2). All nine returned an image.

### The prompt

Each prompt is four parts joined in this order: the art direction, the scene, the composition, the "never" list.

**Art direction (the same for every photograph we make):**

> A documentary-style photograph, as an editorial photographer would take it on a working day: unposed, observed,
> honest. Natural daylight only. An ordinary American home or residential street. Calm and warm. Colour: warm
> off-white and pale paper tones with deep juniper green; muted, nothing saturated. At most one small yellow
> object in the whole picture. The person is absorbed in what they are doing and is not looking at the camera. No
> posed smile. An ordinary working adult, not a model. Hands are natural and correct, with five fingers each. Not
> a studio, no studio lighting, no stock-photo look, no lens flare, no dramatic colour grading.

**Composition (the hero's frame):**

> A wide 16:9 frame, photographed at eye level with a 35mm lens and a shallow depth of field. The subject stands
> entirely in the right third of the frame, seen from the knees or waist up, with their whole head inside the
> frame and clear space above it. The left 55 percent of the frame is calm, light and nearly empty: *(the scene's
> own calm area)*. It is bright and even enough for dark text to be placed over it, with no objects, no people and
> no strong shadows in that part.

**Never:**

> There is no text anywhere in the picture: no letters, no numbers, no words, no signs, no labels that can be
> read, no licence plate. No logos and no brand names on any vehicle, clothing, tool or device. Any phone or
> tablet is seen from behind or edge-on; its screen is not visible. No recognisable real person.

**The four scenes** (the wording of the attempt that was kept; the script holds the same text):

| | Scene | Calm area (left 55%) |
|---|---|---|
| a | A contractor in their forties in a plain dark green work jacket stands beside a plain white work van parked in a suburban driveway, looking down at a phone held in one hand. The van has no lettering, no stripes and no logo. A small plain yellow tape measure is clipped to their belt; it is a plain yellow case with no label, no sticker and no markings of any kind. | the pale siding of a house and a soft, bright overcast sky, out of focus |
| b | A house painter in paint-flecked white overalls stands on the wooden front porch of an American house, checking a phone held in one hand. A paint roller rests in a tray on the porch boards beside them, and a deep juniper green front door is behind them. The only yellow is the handle of a small tape measure on the porch rail. | a freshly painted pale off-white porch wall in soft even light |
| c | A homeowner in their thirties in a casual juniper green sweater stands in a tidy residential garage, holding a phone up with both hands to photograph a tall white water heater tank that stands at the far right edge of the frame. The camera faces the homeowner from the front and slightly to one side, so we see their face in three-quarter view and the plain dark back of the phone; the phone screen faces away from the camera and is never seen. The homeowner and the tank are both pushed to the far right of the picture, with the homeowner no further left than two thirds of the way across. The tank is plain white with no label, no sticker and no markings. A small plain yellow tape measure sits on a shelf. | a plain pale painted garage wall lit by daylight from the open garage door |
| d | A tradesperson in a plain juniper green work shirt sits at a wooden kitchen table in morning light, photographed from across the room so that their whole head, shoulders and the table are well inside the frame and they appear small in the picture. They are looking down at a tablet propped up in a plain grey folding case; the camera sees only the grey back of the case, never the screen. A yellow tape measure lies on the table. A plain mug stands beside it. | a pale kitchen wall and a window with soft morning light, out of focus |

The composition line and scenes a, c and d were tightened between attempts (the whole head in the frame; a tape
measure with no label; the phone or tablet seen from behind; the subject pushed further right). Scene b was kept
from its first attempt, with the first wording of the composition line.

### What was kept

Each was looked at whole and enlarged at the face, the hands and anything that could carry writing.

| | Kept | File (2400 px) | Size | 1200 px | Alt text |
|---|---|---|---|---|---|
| a | attempt 3, with the lowest 22% cut off | `hero-a-2400.webp`, 2400 x 1045 | 82 KB | `hero-a-1200.webp`, 26 KB | A contractor in a green work jacket stands beside a white work van in a driveway, looking down at a phone. |
| b | attempt 1, with the right-hand 7.7% cut off | `hero-b-2400.webp`, 2400 x 1451 | 119 KB | `hero-b-1200.webp`, 38 KB | A house painter in white overalls stands on a front porch, checking a phone; a paint roller rests in a tray at their feet. |
| c | attempt 3, with one small patch | `hero-c-2400.webp`, 2400 x 1340 | 145 KB | `hero-c-1200.webp`, 38 KB | A homeowner in a garage holds up a phone to photograph the side of a water heater. |
| d | attempt 2 | `hero-d-2400.webp`, 2400 x 1340 | 87 KB | `hero-d-1200.webp`, 29 KB | A tradesperson sits at a kitchen table in morning light, looking down at a tablet; a tape measure lies on the table. |

All eight files were WebP at quality 0.86, every one under 300 KB. Only b's two are in
`apps/web/public/photos/` now (`hero-sizes.json` beside them records their measurements).

**Changes made to the kept images, in code** (`scripts/design/photos-to-webp.mjs`; no image model was used for
any of them):

- **a, a cut:** a patch on the jacket's lower pocket could be taken for a brand mark. The picture is cut above it
  (the top 78% is kept), which is why a is a wider strip than the others.
- **b, a cut:** the tape measure on the porch rail carried a label with garbled lettering drawn by the model. The
  right-hand 7.7% of the picture, with the tape measure and the rail post it sat on, is cut off. The kept picture
  has no yellow object (the rule is "at most one").
- **c, a patch:** the tape measure on the shelf had the same kind of label on the lower half of its round face
  (about 50 x 23 px in a 2752 px picture). Scene c had used its three attempts, so the label is painted out: the
  plain upper half of the face is copied, upside down, over the lower half. Nothing else in the picture is
  touched. If the owner would rather not use a retouched picture, c is the one to leave out.
- **c, kept as it is:** two safety labels on the side of the tank are seen edge-on. They show a flame symbol and
  fine lines; no word or number on them can be read at any size the site shows, and they carry no brand.
- **d:** unchanged. Its tape measure is plain yellow with no label.

### What was rejected, and why

| Image | Why it was rejected |
|---|---|
| a, attempt 1 | the top of the contractor's head was cut off by the frame |
| a, attempt 2 | garbled lettering on the tape measure's label (text drawn by the model) |
| c, attempt 1 | the phone's screen faced the camera, with a picture on it drawn by the model |
| c, attempt 2 | the homeowner stood near the middle of the frame, under where the headline goes |
| d, attempt 1 | the head was cut off by the frame, and the tablet's screen was visible |

None was rejected for a malformed hand or face, a logo, or a likeness to a recognisable person; none of the nine
showed one. The five rejected files were never in the repo.

The same fault that rejected a's second attempt (lettering on a tape measure's label) was found on the kept b and
c when they were looked at again at full size. It was removed from both (above) and not left in.

### After the choice

- The owner chose b on the preview. b is wired in as the hero (`HeroPhoto`), with no switch.
- a, c and d were never on the production site. To make any of them again, the candidates would have to be
  generated afresh (they were kept outside the repo); `scripts/design/photos-to-webp.mjs` keeps the crop and the
  patch that were applied to them, as comments.

## Trade heroes, the closing band, the van and the demo's samples (T-170, 2026-11-16)

**Status: built and on a preview. Not on the production site.**

Ten photographs: one for each of the six trade pages' heroes, one evening picture for Home's closing band, the
side of a van for "Add it anywhere", and two sample photos for `/demo`. Home's hero (above) is unchanged.

### How they were made

- **Model, endpoint and script:** the same as T-168 (`gemini-3-pro-image` through `POST /v1beta/interactions`,
  `scripts/design/generate-hero-photos.mjs`). The script now carries these ten scenes beside T-168's four; each
  names its own frame. The limit is three attempts a scene; each ticket keeps its own ledger and its own folder
  of candidates outside the repo.
- **Calls used: 14, all returned an image.** Six scenes were kept from their first attempt; four were made a
  second time with tighter wording (`van`, `closing`, `trade-plumbing`, `demo-room`). No scene needed a third.
- **Files:** `scripts/design/photos-to-webp.mjs` (no image model: a crop, a small patch, WebP). Sizes are also in
  `apps/web/public/photos/photo-sizes.json`.
- **Art direction:** T-168's, word for word, with two variants the ticket asked for. A scene with nobody in it
  swaps the sentences about the person for "There are no people in the picture, and no part of a person." The
  closing band is the one evening picture: "Natural daylight only" becomes the last blue daylight of dusk and one
  warm lamp. The demo's two samples are "an ordinary photograph taken by a homeowner with a phone".
- Every image from this model carries Google's invisible SynthID watermark.

### What was kept

Each was looked at whole, then at full size on every face, hand, tool, label and anything that could carry
writing.

| Scene | Kept | Files | Size | Alt text |
|---|---|---|---|---|
| `trade-painting` | attempt 1, one small patch | `trade-painting-2400.webp` (2400 x 1340), `trade-painting-1200.webp` | 141 KB, 54 KB | The front of a freshly painted house: pale siding, white trim and a dark green front door, with a ladder against the wall and a drop cloth and a paint can on the porch. |
| `trade-hvac` | attempt 1, unchanged | `trade-hvac-2400.webp` (2400 x 1340), `trade-hvac-1200.webp` | 192 KB, 64 KB | An air conditioner’s outdoor unit on a concrete pad beside the pale siding of a house, with its lines running up the wall. |
| `trade-water-heaters` | attempt 1, unchanged | `trade-water-heaters-2400.webp` (2400 x 1340), `trade-water-heaters-1200.webp` | 53 KB, 15 KB | A tall white water heater tank in the corner of a garage, with copper pipes and a vent rising from its top. |
| `trade-plumbing` | attempt 2, one small patch | `trade-plumbing-2400.webp` (2400 x 1340), `trade-plumbing-1200.webp` | 116 KB, 38 KB | A plumber in a green work shirt leans over a kitchen sink, tightening the tap with a wrench; a canvas tool bag sits on the counter. |
| `trade-electrical` | attempt 1, with the lowest 23% cut off | `trade-electrical-2400.webp` (2400 x 1032), `trade-electrical-1200.webp` | 64 KB, 15 KB | An electrician in a grey work shirt holds open the door of an electrical panel on a garage wall and looks inside. |
| `trade-garage-doors` | attempt 1, unchanged | `trade-garage-doors-2400.webp` (2400 x 1340), `trade-garage-doors-1200.webp` | 109 KB, 34 KB | A closed white garage door on the front of a house, seen from the driveway, with a lamp beside it. |
| `closing` | attempt 2, unchanged | `closing-2400.webp` (2400 x 1340), `closing-1200.webp` | 133 KB, 35 KB | In the evening, someone sits back on a sofa beside a lit lamp, looking down at a phone. |
| `van` | attempt 2, cut to a 5:8 picture | `van-1000.webp` (1000 x 1600), `van-500.webp` | 120 KB, 30 KB | The side of a plain white work van parked on a residential street. |
| `demo-springs` | attempt 1, one small patch | `apps/web/public/demo/sample-garage-door-springs.webp` (1200 x 896) | 46 KB | (a customer's own photo in the demo; it has no alt text of ours) |
| `demo-room` | attempt 2, unchanged | `apps/web/public/demo/sample-room-to-paint.webp` (1200 x 896) | 78 KB | (as above) |

All are WebP at quality 0.86 and every one is under 300 KB. The water heater's sample stays the label drawn for
T-153 (`sample-water-heater-label.png`): that service's first photo is its rating label, and a label has to be
readable, which an image model must not draw.

**The van has no 2400 px file, and that is on purpose.** It is a column picture that is never shown wider than
about 360 px, and the part of the candidate that is kept is 1103 px wide. Its two files are 1000 px and 500 px.

**The QR code and the words on the van are ours.** The image model drew a plain white van with nothing on it.
`AddItAnywhere` places the real QR code for the example business's quote page, the business's name and "Scan for
an estimate" on the van's flat panel, in code.

**Changes made to the kept images, in code** (`scripts/design/photos-to-webp.mjs`):

- **`trade-painting`, a patch:** the picture had two small yellow things, a pair of gloves on the porch and a
  sponge on an outside tap by the downpipe. The art direction allows one. The sponge (about 60 x 75 px in a
  2752 px picture) is covered with a copy of the plain siding beside it. The gloves stay.
- **`trade-plumbing`, a patch:** the wrench's handle carried a small stamped mark that read as made-up lettering
  (about 50 x 30 px). It is blurred where it is. Nothing else is touched.
- **`trade-electrical`, a cut:** the yellow tester on the electrician's belt carried made-up lettering. The
  picture is cut above the belt (the top 77% is kept), which is why it is a wider strip than the others. The kept
  picture has no yellow object.
- **`van`, a cut:** to a 5:8 picture with the van's flat panel in its upper part and the rear wheel at the lower
  corner (the cab window and the far kerb are left out).
- **`demo-springs`, a patch:** a small warning tag on the edge of the door (fine lines, nothing that could be
  read; about 14 x 40 px in a 1200 px picture) is covered with a copy of the plain edge above it.
- If the owner would rather not use a retouched picture, the three patched ones (`trade-painting`,
  `trade-plumbing`, `demo-springs`) are the ones to make again.

### What was rejected, and why (T-170)

| Image | Why it was rejected |
|---|---|
| `van`, attempt 1 | it did not read as a van: a plain white box with no wheel and no window, on a street that was not American |
| `closing`, attempt 1 | the phone was held up in front of the face, hiding it, with its camera lenses towards us (it read as someone photographing the viewer, and as a likeness of a real phone) |
| `trade-plumbing`, attempt 1 | the top of the plumber's head was cut off by the frame |
| `demo-room`, attempt 1 | two cardboard boxes carried a delivery company's logo |

None of the fourteen showed a malformed hand or face, or a likeness to a recognisable person. The four rejected
files were never in the repo. Made-up lettering was found on two kept pictures when they were looked at at full
size (the tester and the wrench) and was removed from both, as above.

**What changed between the first and the second wording**, for the four made twice: the van was first asked for
as "the flat sliding side door of the van fills the frame" (which lost the van); the closing picture as "looking
down at a phone held loosely in one hand" with the camera seeing "the plain dark back of the phone"; the plumber
without the sentence that puts the whole head inside the frame; the room without "No boxes, no packaging, no
bags". The prompts below are the second wording.

### The prompts

Each is four parts in this order: the scene, the composition, the art direction, the "never" list. These are
printed from the script, as they were sent for the attempt that was kept.

#### `trade-painting`: Painting: a freshly painted house front

Frame: 16:9, 2K.

> The front of an ordinary two-storey American house that has just been repainted, seen from the front lawn: fresh pale off-white clapboard siding, crisp white trim, a covered wooden porch and a deep juniper green front door. An aluminium extension ladder leans against the wall beside the porch, and a folded canvas drop cloth and a plain metal paint can with no label sit on the porch boards.
>
> A wide 16:9 frame, photographed with a 35mm lens and a shallow depth of field. The subject is entirely in the right 40 percent of the frame, large and sharp, with its top inside the frame and clear space above it. The left 55 percent of the frame is calm, light and nearly empty: a soft, bright overcast sky above a low, out-of-focus green hedge. It is bright and even enough for dark text to be placed over it, with no objects, no people and no strong shadows in that part.
>
> A documentary-style photograph, as an editorial photographer would take it on a working day: unposed, observed, honest. Natural daylight only. An ordinary American home or residential street. Calm and warm. Colour: warm off-white and pale paper tones with deep juniper green; muted, nothing saturated. At most one small yellow object in the whole picture. There are no people in the picture, and no part of a person. Not a studio, no studio lighting, no stock-photo look, no lens flare, no dramatic colour grading.
>
> There is no text anywhere in the picture: no letters, no numbers, no words, no signs, no labels that can be read, no licence plate. No logos and no brand names on any vehicle, clothing, tool or device. Any phone or tablet is seen from behind or edge-on; its screen is not visible. No recognisable real person.

#### `trade-hvac`: HVAC: an outdoor unit beside a house

Frame: 16:9, 2K.

> A residential central air conditioner outdoor unit standing on a small concrete pad beside the pale off-white clapboard side wall of an American house, photographed from a low angle near the unit’s own height so that it is large in the frame. Two insulated lines run from it up the wall. The unit is a plain grey-beige metal cabinet with a louvred grille and a round fan guard on top; it has no badge, no nameplate, no sticker and no lettering of any kind. A strip of clipped green lawn is in front of it.
>
> A wide 16:9 frame, photographed with a 35mm lens and a shallow depth of field. The subject is entirely in the right 40 percent of the frame, large and sharp, with its top inside the frame and clear space above it. The left 55 percent of the frame is calm, light and nearly empty: the pale clapboard side wall of the house running away from the camera, out of focus, in soft even daylight. It is bright and even enough for dark text to be placed over it, with no objects, no people and no strong shadows in that part.
>
> A documentary-style photograph, as an editorial photographer would take it on a working day: unposed, observed, honest. Natural daylight only. An ordinary American home or residential street. Calm and warm. Colour: warm off-white and pale paper tones with deep juniper green; muted, nothing saturated. At most one small yellow object in the whole picture. There are no people in the picture, and no part of a person. Not a studio, no studio lighting, no stock-photo look, no lens flare, no dramatic colour grading.
>
> There is no text anywhere in the picture: no letters, no numbers, no words, no signs, no labels that can be read, no licence plate. No logos and no brand names on any vehicle, clothing, tool or device. Any phone or tablet is seen from behind or edge-on; its screen is not visible. No recognisable real person.

#### `trade-water-heaters`: Water heaters: a tank in a garage

Frame: 16:9, 2K.

> A tall white residential tank water heater standing in the corner of a tidy American garage, with two copper pipes and a metal vent rising from its top to the ceiling. The tank is plain white enamel with no label, no sticker, no warning tag and no markings of any kind. A plain concrete floor.
>
> A wide 16:9 frame, photographed with a 35mm lens and a shallow depth of field. The subject is entirely in the right 40 percent of the frame, large and sharp, with its top inside the frame and clear space above it. The left 55 percent of the frame is calm, light and nearly empty: a plain pale painted garage wall lit by daylight from the open garage door. It is bright and even enough for dark text to be placed over it, with no objects, no people and no strong shadows in that part.
>
> A documentary-style photograph, as an editorial photographer would take it on a working day: unposed, observed, honest. Natural daylight only. An ordinary American home or residential street. Calm and warm. Colour: warm off-white and pale paper tones with deep juniper green; muted, nothing saturated. At most one small yellow object in the whole picture. There are no people in the picture, and no part of a person. Not a studio, no studio lighting, no stock-photo look, no lens flare, no dramatic colour grading.
>
> There is no text anywhere in the picture: no letters, no numbers, no words, no signs, no labels that can be read, no licence plate. No logos and no brand names on any vehicle, clothing, tool or device. Any phone or tablet is seen from behind or edge-on; its screen is not visible. No recognisable real person.

#### `trade-plumbing`: Plumbing: a plumber at a kitchen sink

Frame: 16:9, 2K.

> A plumber in their forties in a plain dark juniper green work shirt stands at the sink of an ordinary American kitchen, bending slightly to tighten the base of the tap with an adjustable wrench held in one hand, the other hand steadying the tap. They are photographed from across the kitchen, so that their whole head, their shoulders and the sink are well inside the frame, with clear space above the head, and they appear fairly small in the picture. A plain open canvas tool bag sits on the counter. The wrench, the tap and the bag carry no brand and no lettering.
>
> A wide 16:9 frame, photographed at eye level with a 35mm lens and a shallow depth of field. The subject stands entirely in the right third of the frame, seen from the knees or waist up, with their whole head inside the frame and clear space above it. The left 55 percent of the frame is calm, light and nearly empty: a pale kitchen wall and a window with soft daylight, out of focus. It is bright and even enough for dark text to be placed over it, with no objects, no people and no strong shadows in that part.
>
> A documentary-style photograph, as an editorial photographer would take it on a working day: unposed, observed, honest. Natural daylight only. An ordinary American home or residential street. Calm and warm. Colour: warm off-white and pale paper tones with deep juniper green; muted, nothing saturated. At most one small yellow object in the whole picture. The person is absorbed in what they are doing and is not looking at the camera. No posed smile. An ordinary working adult, not a model. Hands are natural and correct, with five fingers each. Not a studio, no studio lighting, no stock-photo look, no lens flare, no dramatic colour grading.
>
> There is no text anywhere in the picture: no letters, no numbers, no words, no signs, no labels that can be read, no licence plate. No logos and no brand names on any vehicle, clothing, tool or device. Any phone or tablet is seen from behind or edge-on; its screen is not visible. No recognisable real person.

#### `trade-electrical`: Electrical: an electrician at a panel

Frame: 16:9, 2K.

> An electrician in their thirties in a plain grey work shirt stands in a tidy American garage facing a grey metal electrical panel mounted on the wall, seen in profile from the side. They hold the panel’s plain grey metal door open with one hand; the open door is turned towards the camera, so the camera sees only the plain outside of the door and the inside of the panel is hidden behind it. A plain yellow voltage tester with no label is clipped to their belt. Nothing on the panel, the door or the wall carries a label, a sticker, a number or any lettering.
>
> A wide 16:9 frame, photographed at eye level with a 35mm lens and a shallow depth of field. The subject stands entirely in the right third of the frame, seen from the knees or waist up, with their whole head inside the frame and clear space above it. The left 55 percent of the frame is calm, light and nearly empty: a plain pale painted garage wall in soft even daylight. It is bright and even enough for dark text to be placed over it, with no objects, no people and no strong shadows in that part.
>
> A documentary-style photograph, as an editorial photographer would take it on a working day: unposed, observed, honest. Natural daylight only. An ordinary American home or residential street. Calm and warm. Colour: warm off-white and pale paper tones with deep juniper green; muted, nothing saturated. At most one small yellow object in the whole picture. The person is absorbed in what they are doing and is not looking at the camera. No posed smile. An ordinary working adult, not a model. Hands are natural and correct, with five fingers each. Not a studio, no studio lighting, no stock-photo look, no lens flare, no dramatic colour grading.
>
> There is no text anywhere in the picture: no letters, no numbers, no words, no signs, no labels that can be read, no licence plate. No logos and no brand names on any vehicle, clothing, tool or device. Any phone or tablet is seen from behind or edge-on; its screen is not visible. No recognisable real person.

#### `trade-garage-doors`: Garage doors: a door on a driveway

Frame: 16:9, 2K.

> A closed white sectional garage door with plain raised panels on the front of an ordinary American suburban house, seen from its clean concrete driveway. Crisp white trim around the opening, pale off-white clapboard siding, and one small plain exterior lamp beside the door. No car. No house number and nothing with lettering.
>
> A wide 16:9 frame, photographed with a 35mm lens and a shallow depth of field. The subject is entirely in the right 40 percent of the frame, large and sharp, with its top inside the frame and clear space above it. The left 55 percent of the frame is calm, light and nearly empty: the pale clapboard wall of the house and a soft, bright overcast sky, out of focus. It is bright and even enough for dark text to be placed over it, with no objects, no people and no strong shadows in that part.
>
> A documentary-style photograph, as an editorial photographer would take it on a working day: unposed, observed, honest. Natural daylight only. An ordinary American home or residential street. Calm and warm. Colour: warm off-white and pale paper tones with deep juniper green; muted, nothing saturated. At most one small yellow object in the whole picture. There are no people in the picture, and no part of a person. Not a studio, no studio lighting, no stock-photo look, no lens flare, no dramatic colour grading.
>
> There is no text anywhere in the picture: no letters, no numbers, no words, no signs, no labels that can be read, no licence plate. No logos and no brand names on any vehicle, clothing, tool or device. Any phone or tablet is seen from behind or edge-on; its screen is not visible. No recognisable real person.

#### `closing`: Home’s closing band: a homeowner on a sofa in the evening, with a phone

Frame: 16:9, 2K.

> A homeowner in their forties in a plain cream sweater sits back in the corner of a sofa in a quiet living room at dusk, relaxed, seen from the side in three-quarter profile with their head bowed a little, looking down at a phone that rests in one hand low over their lap, well below the chin. Nothing is in front of the face. The phone is small in the picture and is seen edge-on, as a thin dark shape; its screen faces away from the camera and is never seen, and it has no camera lenses facing us. A warm table lamp glows on a side table at the far right, and a window behind the sofa shows the deep blue of early evening.
>
> A wide 16:9 frame, photographed at eye level with a 35mm lens and a shallow depth of field. The subject is entirely in the right third of the frame, with their whole head inside the frame and clear space above it. The left 55 percent of the frame is calm, dim and nearly empty: a plain wall in deep, soft evening shadow. It is dark and even enough for light text to be placed over it, with no objects, no people, no lamp and no bright patch in that part.
>
> A documentary-style photograph, as an editorial photographer would take it on a working day: unposed, observed, honest. Evening: the last blue daylight of dusk in the window and one warm lamp in the room, nothing else. An ordinary American home. Calm and warm. Colour: warm off-white and pale paper tones with deep juniper green; muted, nothing saturated. At most one small yellow object in the whole picture. The person is absorbed in what they are doing and is not looking at the camera. No posed smile. An ordinary working adult, not a model. Hands are natural and correct, with five fingers each. Not a studio, no studio lighting, no stock-photo look, no lens flare, no dramatic colour grading.
>
> There is no text anywhere in the picture: no letters, no numbers, no words, no signs, no labels that can be read, no licence plate. No logos and no brand names on any vehicle, clothing, tool or device. Any phone or tablet is seen from behind or edge-on; its screen is not visible. No recognisable real person.

#### `van`: "Add it anywhere": the flat side of a plain white work van (our QR code is placed on it in code)

Frame: 2:3, 2K.

> A plain white panel van, the kind a tradesperson drives, parked at the kerb of a quiet American suburban street of single-family houses with front lawns. The frame shows the middle of the van’s side from its roof down to the road: the flat sliding side door fills the centre of the frame, the rear wheel with its black tyre is at the lower right corner, and the edge of the cab door with its dark side window is at the left edge. The sliding door is smooth, clean, plain white painted metal, evenly lit by soft overcast daylight, with nothing on it at all: no lettering, no logo, no stripe, no sticker, no sign and no window. Its handle is small, at one edge. A little pale sky is above the roof and the kerb is below the van.
>
> A vertical 2:3 frame, photographed with a 35mm lens from the pavement at door height, with everything in focus. The camera is square-on to the van and looks straight at its side, so the side of the van has no perspective.
>
> A documentary-style photograph, as an editorial photographer would take it on a working day: unposed, observed, honest. Natural daylight only. An ordinary American home or residential street. Calm and warm. Colour: warm off-white and pale paper tones with deep juniper green; muted, nothing saturated. At most one small yellow object in the whole picture. There are no people in the picture, and no part of a person. Not a studio, no studio lighting, no stock-photo look, no lens flare, no dramatic colour grading.
>
> There is no text anywhere in the picture: no letters, no numbers, no words, no signs, no labels that can be read, no licence plate. No logos and no brand names on any vehicle, clothing, tool or device. Any phone or tablet is seen from behind or edge-on; its screen is not visible. No recognisable real person.

#### `demo-springs`: Demo sample, Garage Door Spring Replacement: the springs above the door, from inside

Frame: 4:3, 1K.

> The view from inside a residential garage, looking up at the wall above a closed white sectional garage door. A steel torsion bar runs across the wall above the door with two dark coiled torsion springs on it, a centre bracket between them and a cable drum at each end; the door’s two horizontal tracks run back along the ceiling at each side. Bare pale painted drywall. Daylight from a side window. Nothing carries a label, a sticker, a warning tag or any lettering.
>
> A 4:3 frame, slightly wide, taken straight on from inside the garage, with everything in focus.
>
> Natural daylight only. An ordinary American home or residential street. Calm and warm. There are no people in the picture, and no part of a person. An ordinary photograph taken by a homeowner with a phone: plain, sharp, honest, not styled. Not a studio, no studio lighting, no stock-photo look, no lens flare, no dramatic colour grading.
>
> There is no text anywhere in the picture: no letters, no numbers, no words, no signs, no labels that can be read, no licence plate. No logos and no brand names on any vehicle, clothing, tool or device. Any phone or tablet is seen from behind or edge-on; its screen is not visible. No recognisable real person.

#### `demo-room`: Demo sample, Interior Painting: a room from the doorway

Frame: 4:3, 1K.

> An ordinary bedroom in an American home that is about to be repainted, seen from its doorway: plain pale beige walls with a few scuffs, a white ceiling, white baseboards, one window with daylight, a wooden floor, and a bed with a plain cover against the far wall. The room is otherwise nearly empty. No boxes, no packaging, no bags, no pictures, posters, books, clocks or screens, and nothing with lettering or a logo.
>
> A 4:3 frame, wide, taken from the doorway at eye level so that the whole room is in the picture from the floor to the ceiling, with everything in focus.
>
> Natural daylight only. An ordinary American home or residential street. Calm and warm. There are no people in the picture, and no part of a person. An ordinary photograph taken by a homeowner with a phone: plain, sharp, honest, not styled. Not a studio, no studio lighting, no stock-photo look, no lens flare, no dramatic colour grading.
>
> There is no text anywhere in the picture: no letters, no numbers, no words, no signs, no labels that can be read, no licence plate. No logos and no brand names on any vehicle, clothing, tool or device. Any phone or tablet is seen from behind or edge-on; its screen is not visible. No recognisable real person.

