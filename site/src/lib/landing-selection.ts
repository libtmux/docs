/** The product a port's landing page shows, carried in the address so a link can share it. */

const PARAMETER = 'product'

/** The product the address names, when the page offers it. */
export function productFromSearch(search: string, available: readonly string[]): string | undefined {
  const product = new URLSearchParams(search).get(PARAMETER)
  return product !== null && available.includes(product) ? product : undefined
}

/**
 * The query string that names `product`. The page's first product is the
 * default, so choosing it leaves the address as it was.
 */
export function searchWithProduct(search: string, product: string, initial: string): string {
  const params = new URLSearchParams(search)
  if (product === initial) params.delete(PARAMETER)
  else params.set(PARAMETER, product)
  const next = params.toString()
  return next ? `?${next}` : ''
}
