import { MicVAD } from '@ricky0123/vad-web';
import {createFrameMic} from './level-vad.js';

export async function createMicVAD(callbacks={}){
 // Callers that let the upstream library own the AudioContext retain its API.
 if(!callbacks.audioContext)return MicVAD.new({model:'v5',baseAssetPath:'/vad/',onnxWASMBasePath:'/vad/',startOnLoad:false,ortConfig:ort=>{ort.env.wasm.numThreads=1;},...callbacks});
 const moduleURL='/vad/ort.wasm.min.mjs';
 const ort=await import(/* @vite-ignore */ moduleURL);
 ort.env.wasm.numThreads=1;ort.env.wasm.wasmPaths='/vad/';ort.env.logLevel='error';
 const session=await ort.InferenceSession.create('/vad/silero_vad_v5.onnx',{executionProviders:['wasm']});
 const rate=new ort.Tensor('int64',BigInt64Array.of(16000n),[1]);
 let state=new ort.Tensor('float32',new Float32Array(256),[2,1,128]);
 return createFrameMic(callbacks,async frame=>{
  const input=new ort.Tensor('float32',frame,[1,512]);
  try{
   const {stateN,output}=await session.run({input,sr:rate,state});
   state.dispose();state=stateN;
   try{return output.data[0];}finally{output.dispose();}
  }finally{input.dispose();}
 },{neural:true,release:async()=>{state.dispose();rate.dispose();await session.release();}});
}
