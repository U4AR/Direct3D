// Find an axis in the actual screen-space hit region, then drag with a real mouse.
export async function dragHandle(page,mode){
 const p=await page.evaluate(mode=>{
  const {studio}=window.testWorkspace,canvas=studio.renderer.domElement,r=canvas.getBoundingClientRect();
  const v=studio.activePlacement.object.getWorldPosition(studio.camera.position.clone()).project(studio.camera);
  const cx=r.left+(1+v.x)*r.width/2,cy=r.top+(1-v.y)*r.height/2;
  for(let radius=35;radius<=145;radius+=5)for(let deg=5;deg<365;deg+=5){
   const a=deg*Math.PI/180,dx=Math.cos(a),dy=Math.sin(a),x=cx+radius*dx,y=cy+radius*dy;
   canvas.dispatchEvent(new PointerEvent('pointermove',{bubbles:true,clientX:x,clientY:y}));
   if(canvas.dataset.transformHandle?.startsWith(mode+'-'))return {x,y,endX:x+30*(mode==='rotate'?-dy:dx),endY:y+30*(mode==='rotate'?dx:dy)};
  }
  throw Error('No visible '+mode+' handle could be picked.');
 },mode);
 await page.mouse.move(p.x,p.y);await page.mouse.down();await page.mouse.move(p.endX,p.endY,{steps:8});await page.mouse.up();
}
