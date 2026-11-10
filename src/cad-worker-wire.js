// The native editor uses typed arrays for mesh buffers and STEP bytes. Plain
// JSON turns them into objects and can silently discard a valid worker result.
const types={Uint8Array,Uint8ClampedArray,Uint16Array,Uint32Array,Int8Array,Int16Array,Int32Array,Float32Array,Float64Array};
function base64(bytes){
 let text='';
 for(let i=0;i<bytes.length;i+=8192)text+=String.fromCharCode(...bytes.subarray(i,i+8192));
 return btoa(text);
}
export function encodeCadMessage(message){
 return JSON.parse(JSON.stringify(message,(_,value)=>{
  if(ArrayBuffer.isView(value)&&Object.hasOwn(types,value.constructor.name))return {__cadBuffer:value.constructor.name,bytes:base64(new Uint8Array(value.buffer,value.byteOffset,value.byteLength))};
  if(value instanceof ArrayBuffer)return {__cadBuffer:'ArrayBuffer',bytes:base64(new Uint8Array(value))};
  return value;
 }));
}
export function decodeCadMessage(message){
 return JSON.parse(JSON.stringify(message),(_,v)=>{
  if(!v||typeof v!=='object'||!Object.hasOwn(v,'__cadBuffer'))return v;
  if(v.__cadBuffer!=='ArrayBuffer'&&!Object.hasOwn(types,v.__cadBuffer))throw Error('Unknown CAD buffer');
  const bytes=Uint8Array.from(atob(v.bytes),c=>c.charCodeAt(0));
  return v.__cadBuffer==='ArrayBuffer'?bytes.buffer:new types[v.__cadBuffer](bytes.buffer);
 });
}
