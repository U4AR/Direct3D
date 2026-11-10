import {inflateSync,deflateSync} from 'node:zlib';
import {sampleDraftSegment} from '../src/desktop-measured-draft.js';
const crcTable=Array.from({length:256},(_,i)=>{let c=i;for(let k=0;k<8;k++)c=c&1?0xedb88320^(c>>>1):c>>>1;return c>>>0;});
const crc=b=>{let c=0xffffffff;for(const v of b)c=crcTable[(c^v)&255]^(c>>>8);return (c^0xffffffff)>>>0;};
function chunk(type,data){const name=Buffer.from(type),out=Buffer.alloc(data.length+12);out.writeUInt32BE(data.length);name.copy(out,4);data.copy(out,8);out.writeUInt32BE(crc(Buffer.concat([name,data])),data.length+8);return out;}
function png(width,height,pixels){const head=Buffer.alloc(13);head.writeUInt32BE(width);head.writeUInt32BE(height,4);head[8]=8;head[9]=6;const rows=Buffer.alloc(height*(width*4+1));for(let y=0;y<height;y++)pixels.copy(rows,y*(width*4+1)+1,y*width*4,(y+1)*width*4);return 'data:image/png;base64,'+Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',head),chunk('IDAT',deflateSync(rows,{level:3})),chunk('IEND',Buffer.alloc(0))]).toString('base64');}
function decode(image){const b=Buffer.from(image.split(',')[1],'base64'),parts=[];let width,height,bpp;for(let p=8;p<b.length;){const n=b.readUInt32BE(p),type=b.toString('ascii',p+4,p+8),data=b.subarray(p+8,p+8+n);if(type==='IHDR'){width=data.readUInt32BE(0);height=data.readUInt32BE(4);if(data[8]!==8||![2,6].includes(data[9])||data[12]||width*height>4e6)throw Error('Unsupported crop image');bpp=data[9]===6?4:3;}if(type==='IDAT')parts.push(data);p+=n+12;}
 const raw=inflateSync(Buffer.concat(parts),{maxOutputLength:20e6}),stride=width*bpp,bytes=Buffer.alloc(stride*height),paeth=(a,b,c)=>{const p=a+b-c,aa=Math.abs(p-a),bb=Math.abs(p-b),cc=Math.abs(p-c);return aa<=bb&&aa<=cc?a:bb<=cc?b:c;};
 for(let y=0;y<height;y++){const filter=raw[y*(stride+1)];for(let x=0;x<stride;x++){const i=y*stride+x,a=x>=bpp?bytes[i-bpp]:0,b=y?bytes[i-stride]:0,c=y&&x>=bpp?bytes[i-stride-bpp]:0,predict=[0,a,b,Math.floor((a+b)/2),paeth(a,b,c)][filter];if(predict===undefined)throw Error('Unsupported PNG filter');bytes[i]=(raw[y*(stride+1)+1+x]+predict)&255;}}
 return {width,height,bpp,bytes};
}
export function cropInkFrame(frame){try{
 const {width,height,bpp,bytes}=decode(frame.image),background=[...bytes.subarray(0,3)];let left=width,top=height,right=0,bottom=0;
 for(let y=0;y<height;y++)for(let x=0;x<width;x++){const i=(y*width+x)*bpp;if(bpp===4&&bytes[i+3]<32)continue;if([0,1,2].some(k=>Math.abs(bytes[i+k]-background[k])>25)){left=Math.min(left,x);right=Math.max(right,x);top=Math.min(top,y);bottom=Math.max(bottom,y);}}
 if(left>=right||top>=bottom)return frame;
 const pad=Math.max(12,Math.ceil(Math.max(right-left,bottom-top)*.12));left=Math.max(0,left-pad);top=Math.max(0,top-pad);right=Math.min(width-1,right+pad);bottom=Math.min(height-1,bottom+pad);
 const w=right-left+1,h=bottom-top+1,scale=Math.max(1,Math.min(4,Math.floor(640/Math.max(w,h)))),out=Buffer.alloc(w*h*scale*scale*4);
 for(let y=0;y<h*scale;y++)for(let x=0;x<w*scale;x++){const from=((top+Math.floor(y/scale))*width+left+Math.floor(x/scale))*bpp,to=(y*w*scale+x)*4;for(let k=0;k<3;k++)out[to+k]=bytes[from+k];out[to+3]=bpp===4?bytes[from+3]:255;}
 return {id:'crop-'+frame.id,layer:'stroke-detail',strokeIds:frame.strokeIds,image:png(w*scale,h*scale,out),imageReference:{sourceFrameId:frame.id,sourceImageSize:[width,height],cropRectangle:[left,top,w,h],pixelToOriginal:[1/scale,0,left,0,1/scale,top,0,0,1],sourceImageReference:frame.imageReference?{imageSize:frame.imageReference.imageSize,worldOrigin:frame.imageReference.worldOrigin,sketchPlane:frame.imageReference.sketchPlane?{id:frame.imageReference.sketchPlane.id,origin:frame.imageReference.sketchPlane.origin,xAxis:frame.imageReference.sketchPlane.xAxis,yAxis:frame.imageReference.sketchPlane.yAxis,planeToImage:frame.imageReference.sketchPlane.planeToImage,imageToPlane:frame.imageReference.sketchPlane.imageToPlane}:undefined}:undefined,note:'Enlarged original ink, unchanged geometry. Map crop pixels through pixelToOriginal before using the original calibration.'}};
 }catch{return frame;}}
const font={0:['111','101','101','101','111'],1:['010','110','010','010','111'],2:['111','001','111','100','111'],3:['111','001','111','001','111'],4:['101','101','111','001','001'],5:['111','100','111','001','111'],6:['111','100','111','101','111'],7:['111','001','010','010','010'],8:['111','101','111','101','111'],9:['111','101','111','001','111'],p:['110','101','110','100','100'],e:['111','100','110','100','111']};
export function measuredDraftFrame(path,draftId){
 const width=800,height=600,pixels=Buffer.alloc(width*height*4),background=[15,23,32,255];for(let i=0;i<pixels.length;i+=4)pixels.set(background,i);
 const size=path.bounds.max.map((v,k)=>v-path.bounds.min[k]),scale=Math.min(650/(size[0]||.001),450/(size[1]||.001)),center=path.bounds.min.map((v,k)=>(v+path.bounds.max[k])/2),project=p=>[width/2+(p[0]-center[0])*scale,height/2-(p[1]-center[1])*scale];
 const dot=(x,y,color,r=1)=>{for(let dy=-r;dy<=r;dy++)for(let dx=-r;dx<=r;dx++){const xx=Math.round(x+dx),yy=Math.round(y+dy);if(xx>=0&&yy>=0&&xx<width&&yy<height)pixels.set(color,(yy*width+xx)*4);}};
 const line=(a,b,color,r=1)=>{const n=Math.max(1,Math.ceil(Math.hypot(b[0]-a[0],b[1]-a[1])));for(let i=0;i<=n;i++)dot(a[0]+(b[0]-a[0])*i/n,a[1]+(b[1]-a[1])*i/n,color,r);};
 const draw=(points,color,r)=>{const p=points.map(project);for(let i=1;i<p.length;i++)line(p[i-1],p[i],color,r);};
 draw(path.source,[130,140,154,255],2);for(const s of path.segments)draw(sampleDraftSegment(s),[70,215,235,255],0);
 const occupied=[];
 for(const s of path.segments){const sampled=sampleDraftSegment(s),mid=project(sampled[Math.floor(sampled.length/2)]),label=s.id,w=label.length*8+8,h=18;let box;
  for(const [dx,dy]of [[10,-24],[10,8],[-w-8,-24],[-w-8,8],[12,-50],[-w-12,30]]){const candidate=[Math.round(mid[0]+dx),Math.round(mid[1]+dy),w,h];if(candidate[0]<0||candidate[1]<0||candidate[0]+w>=width||candidate[1]+h>=height)continue;if(!occupied.some(b=>candidate[0]<b[0]+b[2]+3&&candidate[0]+w+3>b[0]&&candidate[1]<b[1]+b[3]+3&&candidate[1]+h+3>b[1])){box=candidate;break;}}
  if(!box)continue;occupied.push(box);line(mid,[box[0]+w/2,box[1]+h/2],[105,120,130,255],0);for(let y=box[1];y<box[1]+h;y++)for(let x=box[0];x<box[0]+w;x++)dot(x,y,[32,43,55,255],0);
  for(let i=0;i<label.length;i++)for(let y=0;y<5;y++)for(let x=0;x<3;x++)if(font[label[i]]?.[y]?.[x]==='1')dot(box[0]+5+i*8+x*2,box[1]+4+y*2,[255,209,115,255],1);
 }
 return {id:'measured-'+path.id,layer:'measured-draft',strokeIds:[path.strokeId],image:png(width,height,pixels),imageReference:{draftId,pathId:path.id,plane:path.frame,units:'metres',uvToImage:[scale,0,width/2-center[0]*scale,0,-scale,height/2+center[1]*scale,0,0,1],legend:'Plane-aligned measured draft. Grey = original ink, cyan = harness fit, labels = stable segment IDs. These labels are callable; request local changes by ID, do not regenerate coordinates.'}};
}
