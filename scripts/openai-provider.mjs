import {compactResponseSchema} from './compact-response-schema.mjs';
// Responses transport with public output progress; reasoning content is never exposed.
import {metaStrictSchema} from './meta-provider.mjs';
export async function sendOpenAIResponse(fetcher,body,signal){
 const {onProgress,onWireRequest,...request}=body;request.store=false;
 if(request.text?.format?.type==='json_schema'){const strictSchema=metaStrictSchema(request.text.format.schema);request.text={format:{...request.text.format,schema:request.model==='gpt-6.1-terra'&&process.env.DRAW3D_COMPACT_SCHEMA!=='0'?compactResponseSchema(strictSchema):strictSchema}};}
 const stream=typeof onProgress==='function';if(stream)request.stream=true;
 if(onWireRequest)await onWireRequest({url:'https://api.openai.com/v1/responses',method:'POST',headers:{'Content-Type':'application/json',Authorization:'[redacted]'},body:request});
 const response=await fetcher('https://api.openai.com/v1/responses',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+process.env.OPENAI_API_KEY},signal,body:JSON.stringify(request)});
 if(!response.ok||!stream||!response.headers?.get?.('content-type')?.includes('text/event-stream'))return response;
 let buffer='',output='',result;const decoder=new TextDecoder();
 async function line(value){if(!value.startsWith('data: '))return;const raw=value.slice(6).trim();if(!raw||raw==='[DONE]')return;const event=JSON.parse(raw);if(event.type==='response.output_text.delta'){output+=event.delta||'';await onProgress({text:output,characters:output.length});}if(['response.completed','response.incomplete','response.failed'].includes(event.type))result=event.response;if(event.type==='error')throw Error(event.message||'OpenAI stream failed');}
 for await(const chunk of response.body){signal?.throwIfAborted();buffer+=decoder.decode(chunk,{stream:true});let at;while((at=buffer.indexOf('\n'))>=0){const row=buffer.slice(0,at).trimEnd();buffer=buffer.slice(at+1);await line(row);}}
 buffer+=decoder.decode();if(buffer.trim())await line(buffer.trimEnd());if(!result)throw Error('OpenAI stream ended before a final response');return {ok:true,status:response.status,json:async()=>result};
}
