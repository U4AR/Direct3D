// Aggregate Gemini SSE while exposing only public output progress, never private thoughts.
export async function readGeminiStream(response,onProgress,signal){
 if(!response.body?.getReader)return response.json();
 const reader=response.body.getReader(),decoder=new TextDecoder();let buffer='',output='',candidate={content:{role:'model',parts:[]}},usageMetadata,promptFeedback,error;
 async function frame(block){
  const raw=block.split(/\r?\n/).filter(l=>l.startsWith('data:')).map(l=>l.slice(5).trimStart()).join('\n');if(!raw||raw==='[DONE]')return;
  const data=JSON.parse(raw);if(data.error)error=data.error;if(data.usageMetadata)usageMetadata=data.usageMetadata;if(data.promptFeedback)promptFeedback=data.promptFeedback;
  const c=data.candidates?.[0];if(!c)return;if(c.finishReason)candidate.finishReason=c.finishReason;
  for(const p of c.content?.parts||[]){const last=candidate.content.parts.at(-1);if(p.text!==undefined&&last?.text!==undefined&&!!last.thought===!!p.thought){last.text+=p.text;if(p.thoughtSignature)last.thoughtSignature=p.thoughtSignature;}else candidate.content.parts.push({...p});
   if(p.text&&!p.thought){output+=p.text;await onProgress?.({text:output,characters:output.length});}
  }
 }
 try{while(true){signal?.throwIfAborted();const {done,value}=await reader.read();buffer+=decoder.decode(value||new Uint8Array(),{stream:!done});let boundary;while((boundary=buffer.search(/\r?\n\r?\n/))>=0){const m=buffer.slice(boundary).match(/^\r?\n\r?\n/)[0];const block=buffer.slice(0,boundary);buffer=buffer.slice(boundary+m.length);await frame(block);}if(done)break;}if(buffer.trim())await frame(buffer);}
 finally{reader.releaseLock();}
 return {candidates:[candidate],usageMetadata,promptFeedback,...(error?{error}:{})};
}
