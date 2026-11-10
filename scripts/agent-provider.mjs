import {sendOpenAIResponse} from './openai-provider.mjs';
import {sendMetaResponse} from './meta-provider.mjs';
import {readGeminiStream} from './gemini-stream.mjs';
import {cloudVertexReady,cloudVertexModel,vertexGenerate} from './vertex-cloud.mjs';
// Progress messages and the final structured answer are separate output items.
// Joining them produces invalid JSON even when the final answer is valid.
export function finalResponseText(response){const messages=(response.output||[]).filter(o=>o.type==='message'),message=messages.findLast(o=>o.phase==='final_answer')||messages.findLast(o=>o.phase!=='commentary');return (message?.content||[]).filter(c=>c.type==='output_text').map(c=>c.text).join('');}
// Backend-only provider adapter. Never import this module into client code.
export const VERTEX_DEADLINE=Date.parse('2026-10-16T00:00:00+05:30');
export function vertexAllowed(now=Date.now()){return process.env.DRAW3D_AGENT_PROVIDER==='vertex-temporary'&&now<VERTEX_DEADLINE;}
const aiStudio=()=>process.env.DRAW3D_AGENT_PROVIDER==='gemini';
const geminiKey=()=>process.env.GEMINI_AGENT_API_KEY||process.env.GEMINI_API_KEY;
const vertexExpress=()=>process.env.DRAW3D_AGENT_PROVIDER==='vertex-express';
export const selectedModel=()=>process.env.DRAW3D_AGENT_PROVIDER==='meta'?(process.env.META_AGENT_MODEL||'muse-spark-1.3'):aiStudio()?(process.env.GEMINI_AGENT_MODEL||'gemini-3.8-flash'):vertexExpress()?(process.env.VERTEX_AGENT_MODEL||'gemini-3.8-flash'):vertexAllowed()?'gemini-3.8-flash':!process.env.OPENAI_API_KEY&&cloudVertexReady()?cloudVertexModel():process.env.OPENAI_AGENT_MODEL||'gpt-6-luna';
export const providerReady=()=>!!(process.env.DRAW3D_AGENT_PROVIDER==='meta'?process.env.META_API_KEY:aiStudio()?geminiKey():(vertexExpress()||vertexAllowed())?process.env.VERTEX_AGENT_API_KEY:process.env.OPENAI_API_KEY||cloudVertexReady());
export function vertexContents(input){
 const contents=[],calls=new Map();let pendingResponse;
 const append=(role,parts)=>{if(!parts.length)return;const last=contents.at(-1);if(role==='user'&&last?.role===role)last.parts.push(...parts);else contents.push({role,parts});};
 for(const item of input){
  if(item.type==='gemini_content'){
   pendingResponse=undefined;contents.push(structuredClone(item.content));let i=0;for(const p of item.content.parts||[])if(p.functionCall)calls.set(item.callIds[i++],p.functionCall);continue;
  }
  if(['function_call','message','reasoning'].includes(item.type))continue;
  if(item.type==='function_call_output'){
   const fc=calls.get(item.call_id);if(!fc)throw Error('Missing Gemini function-call history');let result;try{result=JSON.parse(item.output);}catch{result={text:item.output};}
   pendingResponse={name:fc.name,...(fc.id?{id:fc.id}:{}),response:{result}};append('user',[{functionResponse:pendingResponse}]);continue;
  }
  if(item.role){const parts=typeof item.content==='string'?[{text:item.content}]:(item.content||[]).map(p=>{
   if(p.type==='input_text')return {text:p.text};
   if(p.type==='input_audio')return {inlineData:{mimeType:p.mime_type||'audio/wav',data:p.input_audio.data}};
   if(p.type==='input_image'){const m=p.image_url.match(/^data:([^;]+);base64,(.*)$/s);if(!m)throw Error('Gemini needs inline image data');return {inlineData:{mimeType:m[1],data:m[2]},...(p.detail?{mediaResolution:{level:p.detail==='low'?'MEDIA_RESOLUTION_LOW':'MEDIA_RESOLUTION_HIGH'}}:{})};}return null;
  }).filter(Boolean);
   // Tool images belong inside their function response. Sibling inlineData is
   // rejected by newer Gemini models, even when the outer role is 'user'.
   if(item.role==='user'&&pendingResponse&&parts.some(p=>p.inlineData)){
    pendingResponse.parts=parts.filter(p=>p.inlineData);
    pendingResponse.response.observationText=parts.filter(p=>p.text).map(p=>p.text).join('\n');
    pendingResponse=undefined;
   }else{pendingResponse=undefined;append(item.role==='assistant'?'model':'user',parts);}
  }
 }
 return contents;
}
export function normalizeVertex(data){
 const candidate=data.candidates?.[0],content=candidate?.content;
 if(!content?.parts?.length&&candidate?.finishReason==='MAX_TOKENS')return {status:'incomplete',incomplete_details:{reason:'MAX_TOKENS'},output:[],usage:data.usageMetadata};
 if(!content?.parts?.length)return {status:'failed',error:{message:data.promptFeedback?.blockReason||'Gemini returned no content'},output:[]};
 const callIds=[],output=[];
 for(const part of content.parts){if(part.functionCall){const id=part.functionCall.id||'gemini-'+crypto.randomUUID();callIds.push(id);output.push({type:'function_call',call_id:id,name:part.functionCall.name,arguments:JSON.stringify(part.functionCall.args||{})});}
  else if(part.text&&!part.thought)output.push({type:'message',role:'assistant',content:[{type:'output_text',text:part.text}]});}
 output.unshift({type:'gemini_content',content,callIds});
 return {status:candidate.finishReason==='STOP'?'completed':'incomplete',incomplete_details:{reason:candidate.finishReason},output,usage:data.usageMetadata};
}
// Keep the provider grammar shallow. Native CAD fields are validated locally.
export function vertexResponseSchema(schema,depth=0,maxDepth=2){
 if(Array.isArray(schema))return schema.map(s=>vertexResponseSchema(s,depth,maxDepth));
 if(!schema||typeof schema!=='object')return schema;
 if(schema.type==='object'&&depth>=maxDepth)return {type:'object',additionalProperties:true};
 const out={};for(const [key,value]of Object.entries(schema)){if(['minItems','maxItems'].includes(key))continue;if(key==='properties')out.properties=Object.fromEntries(Object.entries(value).map(([k,v])=>[k,vertexResponseSchema(v,depth+1,maxDepth)]));else if(key==='items')out.items=vertexResponseSchema(value,depth+1,maxDepth);else if(key==='anyOf')out.anyOf=value.map(v=>vertexResponseSchema(v,depth+1,maxDepth));else out[key]=value;}return out;
}
async function sendAgentResponse(fetcher,body,signal){
 if(process.env.DRAW3D_AGENT_PROVIDER==='meta')return sendMetaResponse(fetcher,body,signal);
 if(!body.model.startsWith('gemini-')){
  if(!process.env.OPENAI_API_KEY&&cloudVertexReady())return sendAgentResponse(fetcher,{...body,model:cloudVertexModel()},signal);
  try{const response=await sendOpenAIResponse(fetcher,body,signal);if(cloudVertexReady()&&[408,429,500,502,503,504].includes(response.status))return sendAgentResponse(fetcher,{...body,model:cloudVertexModel()},signal);return response;}
  catch(error){if(signal?.aborted||!cloudVertexReady())throw error;return sendAgentResponse(fetcher,{...body,model:cloudVertexModel()},signal);}
 }
 // Check every request, including retries and child runs. Never send to the temporary model after expiry.
 if(!aiStudio()&&!vertexExpress()&&!vertexAllowed()&&!cloudVertexReady()){const e=Error('Temporary Gemini access ended at midnight on October 16, Asia/Kolkata. Start a new run to use the normal backend.');e.code='PROVIDER_EXPIRED';throw e;}
 const key=aiStudio()?geminiKey():process.env.VERTEX_AGENT_API_KEY;
 if(!key&&!cloudVertexReady())throw Error(aiStudio()?'AI Studio backend key is missing':'Vertex backend key is missing');
 const streaming=aiStudio()&&!body.tools?.length&&typeof body.onProgress==='function';
 let url=aiStudio()?`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(body.model)}:generateContent`:vertexExpress()?`https://aiplatform.googleapis.com/v1/publishers/google/models/${encodeURIComponent(body.model)}:generateContent`:'https://aiplatform.googleapis.com/v1/projects/speakup-copilot-2026/locations/global/publishers/google/models/gemini-3.8-flash:generateContent';
 if(streaming)url=url.replace(':generateContent',':streamGenerateContent?alt=sse');
 const request={systemInstruction:{parts:[{text:body.instructions}]},contents:vertexContents(body.input),generationConfig:{maxOutputTokens:body.max_output_tokens||8192,thinkingConfig:{thinkingLevel:({low:'LOW',medium:'MEDIUM',high:'HIGH'})[body.reasoning?.effort]||'MEDIUM'}},...(body.tools?.length?{toolConfig:{functionCallingConfig:{mode:'VALIDATED'}},tools:[{functionDeclarations:body.tools.map(t=>({name:t.name,description:t.description,parameters:t.parameters}))}]}:{})};
 if(body.text?.format?.type==='json_schema'){request.generationConfig.responseMimeType='application/json';const schema=structuredClone(body.text.format.schema);if(aiStudio()&&/^(gemini-4-argon|gemini-3\.8-flash)/.test(body.model)){const params=schema.properties?.edits?.items?.properties?.parameters?.anyOf?.find(p=>p.type==='object');if(params)delete params.required;request.generationConfig.responseJsonSchema=vertexResponseSchema(schema,0,12);}else request.generationConfig.responseJsonSchema=vertexResponseSchema(schema);request.systemInstruction.parts.push({text:'Return a complete JSON object following the configured response schema. Use null for unused values, include all required fields and do not add metadata keys.'});}
 if(aiStudio()&&process.env.GEMINI_AGENT_SERVICE_TIER)request.service_tier=process.env.GEMINI_AGENT_SERVICE_TIER;
 const response=cloudVertexReady()&&!aiStudio()&&!vertexExpress()?await vertexGenerate(request,{fetcher,signal,model:body.model}):await fetcher(url,{method:'POST',headers:{'Content-Type':'application/json','x-goog-api-key':key},signal,body:JSON.stringify(request)});
 const data=streaming&&response.ok?await readGeminiStream(response,body.onProgress,signal):await response.json();return {ok:response.ok,status:response.status,json:async()=>response.ok?{...(data.error?{status:'failed',error:data.error,output:[]}:normalizeVertex(data)),providerTier:response.headers?.get?.('x-gemini-service-tier')||data.usageMetadata?.serviceTier||null}:data};
}

