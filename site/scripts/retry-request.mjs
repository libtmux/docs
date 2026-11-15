// Vite can drop a connection while it reloads after its initial dependency
// optimization. Playwright reports the cut response as one of these errors.
const DROPPED = /apiRequestContext\.\w+: (aborted|socket hang up)/

/** Run an `APIRequestContext` call, and run it once more when the dev server dropped the connection. */
export async function retryRequest(request) {
  try {
    return await request()
  } catch (error) {
    if (!DROPPED.test(String(error))) throw error
    return await request()
  }
}
