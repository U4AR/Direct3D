import {validateBlenderParameters} from '../src/blender-contract.js';
export const NATIVE_RECOVERY_LIMIT=3;
const stable=value=>JSON.stringify(value,(_,v)=>v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.keys(v).sort().map(k=>[k,v[k]])):v);
export const nativeEditSignature=e=>stable({engine:e.engine,operation:e.operation,modelId:e.modelId,expectedVersion:e.expectedVersion,tools:e.tools,collaborationValidation:e.collaborationValidation||null,parameters:{...e.parameters,...(e.parameters?.edgeIndices?{edgeIndices:[...e.parameters.edgeIndices].sort((a,b)=>a-b)}:{})}});
// Only a confirmed, atomic native rejection can be corrected automatically. A lost
// connection may have executed the job and must never cause a blind duplicate.
export function nativeApplicationRecovery(run,data){
 const edit=run.edit?.modelEdits?.[0],failure=data.applicationFailure;
 if(!data.error||data.stopForUserInput||data.appliedCount||data.review||run.edit?.modelEdits?.length!==1||run.edit.edits?.length||run.edit.solidEdits?.length||failure?.kind!=='native_rejection'||failure.unchanged!==true||failure.engine!==edit?.engine||failure.operation!==edit.operation||failure.modelId!==edit.modelId||failure.modelVersion!==edit.expectedVersion)return null;
 try{validateBlenderParameters(edit.operation,failure.parameters);}catch{return null;}
 const attemptedEdit={...structuredClone(edit),parameters:structuredClone(failure.parameters)};
 run.nativeRejections??=[];run.nativeRejections.push(nativeEditSignature(edit),nativeEditSignature(attemptedEdit));
 if((run.nativeRecoveryCount||0)>=NATIVE_RECOVERY_LIMIT)return null;
 run.nativeRecoveryCount=(run.nativeRecoveryCount||0)+1;
 return {kind:'native_operation_feedback',attempt:run.nativeRecoveryCount,maxAttempts:NATIVE_RECOVERY_LIMIT,error:String(data.error).slice(0,2000),attemptedEdit,unchanged:true,appliedCount:0,instruction:'Inspect fresh current images, native bounds, edge/face geometry and the rejected parameters. Correct the operation within the original user intent. Do not repeat the rejected operation unchanged. Preserve explicit dimensions and selected scope; ask a focused question according to supervision if the correction requires a different design choice. A failed step is not completed.'};
}
export function rejectRepeatedNativeOperation(edit,run){for(const e of edit.modelEdits||[])if(run.nativeRejections?.includes(nativeEditSignature(e)))throw Error('This exact native operation was already rejected by the CAD engine. Change the cause using current geometry and failure feedback, or ask the user; do not repeat it unchanged.');}

export function cadApplicationRecovery(run,data){
 if(!data.error||data.stopForUserInput||data.appliedCount||data.review||data.applicationFailure?.kind!=='cad_rejection'||data.applicationFailure.unchanged!==true||run.edit?.modelEdits?.length||!(run.edit?.edits?.length||run.edit?.solidEdits?.length)||(run.nativeRecoveryCount||0)>=NATIVE_RECOVERY_LIMIT)return null;
 run.nativeRecoveryCount=(run.nativeRecoveryCount||0)+1;
 return {kind:'cad_operation_feedback',attempt:run.nativeRecoveryCount,maxAttempts:NATIVE_RECOVERY_LIMIT,error:String(data.error).slice(0,2000),attemptedEdit:structuredClone(run.edit),unchanged:true,appliedCount:0,instruction:'The rejected sketch/solid step was rolled back; earlier successful work remains. Inspect current curve geometry and the exact diagnostics, correct the cause and continue the original goal. For a self-intersecting profile, regularize the existing curve with bounded smooth joins before retrying extrusion, or use a valid native construction with the same intended outline. For representation changes use an appropriate editable construction. Do not repeat the same failed parameters or report this failed step complete. Ask only for genuinely indispensable design information.'};
}

export function contextApplicationRecovery(run,data){
 if(!data.error||data.stopForUserInput||data.appliedCount||data.review||data.applicationFailure?.kind!=='context_changed'||data.applicationFailure.unchanged!==true)return null;
 return {kind:'context_changed',reason:String(data.applicationFailure.reason||'drawing or model').slice(0,200),appliedCount:0,unchanged:true,instruction:'The stale proposal was not applied. Continue the original user request using the newly captured drawing, current geometry and versions. Do not repeat already successful edits. New drawing input is normal, not a CAD failure.'};
}
