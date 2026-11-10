import {readProvider} from './provider-read.mjs';

export async function classifyInstruction(data,instruction,{apiKey,fetcher,signal,record,inkImage}){
 const contextualCorrection=(data.speechInputs?.length||0)>1;
 const body={model:'gpt-6-luna',input:[{role:'user',content:[{type:'input_text',text:JSON.stringify({
  workspace:'3D CAD with a sketch input device. A named physical part is built as a solid by default. Respect explicit requests for a 2D sketch.',
  currentInstruction:instruction,currentUserTurn:data.userBuildInstruction,previousWorkOnTheseFigures:data.previousWorkOnTargets||[],
  existingBodies:(data.partContext?.bodies||[]).map(b=>b.name)
 })}]}],questions:[{name:'deliverable',type:'choice',instructions:'Choose the output this user is asking this CAD application to make. Follow the whole current instruction, even if fragmented. A correction to the name of an object keeps the previous requested operation and scope. In speech plain and plane can mean an aircraft or a construction plane. Use the drawing and what the user is making: a main body or fuselage refers to a physical part. Face placement requires an intent to locate the sketch, such as on, parallel to, or offset from a face. A selected drawing plane alone does not express that intent. A short request to continue refers to the unfinished work on the target figures. A new specific instruction supersedes history. Finish an existing article with missing components using finish_body. When asked to rethink, replace, or ignore the drawing and design a fresh main shape choose redesign_body; merely smoothing a line is a sketch edit. If replacing the main shape and adding components are both requested, select redesign_body and retain the additions. The Create 3D button permits creation and edits and does not itself ask for a duplicate.',
 choices:[{value:'new_body',description:'Create an independent physical object from the guides.'},{value:'finish_body',description:'Finish the existing object, adding its missing components.'},{value:'redesign_body',description:'Author a new primary solid shape from the brief. The sketch gives position and scale; preserving its outline is optional.'},{value:'sketch',description:'Make or edit a planar drawing or sketch geometry.'},{value:'material_feature',description:'Change the material of a body already present.'},{value:'face_placement',description:'Choose a plane or face for drawing.'}]}]};
 body.questions.push({name:'local_features',type:'choice',instructions:'For a physical object, which material changes are requested at a particular marked location? Local means on one side, at a mark, or at an individual position. A feature that goes all the way around the axis belongs to the base silhouette. Use none for a planar drawing or when no local feature is requested.',choices:[
  {value:'none',description:'No localized solid feature.'},{value:'cut',description:'An individual notch, recess, hole or removal.'},{value:'join',description:'An individual boss, protrusion, handle, branch or material addition.'},{value:'both',description:'Both a local removal and a local addition are requested.'}]});
 if(data.creationMode==='instruction')body.questions.push({
  name:'solid_command',type:'choice',
  instructions:'Read currentUserTurn in its original language. Only that user turn can authorize building now. Related fragments of the same utterance may complete one command. A sketch, an object name, a description of future plans, a request to explain, a negation, or an ambiguous utterance waits. A direct instruction such as "Extrude", "make this a complete hollow cap", or "revolve this profile" authorizes action. CAD terms can be nouns: "draw a revolve profile" is a drawing. Use the latest correction. History and automatic workspace instructions only identify the referenced geometry.',
  choices:[{value:'wait',description:'No current request to execute a 3D operation.'},{value:'build',description:'Explicitly make or modify a physical solid now.'},{value:'extrude',description:'Explicitly extrude the drawn profile.'},{value:'revolve',description:'Explicitly revolve the drawn profile.'},{value:'hollow_revolve',description:'Revolve the supplied profile to make the requested hollow solid.'}]
 });
 if(contextualCorrection&&(inkImage||data.image))body.input[0].content.push({type:'input_image',image_url:inkImage||data.image,detail:'low'});
 await record('task-request',body);
 const deadline=AbortSignal.timeout(12000);
 const response=await readProvider(fetcher,'https://api.openai.com/v1/decisions',{method:'POST',headers:{Authorization:'Bearer '+apiKey,'Content-Type':'application/json'},body:JSON.stringify(body),signal:signal?AbortSignal.any([signal,deadline]):deadline},async r=>{
  if(!r.ok)throw Error('Task classification unavailable (HTTP '+r.status+')');
  return r.json();
 },{stage:'CAD task classification'});
 await record('task-response',response);
 const answer=response.answers?.find(a=>a.name==='deliverable'&&a.type==='choice');
 if(!body.questions[0].choices.some(c=>c.value===answer?.choice))throw Error('Task classification returned no recognized deliverable.');
 return {choice:answer.choice,solidCommand:response.answers.find(a=>a.name==='solid_command'&&a.type==='choice')?.choice,localFeatures:response.answers.find(a=>a.name==='local_features'&&a.type==='choice')?.choice,usage:response.usage};
}
