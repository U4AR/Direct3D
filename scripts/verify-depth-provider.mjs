import fs from 'node:fs/promises';
import {unzipSync,strFromU8} from 'fflate';
const archive=unzipSync(await fs.readFile('test-results/session.zip'));
const key=Object.keys(archive).find(k=>k.startsWith('assets/captures/')&&k.endsWith('.json'));
if(!key)throw Error('Capture fixture missing');
const capture=JSON.parse(strFromU8(archive[key]));
const start=Date.now();
const response=await fetch('http://127.0.0.1:8788/api/depth',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({description:'A rounded vase with a narrow opening. This is a synthetic test sketch.',frame:capture.frames[0],context:capture.frames}),signal:AbortSignal.timeout(230000)});
const result=await response.json();
await fs.writeFile('artifacts/quest/depth-provider-verification.json',JSON.stringify({...result,image:result.image?'saved separately':undefined,status:response.status,elapsedMs:Date.now()-start},null,2));
if(result.image){const [meta,data]=result.image.split(';base64,');await fs.writeFile('artifacts/quest/depth-provider-test.'+(meta.includes('png')?'png':meta.includes('webp')?'webp':'jpg'),Buffer.from(data,'base64'));}
console.log(JSON.stringify({status:response.status,model:result.model,imageCount:result.imageCount,error:result.error,elapsedMs:Date.now()-start}));
