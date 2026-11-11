import test from 'node:test';import assert from 'node:assert/strict';import {createNativeModelEngine} from '../scripts/native-model-engine.mjs';
test('concurrent native health checks share startup and a timed-out process can restart',async()=>{
 const old=process.env.DRAW3D_NATIVE_STARTUP_MS;process.env.DRAW3D_NATIVE_STARTUP_MS='1000';let calls=0,delay=1500;
 const engine=createNativeModelEngine({key:'fixture',name:'Fixture',executable:()=>process.execPath,argumentsForWorker:()=>{calls++;return ['-e',`setTimeout(()=>{console.log('DRAW3D_READY '+JSON.stringify({version:'fixture'}));setInterval(()=>{},1000)},${delay})`];},worker:'unused',operations:[],formats:{}});
 try{const [a,b]=await Promise.all([engine.health(),engine.health()]);assert.equal(a.ready,false);assert.equal(b.ready,false);assert.equal(calls,1);delay=0;const next=await engine.health();assert.equal(next.ready,true);assert.equal(next.version,'fixture');assert.equal(calls,2);}
 finally{engine.close();if(old===undefined)delete process.env.DRAW3D_NATIVE_STARTUP_MS;else process.env.DRAW3D_NATIVE_STARTUP_MS=old;}
});
