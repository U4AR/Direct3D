// Lossless factoring of repeated schema nodes. OpenAI Structured Outputs supports $defs/$ref.
// No operations, required fields, bounds or enum values are removed.
const cache=new Map();
export function compactResponseSchema(schema){
 if(!schema||schema.$defs)return structuredClone(schema);const serialized=JSON.stringify(schema);if(serialized.length<50000)return structuredClone(schema);if(cache.has(serialized))return structuredClone(cache.get(serialized));
 const counts=new Map(),schemaNode=v=>v&&typeof v==='object'&&!Array.isArray(v)&&!v.$ref&&(typeof v.type==='string'||Array.isArray(v.type)||Array.isArray(v.anyOf)||Array.isArray(v.oneOf));
 const maps=new Set(['properties','patternProperties','$defs','definitions']),singles=new Set(['items','additionalProperties','not','contains','propertyNames','if','then','else','unevaluatedProperties']),lists=new Set(['anyOf','oneOf','allOf','prefixItems']);
 function children(v,fn){return Object.fromEntries(Object.entries(v).map(([k,x])=>[k,maps.has(k)&&x&&typeof x==='object'?Object.fromEntries(Object.entries(x).map(([n,c])=>[n,fn(c)])):singles.has(k)&&x&&typeof x==='object'?fn(x):lists.has(k)&&Array.isArray(x)?x.map(fn):structuredClone(x)]));}
 function count(v,root=false){if(!v||typeof v!=='object')return;if(!root&&schemaNode(v)){const key=JSON.stringify(v);if(key.length>=50){counts.set(key,(counts.get(key)||0)+1);}}children(v,x=>{count(x);return x;});}
 count(schema,true);const names=new Map(),defs={};let serial=0;
 function rewrite(v,root=false){if(!v||typeof v!=='object')return v;if(Array.isArray(v))return v.map(x=>rewrite(x));const key=!root&&schemaNode(v)?JSON.stringify(v):null;if(key&&counts.get(key)>1){if(!names.has(key)){const name='s'+(++serial);names.set(key,name);defs[name]=rewrite(v,true);}return {$ref:'#/$defs/'+names.get(key)};}return children(v,x=>rewrite(x));}
 let result=rewrite(schema,true);if(!Object.keys(defs).length)return result;result.$defs=defs;
 // Parent factoring can leave a child referenced only once. Inline it again.
 for(let pass=0;pass<100;pass++){const uses={};function tally(v){if(!v||typeof v!=='object')return;if(v.$ref?.startsWith('#/$defs/'))uses[v.$ref.slice(8)]=(uses[v.$ref.slice(8)]||0)+1;children(v,x=>{tally(x);return x;});}tally(result);const single=Object.keys(result.$defs).find(k=>(uses[k]||0)<=1);if(!single)break;const value=result.$defs[single];delete result.$defs[single];function inline(v){if(!v||typeof v!=='object')return v;if(v.$ref==='#/$defs/'+single)return structuredClone(value);if(Array.isArray(v))return v.map(inline);return children(v,inline);}result=inline(result);}
 const best=JSON.stringify(result).length<serialized.length?result:structuredClone(schema);cache.set(serialized,best);while(cache.size>8)cache.delete(cache.keys().next().value);return structuredClone(best);
}
export function expandResponseSchema(schema){const defs=schema.$defs||{};function expand(v,stack=[]){if(!v||typeof v!=='object')return v;if(Array.isArray(v))return v.map(x=>expand(x,stack));if(v.$ref?.startsWith('#/$defs/')){const key=v.$ref.slice(8);if(!defs[key]||stack.includes(key))throw Error('Invalid or circular compact schema reference');return expand(defs[key],[...stack,key]);}return Object.fromEntries(Object.entries(v).filter(([k])=>k!=='$defs').map(([k,x])=>[k,expand(x,stack)]));}return expand(schema);}