// Keep a real watchdog for the complete request/body read, even if a transport
// ignores abort. The temporary provider also aborts at its absolute cutoff.
export async function fetchAgentResponse(fetcher,body,signal=new AbortController().signal,timeoutMs=120000){
 signal.throwIfAborted();
 const controller=new AbortController();let timer,abort;
 const expires=body.model?.startsWith('gemini-')&&!aiStudio()&&!vertexExpress()&&!cloudVertexReady()?VERTEX_DEADLINE:Infinity;
 const waiting=new Promise((_,reject)=>{
  abort=()=>{controller.abort(signal.reason);reject(signal.reason);};signal.addEventListener('abort',abort,{once:true});
  timer=setTimeout(()=>{const error=Error(Date.now()>=expires?'Temporary Gemini access expired':'Model request timed out');error.code=Date.now()>=expires?'PROVIDER_EXPIRED':'MODEL_TIMEOUT';controller.abort(error);reject(error);},Math.max(1,Math.min(timeoutMs,expires-Date.now())));
 });
 try{return await Promise.race([waiting,(async()=>{const r=await sendAgentResponse(fetcher,body,controller.signal);const data=await r.json();return {ok:r.ok,status:r.status,json:async()=>data};})()]);}
 catch(error){const code=error.cause?.code;if(['ENOTFOUND','EAI_AGAIN'].includes(code)){const failure=Error('AI provider DNS lookup failed ('+code+'); drawing and native geometry are saved. Waiting for the server network to recover.');failure.code=code;failure.transient=true;throw failure;}if(code&&/^(ECONN|UND_ERR_CONNECT)/.test(code)){const failure=Error('AI provider connection failed ('+code+'); drawing and native geometry are saved.');failure.code=code;failure.transient=true;throw failure;}throw error;}
 finally{clearTimeout(timer);signal.removeEventListener('abort',abort);} 
}
