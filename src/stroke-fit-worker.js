import {fitLiveShape} from './live-shape-fitting.js';
import {regularizeStroke} from './stroke-regularization.js';
import {fitStroke} from './stroke-fitting.js';
import {fitSpatialSketch} from './spatial-fitting.js';
self.onmessage=({data:{id,task,points,strokes,options}})=>{try{if(task==='live'){self.postMessage({id,result:fitLiveShape(strokes,options)});return;}const result=task==='spatial'?fitSpatialSketch(strokes,options):fitStroke(points,options);if(task!=='spatial')result.regularization=regularizeStroke(points,{...options,localFit:result});self.postMessage({id,result});}catch(e){self.postMessage({id,error:e.message});}};
