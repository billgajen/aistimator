/**
 * T-170: the photo "Use a sample photo" adds on /demo, for each demo service
 * that asks for photos (lib/demo/demo-services.ts), by the service's name.
 * A service that is not listed here has no sample yet, and the button is
 * not shown for it.
 *
 * Each follows the service's own photo instructions (its first guided
 * angle, the one the demo keeps):
 *   Water Heater Replacement        the tank's rating label: the label drawn for T-153
 *   Garage Door Spring Replacement  the springs above the door, from inside
 *   Interior Painting               the whole room, from the doorway
 * The last two are scene photographs made with an image model, with no
 * people in them (Docs/design/photos.md). They go through the same checks
 * and the same upload as a customer's own photo.
 *
 * Plain data, no imports from the packs: the demo page's client code reads it.
 */
import { DEMO_SAMPLE_PHOTO_PATH } from '@qolumns/shared'

export const DEMO_SAMPLE_PHOTOS: Readonly<Record<string, string>> = {
  'Water Heater Replacement': DEMO_SAMPLE_PHOTO_PATH,
  'Garage Door Spring Replacement': '/demo/sample-garage-door-springs.webp',
  'Interior Painting': '/demo/sample-room-to-paint.webp',
}
