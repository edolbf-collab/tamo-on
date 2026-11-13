import {chromium,webkit} from 'playwright';
import assert from 'node:assert/strict';
import {mkdir,readFile} from 'node:fs/promises';
import {typographyFixture,lineSelectors,read} from './mobile-typography-fixture.mjs';
const engine=process.env.TAMOON_TEST_BROWSER||'chromium';
const browser=await ({chromium,webkit}[engine]).launch();
await mkdir('/tmp/mobile-typography',{recursive:true});
try {
 for(const mode of ['community','market']){
  const page=await browser.newPage({viewport:{width:1280,height:900},locale:'pt-BR'});
  await page.route('**/*',route=>route.abort()); // Fixture never calls a real service.
  await page.setContent(await typographyFixture(mode,false));
  await page.locator('.ops-nav button').first().waitFor();
  if(mode==='market')await page.locator('.metrics-cards strong').first().waitFor();
  const bounds=()=>page.locator(lineSelectors).evaluateAll(els=>els.map(el=>({text:el.textContent,rect:el.getBoundingClientRect().toJSON(),font:getComputedStyle(el).fontSize,whiteSpace:getComputedStyle(el).whiteSpace})));
  const desktop=await bounds();
  await page.addStyleTag({content:await read('marketplace/mobile-layout.css')});
  assert.deepEqual(await bounds(),desktop,'Desktop presentation is unchanged');
  for(const width of [320,360,375,390,430,600,768,844]){
   await page.setViewportSize({width,height:900});
   const failures=await page.locator(lineSelectors).evaluateAll(els=>els.flatMap(el=>{
    const r=el.getBoundingClientRect(),s=getComputedStyle(el),range=document.createRange();range.selectNodeContents(el);
    const rects=[...range.getClientRects()].filter(r=>r.width>0&&r.height>0);
    const lines=new Set(rects.map(r=>Math.round(r.top)));
    const problems=[];
    if(lines.size>1)problems.push('wrapped');
    if(el.scrollWidth>el.clientWidth+2)problems.push('text does not fit');
    if(r.left< -1||r.right>innerWidth+1)problems.push('outside viewport');
    if(s.textOverflow==='ellipsis')problems.push('ellipsis');
    return problems.length?[{text:el.textContent,problems,width:r.width,scroll:el.scrollWidth,client:el.clientWidth}]:[];
   }));
   assert.deepEqual(failures,[],`${engine} ${mode} ${width}: whole labels and amounts`);
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),`${mode} ${width}: no page overflow`);
   // Preserve explanatory text rather than imposing nowrap on the whole app.
   assert.notEqual(await page.locator('.qa-prose').evaluate(el=>getComputedStyle(el).whiteSpace),'nowrap');
   if(width===390)await page.screenshot({path:`/tmp/mobile-typography/${engine}-${mode}-390.png`,fullPage:true});
   console.log(`PASS ${engine} ${mode} ${width}px: labels, large amounts, bounds`);
  }
  // Real navigation handler must keep working after buttons reflow.
  await page.getByRole('button',{name:mode==='market'?'Mensalidades':'Participações',exact:true}).click();
  assert.equal(await page.locator('.ops-nav [aria-current=page]').innerText(),mode==='market'?'Mensalidades':'Participações');
  await page.close();
 }
 // Ensure the native build ships the exact shared correction, not only the web page.
 assert.equal(await readFile(new URL('../www/marketplace/mobile-layout.css',import.meta.url),'utf8'),await read('marketplace/mobile-layout.css'));
 for(const file of ['index.html','marketplace/index.html'])assert.match(await readFile(new URL('../www/'+file,import.meta.url),'utf8'),/mobile-layout\.css\?v=mobile1/);
}finally{await browser.close();}
