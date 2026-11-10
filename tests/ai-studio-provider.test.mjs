import test from 'node:test';
import assert from 'node:assert/strict';
import {fetchAgentResponse,selectedModel,providerReady} from '../scripts/agent-provider.mjs';
test('AI Studio sends images and direct JSON to Developer API with its own key after temporary Vertex expiry',async()=>{
 const names=['DRAW3D_AGENT_PROVIDER','GEMINI_AGENT_API_KEY','GEMINI_API_KEY','GEMINI_AGENT_MODEL','VERTEX_AGENT_API_KEY'],previous=names.map(k=>process.env[k]);
 Object.assign(process.env,{DRAW3D_AGENT_PROVIDER:'gemini',GEMINI_AGENT_API_KEY:'studio-fixture',GEMINI_API_KEY:'other-fixture',GEMINI_AGENT_MODEL:'gemini-3.8-flash',VERTEX_AGENT_API_KEY:'vertex-fixture'});
 try{
 assert.equal(selectedModel(),'gemini-3.8-flash');assert.equal(providerReady(),true);let calls=0;
 const r=await fetchAgentResponse(async(url,o)=>{calls++;assert.equal(url,'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent');assert.equal(o.headers['x-goog-api-key'],'studio-fixture');const b=JSON.parse(o.body);assert.deepEqual(b.contents[0].parts[1],{inlineData:{mimeType:'image/png',data:'AAAA'}});assert.deepEqual(b.contents[0].parts[2],{inlineData:{mimeType:'audio/wav',data:'UklGRg=='}});assert.equal(b.generationConfig.responseMimeType,'application/json');assert.equal(b.generationConfig.thinkingConfig.thinkingLevel,'LOW');assert.equal(b.tools,undefined);return {ok:true,status:200,json:async()=>({candidates:[{finishReason:'STOP',content:{parts:[{text:'{"ok":true}'}]}}]})};},{model:selectedModel(),instructions:'Test',reasoning:{effort:'low'},input:[{role:'user',content:[{type:'input_text',text:'Test'},{type:'input_image',image_url:'data:image/png;base64,AAAA'},{type:'input_audio',input_audio:{data:'UklGRg==',format:'wav'},mime_type:'audio/wav'}]}],text:{format:{type:'json_schema',schema:{type:'object',properties:{ok:{type:'boolean'}},required:['ok']}}}});
 assert.equal(calls,1);assert.equal((await r.json()).status,'completed');
 delete process.env.GEMINI_AGENT_API_KEY;assert.equal(providerReady(),true);delete process.env.GEMINI_API_KEY;assert.equal(providerReady(),false);await assert.rejects(fetchAgentResponse(()=>assert.fail('Must not send a Vertex key to Developer API'),{model:selectedModel(),input:[]}),/AI Studio backend key is missing/);
 }finally{names.forEach((k,i)=>{if(previous[i]===undefined)delete process.env[k];else process.env[k]=previous[i];});}
});
