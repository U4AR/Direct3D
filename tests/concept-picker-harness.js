import * as T from 'three';import {initConceptPicker} from '../src/concept-picker.js';
const canvas=document.createElement('canvas');canvas.width=32;canvas.height=32;canvas.getContext('2d').fillRect(0,0,32,32);const image=canvas.toDataURL('image/jpeg');
let job={id:'concept-test',status:'awaiting_selection',prompt:'test',selected:null,candidates:[0,1,2].map(id=>({id,label:'Concept '+(id+1),status:'ready',image})),events:[{message:'Select one of three concepts'}]};
window.testCalls=[];window.testStore={session:{},asset:async()=>{},flush:async()=>{}};
const studio={scene:new T.Scene(),renderer:{xr:{isPresenting:true}},modelAgentEvidence:async()=>({strokes:[{id:'synthetic'}]})};
window.testPicker=initConceptPicker({studio,store:testStore,request:async(route,data)=>{testCalls.push(route);if(route==='concept-generate')job={...job,selected:null};if(route==='concept-select')job={...job,selected:data.candidateId};if(route==='concept-confirm')job={...job,status:'confirmed',confirmedAt:Date.now()};return {concept:job};}});
