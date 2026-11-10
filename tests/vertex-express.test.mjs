import test from 'node:test';
import assert from 'node:assert/strict';
import {fetchAgentResponse,selectedModel,providerReady} from '../scripts/agent-provider.mjs';
test('explicit express provider uses configured model and projectless endpoint after temporary expiry',async()=>{
 const names=['DRAW3D_AGENT_PROVIDER','VERTEX_AGENT_API_KEY','VERTEX_AGENT_MODEL'],previous=names.map(k=>process.env[k]);
 Object.assign(process.env,{DRAW3D_AGENT_PROVIDER:'vertex-express',VERTEX_AGENT_API_KEY:'fixture',VERTEX_AGENT_MODEL:'gemini-3.8-flash'});
 try{assert.equal(selectedModel(),'gemini-3.8-flash');assert.equal(providerReady(),true);let url;
 const r=await fetchAgentResponse(async(u,o)=>{url=u;assert.equal(o.headers['x-goog-api-key'],'fixture');return {ok:true,status:200,json:async()=>({candidates:[{finishReason:'STOP',content:{parts:[{text:'OK'}]}}]})};},{model:selectedModel(),instructions:'Test',input:[{role:'user',content:'Test'}]});
 assert.equal(url,'https://aiplatform.googleapis.com/v1/publishers/google/models/gemini-3.8-flash:generateContent');assert.equal((await r.json()).status,'completed');
 }finally{names.forEach((k,i)=>{if(previous[i]===undefined)delete process.env[k];else process.env[k]=previous[i];});}
});
