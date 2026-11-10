import {cp,copyFile,readFile,writeFile,mkdir,readdir} from "node:fs/promises";
import {execFileSync} from "node:child_process";
import path from "node:path";
const source=path.resolve(process.env.OPENZCAD_SOURCE || "I:/Projects/Draw3d/.cache/native-build/openzcad-source");
const commit="ae6553b498d5ba04d8c7b5cc43d97682bd5f94a3";
if(execFileSync("git",["-C",source,"rev-parse","HEAD"],{encoding:"utf8"}).trim()!==commit)throw new Error("Unexpected OpenZCAD revision; review and update the pin explicitly.");
const dist=path.join(source,"apps/web/dist"),target=path.resolve("public/cad");
let html=await readFile(path.join(dist,"index.html"),"utf8");
if(!html.includes('/cad/assets/'))throw new Error("Build OpenZCAD with --base=/cad/ before packaging.");
await mkdir(target,{recursive:true});
async function copyNewTree(from,to){await mkdir(to,{recursive:true});const names=new Set(await readdir(to));for(const entry of await readdir(from,{withFileTypes:true})){const src=path.join(from,entry.name),dest=path.join(to,entry.name);if(entry.isDirectory())await copyNewTree(src,dest);else if(!names.has(entry.name))await copyFile(src,dest);}}
await copyNewTree(dist,target);
async function assetFiles(folder,prefix=""){const files=[];for(const e of await readdir(folder,{withFileTypes:true})){const name=prefix+e.name;if(e.isDirectory())files.push(...await assetFiles(path.join(folder,e.name),name+"/"));else files.push(name);}return files;}
await writeFile(path.join(target,"asset-manifest.json"),JSON.stringify(await assetFiles(path.join(dist,"assets"))));
for(const name of ["LICENSE","NOTICE","THIRD-PARTY-NOTICES.md"])await cp(path.join(source,name),path.join(target,name));
// The editor's font/PDF loaders use origin-root paths independently of Vite base.
for(const name of ["fonts","pdfjs"])await copyNewTree(path.join(dist,name),path.resolve("public",name));
await cp(path.join(dist,"build-meta.json"),path.resolve("public/build-meta.json"));
await cp("scripts/cad-recorder.js",path.join(target,"draw3d-recorder.js"));
html=html.replace('<head>','<head>\n<script src="/cad/draw3d-recorder.js"></script>');
await writeFile(path.join(target,"index.html"),html);
await writeFile(path.join(target,"integration.json"),JSON.stringify({engine:"OpenZCAD",commit,license:"Apache-2.0",compute:"browser",source:"https://github.com/esaueng/OpenZCAD",modifications:["Hosted at /cad/","Draw3D native cubic spline schema, exact profile builder, viewport and control-point editor","Shared magnetic controls","Draw3D local recording script added to HTML","Native command bridge injected into App through the pinned build transform"]},null,2));
// Preserve package notices alongside the compiled dependencies.
const modules=path.join(source,"node_modules/.pnpm");
for(const entry of await readdir(modules,{withFileTypes:true})){
 if(!entry.isDirectory() || entry.name==="node_modules")continue;
 const root=path.join(modules,entry.name,"node_modules");
 let packages;try{packages=await readdir(root,{withFileTypes:true});}catch{continue;}
 const roots=[];
 for(const pkg of packages){if(pkg.isSymbolicLink() || !pkg.isDirectory())continue;const p=path.join(root,pkg.name);if(pkg.name.startsWith("@")){for(const s of await readdir(p))roots.push(path.join(p,s));}else roots.push(p);}
 for(const p of roots){for(const f of await readdir(p)){if(/^(license|licence|notice|copying)(\.|$)/i.test(f)){const dest=path.join(target,"licenses",entry.name,f);await mkdir(path.dirname(dest),{recursive:true});await cp(path.join(p,f),dest,{recursive:true,force:false});}}}
}
console.log("Full on-device CAD bundled at /cad/ (OpenZCAD " + commit.slice(0,8) + ")");
import {installSplineRevolve} from './install-spline-revolve.mjs';
await installSplineRevolve(target);
import {installSplineLoft} from './install-spline-loft.mjs';
await installSplineLoft(target);
import {versionCadWorker} from './version-cad-worker.mjs';
await versionCadWorker(target);
