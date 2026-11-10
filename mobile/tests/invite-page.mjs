import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {chromium} from 'playwright';
const script=await readFile(new URL('../../deployment/site-invite/download.js',import.meta.url),'utf8');
const browser=await chromium.launch({...(process.env.TAMOON_TEST_EXECUTABLE?{executablePath:process.env.TAMOON_TEST_EXECUTABLE}:{})});
const fixture='<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><a class="header-cta">Abrir app</a><main><section class="download-page"><div class="store-links"><a href="https://play.google.com/store/apps/details?id=br.app.tamoon">Google Play</a><a href="https://apps.apple.com/br/app/t%C3%A2mo-on/id6830420681">App Store</a></div><p id="downloadStatus"></p><a class="inline-guide-link">Navegador</a><div class="download-qr">QR</div></section></main></body></html>';
try {
 for(const width of [320,390,768,1280]){
  const context=await browser.newContext({viewport:{width,height:844},permissions:['clipboard-read','clipboard-write'],userAgent:'Android'});
  await context.route('https://tamoon.app.br/**',r=>r.fulfill({contentType:'text/html',body:fixture}));
  const page=await context.newPage();await page.goto('https://tamoon.app.br/baixar?invite=a1b2c3d4');
  await page.addScriptTag({content:script});
  assert.equal(await page.locator('#inviteCode').inputValue(),'A1B2C3D4');
  assert.equal(await page.locator('.invite-open').getAttribute('href'),'br.app.tamoon://invite?code=A1B2C3D4');
  assert.equal(await page.locator('.inline-guide-link').getAttribute('href'),'https://app.tamoon.app.br/?invite=A1B2C3D4');
  assert.equal(await page.locator('.download-qr').isVisible(),false);
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  await page.getByRole('button',{name:'Copiar código'}).click();
  assert.equal(await page.evaluate(()=>navigator.clipboard.readText()),'A1B2C3D4');
  assert.equal(await page.locator('.invite-feedback').textContent(),'Código copiado.');
  await page.evaluate(()=>Object.defineProperty(navigator,'clipboard',{value:{writeText:()=>Promise.reject(Error('denied'))}}));
  await page.getByRole('button',{name:'Copiar código'}).click();
  assert.match(await page.locator('.invite-feedback').textContent(),/Toque e segure/);
  assert.equal(await page.locator('#inviteCode').evaluate(el=>el.selectionEnd-el.selectionStart),8);
  await context.close();console.log(`Invitation page ${width}px: code, native/web links, clipboard and fallback OK`);
 }
 for(const [query,ua,expected] of [['','Android','https://play.google.com/test'],['','iPhone','https://apps.apple.com/test'],['?escolher=1','Android',null],['','Desktop',null],['?invite=A1B2C3D4','Android',null],['?invite=bad','Android',null],['?invite=A1B2C3D4&invite=00000000','Android',null]]){
  const context=await browser.newContext({userAgent:ua});
  await context.route('**/*',r=>r.fulfill({contentType:'text/html',body:fixture}));
  const page=await context.newPage();await page.clock.install();await page.goto('https://tamoon.app.br/baixar'+query);
  await page.evaluate(()=>{window.TAMO_ON_SITE_CONFIG={androidUrl:'https://play.google.com/test',iosUrl:'https://apps.apple.com/test'};});
  await page.addScriptTag({content:script});
  await page.clock.fastForward(1200);
  if(expected)await page.waitForURL(expected);
  assert.equal(page.url(),expected||'https://tamoon.app.br/baixar'+query);
  if(query.includes('bad')||query.includes('&invite'))assert.match(await page.locator('#downloadStatus').textContent(),/inválido/);
  await context.close();
 }
 console.log('Generic QR redirects, explicit store selection, invalid and duplicate codes: OK');
} finally {await browser.close();}
