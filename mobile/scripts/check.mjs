import fs from 'node:fs';
import assert from 'node:assert/strict';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const read=name=>fs.readFileSync(path.join(root,name),'utf8');
const config=JSON.parse(read('capacitor.config.json'));
assert.equal(config.appId,'br.app.tamoon');assert.equal(config.webDir,'www');assert.equal(config.server.url,undefined);
const html=read('www/index.html');assert(html.includes('native.js'));assert(!html.includes('cloudflareinsights'));assert(!html.includes('pwa-bootstrap'));assert(html.includes("script-src 'self'"));
const project=read('ios/App/App.xcodeproj/project.pbxproj');
const release=JSON.parse(fs.readFileSync(path.join(root,'../version.json'),'utf8'));
for(const item of ['TamoonNativePlugin.swift in Sources','PrivacyInfo.xcprivacy in Resources',`CURRENT_PROJECT_VERSION = ${release.build}`,`MARKETING_VERSION = 1.0.${release.build}`,'DEVELOPMENT_TEAM = 4T892ZTN46','CODE_SIGN_ENTITLEMENTS = App/App.entitlements'])assert(project.includes(item),item);
assert(read('ios/App/App/Base.lproj/Main.storyboard').includes('TamoonViewController'));
assert(read('ios/App/App/App.entitlements').includes('com.apple.developer.applesignin'));
assert(read('ios/App/App/Info.plist').includes('br.app.tamoon'));
assert(!fs.existsSync(path.join(root,'www/backend')));assert(!fs.existsSync(path.join(root,'www/supabase')));
assert.equal(JSON.parse(read('package.json')).version,`1.0.${release.build}`);
const marketHtml=read('www/marketplace/index.html');
assert(marketHtml.includes('/native.js'));
assert(marketHtml.includes("script-src 'self'"));
assert(read('www/marketplace/pilot-entry.js').includes('storage:window.TamoonNative.storage'));
for(const page of ['index.html','marketplace/index.html']){
 for(const match of read('www/'+page).matchAll(/(?:src|href)="([^"?#]+\.(?:js|css))(?:[?#][^"]*)?"/g)){
  assert(!/^https?:/.test(match[1]),`Remote executable/style in ${page}: ${match[1]}`);
  const target=match[1].startsWith('/')?path.join(root,'www',match[1]):path.resolve(root,'www',path.dirname(page),match[1]);
  assert(fs.existsSync(target),`Missing bundled asset: ${target}`);
 }
}
for(const asset of JSON.parse(read('www/marketplace/pilot-assets.json')))assert(fs.existsSync(path.join(root,'www/marketplace',asset)));
const secretPatterns=[/-----BEGIN (?:EC |RSA )?PRIVATE KEY-----/,/sb_secret_[A-Za-z0-9]/,/APPLE_PRIVATE_KEY\s*[:=]/];
for(const filename of ['www/native.js','www/supabase-config.js'])for(const pattern of secretPatterns)assert(!pattern.test(read(filename)),`${filename} contains a server secret`);
console.log('Estrutura iOS, versão, recursos, política de conteúdo e separação de secrets: OK.');
console.log('Esta checagem não substitui compilação Swift, assinatura ou teste em iPhone.');

for(const name of ['auth-config.js','auth-access.js','auth-access.css'])assert(fs.existsSync(path.join(root,'www',name)));
assert(read('www/auth-config.js').includes('appleEnabled: true'));
assert(read('www/auth-config.js').includes('linkingEnabled: true'));
