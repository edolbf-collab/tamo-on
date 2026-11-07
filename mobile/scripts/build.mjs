import {cp,readFile,writeFile,mkdir,rm} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {build} from 'esbuild';
const mobile=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const root=path.dirname(mobile),target=path.join(mobile,'www');
await rm(target,{recursive:true,force:true});await mkdir(target,{recursive:true});
// Lista explícita: SQL, código servidor, credenciais e arquivos administrativos nunca vão ao IPA.
const files=['index.html','auth-config.js','auth-access.js','auth-access.css','app.js','push-client.js','account-deletion.js','community-safety.js','styles.css','supabase-config.js','group-avatars-data.js','marketplace-access.js','brand','assets','icons','apple-touch-icon.png','tamo-on-icon-192.png','legal','version.json'];
for(const file of files)await cp(path.join(root,file),path.join(target,file),{recursive:true});
await build({entryPoints:[path.join(mobile,'src/native.js')],bundle:true,format:'iife',target:['safari15'],outfile:path.join(target,'native.js'),minify:true,legalComments:'eof'});
let html=await readFile(path.join(target,'index.html'),'utf8');
html=html.replace(/<script src="\/pwa-bootstrap[^>]+><\/script>/,'<script src="native.js"></script>')
 .replace(/<link rel="manifest"[^>]+>/,'')
 .replace(/<!-- Cloudflare Web Analytics[\s\S]*?<\/script>/,'');
// Política local: scripts do pacote; API e imagens HTTPS. Nenhum código remoto de atualização.
const policy="default-src 'self' capacitor:; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https:; connect-src 'self' https://xvwgrpnioaqyijhzqxqh.supabase.co wss://xvwgrpnioaqyijhzqxqh.supabase.co https://owybghlwcohfyapvsfdo.supabase.co wss://owybghlwcohfyapvsfdo.supabase.co; font-src 'self' data:; object-src 'none'; base-uri 'self'";
html=html.replace('<meta charset="utf-8">',`<meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${policy}">`);
await writeFile(path.join(target,'index.html'),html);
// Ship the current private pilot locally. No remote JS or server source enters the IPA.
const marketTarget=path.join(target,'marketplace');
await mkdir(marketTarget,{recursive:true});
const marketHtml=await readFile(path.join(root,'marketplace/index.html'),'utf8');
const bundled=JSON.parse(await readFile(path.join(root,'marketplace/pilot-assets.json'),'utf8'));
if(bundled.length!==1||!/^assets\/pilot-[a-f0-9]{12}\.js$/.test(bundled[0]))throw Error('Expected one versioned Marketplace bundle');
const marketFiles=new Set(['index.html','pilot-entry.js','pilot-assets.json','manifest.webmanifest',bundled[0],...Array.from(marketHtml.matchAll(/href="([^"?#]+\.css)(?:[?#][^"]*)?"/g),m=>m[1])]);
for(const file of marketFiles){
 if(file.startsWith('/')||file.includes('..'))throw Error('Unsafe Marketplace asset path');
 await mkdir(path.dirname(path.join(marketTarget,file)),{recursive:true});
 await cp(path.join(root,'marketplace',file),path.join(marketTarget,file));
}
await cp(path.join(root,'marketplace/assets/venues'),path.join(marketTarget,'assets/venues'),{recursive:true});
await cp(path.join(root,'marketplace/assets/preview-icon.svg'),path.join(marketTarget,'assets/preview-icon.svg'));
await writeFile(path.join(marketTarget,'index.html'),marketHtml
 .replace(/<link rel="manifest"[^>]+>/,'')
 .replace('<meta charset="UTF-8">',`<meta charset="UTF-8"><meta http-equiv="Content-Security-Policy" content="${policy}">`)
 .replace('<meta charset="utf-8">',`<meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${policy}">`)
 .replace('<script src="/supabase-config.js','<script src="/native.js"></script>\n  <script src="/supabase-config.js'));
const release=JSON.parse(await readFile(path.join(root,'version.json'),'utf8'));
console.log(`Pacote web local do iOS preparado (Build ${release.build}).`);
