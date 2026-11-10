import {existsSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';

const root=fileURLToPath(new URL('../',import.meta.url));
process.chdir(root);
const flags=new Set(process.argv.slice(2));
if([...flags].some(f=>!['--test','--serve','--help'].includes(f)))throw Error('Use --test, --serve or --help.');
if(flags.has('--help')){
 console.log('node scripts/handoff.mjs [--test] [--serve]\nCheck this checkout, optionally run its regression suite, then serve the built desktop and VR pages with the backend.');
 process.exit(0);
}
const assets=['package.json','src/part-workspace.js','agent-skills/build-from-sketches/SKILL.md','node_modules/vite/bin/vite.js','dist/desktop.html','dist/index.html','dist/cad/index.html'];
const missing=assets.filter(f=>!existsSync(f));
console.log('Draw3D workspace',root,'\nNode',process.version);
for(const f of missing)console.error('Missing',f);
console.log('Guides: docs/DESKTOP-WORKSPACE.md and docs/PROJECT-HANDOFF.md');
if(flags.has('--test')){
 const npm=process.env.npm_execpath;
 const run=npm?spawnSync(process.execPath,[npm,'test'],{stdio:'inherit'}):spawnSync(process.platform==='win32'?'npm.cmd':'npm',['test'],{stdio:'inherit',shell:process.platform==='win32'});
 if(run.status!==0)process.exit(run.status||1);
}
if(missing.length){console.error('Install dependencies, prepare the native CAD bundle if missing, and run npm run build.');process.exit(1);}
if(flags.has('--serve')){
 process.env.DRAW3D_STATIC_DIR=path.join(root,'dist');
 process.env.DRAW3D_CREATION_WORKFLOW||='direct';
 const {startBridge}=await import('./model-bridge.mjs');
 const port=Number(process.env.BRIDGE_PORT||8788);
 await startBridge(port);
 console.log('Desktop http://localhost:'+port+'/desktop.html?experiment=decision\nVR http://localhost:'+port+'/index.html');
}
