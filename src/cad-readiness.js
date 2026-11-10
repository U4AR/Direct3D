export function isCadDocument(frame){try{return !!frame.getAttribute('src')&&frame.contentWindow?.location.pathname==='/cad/index.html';}catch{return false;}}
export async function waitForCadEditor(frame,{timeoutMs=180000,onProgress=()=>{},pause=()=>new Promise(resolve=>setTimeout(resolve,100))}={}){
 const deadline=Date.now()+timeoutMs;
 for(;;){
  const loaded=isCadDocument(frame),editor=loaded?frame.contentWindow?.__draw3dCAD:null,restoring=loaded&&frame.contentDocument?.querySelector('[aria-label="Restoring workspace"]');
  if(editor&&!restoring)return editor;
  onProgress(restoring?'Restoring your CAD workspace…':'Loading CAD editor and geometry tools. The first visit can take longer…');
  if(Date.now()>=deadline)throw Error('CAD is taking longer than expected. Check your connection, then choose Retry CAD. Your saved work is kept.');
  await pause();
 }
}
