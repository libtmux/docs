#!/usr/bin/env node
// Write the external-link marker into pages that no Astro build wrote, such as native reference trees.
// Usage: node scripts/mark-external-links.mjs DIRECTORY [SITE_ORIGIN]
import { markExternalLinksIn } from '../site/src/integrations/external-links.ts'

const [directory, site] = process.argv.slice(2)
if (!directory) throw new Error('Usage: mark-external-links.mjs DIRECTORY [SITE_ORIGIN]')
console.log(`External links: ${markExternalLinksIn(directory, site)} pages`)
