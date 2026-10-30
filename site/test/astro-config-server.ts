/**
 * Stand-in for Astro's `astro:config/server` module, which only exists inside
 * an Astro build. Its `root` is the Astro project directory, `site/`.
 */
export const root = new URL('../', import.meta.url)
