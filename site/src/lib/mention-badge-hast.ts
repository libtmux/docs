import { fromHtml } from 'hast-util-from-html'
import { mentionBadgeHtml, type MentionBadge } from './mention-badge.ts'

/** The badge as a hast element, for the Markdown pipeline. It reads the same description the page and the browser do. */
export const mentionBadgeHast = (badge: MentionBadge) => fromHtml(mentionBadgeHtml(badge), { fragment: true }).children[0] as {
  type: 'element'; tagName: string; properties: Record<string, unknown>; children: unknown[]
}
