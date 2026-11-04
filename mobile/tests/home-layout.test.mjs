import {createRequire} from 'node:module';
import {readFile} from 'node:fs/promises';
import {createServer} from 'node:http';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import assert from 'node:assert/strict';

const {webkit}=createRequire(import.meta.url)('playwright');
const root=fileURLToPath(new URL('../www/',import.meta.url));
const fixture=await readFile(new URL('./home-fixture.js',import.meta.url),'utf8');
// Match CapacitorRouter: extensionless URLs return the Community index, not a directory index.
const server=createServer(async(req,res)=>{
  const pathname=decodeURIComponent(new URL(req.url,'http://localhost').pathname);
  const filename=path.extname(pathname)?pathname:'/index.html';
  try {
    const file=path.resolve(root,'.'+filename);
    assert(file.startsWith(root));
    const types={'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json','.svg':'image/svg+xml','.png':'image/png'};
    res.setHeader('Content-Type',types[path.extname(file)]||'application/octet-stream');
    res.end(await readFile(file));
  } catch {res.writeHead(404);res.end();}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const origin=`http://127.0.0.1:${server.address().port}`;
const browser=await webkit.launch();
try {
  for(const [width,height] of [[320,568],[375,667],[390,844],[430,932],[844,390],[768,1024],[1280,800]]){
    const context=await browser.newContext({viewport:{width,height}});
    await context.route('**/*',route=>route.request().url().startsWith(origin)?route.continue():route.abort());
    const page=await context.newPage();
    await page.goto(origin);
    await page.waitForSelector('#googleLoginButton');
    await page.evaluate(`async()=>{${fixture}}`);
    const initial=await page.evaluate(()=>{
      const main=document.querySelector('#mainContent'),nav=document.querySelector('.bottom-nav'),header=document.querySelector('.topbar');
      return {width:innerWidth,height:innerHeight,bodyWidth:document.body.scrollWidth,shell:document.querySelector('#app').getBoundingClientRect().toJSON(),main:main.getBoundingClientRect().toJSON(),nav:nav.getBoundingClientRect().toJSON(),header:header.getBoundingClientRect().toJSON(),scrollHeight:main.scrollHeight,clientHeight:main.clientHeight};
    });
    assert(initial.bodyWidth<=width+1,'No horizontal overflow');
    assert(initial.shell.bottom<=height+1,'Home fits viewport');
    assert(initial.nav.bottom<=height+1,'Navigation stays visible');
    assert(initial.main.bottom<=initial.nav.top+1,'Content does not run under navigation');
    assert(initial.main.top>=initial.header.bottom-1,'Content does not run under header');
    for(const button of await page.locator('.home-dashboard button').all()){
      await button.scrollIntoViewIfNeeded();
      assert(await button.evaluate(el=>{const r=el.getBoundingClientRect(),m=document.querySelector('#mainContent').getBoundingClientRect();return r.top>=m.top-1&&r.bottom<=m.bottom+1&&el.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2));}),'Every home button can be reached');
    }
    // Exercise the production click handler and the packaged native destination.
    await page.evaluate(()=>{window.TamoonNative.isIOS=true;});
    await page.locator('[data-action="playing-spaces"]').click();
    await page.waitForURL('**/marketplace/index.html?page=discover');
    assert.equal(await page.locator('#pilotGate').count(),1,'Marketplace document loads');
    assert.equal(await page.locator('.home-dashboard').count(),0,'Must not reload Community at the Marketplace path');
    await page.locator('#pilotGate a').click();
    await page.waitForURL(origin+'/');
    await page.waitForSelector('#googleLoginButton');
    console.log(`${width}x${height}: home bounds, all controls, Marketplace entry and return OK`);
    await context.close();
  }
} finally {await browser.close();await new Promise(resolve=>server.close(resolve));}
