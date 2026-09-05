import { readdirSync, statSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
const ROOT='/home/d/work/libtmux/docs/_site'
const pages=[]
;(function w(d){for(const e of readdirSync(d)){const p=join(d,e)
  if(statSync(p).isDirectory()){if(!/^(_static|_sources|_images|pagefind|\.build-logs)$/.test(e))w(p)}
  else if(e==='index.html')pages.push(p)}})(ROOT)
function content(h){
  const m=h.match(/<article[^>]*role="main"[^>]*>([\s\S]*?)<\/article>/)||h.match(/<main[^>]*>([\s\S]*?)<\/main>/)
  let b=m?m[1]:h
  b=b.replace(/<(script|style|nav|aside|footer|header)[^>]*>[\s\S]*?<\/\1>/g,'')
  return b.replace(/<[^>]+>/g,' ').replace(/&[a-z]+;|&#\d+;/g,' ').replace(/\s+/g,' ').trim()
}
const rows=[]; let redirects=0
for(const f of pages){
  const url='/'+relative(ROOT,f).replace(/index\.html$/,'')
  const html=readFileSync(f,'utf8')
  if(/You should have been redirected/.test(html)){redirects++;continue}
  const text=content(html); const flags=[]
  if(text.length<40)flags.push('EMPTY')
  else if(text.length<250)flags.push('THIN')
  // real rendered admonitions only, not identifiers containing "Error"
  if(/class="admonition warning"|class="admonition error"/.test(html))flags.push('ADMONITION')
  if(/Found multiple matches for file/.test(html))flags.push('breathe-ambiguous')
  if(/Unable to resolve|Cannot find file|not found in doxygen/.test(html))flags.push('breathe-unresolved')
  if(/\bTODO\b|\bFIXME\b|PLACEHOLDER/.test(text))flags.push('placeholder')
  if(flags.length)rows.push({url,len:text.length,flags})
}
rows.sort((a,b)=>a.len-b.len)
console.log(`pages ${pages.length}  redirects ${redirects}  flagged ${rows.length}\n`)
const by={};for(const r of rows)for(const f of r.flags)by[f]=(by[f]||0)+1
for(const[k,v]of Object.entries(by).sort((a,b)=>b[1]-a[1]))console.log(`  ${String(v).padStart(4)}  ${k}`)
console.log('\n-- non-THIN-only findings --')
for(const r of rows.filter(r=>r.flags.some(f=>f!=='THIN')))console.log(`  ${String(r.len).padStart(6)}  ${r.flags.join(',').padEnd(28)} ${r.url}`)
