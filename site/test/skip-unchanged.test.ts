import { describe, expect, it } from 'vitest'
import { unchanged } from '../../scripts/skip-unchanged.mjs'

const md5 = 'd41d8cd98f00b204e9800998ecf8427e'
const file = { path: 'rs/latest/index.html', size: 10, md5 }
const object = { Key: 'en/rs/latest/index.html', ETag: `"${md5}"`, Size: 10, LastModified: '2026-09-27T18:00:00Z' }
const since = '2026-09-27'

describe('skip-unchanged', () => {
  it('skips a file the bucket holds byte for byte', () => {
    expect(unchanged([file], [object], 'en/', since)).toEqual([file.path])
  })

  it('uploads anything it cannot prove unchanged', () => {
    const cases = {
      'no object': [],
      'another size': [{ ...object, Size: 11 }],
      'other content': [{ ...object, ETag: '"0cc175b9c0f1b6a831c399e269772661"' }],
      'a multipart ETag': [{ ...object, ETag: `"${md5}-2"` }],
      'another locale': [{ ...object, Key: 'ja/rs/latest/index.html' }],
      'written under an older header policy': [{ ...object, LastModified: '2026-09-26T23:59:59Z' }],
    }
    for (const [name, objects] of Object.entries(cases)) {
      expect(unchanged([file], objects, 'en/', since), name).toEqual([])
    }
  })
})
