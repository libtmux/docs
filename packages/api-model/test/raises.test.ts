import { describe, expect, it } from 'vitest'
import { parsePythonDoc } from '../src/doc/python.ts'

/**
 * `Raises` sections, which this corpus writes with Sphinx roles.
 *
 * numpydoc puts the exception on its own line with prose indented beneath, and
 * the field-list parser reads exactly that. A role is `name : type` shaped, so
 * it read `:exc:` as the exception name and threw the real one away: 149
 * entries in the Python reference rendered as the literal text `:exc`.
 */
const doc = (body: string) => parsePythonDoc(body)

describe('a Raises section written with roles', () => {
  it('names the exception, not the role', () => {
    const parsed = doc(`Do a thing.

Raises
------
:exc:\`libtmux.exc.BadSessionName\`
    When the name is invalid.
`)
    expect(parsed.raises).toEqual([
      { type: 'libtmux.exc.BadSessionName', doc: 'When the name is invalid.' },
    ])
  })

  it('shortens a target Sphinx would shorten', () => {
    // `~` is Sphinx's "show the last component only".
    const parsed = doc(`Do a thing.

Raises
------
:exc:\`~libtmux.exc.BadSessionName\`
    When the name is invalid.
`)
    expect(parsed.raises[0].type).toBe('BadSessionName')
  })

  it('splits a comma-separated run wrapped over lines', () => {
    // Not a field list in any sense: several exceptions per line, no prose.
    const parsed = doc(`Set a hook.

Raises
------
:exc:\`exc.OptionError\`, :exc:\`exc.UnknownOption\`,
:exc:\`exc.InvalidOption\`, :exc:\`exc.AmbiguousOption\`
`)
    expect(parsed.raises.map((r) => r.type)).toEqual([
      'exc.OptionError',
      'exc.UnknownOption',
      'exc.InvalidOption',
      'exc.AmbiguousOption',
    ])
    expect(parsed.raises.every((r) => r.doc === undefined)).toBe(true)
  })

  it('still reads a plain numpydoc name', () => {
    const parsed = doc(`Do a thing.

Raises
------
ValueError
    When the value is wrong.
`)
    expect(parsed.raises).toEqual([{ type: 'ValueError', doc: 'When the value is wrong.' }])
  })

  it('gives prose under a shared line to every exception on it', () => {
    const parsed = doc(`Do a thing.

Raises
------
:exc:\`AError\`, :exc:\`BError\`
    Either way, it failed.
`)
    expect(parsed.raises).toEqual([
      { type: 'AError', doc: 'Either way, it failed.' },
      { type: 'BError', doc: 'Either way, it failed.' },
    ])
  })
})
