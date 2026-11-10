/**
 * T-154: "Who is behind this" on the home page. Fill these in to show the
 * section; while the note or the name is empty, nothing renders. The support
 * email comes from SUPPORT_EMAIL in packages/shared/src/brand.ts.
 */
import { SUPPORT_EMAIL } from '@estimator/shared'

export interface FounderContent {
  name: string
  role: string
  /** Two or three short sentences, first person */
  note: string
  /** A file in apps/web/public, e.g. "/founder.jpg"; optional */
  photo: string
  supportEmail: string
}

export const FOUNDER: FounderContent = {
  name: '',
  role: '',
  note: '',
  photo: '',
  supportEmail: SUPPORT_EMAIL,
}

/** The section shows only once there is a name and a note to show */
export function founderReady(f: FounderContent = FOUNDER): boolean {
  return f.name.trim().length > 0 && f.note.trim().length > 0
}
