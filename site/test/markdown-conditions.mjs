import { registerHooks } from 'node:module'

const parser = /^(?:mdast-util-from-markdown|micromark(?:-[^/]+)?)(?:\/.*)?$/

// Production parser entries omit per-token development assertions.
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (!parser.test(specifier) || !context.conditions.includes('development')) return nextResolve(specifier, context)
    return nextResolve(specifier, {
      ...context,
      conditions: context.conditions.filter((condition) => condition !== 'development'),
    })
  },
})
