import { gunzipSync } from 'node:zlib'
import * as pagefind from 'pagefind'

/**
 * The text Pagefind indexes for an HTML body, read from the fragment it writes.
 * The engine is the one the build runs, so a mark it would fuse to the name beside it shows up as it would in search.
 */
export async function indexedText(body: string): Promise<string> {
  const { index } = await pagefind.createIndex()
  try {
    await index!.addHTMLFile({ url: '/page/', content: `<html lang="en"><body data-pagefind-body>${body}</body></html>` })
    const { files } = await index!.getFiles()
    const fragment = files.find((file) => file.path.includes('fragment/'))
    // A fragment is gzip of `pagefind_dcd` and the page's JSON.
    const text = gunzipSync(Buffer.from(fragment!.content)).toString('utf8')
    return JSON.parse(text.slice(text.indexOf('{'))).content as string
  } finally { await pagefind.close() }
}
