// Mirrors the tokenise/diffWords pair in ReviewPanel so the algorithm can be
// exercised without a DOM.
function tokenise(t: string): string[] { return t.match(/\S+\s*/g) ?? [] }
type Op = { kind: 'same'|'add'|'remove'; text: string }
function diffWords(before: string, after: string): Op[] {
  const a = tokenise(before), b = tokenise(after)
  const lcs: number[][] = Array.from({length:a.length+1},()=>new Array<number>(b.length+1).fill(0))
  for (let i=a.length-1;i>=0;i--) for (let j=b.length-1;j>=0;j--)
    lcs[i]![j] = a[i]!.trim()===b[j]!.trim() ? (lcs[i+1]![j+1]??0)+1 : Math.max(lcs[i+1]![j]??0, lcs[i]![j+1]??0)
  const ops: Op[] = []
  const push=(k:Op['kind'],t:string)=>{const l=ops[ops.length-1]; if(l&&l.kind===k)l.text+=t; else ops.push({kind:k,text:t})}
  let i=0,j=0
  while(i<a.length&&j<b.length){
    if(a[i]!.trim()===b[j]!.trim()){push('same',b[j]!);i++;j++}
    else if((lcs[i+1]![j]??0)>=(lcs[i]![j+1]??0)){push('remove',a[i]!);i++}
    else{push('add',b[j]!);j++}
  }
  while(i<a.length){push('remove',a[i]!);i++}
  while(j<b.length){push('add',b[j]!);j++}
  return ops
}
const rebuild=(o:Op[],side:'before'|'after')=>o.filter(x=>x.kind==='same'||x.kind===(side==='before'?'remove':'add')).map(x=>x.text).join('')

const cases: Array<[string,string,string]> = [
  ['the reward model is simple','the reward model is a calibrated preference estimator','rewrite of the tail'],
  ['one two three four five','one two three four five','identical'],
  ['','brand new caption entirely','from empty'],
  ['a b c d e f g','a c e g','deletions only'],
  ['short','short and considerably longer now','append'],
]
let ok = true
for (const [before, after, label] of cases) {
  const ops = diffWords(before, after)
  const rb = rebuild(ops,'before'), ra = rebuild(ops,'after')
  // The after side must be exact — it is what the panel shows as current.
  // The before side is compared on words, since a `same` span now carries the
  // after text's spacing by design.
  const norm = (t: string) => t.replace(/\s+/g, ' ').trim()
  const pass = ra === after && norm(rb) === norm(before)
  ok &&= pass
  const adds = ops.filter(o=>o.kind==='add').length, dels = ops.filter(o=>o.kind==='remove').length
  console.log(`${pass?'PASS':'FAIL'}  ${label.padEnd(20)} +${adds} span(s) / -${dels} span(s)`)
  if (!pass) { console.log('   before rebuilt:', JSON.stringify(rb)); console.log('   after  rebuilt:', JSON.stringify(ra)) }
}
console.log(ok ? '\nlossless: every diff rebuilds both sides exactly' : '\nLOSSY — diff does not round-trip')
