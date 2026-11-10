import {deflateSync} from 'node:zlib';
import {bounds} from '../src/decision-sketch/math.js';
const crc=buffer=>{let c=0xffffffff;for(const b of buffer){c^=b;for(let k=0;k<8;k++)c=(c>>>1)^((c&1)?0xedb88320:0);}return (c^0xffffffff)>>>0;};
function chunk(type,data){const t=Buffer.from(type),out=Buffer.alloc(data.length+12);out.writeUInt32BE(data.length);t.copy(out,4);data.copy(out,8);out.writeUInt32BE(crc(Buffer.concat([t,data])),out.length-4);return out;}
// A clean plane-space rendering avoids tiny ink hidden among perspective grids.
// Raw coordinates remain authoritative. Each panel's pixel-to-UV map is supplied.
export function renderDecisionInk(groups){
 const cell=320,cols=Math.min(4,groups.length),rows=Math.ceil(groups.length/cols),width=cols*cell,height=rows*cell,pixels=Buffer.alloc(width*height*3,255),panels=[];
 function dot(x,y,color,r=1){for(let a=-r;a<=r;a++)for(let b=-r;b<=r;b++){const xx=Math.round(x)+a,yy=Math.round(y)+b;if(xx<0||xx>=width||yy<0||yy>=height)continue;const i=(yy*width+xx)*3;for(let k=0;k<3;k++)pixels[i+k]=color[k];}}
 function line(a,b,color,r){const n=Math.max(1,Math.ceil(Math.hypot(b[0]-a[0],b[1]-a[1])));for(let i=0;i<=n;i++)dot(a[0]+(b[0]-a[0])*i/n,a[1]+(b[1]-a[1])*i/n,color,r);}
 groups.forEach((g,i)=>{const b=bounds(g.points),scale=(cell-48)/Math.max(1e-9,b.max[0]-b.min[0],b.max[1]-b.min[1]),x=(i%cols)*cell,y=Math.floor(i/cols)*cell,toPixel=p=>[x+cell/2+(p[0]-b.center[0])*scale,y+cell/2-(p[1]-b.center[1])*scale];
  panels.push({groupId:g.id,pixelRect:[x,y,cell,cell],centerUV:b.center,pixelsPerMetre:scale,convention:'Top left origin; +U right, +V up. Panels ordered row-major.'});
  line([x,y],[x+cell-1,y],[210,215,220],0);line([x,y],[x,y+cell-1],[210,215,220],0);
  for(const stroke of g.strokes)for(let j=1;j<stroke.uv.length;j++)line(toPixel(stroke.uv[j-1]),toPixel(stroke.uv[j]),stroke.color||[22,34,48],stroke.context?0:1);
 });
 const scan=Buffer.alloc((width*3+1)*height);for(let y=0;y<height;y++)pixels.copy(scan,y*(width*3+1)+1,y*width*3,(y+1)*width*3);
 const ihdr=Buffer.alloc(13);ihdr.writeUInt32BE(width,0);ihdr.writeUInt32BE(height,4);ihdr[8]=8;ihdr[9]=2;
 return {image:'data:image/png;base64,'+Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',ihdr),chunk('IDAT',deflateSync(scan)),chunk('IEND',Buffer.alloc(0))]).toString('base64'),panels};
}
