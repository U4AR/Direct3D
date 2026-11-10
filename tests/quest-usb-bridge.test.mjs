import test from 'node:test';
import assert from 'node:assert/strict';
import {restoreRoute} from '../scripts/quest-usb-bridge.mjs';
test('restore only missing app route for authorized connected headset',async()=>{
 let routes='',calls=[];
 const run=async args=>{calls.push(args);return args[0]==='devices'?'List of devices attached\nquest\tdevice\n':args.at(-1)==='--list'?routes:'';};
 assert.equal(await restoreRoute(run,'quest'),true);
 assert.deepEqual(calls.at(-1),['-s','quest','reverse','tcp:5173','tcp:5173']);
 routes='UsbFfs tcp:5173 tcp:5173\n';calls=[];
 assert.equal(await restoreRoute(run,'quest'),false);assert.equal(calls.length,2);
 calls=[];assert.equal(await restoreRoute(run,'different'),false);assert.equal(calls.length,1);
 assert.equal(await restoreRoute(async()=> 'quest\tunauthorized','quest'),false);
});
