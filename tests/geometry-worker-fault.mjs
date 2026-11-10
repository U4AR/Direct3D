export function injectGeometryMemoryFault(failures){
  if(!location.pathname.startsWith('/cad/'))return;
  const NativeWorker=window.Worker;window.memoryTest={faults:0,workers:0};
  window.Worker=class extends NativeWorker{
   constructor(url,options){super(url,options);this.cad=String(url).includes('geometryWorker');if(this.cad)window.memoryTest.workers++;}
   postMessage(msg,...rest){
    const doc=msg.document;
    if(this.cad&&msg.type==='sync'&&doc&&Object.values(doc.nodes||{}).some(n=>n.kind==='body')&&window.memoryTest.faults<failures){
     window.memoryTest.faults++;
     queueMicrotask(()=>{
      const failure={error:'out of memory',projectId:doc.projectId,version:doc.version};
      this.dispatchEvent(new MessageEvent('message',{data:{type:'sync',ok:false,...failure}}));
      this.dispatchEvent(new MessageEvent('message',{data:{type:'state',phase:'failed',stale:true,...failure,
       kernelMemoryDiagnostic:{kernelState:'failed',operation:'sync',bodyCount:doc.bodyOrder.length,featureCount:doc.featureOrder.length,allocatedWasmBytes:null}}}));
     });
     return;
    }
    super.postMessage(msg,...rest);
   }
  };
}
