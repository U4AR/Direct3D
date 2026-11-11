import {serverCadJob} from './cad-server-jobs.mjs';
import {cloudVertexReady} from './vertex-cloud.mjs';
import {saveActivity,recentActivity} from './session-activity.mjs';
import {classifySketchSpeech} from './sketch-speech-intent.mjs';
import {runExistingSketchEdit} from './existing-sketch-edit.mjs';
import {pickImageSurface} from '../src/image-surface-pick.js';
import {runSketchRefinement} from './sketch-refinement.mjs';
import {runSketchDecisions,decisionInputHash} from './decision-sketch-api.mjs';
import {recoverableConnectionError} from '../src/request-recovery.js';
import {saveTaskBenchmark,exportTaskBenchmark} from './harness-benchmark.mjs';
import {inspectRuns,inspectRun} from './model-inspector.mjs';
import {CONCEPT_MODE,conceptWorkflow,transcribeConceptAudio} from './concept-workflow.mjs';
import {nativeApplicationRecovery,contextApplicationRecovery,cadApplicationRecovery} from './native-recovery.mjs';
import {withDesktopContext,recordContextApplication,recordContextClarification} from './desktop-context.mjs';
import {runDesktopEdit,validateDesktopEvidence,directEvent} from './desktop-edit.mjs';
import {appendActivity} from './agent-events.mjs';
import {
  agentModel,
  agentReasoning,
  agentReady,
  runModelAgent,
  safeError,
} from "./model-agent.mjs";
import { answerAgentQuestion, askDirectQuestion, directContinuation, createPausableDeadline, runInFlight } from "./agent-questions.mjs";
import { randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { mkdir, readFile, writeFile, appendFile } from "node:fs/promises";
import path from "node:path";
export const tokenFile =
  process.env.DRAW3D_AGENT_TOKEN_FILE || path.resolve(process.env.SESSION_DIR||'sessions','private','agent-token');
let master;
async function token() {
  if (master) return master;
  await mkdir(path.dirname(tokenFile), { recursive: true });
  try {
    master = (await readFile(tokenFile, "utf8")).trim();
  } catch (e) {
    if (e.code !== "ENOENT") throw e;
    const value = randomBytes(32).toString("hex");
    try {
      await writeFile(tokenFile, value, { flag: "wx", mode: 0o600 });
    } catch (e) {
      if (e.code !== "EEXIST") throw e;
    }
    master = (await readFile(tokenFile, "utf8")).trim();
  }
  return master;
}
await token();
const sessions = new Map(),
  jobs = new Map();
const equal = (a, b) =>
  typeof a === "string" && a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));
const send = (res, status, data) => {
  res.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" });
  res.end(JSON.stringify(data));
};
async function body(req) {
  let text = "";
  for await (const c of req) {
    text += c;
    if (text.length > 24 * 1024 * 1024) throw Error("Agent payload exceeds 24 MB");
  }
  return text ? JSON.parse(text) : {};
}
const alive = (s) => Date.now() - s.seen < 20000;
const runs = new Map();
const publicRun = (r) =>
  r
    ? {
        id: r.id,
        mode:r.mode,contextRebase:r.contextRebasePending,nativeRecovery:r.nativeRecoveryPending,nativeRecoveryCount:r.nativeRecoveryCount,supervision:r.supervision,providerCallCount:r.providerCallCount,automation:r.automation,contextStats:r.contextStats,
        model: r.model,
        reasoning: r.reasoning,
        providerDurationMs: r.providerDurationMs,
        state: r.state,
        step: r.step,
        activity: r.activity,
        answer: r.answer,
        error: r.error,
        events: r.events.slice(-200),
        startedAt:r.startedAt,updatedAt:r.updatedAt,finishedAt:r.finishedAt,moveStartedAt:r.moveStartedAt,firstOutputMs:r.firstOutputMs,targetMoveMs:r.targetMoveMs,
        plan: r.plan,
        regionReports: r.regionReports,
        review: r.review,
        artifacts: r.artifacts,
        question: r.question,
        questions: r.questions,
      }
    : null;
function mergeDirectReviews(previous,next){
 if(!previous)return next;if(!next)return previous;
 const unique=key=>[...new Set([...(previous[key]||[]),...(next[key]||[])])];
 return {...next,kind:previous.kind==='model'||next.kind==='model'?'model':'drawing',figureIds:unique('figureIds'),modelIds:unique('modelIds'),sourceStrokeIds:unique('sourceStrokeIds'),models:[...new Map([...(previous.models||[]),...(next.models||[])].map(m=>[m.id,m])).values()]};
}
async function executeForSession(s, run, tool, args, signal) {
  signal.throwIfAborted();
  if (!alive(s)) throw Error("Browser disconnected; keep Draw3D open");
  const id = randomUUID();
  const j = { id, session: s.id, tool, args, state: "queued", created: Date.now() };
  jobs.set(id, j);
  s.queue.push(id);
  try {
    while (j.state !== "completed") {
      signal.throwIfAborted();
      if (Date.now() - j.created > 125000)
        throw Error("Command timed out; inspect current state before retrying");
      await new Promise((r) => setTimeout(r, 150));
    }
    if (j.error) throw Error(j.error);
    return j.result;
  } finally {
    if (j.state === "queued") {
      j.state = "completed";
      j.error = "Cancelled before execution";
    }
  }
}
function performDirectMove(s,run,data){return (async()=>{try{run.edit=await runDesktopEdit({run,prompt:run.prompt,promptSource:run.promptSource,evidence:data.evidence,previousDraft:run.previousDraft,continuationContext:run.continuationContext,signal:run.controller.signal});run.awaitingApplyAt=run.edit.visualizationRequest?undefined:Date.now();}
        catch(e){run.state=run.controller.signal.aborted?'stopped':'failed';run.error=safeError(e);run.finishedAt=Date.now();if(run.automation)run.automation.state=run.state;await directEvent(run,'Direct AI edit '+run.state+': '+run.error,{error:run.error},'error');await saveTaskBenchmark(s.recordingId,run.id).catch(()=>{});}})();}
