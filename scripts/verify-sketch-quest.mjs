import {chromium} from '@playwright/test';
import {spawn} from 'node:child_process';
import {createInterface} from 'node:readline';
import {mkdir,writeFile} from 'node:fs/promises';
const browser=await chromium.connectOverCDP('http://127.0.0.1:9223');
const child=spawn('node',['scripts/draw3d-mcp.mjs'],{stdio:['pipe','pipe','pipe']});
let sequence=0,sessionId;const waiting=new Map();createInterface({input:child.stdout}).on('line',line=>{const m=JSON.parse(line);waiting.get(m.id)?.(m);waiting.delete(m.id);});
function rpc(method,params){return new Promise((resolve,reject)=>{const id=++sequence,timer=setTimeout(()=>reject(Error('MCP timeout')),130000);waiting.set(id,m=>{clearTimeout(timer);resolve(m);});child.stdin.write(JSON.stringify({jsonrpc:'2.0',id,method,params})+'\n');});}
async function raw(name,args={}){const m=await rpc('tools/call',{name,arguments:name==='draw3d_sessions'?{}:{sessionId,...args}});if(m.error)throw Error(m.error.message);if(m.result.isError)throw Error(m.result.content[0].text);return m.result;}
async function call(name,args={}){return JSON.parse((await raw(name,args)).content.find(c=>c.type==='text').text);}
try{
 let page;for(const p of browser.contexts().flatMap(c=>c.pages()))if(p.url().startsWith('http://localhost:5173')&&await p.locator('#workspace-sculpt').count())page=p;
 if(!page)throw Error('Active Quest application not found');
 const fields=await page.locator('textarea[id$="instruction-text"]').count();if(fields!==2)throw Error('New instruction fields not loaded on Quest');
 await rpc('initialize',{});const sessions=(await call('draw3d_sessions')).sessions;
 const quests=sessions.filter(s=>/OculusBrowser/i.test(s.label));if(quests.length!==1)throw Error('Expected one active Quest session, got '+quests.length);sessionId=quests[0].id;
 const before=await call('agent_status');const reference=await call('sketch_analyze');
 const response=await raw('sketch_views',{views:['front','right','top','perspective'],width:768,height:768});const meta=JSON.parse(response.content[0].text),frames=response.content.filter(c=>c.type==='image');
 const after=await call('agent_status');if(JSON.stringify(before.userCamera)!==JSON.stringify(after.userCamera)||JSON.stringify(before.camera)!==JSON.stringify(after.camera))throw Error('Camera changed');
 const dir='artifacts/agent/quest-sketch-reference';await mkdir(dir,{recursive:true});for(let i=0;i<frames.length;i++)await writeFile(`${dir}/${meta.frames[i].view}.png`,Buffer.from(frames[i].data,'base64'));
 const summary={sessionId,instructionFields:fields,reference,frameCount:frames.length,camerasUnchanged:true};await writeFile(dir+'/verification.json',JSON.stringify(summary,null,2));console.log(JSON.stringify({sessionId,instructionFields:fields,strokeCount:reference.strokeIds.length,pointCount:reference.pointCount,frameCount:frames.length,camerasUnchanged:true}));
}finally{child.kill();await browser.close();}
