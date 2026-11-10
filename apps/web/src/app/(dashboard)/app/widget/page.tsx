import { redirect } from 'next/navigation'

/** T-149: the Widget page became Share. Old bookmarks and links land there. */
export default function WidgetPage() {
  redirect('/app/share')
}
