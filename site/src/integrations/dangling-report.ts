import { existsSync, readFileSync, rmSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { AstroIntegration } from 'astro'

interface DanglingReference { port: string; text: string; why: string }

/**
 * Report unresolved API mentions at the end of a build, and fail on a
 * regression.
 *
 * The file is the contract, not a shared array: the markdown pipeline runs in
 * a Vite module runner with its own realm, so neither a module-level export
 * nor `globalThis` reaches this hook. Two earlier versions reported "no
 * dangling API references" from builds that had them.
 *
 * An absent file therefore means the linking pass did not run — a cached
 * build, or a broken plugin — and that is reported as unknown rather than as
 * success. A report that says "clean" without looking is worse than none.
 */
const here = dirname(fileURLToPath(import.meta.url))
const REPORT = join(here, '../../.astro/dangling-refs.json')

/**
 * `maxDangling` is a regression guard, not a quality target.
 *
 * 60 is the current measurement taken from a report that actually ran — the
 * previous 60 was set blind, against a reporting path that could not observe
 * anything. Most of the 66 are correct refusals: test-class names in an
 * examples table, Go doc tags, another language's standard library, and bare
 * names that genuinely name two things. Raise this only with a reason;
 * lowering it as real gaps close is the point.
 */
export function danglingReport(maxDangling = 60): AstroIntegration {
  return {
    name: 'libtmux:dangling-refs',
    hooks: {
      // Clear before the run so a stale file cannot be mistaken for this
      // build's result.
      'astro:config:setup': ({ command, config }) => {
        try {
          rmSync(REPORT, { force: true })
        } catch {
          /* nothing to clear */
        }
        if (command !== 'build') return
        // Astro's content layer caches rendered markdown keyed on the source
        // file, not on the rehype plugins that transformed it. Editing the
        // linker therefore left every cached page holding the *old* links —
        // a build after the cross-language fix still shipped
        // `Stream.filter()` pointing at Python's docs, and reported success.
        //
        // The report needs the full render anyway: a partially cached build
        // only records entries for the pages it re-rendered, so the ceiling
        // check would silently undercount. Both problems have one answer.
        // The whole render is ten seconds; the incremental win that matters
        // is upstream, in extraction.
        try {
          rmSync(join(fileURLToPath(config.cacheDir), 'data-store.json'), { force: true })
        } catch {
          /* a cold cache is the desired state anyway */
        }
      },
      'astro:build:done': ({ logger }) => {
        if (process.env.LIBTMUX_DOCS_PORT) return
        if (!existsSync(REPORT)) {
          logger.info('API link check did not run (content served from cache)')
          return
        }
        const dangling = readFileSync(REPORT, 'utf8')
          .split('\n')
          .filter(Boolean)
          .map((line) => JSON.parse(line) as DanglingReference)
        if (!dangling.length) {
          logger.info('API links: every mention resolved')
          return
        }
        const byPort = new Map<string, number>()
        for (const d of dangling) byPort.set(d.port, (byPort.get(d.port) ?? 0) + 1)
        logger.warn(
          `${dangling.length} dangling API references (` +
            [...byPort].sort((a, b) => b[1] - a[1]).map(([p, n]) => `${p}:${n}`).join(' ') +
            ')',
        )
        for (const d of dangling.slice(0, 12)) logger.warn(`  ${d.port}  ${d.text}  (${d.why})`)
        if (dangling.length > maxDangling) {
          throw new Error(
            `libtmux:dangling-refs: ${dangling.length} unresolved mentions exceeds the ceiling ` +
              `of ${maxDangling}. Raise it deliberately, never to make a build pass.`,
          )
        }
      },
    },
  }
}
