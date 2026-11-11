import {test} from 'node:test';import assert from 'node:assert/strict';
import {fetchAgentResponse,selectedModel} from '../scripts/agent-provider.mjs';import {vertexDecisions} from '../scripts/vertex-decisions.mjs';
test('OpenAI stays primary; missing credentials and transient failures use the configured Google fallback',async()=>{
 const names=['DRAW3D_AGENT_PROVIDER','DRAW3D_GOOGLE_BACKUP','GOOGLE_CLOUD_PROJECT','GOOGLE_OAUTH_ACCESS_TOKEN','OPENAI_API_KEY'],previous=Object.fromEntries(names.map(n=>[n,process.env[n]]));Object.assign(process.env,{DRAW3D_AGENT_PROVIDER:'openai',DRAW3D_GOOGLE_BACKUP:'1',GOOGLE_CLOUD_PROJECT:'test-project',GOOGLE_OAUTH_ACCESS_TOKEN:'fake-google-token',OPENAI_API_KEY:'fake-openai-key'});
 const body={model:'gpt-6-luna',instructions:'Return JSON',input:[{role:'user',content:'Test geometry'}],text:{format:{type:'json_schema',schema:{type:'object',properties:{edits:{type:'array'}},required:['edits']}}}};
 const google=()=>({ok:true,status:200,json:async()=>({candidates:[{finishReason:'STOP',content:{parts:[{text:'{"edits":[]}'}]}}]})});
 try{
  assert.equal(selectedModel(),'gpt-6-luna');let calls=[];let result=await fetchAgentResponse(async(url,options)=>{calls.push({url,options});return {ok:true,status:200,json:async()=>({status:'completed',output:[]})}},body);assert.equal(calls.length,1);assert.equal(calls[0].url,'https://api.openai.com/v1/responses');assert(result.ok);
  calls=[];result=await fetchAgentResponse(async(url,options)=>{calls.push({url,options});return url.includes('api.openai.com')?{ok:false,status:429}:google()},body);assert.equal(calls.length,2);assert.match(calls[1].url,/projects\/test-project\/locations\/global/);assert.equal(calls[1].options.headers.Authorization,'Bearer fake-google-token');assert(!JSON.stringify(calls[1].options).includes('fake-openai-key'));assert.equal((await result.json()).status,'completed');
  delete process.env.OPENAI_API_KEY;assert.equal(selectedModel(),'gemini-3.8-flash');calls=[];await fetchAgentResponse(async(url)=>{calls.push(url);return google()},body);assert.equal(calls.length,1);assert(!calls[0].includes('api.openai.com'));
 }finally{for(const name of names)if(previous[name]===undefined)delete process.env[name];else process.env[name]=previous[name];}
});
test('Google decision fallback rejects missing, invented and duplicate question answers',async()=>{
 const names=['DRAW3D_GOOGLE_BACKUP','GOOGLE_CLOUD_PROJECT','GOOGLE_OAUTH_ACCESS_TOKEN'],previous=Object.fromEntries(names.map(n=>[n,process.env[n]]));Object.assign(process.env,{DRAW3D_GOOGLE_BACKUP:'1',GOOGLE_CLOUD_PROJECT:'test-project',GOOGLE_OAUTH_ACCESS_TOKEN:'fake-token'});
 const question={name:'shape',type:'choice',choices:[{value:'circle'},{value:'line'}]},answer={name:'shape',type:'choice',choice:'circle',confidence:.9};const body={questions:[question],input:[{role:'user',content:'A round outline'}]};
 const fake=answers=>async()=>({ok:true,status:200,json:async()=>({candidates:[{content:{parts:[{text:JSON.stringify({answers})}]}}]})});
 try{assert.equal((await vertexDecisions(body,{fetcher:fake([answer])})).answers[0].choice,'circle');for(const answers of [[],[{...answer,choice:'invented'}],[answer,answer],[{...answer,name:'other'}]])await assert.rejects(vertexDecisions(body,{fetcher:fake(answers)}));}
 finally{for(const name of names)if(previous[name]===undefined)delete process.env[name];else process.env[name]=previous[name];}
});
