const ROOT = 'http://localhost:8080'
const seen = new Map()
const refs = new Map()
const queue = ['/']
const SKIP = /\.(woff2?|ttf|eot|png|jpe?g|gif|svg|ico|css|js|json|xml|inv|txt|map|pf_meta|pf_index|pf_fragment|wasm)$/i

function note(t, f) { (refs.get(t) ?? refs.set(t, new Set()).get(t)).add(f) }

while (queue.length) {
  const path = queue.shift()
  if (seen.has(path)) continue
  let res, body = ''
  try {
    res = await fetch(ROOT + path)
    seen.set(path, res.status)
    if ((res.headers.get('content-type') || '').includes('text/html')) body = await res.text()
  } catch { seen.set(path, 'ERR'); continue }
  if (!body) continue
  for (const m of body.matchAll(/(?:href|src)="([^"]+)"/g)) {
    const raw = m[1]
    if (/^(https?:|mailto:|#|data:|javascript:)/i.test(raw)) continue
    let u
    try { u = new URL(raw, ROOT + path) } catch { continue }
    if (u.origin !== ROOT) continue
    const p = u.pathname
    if (SKIP.test(p)) continue
    note(p, path)
    if (!seen.has(p) && !queue.includes(p)) queue.push(p)
  }
}
const bad = [...seen.entries()].filter(([, s]) => s !== 200)
console.log(`reachable HTML URLs: ${seen.size}`)
console.log(`broken: ${bad.length}\n`)
for (const [u, s] of bad.sort()) {
  console.log(`  ${s}  ${u}`)
  console.log(`        from: ${[...(refs.get(u) || [])].slice(0, 2).join(', ')}`)
}
