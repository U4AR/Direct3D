export function sketchTaskQuestion(data){
 if(!data.prompt?.trim())return null;
 const choices=[
  {value:'sketch',description:'The user wants a planar figure, a drawing of an object, or a change to sketch geometry itself. Drawing with the pen alone is not evidence for this choice.'},
  {value:'new_body',description:'The utterance identifies what the physical object is or describes its physical features while drawing it. The CAD workspace should build that part, even from one side view.'},
  {value:'face_placement',description:'Position a sketch on a plane or specific face.'}
 ];
 if(data.partContext?.bodies?.length)choices.push({value:'material_feature',description:'Add, remove or intersect material on a referenced existing body.'});
 return {name:'current_task',type:'choice',instructions:'What deliverable does the user want, considering all speech fragments and highlighted ink together? Imperfect transcription often omits the first verb. In the CAD workspace a request to turn a sketch into a physical object with features normally requests a new body. An explicit drawing, sketch-only, or cleanup request stays 2D. Use new_body when the user describes a physical article with design features in this CAD workspace and has not requested just its drawing. Semicircular, rounded, or rectangular may describe a physical object. A mention of those adjectives does not imply a sketch-only result. Read all updates as one utterance; do not classify just its final fragment.',choices};
}

// Separate what the person described from the representation they requested.
// The same circle can mean a planar circle, a rim, or the end of a pipe.
export const subjectQuestion={name:'instruction_subject',type:'choice',
 instructions:'Classify the subject described by the words, independently of the image modality and the other fitting questions. Is the user describing a physical article and its features, or just geometry?',
 choices:[{value:'part',description:'A real object or component and its shape/features.'},{value:'geometry',description:'Geometric elements, their dimensions, placement or constraints.'},{value:'unspecified',description:'No identifiable subject.'}]};
export const formQuestion={name:'requested_form',type:'choice',
 instructions:'Does the user explicitly ask for a planar drawing or a sketch edit, explicitly ask for solid modeling, or leave the output representation unstated? Using pen strokes as input does not specify an output format.',
 choices:[{value:'planar',description:'Draw a 2D picture/profile or edit the sketch itself.'},{value:'solid',description:'Explicitly build a body or perform a solid operation.'},{value:'unstated',description:'Describes the article or goal without specifying a representation.'}]};
export function sketchTask(fit){
 if(fit.instructionTask)return fit.instructionTask;
 const answer=name=>fit.decisions?.find(a=>a.name===name&&a.type!=='refusal')?.choice;
 const task=answer('current_task'),form=answer('requested_form');
 if(task==='face_placement')return task;
 if(form==='planar')return 'sketch';
 if(task==='material_feature')return task;
 if(form==='solid'||answer('instruction_subject')==='part'&&form==='unstated')return 'new_body';
 return task||null;
}

export function hasSolidConstruction(result){
 return !!result.solidEdits?.length||!!result.edits?.some(e=>e.extrusionMetres>0);
}

export function verifyRequestedOperation(command,plan,result,availableFigures=[]){
 if(plan.question)return;
 const solids=result.solidEdits||[];
 if(command==='extrude'){
  if(!solids.some(s=>['extrude','pocket','join-material','common-material'].includes(s.kind))&&!result.edits.some(e=>e.extrusionMetres>0))throw Error('Use the explicitly requested extrusion.');
  return;
 }
 if(!['revolve','hollow_revolve'].includes(command))return;
 if(plan.bodyDesign)throw Error('Use the supplied profile for this revolution. Its shape and placement are the reference.');
 const revolutions=solids.filter(s=>s.kind==='revolve');
 if(!revolutions.length)throw Error('Revolve the requested profile around its axis.');
 if(command==='hollow_revolve'&&!revolutions.some(s=>s.revolution?.wallThicknessMetres>0||s.profiles.some(p=>{
  const index=/^new-edit:(\d+)$/.exec(p.figureId);
  const section=index?result.edits[Number(index[1])]:result.edits.find(e=>e.figureId===p.figureId)||availableFigures.find(f=>f.id===p.figureId);
  return section?.closed;
 })))throw Error('Build the open meridian with a positive wall thickness or a closed wall section.');
}

export function verifySketchDeliverable(task,result,localFeatures){
 if(result.refinement?.question)return;
 if((task==='sketch'||task==='face_placement')&&hasSolidConstruction(result))
  throw Error('The requested output is planar. Return only the sketch or its placement, without building or changing a body.');
 const createsBody=result.edits?.some(e=>e.extrusionMetres>0)||result.solidEdits?.some(s=>['extrude','revolve','loft','intersect','union','subtract'].includes(s.kind));
 if(task==='finish_body'&&!hasSolidConstruction(result))throw Error('Finish the existing object with a solid feature or the missing bodies.');
 if(task==='redesign_body'&&(!createsBody||!result.results?.some(r=>r.metrics?.modelCreated)))throw Error('Author a new main shape with bodyDesign or a newly authored section. Smoothing the input or adding features only to the old body does not fulfill this redesign.');
 if(task==='new_body'&&!createsBody){
  throw Error('The requested deliverable is a new CAD body. No independent body is constructed. Construct an editable solid from the supplied profiles and preserve the indicated local features.');
 }
 const kinds=new Set(result.solidEdits?.map(s=>s.kind));
 if(kinds.has('revolve')&&(task==='new_body'||task==='material_feature')){
  if(['cut','both'].includes(localFeatures)&&!kinds.has('pocket')&&!kinds.has('subtract'))
   throw Error('A full revolution carries its silhouette around the entire axis. The localized removal still requires a pocket using the corresponding guide. Return the base and all local additions and removals together.');
  if(['join','both'].includes(localFeatures)&&!kinds.has('join-material')&&!kinds.has('union'))
   throw Error('The localized addition requires a join targeting the revolved body. Preserve the other requested features.');
 }
 if(task==='material_feature'&&!result.solidEdits?.some(s=>['join-material','pocket','common-material'].includes(s.kind)&&s.targetBodyId&&!s.targetBodyId.startsWith('feature-result:'))){
  throw Error('The requested deliverable is a material edit to an existing body. Supply a feature targeting that body. A separate sketch or tool solid does not modify it.');
 }
}
