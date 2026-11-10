// Reuse existing backend secret mounts and native workers. No key or saved user data is copied.
import {spawn,spawnSync} from 'node:child_process';
import {createReadStream} from 'node:fs';
const wrapper='/mnt/d/Projects/Draw3d/.runtime/docker/draw3d-docker.sh';
function docker(args,{json=false}={}){const r=spawnSync('wsl',['-d','Ubuntu','-u','root','--','sh',wrapper,...args],{cwd:'C:\\',encoding:'utf8',maxBuffer:8*1024*1024});if(r.status!==0)throw Error(r.stderr||r.stdout);return json?JSON.parse(r.stdout):r.stdout;}
const build=spawn('wsl',['-d','Ubuntu','-u','root','--','sh',wrapper,'build','-t','draw3d-app:desktop-sketch-preview','-f','deploy/Dockerfile.desktop-preview','-'],{cwd:'C:\\',stdio:['pipe','pipe','pipe']});
build.stdout.pipe(process.stdout);build.stderr.pipe(process.stderr);createReadStream(new URL('../.cache/desktop-preview.tar',import.meta.url)).pipe(build.stdin);await new Promise((resolve,reject)=>{build.on('error',reject);build.on('exit',code=>code===0?resolve():reject(Error('Preview image build failed')));});
const source=docker(['inspect','draw3d-terra-app-1'],{json:true})[0],name=process.env.DRAW3D_PREVIEW_NAME||'draw3d-desktop-preview',port=Number(process.env.DRAW3D_PREVIEW_PORT||18890);
if(!/^draw3d-[a-z0-9-]+$/.test(name)||!Number.isInteger(port)||port<1024||port>65535)throw Error('Invalid preview name or port');
const exists=spawnSync('wsl',['-d','Ubuntu','-u','root','--','sh',wrapper,'inspect',name],{cwd:'C:\\',stdio:'ignore'}).status===0;
if(exists){docker(['stop',name]);docker(['rm',name]);}
const networks=Object.keys(source.NetworkSettings.Networks),args=['create','--name',name,'--restart','unless-stopped','--init','--read-only','--tmpfs','/tmp:size=512m','--cap-drop','ALL','--security-opt','no-new-privileges:true','--network',networks[0],'-p',`127.0.0.1:${port}:8788`,'-v',name+'-data:/data'];
const previewModel=process.env.DRAW3D_PREVIEW_MODEL;
for(const env of source.Config.Env||[])if(!env.startsWith('DRAW3D_AGENT_ORIGINS=')&&!env.startsWith('DRAW3D_CREATION_WORKFLOW=')&&!(previewModel&&env.startsWith('OPENAI_AGENT_MODEL=')))args.push('-e',env);
if(previewModel)args.push('-e','OPENAI_AGENT_MODEL='+previewModel);
if(process.env.DRAW3D_PREVIEW_REASONING)args.push('-e','DRAW3D_DESKTOP_REASONING='+process.env.DRAW3D_PREVIEW_REASONING);
args.push('-e','DRAW3D_AGENT_ORIGINS=http://localhost:5173,http://127.0.0.1:5173,http://localhost:5181,http://127.0.0.1:5181,http://localhost:5182,http://127.0.0.1:5182,http://127.0.0.1:5191,http://localhost:5191,http://localhost:'+port,'-e','DRAW3D_CREATION_WORKFLOW=direct');
for(const mount of source.Mounts.filter(m=>m.Destination!=='/data'))args.push('--mount',`type=${mount.Type},source=${mount.Source},target=${mount.Destination}${mount.RW?'':',readonly'}`);
args.push('draw3d-app:desktop-sketch-preview');docker(args);for(const network of networks.slice(1))docker(['network','connect',network,name]);docker(['start',name]);console.log('Desktop backend ready on http://localhost:'+port+'; existing server unchanged.');
