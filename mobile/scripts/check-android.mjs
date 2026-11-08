import assert from 'node:assert/strict';
import fs from 'node:fs';
const root=new URL('../',import.meta.url),read=name=>fs.readFileSync(new URL(name,root),'utf8');
const config=JSON.parse(read('capacitor.config.json')),release=JSON.parse(read('android-release.json'));
assert.equal(config.appId,'br.app.tamoon');assert.equal(config.server.url,undefined);assert.equal(config.android.allowMixedContent,false);
assert(release.versionCode>168);assert.equal(release.versionName,JSON.parse(read('package.json')).version);
const manifest=read('android/app/src/main/AndroidManifest.xml');
assert(manifest.includes('android:allowBackup="false"'));assert(manifest.includes('android:usesCleartextTraffic="false"'));
assert(manifest.includes('android:scheme="br.app.tamoon"'));assert(manifest.includes('tamoon-alerts'));
assert(!manifest.includes('androidbrowserhelper'));assert(!read('android/app/build.gradle').includes('androidbrowserhelper'));
for(const file of ['www/index.html','www/marketplace/index.html']){
 const page=read(file);assert(page.includes('native.js'));assert(page.includes("script-src 'self'"));assert(!page.includes('pwa-bootstrap'));
 for(const m of page.matchAll(/(?:src|href)="([^"?#]+\.(?:js|css))(?:[?#][^"]*)?"/g))assert(!/^https?:/.test(m[1]));
}
assert(read('android/app/src/main/java/br/app/tamoon/MainActivity.java').includes('registerPlugin(TamoonNativePlugin.class)'));
assert(read('android/app/src/main/java/br/app/tamoon/TamoonNativePlugin.java').includes('AndroidKeyStore'));
assert(!read('www/native.js').includes('BEGIN PRIVATE KEY'));
const firebasePath=new URL('android/app/google-services.json',root);
if(fs.existsSync(firebasePath)){
 const firebase=JSON.parse(fs.readFileSync(firebasePath,'utf8'));
 assert(firebase.client.some(client=>client.client_info.android_client_info.package_name==='br.app.tamoon'));
 console.log('Configuração Firebase presente para br.app.tamoon.');
}else console.log('Pendente: configuração Firebase de produção (google-services.json).');
console.log('Estrutura Android, pacote local, identidade e separação de credenciais: OK. Não valida recebimento físico.');
