import {cp,readFile,writeFile,mkdir,rm} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {build} from 'esbuild';
const mobile=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const root=path.dirname(mobile),target=path.join(mobile,'www');
await rm(target,{recursive:true,force:true});await mkdir(target,{recursive:true});
// Lista explícita: SQL, código servidor, credenciais e arquivos administrativos nunca vão ao IPA.
const files=['index.html','auth-config.js','auth-access.js','auth-access.css','app.js','account-deletion.js','community-safety.js','styles.css','supabase-config.js','group-avatars-data.js','brand','assets','icons','apple-touch-icon.png','tamo-on-icon-192.png','legal','version.json'];
for(const file of files)await cp(path.join(root,file),path.join(target,file),{recursive:true});
await build({entryPoints:[path.join(mobile,'src/native.js')],bundle:true,format:'iife',target:['safari15'],outfile:path.join(target,'native.js'),minify:true,legalComments:'eof'});
let html=await readFile(path.join(target,'index.html'),'utf8');
html=html.replace(/<script src="\/pwa-bootstrap[^>]+><\/script>/,'<script src="native.js"></script>')
 .replace(/<link rel="manifest"[^>]+>/,'')
 .replace(/<!-- Cloudflare Web Analytics[\s\S]*?<\/script>/,'');
// Política local: scripts do pacote; API e imagens HTTPS. Nenhum código remoto de atualização.
const policy="default-src 'self' capacitor:; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https:; connect-src 'self' https://xvwgrpnioaqyijhzqxqh.supabase.co wss://xvwgrpnioaqyijhzqxqh.supabase.co; font-src 'self' data:; object-src 'none'; base-uri 'self'";
html=html.replace('<meta charset="utf-8">',`<meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${policy}">`);
await writeFile(path.join(target,'index.html'),html);
console.log('Pacote web local do iOS preparado (Build 165).');
