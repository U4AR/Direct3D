// Keeps the development route alive after USB reconnects or ADB restarts.
// Run with node scripts/quest-usb-bridge.mjs; Ctrl+C stops it. Never reloads tabs.
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import net from 'node:net';
import {pathToFileURL} from 'node:url';
const exec=promisify(execFile);
export async function restoreRoute(run,serial){
 const devices=await run(['devices']);
 if(!devices.split(/\r?\n/).some(line=>line.trim()===serial+'\tdevice'))return false;
 const routes=await run(['-s',serial,'reverse','--list']);
 if(!routes.split(/\r?\n/).some(line=>/\btcp:5173\s+tcp:5173\s*$/.test(line))){
  await run(['-s',serial,'reverse','tcp:5173','tcp:5173']);
  return true;
 }
 return false;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 const adb=process.env.DRAW3D_ADB_PATH||process.env.LOCALAPPDATA+'/Android/Sdk/platform-tools/adb.exe';
 const serial=process.env.DRAW3D_QUEST_SERIAL||'2G0YC5ZH7C0312';
 // Singleton, local-only lock. Another copy exits without spawning a poller.
 const lock=net.createServer(socket=>socket.end('Draw3D USB recovery\n'));
 lock.on('error',()=>process.exit(0));
 lock.listen(8791,'127.0.0.1',async()=>{
  while(true){
   try{if(await restoreRoute(async args=>(await exec(adb,args,{windowsHide:true,timeout:8000})).stdout,serial))console.log(new Date().toISOString(),'Quest app route restored');}
   catch(error){console.error('Quest route unavailable:',error.code||error.message);}
   await new Promise(resolve=>setTimeout(resolve,5000));
  }
 });
}
