// Backend-only Meta Responses adapter; credentials never enter browser builds.
export function metaStrictSchema(schema){
 if(Array.isArray(schema))return schema.map(metaStrictSchema);if(!schema||typeof schema!=='object')return schema;
 const out=Object.fromEntries(Object.entries(schema).map(([k,v])=>[k,metaStrictSchema(v)]));
 if(out.type==='object'&&out.properties){const required=new Set(schema.required||[]);out.properties=Object.fromEntries(Object.entries(out.properties).map(([key,value])=>[key,required.has(key)||value.type==='null'||value.anyOf?.some(s=>s.type==='null')?value:{anyOf:[value,{type:'null'}]}]));out.required=Object.keys(out.properties);out.additionalProperties=false;}
 return out;
}
export async function sendMetaResponse(fetcher,body,signal){
 if(!process.env.META_API_KEY)throw Error('Meta backend API key is missing');
 const {onProgress,onWireRequest,...request}=body;request.store=false;request.include=[...new Set([...(request.include||[]),'reasoning.encrypted_content'])];
 if(request.text?.format?.type==='json_schema')request.text={format:{...request.text.format,schema:metaStrictSchema(request.text.format.schema)}};
 if(onWireRequest)await onWireRequest({url:'https://api.meta.ai/v1/responses',method:'POST',headers:{'Content-Type':'application/json',Authorization:'[redacted]'},body:request});
 return fetcher('https://api.meta.ai/v1/responses',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+process.env.META_API_KEY},body:JSON.stringify(request),signal});
}
