import { expect } from 'vitest'

/**
 * Stabilise Tailwind's version banner in snapshots so they survive patch bumps.
 *
 * Ported from ~/work/typescript/tony.sh's tailwind-plugin package along with
 * the plugin and its tests. The serializer was left behind by that port, which
 * is why `compatibility-side-effects.test.ts` has had eight snapshots failing
 * on nothing but a `tailwindcss v4.3.3` banner against a recorded `vx.y.z`.
 *
 * This absorbs the banner and nothing else. Selector shape and byte size are
 * version-coupled too — 4.3.3 showed that by flattening CSS nesting
 * (tailwindlabs/tailwindcss#20124) — so a compiler change that restructures
 * output still requires regenerating these snapshots, which is the point.
 * Only `compileWithPlugin`'s real output stays untouched.
 *
 * The upstream setup also imports a custom-matcher module. Nothing here uses
 * one: these tests reach for `toBe`, `toContain`, `toMatch` and
 * `toMatchSnapshot` only.
 */
expect.addSnapshotSerializer({
  test: (val) => typeof val === 'string' && /tailwindcss v\d/.test(val),
  serialize: (val, config, indentation, depth, refs, printer) =>
    printer(val.replace(/(tailwindcss v)[\d.]+/g, '$1x.y.z'), config, indentation, depth, refs),
})