// Under slot pressure, release disconnected idle browsers before rejecting a
// new one. Keep work, commands and unanswered questions even if their tab slept.
function reapIdleBrowserSlots(now=Date.now()){
 for(const [id,s]of sessions){if(now-s.seen<=120000||s.decisionBusy||s.refinementBusy||s.pendingRefinementQuestion||s.queue.length||runInFlight(runs.get(id))||conceptWorkflow.jobs.has(id))continue;runs.delete(id);sessions.delete(id);}
}
export async function handleAgent(req, res) {
  const url = new URL(req.url, "http://localhost");
  if (!url.pathname.startsWith("/api/agent/")) return false;
  try {
    const origin = req.headers.origin;
    const allowed = (
      process.env.DRAW3D_AGENT_ORIGINS || "http://localhost:5173,http://127.0.0.1:5173"
    ).split(",");
    if (origin && !allowed.includes(origin)) {
      send(res, 403, { error: "Origin not allowed" });
      return true;
    }
    const route = url.pathname.slice("/api/agent/".length),
      auth = req.headers["x-draw3d-capability"] || req.headers.authorization?.replace(/^Bearer /, "") || "";
    if (route === "register" && req.method === "POST") {
      if (!origin || !allowed.includes(origin))
        throw Error("Browser registration requires an allowed Origin");
      if(sessions.size>=32)reapIdleBrowserSlots();
      if (sessions.size >= 32) throw Error("Too many browser sessions");
      const data = await body(req),
        id = randomUUID(),
        cap = randomBytes(24).toString("hex");
      sessions.set(id, {
        id,
        cap,
        seen: Date.now(),
        label: String(data.label || "Browser").slice(0, 160),
        recordingId: data.recordingId,
        queue: [],
        status: {},
      });
      send(res, 200, { id, token: cap });
      return true;
    }
    if (
      route === "cad-worker" || route === "session-activity" || route === "speech-decision" || route === "sketch-decisions" || route === "sketch-refine" || route === "sketch-command" || route === "refinement-inspect" || route === "image-surface" || route === "decision-preview" || route === "decision-inspect" || route === "decision-feedback" || route === "desktop-review" || route === "export-task" || route.startsWith("inspect-") || route.startsWith("concept-") || route === "desktop-edit" || route === "desktop-applied" ||
      route === "ai-run" ||
      route === "ai-stop" ||
      route === "ai-answer" ||
      route === "ai-status" ||
      route === "audio-log"
    ) {
      const s = sessions.get(url.searchParams.get("session"));
      if (!s || !equal(auth, s.cap)) {
        send(res, 401, { error: "Browser capability required" });
        return true;
      }
      if (req.method !== "POST") {
        send(res, 405, { error: "POST required" });
        return true;
      }
      const data = await body(req);
      if(route==='speech-decision'){
        const recent=(s.speechDecisionTimes||[]).filter(t=>Date.now()-t<60000);
        if(recent.length>=40)throw Error('Speech classification limit reached');
        s.speechDecisionTimes=[...recent,Date.now()];
        send(res,200,await classifySketchSpeech(data,{question:s.pendingRefinementQuestion?.question}));
        return true;
      }
      if(route==='sketch-decisions'){
        if(s.decisionBusy)throw Error('A sketch decision is already running');
        if(!/^[a-f0-9-]{36}$/i.test(data.requestId||''))throw Error('A decision request ID is required');
        const hash=decisionInputHash(data),cached=s.decisionResults?.get(data.requestId);if(cached){if(cached.hash!==hash)throw Error('Request ID reused with different input');send(res,200,cached.result);return true;}
        const recent=(s.decisionTimes||[]).filter(t=>Date.now()-t<60000);if(recent.length>=30)throw Error('Sketch decision limit reached; wait before fitting again');s.decisionTimes=[...recent,Date.now()];s.decisionBusy=true;s.seen=Date.now();
        try{const result=await runSketchDecisions(data,{recordingId:s.recordingId});s.decisionResults??=new Map();s.decisionResults.set(data.requestId,{hash,result});if(s.decisionResults.size>20)s.decisionResults.delete(s.decisionResults.keys().next().value);send(res,200,result);}finally{s.decisionBusy=false;}return true;
      }
      if(route==='sketch-command'){
        if(!/^[a-f0-9-]{36}$/i.test(data.requestId||''))throw Error('A sketch instruction ID is required');const hash=decisionInputHash(data),cached=s.commandResults?.get(data.requestId);if(cached){if(cached.hash!==hash)throw Error('Instruction ID reused with different targets');send(res,200,cached.result);return true;}if(s.refinementBusy&&(!s.refinementControl||s.refinementRequestId!==data.supersedes))throw Error('A sketch edit is already running');const recent=(s.refinementTimes||[]).filter(t=>Date.now()-t<60000);if(recent.length>=30)throw Error('Sketch edit limit reached');s.refinementTimes=[...recent,Date.now()];s.refinementBusy=true;s.seen=Date.now();
        s.refinementControl?.abort(Error('Sketch instruction updated'));const control=new AbortController();s.refinementControl=control;s.refinementRequestId=data.requestId;const onClose=()=>{if(!res.writableEnded)control.abort(Error('Sketch instruction superseded'));};res.once('close',onClose);try{let prompt=data.prompt;if(s.pendingRefinementQuestion){const p=s.pendingRefinementQuestion;prompt=('Original request: '+p.instruction.slice(0,1600)+'\nQuestion: '+p.question.slice(0,600)+'\nUser answer: '+String(prompt).slice(0,1600)).slice(0,4000);}const result=await runExistingSketchEdit({...data,prompt},{recordingId:s.recordingId,requestId:data.requestId,signal:control.signal});control.signal.throwIfAborted();s.pendingRefinementQuestion=result.refinement.question?{fitId:result.id,instruction:prompt,question:result.refinement.question}:null;s.commandResults??=new Map();s.commandResults.set(data.requestId,{hash,result});if(s.commandResults.size>20)s.commandResults.delete(s.commandResults.keys().next().value);send(res,200,result);}finally{res.off('close',onClose);if(s.refinementControl===control){s.refinementBusy=false;s.refinementControl=null;}}return true;
      }
      if(route==='image-surface'){
        if(!/^[a-f0-9-]{36}$/i.test(data.fitId||''))throw Error('A valid fit ID is required');const folder=path.resolve(process.env.SESSION_DIR||'sessions','decision-sketches',data.fitId),saved=JSON.parse(await readFile(path.join(folder,'request.json'),'utf8'));if(saved.recordingId!==s.recordingId)throw Error('Fit belongs to another recording');send(res,200,pickImageSurface(saved.data.surfaceScene,saved.data.view,data.imagePoint));return true;
      }
      if(route==='sketch-refine'||route==='refinement-inspect'){
        if(!/^[a-f0-9-]{36}$/i.test(data.fitId||'')||!/^[a-f0-9-]{36}$/i.test(data.requestId||''))throw Error('Valid fit and refinement IDs are required');
        const folder=path.resolve(process.env.SESSION_DIR||'sessions','decision-sketches',data.fitId),saved=JSON.parse(await readFile(path.join(folder,'request.json'),'utf8'));if(saved.recordingId!==s.recordingId)throw Error('Fit belongs to another recording');
        if(route==='refinement-inspect'){const base=path.join(folder,'refinements',data.requestId),wire=JSON.parse(await readFile(path.join(base,'wire.json'),'utf8')),response=JSON.parse(await readFile(path.join(base,'response.json'),'utf8'));let turns;try{turns=JSON.parse(await readFile(path.join(base,'turns.json'),'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;}send(res,200,{request:wire.body,response,turns});return true;}
        if(data.directRecovery===true)saved.data.directRecovery=true;
        if(data.cadFailure){
          const {refinementId,reason}=data.cadFailure;
          if(!/^[a-f0-9-]{36}$/i.test(refinementId||'')||typeof reason!=='string'||!reason.trim()||reason.length>1000)throw Error('Invalid CAD execution feedback');
          const previous=JSON.parse(await readFile(path.join(folder,'refinements',refinementId,'result.json'),'utf8'));
          if(!previous.solidEdits?.length||previous.refinement?.recoveryOf)throw Error('Invalid automatic repair target');
          const verified=data.cadFailure.verifiedFeatures;
          if(verified!==undefined&&(!Number.isSafeInteger(verified)||verified<0||verified>previous.solidEdits.length))throw Error('Invalid native feature count');
          saved.data.cadFailure={refinementId,reason,features:previous.solidEdits.map((f,i)=>({name:f.name,kind:f.kind,nativeStatus:verified===undefined?undefined:i<verified?'verified':i===verified?'failed':'unbuilt',target:f.targetBodyId,tool:f.toolBodyId,profiles:f.profiles,revolution:f.revolution})),guides:previous.edits.map(e=>({name:e.name,strokeIds:e.strokeIds}))};
        }
        const key=data.fitId+':'+data.requestId,cached=s.refinementResults?.get(key);if(cached){send(res,200,cached);return true;}if(s.refinementBusy&&(!s.refinementControl||s.refinementRequestId!==data.supersedes))throw Error('A sketch refinement is already running');const recent=(s.refinementTimes||[]).filter(t=>Date.now()-t<60000);if(recent.length>=30)throw Error('Sketch refinement limit reached');s.refinementTimes=[...recent,Date.now()];s.refinementBusy=true;s.seen=Date.now();
        s.refinementControl?.abort(Error('Sketch instruction updated'));const control=new AbortController();s.refinementControl=control;s.refinementRequestId=data.requestId;const onClose=()=>{if(!res.writableEnded)control.abort(Error('Sketch refinement cancelled by newer input'));};res.once('close',onClose);try{const fit=JSON.parse(await readFile(path.join(folder,'result.json'),'utf8'));let instruction=saved.data.prompt||'';if(s.pendingRefinementQuestion){const prior=s.pendingRefinementQuestion;instruction=('Original request: '+prior.instruction.slice(0,1800)+'\nQuestion: '+prior.question.slice(0,600)+'\nNewest user answer/instruction: '+instruction.slice(0,1400)).slice(0,4000);}const result=await runSketchRefinement(saved,fit,{recordingId:s.recordingId,requestId:data.requestId,instruction,signal:control.signal});control.signal.throwIfAborted();s.pendingRefinementQuestion=result.refinement.question?{fitId:data.fitId,instruction,question:result.refinement.question}:null;s.refinementResults??=new Map();s.refinementResults.set(key,result);if(s.refinementResults.size>20)s.refinementResults.delete(s.refinementResults.keys().next().value);send(res,200,result);}finally{res.off('close',onClose);if(s.refinementControl===control){s.refinementBusy=false;s.refinementControl=null;}}return true;
      }
      if(route==='decision-preview'){
        if(!/^[a-f0-9-]{36}$/i.test(data.id||'')||!['received','visible','unchanged','stale','building','applying','accepted','failed'].includes(data.state))throw Error('Invalid preview receipt');const folder=path.resolve(process.env.SESSION_DIR||'sessions','decision-sketches',data.id),saved=JSON.parse(await readFile(path.join(folder,'request.json'),'utf8'));if(saved.recordingId!==s.recordingId)throw Error('Decision belongs to another recording');await appendFile(path.join(folder,'preview.jsonl'),JSON.stringify({state:data.state,at:Date.now(),reason:String(data.reason||'').slice(0,1000),figureCount:data.figureCount,interpretations:data.interpretations,ignoredStrokeIds:data.ignoredStrokeIds,commitMs:data.commitMs,elapsedMs:data.elapsedMs,figureIndex:data.figureIndex})+'\n');send(res,200,{saved:true});return true;
      }
      if(route==='decision-inspect'){
        if(!/^[a-f0-9-]{36}$/i.test(data.id||''))throw Error('Invalid decision ID');const folder=path.resolve(process.env.SESSION_DIR||'sessions','decision-sketches',data.id),request=JSON.parse(await readFile(path.join(folder,'request.json'),'utf8'));if(request.recordingId!==s.recordingId)throw Error('Decision belongs to another recording');const response=JSON.parse(await readFile(path.join(folder,'response.json'),'utf8'));send(res,200,{request:request.body,response});return true;
      }
      if(route==='decision-feedback'){
        if(['discarded','incorrect'].includes(data.verdict)&&s.pendingRefinementQuestion?.fitId===data.id)s.pendingRefinementQuestion=null;
        if(!/^[a-f0-9-]{36}$/i.test(data.id||'')||!['accepted','discarded','incorrect'].includes(data.verdict))throw Error('Invalid decision feedback');
        const folder=path.resolve(process.env.SESSION_DIR||'sessions','decision-sketches',data.id),saved=JSON.parse(await readFile(path.join(folder,'request.json'),'utf8'));if(saved.recordingId!==s.recordingId)throw Error('Decision belongs to another recording');await appendFile(path.join(folder,'feedback.jsonl'),JSON.stringify({verdict:data.verdict,note:String(data.note||'').slice(0,2000),at:Date.now()})+'\n');send(res,200,{saved:true});return true;
      }
      if(route==='desktop-review'){if(typeof data.accepted!=='boolean')throw Error('Review must explicitly accept or discard the preview');await inspectRun(s.recordingId,data.runId);await writeFile(path.resolve(process.env.SESSION_DIR||'sessions','desktop-edits',data.runId,'human-review.json'),JSON.stringify({accepted:data.accepted,isFinal:data.final!==false,relatedRunIds:Array.isArray(data.relatedRunIds)?data.relatedRunIds.filter(id=>typeof id==='string'&&/^[a-f0-9-]{36}$/i.test(id)).slice(0,32):[data.runId],at:Date.now(),source:'preview-button'}));await saveTaskBenchmark(s.recordingId,data.runId);send(res,200,{saved:true,accepted:data.accepted});return true;}
      if(route==='cad-worker'){send(res,200,await serverCadJob(s.id,data));return true;}
      if(route==='session-activity'){send(res,200,await saveActivity(s.recordingId,data));return true;}
      if(route==='inspect-activity'){send(res,200,await recentActivity(s.recordingId));return true;}
      if(route==='inspect-runs'){send(res,200,{runs:await inspectRuns(s.recordingId)});return true;}
      if(route==='inspect-run'){send(res,200,await inspectRun(s.recordingId,data.runId));return true;}
      if(route==='export-task'){send(res,200,await exportTaskBenchmark(s.recordingId,data.runId));return true;}
      if(route==='ai-stop')conceptWorkflow.cancel(s.id);
      s.seen = Date.now();
      if (route === "audio-log") {
        const uuid = /^[a-f0-9]{8}-[a-f0-9-]{27}$/i;
        if (!uuid.test(s.recordingId || "") || !uuid.test(data.id || ""))
          throw Error("Invalid recording/audio ID");
        if (
          typeof data.audio !== "string" ||
          data.audio.length > 14000000 ||
          !/^[A-Za-z0-9+/]*={0,2}$/.test(data.audio)
        )
          throw Error("Invalid WAV audio");
        const bytes = Buffer.from(data.audio, "base64");
        if (
          bytes.length < 46 ||
          bytes.toString("ascii", 0, 4) !== "RIFF" ||
          bytes.toString("ascii", 8, 12) !== "WAVE" ||
          bytes.readUInt16LE(20) !== 1 ||
          bytes.readUInt16LE(22) !== 1 ||
          bytes.readUInt32LE(24) !== 16000 ||
          bytes.readUInt16LE(34) !== 16 ||
          bytes.readUInt32LE(40) !== bytes.length - 44
        )
          throw Error("Expected mono PCM16 16kHz WAV");
        const folder = path.resolve(process.env.SESSION_DIR || "sessions", "audio", s.recordingId);
        await mkdir(folder, { recursive: true });
        await writeFile(path.join(folder, data.id + ".wav"), bytes);
        await writeFile(
          path.join(folder, data.id + ".json"),
          JSON.stringify({
            recordingId: s.recordingId,
            audioId: data.id,
            start: data.start,
            end: data.end,
            transcripts: data.transcripts,
            savedAt: new Date().toISOString(),
          }),
        );
        send(res, 200, { saved: true, id: data.id, bytes: bytes.length });
        return true;
      }
      if(route.startsWith('concept-')){
        if(!CONCEPT_MODE()&&route!=='concept-transcribe')throw Error('Concept workflow is available in the Terra version');
        if(route==='concept-restore'){validateDesktopEvidence(data.evidence);const concept=conceptWorkflow.restore(s.id,{snapshot:data.snapshot,evidence:data.evidence,recordingId:s.recordingId});send(res,200,{concept});return true;}
        if(!process.env.OPENAI_API_KEY&&!(route==='concept-transcribe'&&cloudVertexReady()))throw Error('OpenAI backend key is missing');
        let concept;
        if(route==='concept-transcribe'){
          const stream=data.streamTranscript===true&&data.sketchSpeech===true;
          const emit=value=>{if(!res.destroyed)res.write(JSON.stringify(value)+'\n');};
          if(stream)res.writeHead(200,{'Content-Type':'application/x-ndjson','Cache-Control':'no-store','X-Accel-Buffering':'no'});
          const uuid=/^[a-f0-9-]{36}$/i;
          async function speechReceipt(fields){
            if(!data.sketchSpeech||!uuid.test(s.recordingId)||!uuid.test(data.audioId))return;
            const folder=path.resolve(process.env.SESSION_DIR||'sessions','audio',s.recordingId);
            await mkdir(folder,{recursive:true});
            await writeFile(path.join(folder,data.audioId+'.speech.json'),JSON.stringify({
              audioId:data.audioId,start:data.start,end:data.end,strokeIds:Array.isArray(data.strokeIds)?data.strokeIds.filter(id=>typeof id==='string').slice(0,32):[],at:Date.now(),...fields
            }));
          }
          try {
            const start=performance.now();
            let firstTextMs=null;
            const retries=[];
            const onRetry=retry=>{retries.push(retry);if(stream)emit({retry});};
            const reportTranscript=transcript=>{
              if(!transcript)return;
              firstTextMs??=performance.now()-start;
              emit({transcript});
            };
            const text=await transcribeConceptAudio(data.audioInputs,{sketchSpeech:data.sketchSpeech===true,onTranscript:stream?reportTranscript:undefined,onRetry});
            const transcriptionMs=performance.now()-start;
            if(stream&&text)reportTranscript(text);
            let speechDecision=null,filterError;
            if(data.sketchSpeech&&text.trim()){
              try{speechDecision=await classifySketchSpeech({text,currentInstruction:data.currentInstruction,hasSketch:data.hasSketch},{question:s.pendingRefinementQuestion?.question,onRetry});}
              catch(error){filterError=error.message;} // Deliver the words so the client can retry only the filter.
            }
            const result={text,speechDecision,retries,timings:{firstTextMs,transcriptionMs,totalMs:performance.now()-start}};
            if(stream){emit({result});res.end();}else send(res,200,result);
            void speechReceipt({...result,filterError}).catch(e=>console.error('Speech receipt:',e.message));
          } catch(error) {
            void speechReceipt({error:error.message}).catch(e=>console.error('Speech receipt:',e.message));
            if(!stream)throw error;
            emit({error:error.message});res.end();
          }
          return true;
        }
        if(route==='concept-generate'){validateDesktopEvidence(data.evidence);if(data.requestContext){const current=runs.get(s.id);if(!current||current.id!==data.requestContext.runId||current.edit?.visualizationRequest?.toolCallId!==data.requestContext.toolCallId)throw Error('No visualization tool call is awaiting review');}concept=conceptWorkflow.start(s.id,data);}
        else if(route==='concept-status')concept=conceptWorkflow.status(s.id,data.id);
        else if(route==='concept-select')concept=conceptWorkflow.select(s.id,data);
        else if(route==='concept-confirm'){validateDesktopEvidence(data.evidence);concept=conceptWorkflow.confirm(s.id,data);}
        else if(route==='concept-cancel'){conceptWorkflow.cancel(s.id);send(res,200,{cancelled:true});return true;}
        else throw Error('Unknown concept action');
        send(res,200,{concept});return true;
      }
      let run = runs.get(s.id);
      if(route === "desktop-applied"){
        if(!run||run.mode!=="direct"||data.runId!==run.id)throw Error("No matching direct edit");
        if(data.turn!==undefined&&data.turn!==run.step)throw Error("Stale drawing move acknowledgement");
        const reply=()=>send(res,200,{ready:agentReady(),model:agentModel(),reasoning:agentReasoning(),run:publicRun(run),continuation:directContinuation(run)});
        if(run.ackPromise)await run.ackPromise;
        if(run.state==='failed'&&/Browser did not acknowledge/.test(run.error||'')&&run.edit){run.state='running';run.error=undefined;run.controller=new AbortController();}
        if(run.state!=="running"||run.appliedTurn===run.step){reply();return true;}
        let releaseAck;run.ackPromise=new Promise(resolve=>releaseAck=resolve);
        try{
        if(run.edit.visualizationRequest&&!data.error){run.confirmedConcept=conceptWorkflow.consumeForRun(s.id,data.visualizationConceptId,run);await directEvent(run,'Visualization tool result · user confirmed '+run.confirmedConcept.label,{tool:'generate_design_visualizations',conceptId:run.confirmedConcept.id,candidateId:run.confirmedConcept.candidateId},'tool-result');}
        const receiptFolder=path.resolve(process.env.SESSION_DIR||'sessions','desktop-edits',run.id,...(run.step>1?['turn-'+run.step]:[]));await mkdir(receiptFolder,{recursive:true});await writeFile(path.join(receiptFolder,'application.json'),JSON.stringify(data));
        run.appliedTurn=run.step;run.awaitingApplyAt=undefined;run.error=data.error?String(data.error).slice(0,2000):undefined;
        const applicationError=run.error;run.contextRebasePending=contextApplicationRecovery(run,data);run.nativeRecoveryPending=nativeApplicationRecovery(run,data)||cadApplicationRecovery(run,data);
        const application={review:data.review,appliedCount:data.appliedCount||0,error:applicationError,contextChange:run.contextRebasePending||undefined,nativeFeedback:run.nativeRecoveryPending||undefined};
        run.moves.push({turn:run.step,output:run.edit,application});
        await withDesktopContext(run.contextKey||run.recordingId||run.id,c=>recordContextApplication(c,{runId:run.id,turn:run.step,...application}));
        run.review=mergeDirectReviews(run.review,data.review);
        run.answer=run.edit.summary+(run.edit.assumptions.length?"\n"+run.edit.assumptions.join("\n"):"")+(run.edit.question?"\n"+run.edit.question:"");
        const more=!!run.contextRebasePending||!!run.nativeRecoveryPending||!run.error&&run.edit.continuation&&!data.stopForUserInput;
        if(run.nativeRecoveryPending||run.contextRebasePending)run.error=undefined;
        run.state=run.error?"failed":more?"running":"completed";
        if(run.automation)run.automation.state=run.nativeRecoveryPending?"recovering":run.error?"failed":data.stopForUserInput&&run.edit.continuation?"yielded":run.edit.question?"awaiting_input":more?"running":"completed";
        if(!run.error&&run.edit.question){askDirectQuestion(run,run.edit.question,run.edit.questionOptions);if(run.automation)run.automation.state='awaiting_input';}
        if(['failed','completed','stopped'].includes(run.state))run.finishedAt=Date.now();
        run.awaitingContinuation=!!more;run.continuationRequestedAt=more?Date.now():undefined;
        run.activity=run.contextRebasePending?"New drawing received; updating AI context":run.nativeRecoveryPending?"CAD rejected the operation; AI is inspecting feedback and correcting it":run.error?"Local CAD application failed":run.state==="waiting_for_answer"?"Waiting for your answer":more?"AI requested another move: "+run.edit.continuation.reason:"Direct drawing edit complete";
        await directEvent(run,run.contextRebasePending?'New drawing received · stale proposal discarded':applicationError?'Local edit failed: '+applicationError:'Local CAD verification complete · '+(data.appliedCount||0)+' figure edit(s)',{turn:run.step,review:run.review,providerCallCount:run.providerCallCount,modelToolCalls:0,error:applicationError,nativeFeedback:run.nativeRecoveryPending},run.contextRebasePending?'context':applicationError?'error':'lifecycle');
        if(run.state==='waiting_for_answer')await directEvent(run,'Question for you · '+run.question.question,{question:run.question},'question');
        if(more){const next=directContinuation(run);await directEvent(run,run.contextRebasePending?'New drawing received · AI continuing with refreshed context':run.nativeRecoveryPending?'CAD feedback sent · AI correcting rejected operation ('+run.nativeRecoveryCount+'/3)':'AI requested another move · '+next.reason,{turn:run.step,nextMove:next.nextMove,nativeFeedback:run.nativeRecoveryPending},run.contextRebasePending?'context':run.nativeRecoveryPending?'recovery':'continuation');}
        else if(run.edit.continuation&&data.stopForUserInput)await directEvent(run,'New user input queued · yielding before additional AI moves',{},'lifecycle');
        await saveTaskBenchmark(s.recordingId,run.id).catch(error=>{run.recordingWarning='Evaluation manifest unavailable: '+error.message;});reply();return true;
        }finally{releaseAck();run.ackPromise=null;}
      }
      if(route === "desktop-edit"){
        if(!agentReady())throw Error("Configure the selected model API key on the PC backend");
        if(data.requestId&&run?.requestId===data.requestId){if(run.state==='failed'&&!run.edit&&recoverableConnectionError({message:run.error})){validateDesktopEvidence(data.evidence);run.state='running';run.error=undefined;run.finishedAt=undefined;run.controller=new AbortController();run.movePromise=performDirectMove(s,run,data);}if(run.movePromise)await run.movePromise;send(res,200,{ready:true,model:run.model,reasoning:run.reasoning,run:publicRun(run),edit:run.edit});return true;}
        validateDesktopEvidence(data.evidence);
        if(data.continueRunId){
          if(!run||run.id!==data.continueRunId||run.mode!=='direct'||run.state!=='running'||!run.awaitingContinuation||run.step!==data.previousTurn||!directContinuation(run))throw Error('No model-requested move is pending for this run');
          run.continuationContext={requestedMove:directContinuation(run),nativeRecovery:run.nativeRecoveryPending,contextChange:run.contextRebasePending,clarification:run.question?.status==='answered'&&run.question.turn===run.step?{questionId:run.question.id,question:run.question.question,answer:run.question.answer,source:run.question.source}:undefined,requestedSketchIds:run.edit.requestedSketchIds,priorMoves:run.moves,automation:run.automation};run.awaitingContinuation=false;run.nativeRecoveryPending=null;run.contextRebasePending=null;run.continuationRequestedAt=undefined;run.step++;run.requestId=data.requestId;run.edit=undefined;
        }else{
          if(runInFlight(run))throw Error("An AI edit is already active");
          if([...runs.values()].filter(runInFlight).length>=2)throw Error("Two AI runs are already active");
          if(typeof data.prompt!=="string"||!data.prompt.trim()||data.prompt.length>12000)throw Error("Provide an instruction up to 12,000 characters");
          const confirmedConcept=CONCEPT_MODE()&&(data.conceptId||data.evidence.strokes.length&&!data.evidence.models?.some(m=>!m.hidden))?conceptWorkflow.consume(s.id,data.conceptId,data.evidence,data.prompt):null;
          run={confirmedConcept,id:randomUUID(),requestId:data.requestId,recordingId:s.recordingId,model:agentModel(),reasoning:'low',mode:'direct',state:'running',startedAt:Date.now(),step:1,events:[],moves:[],prompt:data.prompt,promptSource:data.promptSource,contextKey:s.recordingId||s.id,previousDraft:data.previousDraft,activity:'Reading the complete drawing packet',controller:new AbortController()};runs.set(s.id,run);
        }
        if(data.audioInputs!==undefined){
          if(!Array.isArray(data.audioInputs)||data.audioInputs.length>8||data.audioInputs.some(a=>!a||a.mimeType!=='audio/wav'||typeof a.audio!=='string'||a.audio.length>12000000||!/^[A-Za-z0-9+/]+={0,2}$/.test(a.audio)))throw Error('Invalid direct audio input');
          run.audioInputs=[...(run.audioInputs||[]),...data.audioInputs].slice(-8);
        }
        run.movePromise=performDirectMove(s,run,data);
        await run.movePromise;run.movePromise=null;
        send(res,200,{ready:agentReady(),model:run.model,reasoning:run.reasoning,run:publicRun(run),edit:run.edit});return true;
      }
      if (route === "ai-run") {
        if(CONCEPT_MODE())throw Error("Use the confirmed concept workflow in this version");
        if (!agentReady()) throw Error("Configure the selected model API key on the PC backend");
        if (data.requestId && run?.requestId === data.requestId) {
          send(res, 200, {
            ready: agentReady(),
            model: agentModel(),
            reasoning: agentReasoning(),
            run: publicRun(run),
          });
          return true;
        }
        if (runInFlight(run)) throw Error("An AI run is already active or waiting for your answer");
        if ([...runs.values()].filter(runInFlight).length >= 2)
          throw Error("Two AI runs are already active");
        if (!alive(s)) throw Error("Browser disconnected");
        if (typeof data.prompt !== "string" || !data.prompt.trim() || data.prompt.length > 12000)
          throw Error("Provide an instruction up to 12,000 characters");
        const draftSource=run || data.previousDraft;
        const previousDraft = draftSource && typeof draftSource === "object" && !Array.isArray(draftSource) ? {answer:draftSource.answer,plan:draftSource.plan,regionReports:draftSource.regionReports,review:draftSource.review,artifacts:draftSource.artifacts,question:draftSource.question,questions:draftSource.questions} : undefined;
        if(previousDraft && JSON.stringify(previousDraft).length > 200000) throw Error("Previous draft context is too large");
        run = {
          id: randomUUID(),
          requestId: typeof data.requestId === "string" ? data.requestId.slice(0, 100) : undefined,
          recordingId: s.recordingId,
          model: agentModel(),
          reasoning: agentReasoning(),
          state: "running",
          startedAt:Date.now(),
          step: 0,
          events: [],
          activity: "Starting",
          controller: new AbortController(),
        };
        runs.set(s.id, run);
        const deadline = createPausableDeadline(() => run.controller.abort(new Error("AI run exceeded 30 minutes of active work")));
        run.pauseDeadline = deadline.pause;
        run.resumeDeadline = deadline.resume;
        runModelAgent({
          run,
          prompt: data.prompt,
          priorContext: previousDraft,
          desktopEvidence: data.desktopEvidence === true,
          promptId: typeof data.promptId === "string" ? data.promptId : undefined,
          promptIds: Array.isArray(data.promptIds)
            ? data.promptIds.filter((x) => typeof x === "string").slice(0, 32)
            : undefined,
          sessionId: s.id,
          signal: run.controller.signal,
          execute: (tool, args, signal) => executeForSession(s, run, tool, args, signal),
        })
          .then(() => {
            run.state = "completed";
          })
          .catch((e) => {
            run.state = run.controller.signal.aborted ? "stopped" : "failed";
            run.error = safeError(e);
          })
          .finally(async() => {deadline.dispose();run.finishedAt=Date.now();const message=run.state==='completed'?'AI run completed':run.state==='stopped'?'AI run stopped: '+run.error:'AI run failed: '+run.error;const entry=appendActivity(run,message,{kind:run.state==='failed'?'error':'lifecycle',details:{state:run.state,error:run.error}});const folder=path.resolve(process.env.SESSION_DIR||'sessions','agent-runs',run.id);try{await mkdir(folder,{recursive:true});await appendFile(path.join(folder,'events.jsonl'),JSON.stringify({time:new Date().toISOString(),type:'run.state',data:entry})+'\n');}catch{ /* Runtime status remains visible even if disk logging fails. */ }});
      } else if (route === "ai-answer") {
        const answered = answerAgentQuestion(run, data);
        if(run.mode==='direct'&&!answered.duplicate){await withDesktopContext(run.contextKey||run.recordingId||run.id,c=>recordContextClarification(c,run.question,run.id));await directEvent(run,'User answered · '+run.question.answer,{questionId:run.question.id,question:run.question.question,answer:run.question.answer,source:run.question.source},'answer');}
        send(res, 200, { ...answered,...(run.mode==='direct'?{continuation:directContinuation(run)}:{}), ready: agentReady(), model: agentModel(), reasoning: agentReasoning(), run: publicRun(run) });
        return true;
      } else if (route === "ai-stop" && runInFlight(run)) {
        run.controller.abort(
          new Error("Stopped by user. An already executing edit may finish; inspect the scene."),
        );
        run.activity = "Stopping";
        if(run.mode==='direct'){if(run.question?.status==='pending'){run.question.status='cancelled';run.question.cancelledAt=Date.now();}run.state="stopped";run.finishedAt=Date.now();run.error="Stopped by user. Already applied edits remain editable.";if(run.automation)run.automation.state="stopped";await directEvent(run,run.error,{state:run.state},"lifecycle");}
      }
      send(res, 200, {
        ready: agentReady(),
        model: agentModel(),
        reasoning: agentReasoning(),
        run: publicRun(run),
      });
      return true;
    }
    if (route === "poll" || route === "result") {
      const s = sessions.get(url.searchParams.get("session"));
      if (!s || !equal(auth, s.cap)) {
        send(res, 401, { error: "Browser capability required" });
        return true;
      }
      const data = await body(req);
      if(route==='inspect-runs'){send(res,200,{runs:await inspectRuns(s.recordingId)});return true;}
      if(route==='inspect-run'){send(res,200,await inspectRun(s.recordingId,data.runId));return true;}
      if(route==='export-task'){send(res,200,await exportTaskBenchmark(s.recordingId,data.runId));return true;}
      if(route==='ai-stop')conceptWorkflow.cancel(s.id);
      s.seen = Date.now();
      if (route === "poll") {
        s.status = data;
        let job;
        while (s.queue.length && !job) {
          const j = jobs.get(s.queue.shift());
          if (j && j.state === "queued") job = j;
        }
        if (job) {
          job.state = "running";
          job.started = Date.now();
        }
        send(res, 200, {
          job: job ? { id: job.id, tool: job.tool, args: job.args } : null,
          ai: {
            ready: agentReady(),
            model: agentModel(),
            reasoning: agentReasoning(),
            run: publicRun(runs.get(s.id)),
          },
        });
      } else {
        const j = jobs.get(data.id);
        if (!j || j.session !== s.id || j.state !== "running")
          throw Error("No matching running command");
        j.state = "completed";
        j.result = data.result;
        j.error = data.error;
        send(res, 200, { ok: true });
      }
      return true;
    }
    if (!equal(auth, await token())) {
      send(res, 401, { error: "MCP authentication required" });
      return true;
    }
    if (route === "sessions" && req.method === "GET") {
      send(res, 200, {
        sessions: [...sessions.values()]
          .filter(alive)
          .map(({ cap, queue, seen, ...s }) => ({ ...s, lastSeen: seen })),
      });
      return true;
    }
    if (route === "command" && req.method === "POST") {
      const data = await body(req),
        s = sessions.get(data.sessionId);
      if (!s || !alive(s))
        throw Error("Browser is disconnected; open Draw3D and keep the headset awake");
      if (s.queue.length >= 16) throw Error("Agent queue is full");
      const id = randomUUID();
      jobs.set(id, {
        id,
        session: s.id,
        tool: data.tool,
        args: data.args || {},
        state: "queued",
        created: Date.now(),
      });
      s.queue.push(id);
      send(res, 202, { id });
      return true;
    }
    if (route === "job" && req.method === "GET") {
      const j = jobs.get(url.searchParams.get("id"));
      if (!j) throw Error("Job expired");
      send(res, 200, j);
      return true;
    }
    send(res, 404, { error: "Unknown agent route" });
  } catch (e) {
    send(res, 400, { error: e.message });
  }
  return true;
}
setInterval(() => {
  const now = Date.now();
  for (const [id, run] of runs) {
    const s = sessions.get(id);
    if(run.mode==='direct'&&run.state==='running'&&((run.awaitingApplyAt&&now-run.awaitingApplyAt>120000)||(run.continuationRequestedAt&&now-run.continuationRequestedAt>120000))){run.state='failed';run.error='Browser did not acknowledge the drawing response; inspect saved edits before retrying.';run.finishedAt=now;if(run.automation)run.automation.state='failed';void directEvent(run,run.error,{state:run.state},'error').catch(()=>{});}
    if (run.state === "running" && (!s || now - s.seen > 45000))
      run.controller.abort(
        new Error(
          "Browser disconnected or reloaded. Existing edits remain saved; start a new run to continue.",
        ),
      );
  }
  for (const [id, j] of jobs) {
    if (j.state !== "completed" && now - j.created > 120000) {
      j.state = "completed";
      j.error = "Command timed out; inspect current state before retrying a mutation";
    }
    if (now - j.created > 600000) jobs.delete(id);
  }
  for (const [id, s] of sessions)
    if (now - s.seen > 600000 && runs.get(id)?.state !== "waiting_for_answer") {
      runs.get(id)?.controller.abort(new Error("Browser disconnected"));
      runs.delete(id);conceptWorkflow.cancel(id);conceptWorkflow.jobs.delete(id);
      sessions.delete(id);
    }
}, 10000).unref();
