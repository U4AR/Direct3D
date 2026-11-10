import './server-secrets.mjs';
import http from 'node:http';import {handleBlender,blenderHealth,closeBlender} from './blender-bridge.mjs';import {handleFreeCAD,freecadHealth,closeFreeCAD} from './freecad-bridge.mjs';
const engine=process.env.MODELING_ENGINE;if(!['blender','freecad'].includes(engine))throw Error('Set MODELING_ENGINE=blender or freecad');
const handle=engine==='blender'?handleBlender:handleFreeCAD,health=engine==='blender'?blenderHealth:freecadHealth;
const server=http.createServer(async(req,res)=>{if(process.env.MODELING_SERVICE_TOKEN&&req.headers['x-modeling-token']!==process.env.MODELING_SERVICE_TOKEN){res.writeHead(401);res.end('Unauthorized');return;}if(!await handle(req,res)){res.writeHead(404);res.end('Not found');}});
server.listen(Number(process.env.PORT||8790),'0.0.0.0',()=>console.log(engine+' worker listening on '+server.address().port));
void health().then(h=>console.log(engine+' '+(h.ready?h.version+' ready':h.error)));
for(const event of ['SIGINT','SIGTERM'])process.on(event,()=>{closeBlender();closeFreeCAD();server.close(()=>process.exit());});
