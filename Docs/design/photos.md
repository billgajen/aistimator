# Photographs made for the site

Every photograph on the site that we did not take is listed here: what it shows, how it was made, the exact
prompt, and what was thrown away. `Docs/design/system.md` (Imagery) sets the rules; this file is the record.

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
