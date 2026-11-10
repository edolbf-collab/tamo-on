import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const mobile = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cache = path.resolve(process.argv[2]);
const lock = JSON.parse(readFileSync(path.join(mobile,'package-lock.json'),'utf8'));
// Seed only macOS ARM optional tarballs missing from the Linux installation.
for (const pkg of Object.values(lock.packages)) {
  if (!pkg.os?.includes('darwin') || (pkg.cpu && !pkg.cpu.includes('arm64'))) continue;
  const url = new URL(pkg.resolved);
  if (url.origin !== 'https://registry.npmjs.org' || !pkg.integrity) throw Error('Unverified dependency URL');
  execFileSync('npm',['cache','add',url.href,'--cache',cache],{stdio:'inherit'});
}
execFileSync('npm',['cache','verify','--cache',cache],{stdio:'inherit'});
