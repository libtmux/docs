import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import { retryRequest } from '../scripts/retry-request.mjs'

const aborted = () => new Error('apiRequestContext.get: aborted\nCall log:\n  - GET http://127.0.0.1:42633/en/docs.json')

describe('request retry for the dev-server browser checks', () => {
  it('runs the request again after the server drops the connection', async () => {
    const request = vi.fn().mockRejectedValueOnce(aborted()).mockResolvedValueOnce('manifest')
    await expect(retryRequest(request)).resolves.toBe('manifest')
    expect(request).toHaveBeenCalledTimes(2)
  })

  it('retries a socket hang up the same way', async () => {
    const request = vi.fn().mockRejectedValueOnce(new Error('apiRequestContext.get: socket hang up')).mockResolvedValueOnce(1)
    await expect(retryRequest(request)).resolves.toBe(1)
  })

  it('throws an unrelated error at once', async () => {
    const request = vi.fn().mockRejectedValue(new Error('apiRequestContext.get: Request timed out'))
    await expect(retryRequest(request)).rejects.toThrow('Request timed out')
    expect(request).toHaveBeenCalledTimes(1)
  })

  it('stops after one retry', async () => {
    const request = vi.fn().mockRejectedValue(aborted())
    await expect(retryRequest(request)).rejects.toThrow('apiRequestContext.get: aborted')
    expect(request).toHaveBeenCalledTimes(2)
  })

  it('covers every request check-dev.mjs makes', () => {
    const source = readFileSync(new URL('../scripts/check-dev.mjs', import.meta.url), 'utf8')
    expect(source.split('\n').filter((line) => line.includes('.request.get(') && !line.includes('retryRequest('))).toEqual([])
  })
})
