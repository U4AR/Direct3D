import {execFileSync} from 'node:child_process';
import {existsSync,mkdirSync} from 'node:fs';import path from 'node:path';
const root=process.cwd(),build=path.resolve('.build');mkdirSync(build,{recursive:true});
function run(cmd,args,cwd=root,env={}){execFileSync(cmd,args,{cwd,stdio:'inherit',env:{...process.env,...env}});}
function checkout(name,url,commit){const dir=path.join(build,name);if(!existsSync(dir)){run('git',['clone','--no-checkout',url,dir]);run('git',['fetch','--depth','1','origin',commit],dir);run('git',['checkout','--detach',commit],dir);}if(execFileSync('git',['rev-parse','HEAD'],{cwd:dir,encoding:'utf8'}).trim()!==commit)throw Error('Unexpected '+name+' revision');return dir;}
const cad=checkout('openzcad','https://github.com/esaueng/OpenZCAD.git','ae6553b498d5ba04d8c7b5cc43d97682bd5f94a3');
run('corepack',['pnpm','install','--frozen-lockfile'],cad);run(process.execPath,['scripts/verify-remus-artifacts.mjs'],cad);
run(process.execPath,[path.join(root,'scripts/build-cad-agent.mjs')],root,{OPENZCAD_SOURCE:cad});run(process.execPath,['scripts/bundle-cad.mjs'],root,{OPENZCAD_SOURCE:cad});
const sculpt=checkout('sculptgl','https://github.com/stephomi/sculptgl.git','8e45dafc0f7906e5238dfffc1a2df742bd25f29d');
run('npm',['install','--omit=dev','--ignore-scripts','--no-audit','--no-fund'],sculpt);run(process.execPath,['scripts/bundle-sculpt.mjs'],root,{SCULPTGL_SOURCE:sculpt});
