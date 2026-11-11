import {independentPartRequest,beginIndependentDrawing} from './drawing-intent.js';
import {initDesktopDraftReview} from './desktop-draft-review.js';
import {createSpeechFocusTracker,dominantSpeechFocus} from './speech-focus.js';
import {drawingView} from './sketch-projection.js';
import {initHandRoles,captureSelectionReference} from './hand-roles.js';
import {initConceptPicker} from './concept-picker.js';
import {recoverableConnectionError} from './request-recovery.js';
import {waitForDrawingPause} from './drawing-concurrency.js';
import {archiveAppliedStrokes,attachStrokeArchives} from './stroke-archive.js';
import {voiceAICommand} from './voice-ai-commands.js';
import {initAISupervision} from './ai-supervision.js';
import {initAIActivity} from './ai-activity.js';
import { sketchReference } from "./sketch-reference.js";
import { blobToBase64 } from "./audio.js";
export function initModelAgentUI({ panel, store, studio, input, addTranscript, request, dispatch, desktop }) {
  const decisionLab=new URL(location.href).searchParams.get('experiment')==='decision';
  if(decisionLab)studio.decisionRequest=request;
  const activityLog=initAIActivity(studio,store);
  if(document.body.classList.contains('desktop-studio'))initDesktopDraftReview({studio,store,request,record:(...args)=>activityLog.record(...args)});
  studio.modelAgentEvidence=async()=>{const e=await desktop.prepare(),frames=await studio.modeling?.visualizationFrames?.()||[];return {...e,frames:[...frames,...e.frames]};};
  const speechFocusTracker=createSpeechFocusTracker({view:()=>drawingView(studio),strokes:()=>store.session.strokes}),speechFocusQueue=[],speechFocusByAudio=new Map();
  const focusForAudio=()=>speechFocusQueue.shift()||(speechFocusTracker.active?speechFocusTracker.finish():dominantSpeechFocus([{at:performance.now(),view:drawingView(studio)}],store.session.strokes));
  const concepts=initConceptPicker({studio,store,request,record:(...args)=>activityLog.record(...args)});
  const section = document.createElement("section");
  section.className = "model-agent-controls";
  section.innerHTML =
    '<strong id="ai-model">Assistant</strong><p>Speak or type a change.</p><label><input id="ai-auto-speech" type="checkbox"> Act on speech</label><button id="ai-run" disabled>Run</button><button id="ai-stop" disabled>Stop</button><button id="ai-accept" hidden>Accept draft</button><p id="ai-plan" style="white-space:pre-wrap"></p><p id="ai-status" role="status">Waiting for backend</p><p id="audio-log-status">Audio recording ready</p><pre id="ai-answer" style="white-space:pre-wrap;max-height:280px;overflow:auto"></pre><details><summary>Activity</summary><pre id="ai-events" style="white-space:pre-wrap;max-height:180px;overflow:auto"></pre></details>';
  panel.querySelector("#agent-connection").after(input.closest("form"));
  input.closest("form").after(section);
  const inspector=document.createElement('a');inspector.textContent='Inspect activity';inspector.href='/inspector.html?recording='+encodeURIComponent(store.session.id);inspector.target='_blank';inspector.rel='noopener';section.append(inspector);
  initAISupervision(studio,store,section);initHandRoles(studio,store,section);
  const banner = document.createElement("aside");
  banner.id = "assistant-feedback";
  banner.innerHTML =
    '<strong id="assistant-state" role="status">Assistant</strong><span id="assistant-detail"></span><button id="assistant-details">Details</button><button id="assistant-stop" disabled>Stop</button>';
  document.body.append(banner);
  const runButton = section.querySelector("#ai-run"),
    stop = section.querySelector("#ai-stop"),
    status = section.querySelector("#ai-status"),
    auto = section.querySelector("#ai-auto-speech"),
    audioStatus = section.querySelector("#audio-log-status");
  auto.checked = store.session.voiceAIEnabled !== false;
  if(desktop?.workspace==="vr")auto.parentElement.lastChild.textContent=" Act on speech and text";
  const accept = section.querySelector("#ai-accept");
  let reviewSnapshot,connectionRecovery="",resumeAt=0,resuming=false;
  let lastRun = store.session.lastAIRun||store.session.aiPendingQuestion?.run,
    submitting = false,
    migrating = false,
    ready = false,
    pending = [],
    seen = new Set(),
    due = 0,
    speaking = false,
    transcribing = false,
    modelNeedsTranscription = false,
    speechSelectionReference=null,
    error = "",
    speechStatus = "Microphone off",
    audioText = "Audio recording ready",
    uploading = false;
  if(lastRun?.state==='stopped')delete store.session.aiDirectCheckpoint;
  const waitingForAnswer=()=>lastRun?.state === "waiting_for_answer" && lastRun?.question?.status === "pending";
  const busy = () => migrating || submitting || concepts.pending || ["running","waiting_for_answer"].includes(lastRun?.state);
  let directStage="",directStopped=lastRun?.state==='stopped',correctionExpected=false,correctionPending=false,moveBeganAt=0;
  let answering=false,answerBatch=[],answerDue=0,renderedQuestion="",answerRetryAt=0;
  const questionBox=document.createElement("aside");questionBox.id="agent-question";questionBox.hidden=true;questionBox.setAttribute("role","dialog");questionBox.setAttribute("aria-labelledby","agent-question-title");
  questionBox.innerHTML='<strong>Design question</strong><h2 id="agent-question-title"></h2><p id="agent-question-reason"></p><div id="agent-question-options"></div><p>Speak or type an answer.</p><form id="agent-answer-form"><input id="agent-answer-text" aria-label="Answer the design question" placeholder="Answer"></form><p id="agent-answer-status" role="status"></p>';
  document.body.append(questionBox);
  async function answerQuestion(answer,source="speech",record=true,audioPrompts=[]){
    const saved=store.session.pendingQuestionAnswer;
    const acceptedReply=!!saved&&lastRun?.state==='running'&&saved.runId===lastRun.id&&saved.questionId===lastRun?.question?.id&&lastRun.question.status==='answered'&&lastRun.step===lastRun.question.turn;
    if((!waitingForAnswer()&&!acceptedReply)||answering||!answer.trim())return;
    answering=true;submitting=true;directStage='answering';error="";if(desktop)directStopped=false;questionBox.querySelector("#agent-answer-status").textContent="Sending your answer…";
    const q=lastRun.question,runId=lastRun.id;let accepted=false,promptId;
    try{
      {
        store.session.pendingQuestionAnswer={...saved,runId,questionId:q.id,turn:q.turn,answer,source,audioPrompts:structuredClone(audioPrompts),state:saved?.state||'queued'};
        await store.flush();
      }
      store.log('ai.question.sending',{runId,questionId:q.id,source,audioIds:audioPrompts.map(p=>p.id)});
      if(record&&source!=="speech"){const p={id:crypto.randomUUID(),text:answer,source:"question-"+source,start:store.elapsed(),end:store.elapsed(),questionId:q.id};promptId=p.id;addTranscript(p);}
      let response;try{response=await request("ai-answer",{runId,questionId:q.id,answer,source});}catch(failure){
        if(!desktop||!/No matching AI run|No matching clarification question|No pending question|not waiting/i.test(failure.message))throw failure;
        const current=await request('ai-status',{});if(directStopped)return;
        if(current.run&&(current.run.id!==runId||current.run.state==='completed'||current.run.question?.id!==q.id||current.run.question?.status==='answered')){delete store.session.pendingQuestionAnswer;delete store.session.aiPendingQuestion;store.session.lastAIRun=structuredClone(current.run);update(current,true);await store.flush();activityLog.record('A newer assistant update is available · the saved answer was not replayed','connection');return;}
        if(current.run&&['running','waiting_for_answer'].includes(current.run.state))throw failure;
        const prior=store.session.aiPendingQuestion,original=prior?.run?.id===runId?prior.goalPrompts:store.session.aiDirectGoal?.prompts;
        const goal=original?.length?structuredClone(original):[{id:crypto.randomUUID(),text:lastRun.automation?.goal||lastRun.prompt||'Continue the saved design request using the current model.',source:'recovered-goal'}];
        goal.push(...structuredClone(audioPrompts));
        goal.push({id:promptId||crypto.randomUUID(),text:'Clarification for "'+q.question+'": '+answer,source:'question-'+source,...(audioPrompts.at(-1)?.speechFocus?{speechFocus:audioPrompts.at(-1).speechFocus}:{})});
        store.session.aiDirectGoal={prompts:structuredClone(goal),startedAt:Date.now()};delete store.session.aiPendingQuestion;delete store.session.aiDirectCheckpoint;lastRun={...lastRun,state:'stopped',question:{...q,status:'answered',answer}};await store.flush();
        activityLog.record('Reconnected · continuing your design with the saved answer','connection');studio.endAll();directStage='preparing';
        await directMoves(goal,null,crypto.randomUUID(),{review:lastRun.review,question:q.question,answer,recovery:'The backend restarted while waiting for this answer. Continue the ORIGINAL user goal with this clarification. Inspect fresh current geometry and native receipts first; preserve completed edits and never replay an operation merely because the previous run was lost.'});
        if(store.session.pendingQuestionAnswer?.runId===runId)delete store.session.pendingQuestionAnswer;await store.flush();return;
      }accepted=!!response.accepted;
      if(accepted&&store.session.pendingQuestionAnswer?.questionId===q.id){store.session.pendingQuestionAnswer.state='accepted';await store.flush();}
      update(response,true);
      store.log("ai.question.answer",{runId,questionId:q.id,answer,source});await store.flush();answerBatch=[];
      if(desktop&&response.continuation&&!directStopped){
        submitting=true;directStage="preparing";feedback();studio.endAll();
        await directMoves(audioPrompts.length?audioPrompts:[{id:promptId,text:answer,source:"question-"+source}],response.continuation);
      }
    }catch(e){answerBatch=[];answerRetryAt=Date.now()+3000;error=(accepted?"AI could not continue: ":"Answer not sent: ")+e.message;store.log('ai.question.error',{runId,questionId:q.id,error:e.message,accepted,audioSaved:!!store.session.pendingQuestionAnswer});questionBox.querySelector("#agent-answer-status").textContent=error;feedback();}
    finally{answering=false;submitting=false;directStage="";feedback();}
  }
  window.addEventListener("draw3d-stop-ai",()=>stop.click());
  window.addEventListener("draw3d-run-ai",()=>runButton.click());
  questionBox.querySelector("form").onsubmit=e=>{e.preventDefault();void answerQuestion(questionBox.querySelector("input").value,"typed");};
  window.addEventListener("draw3d-question-option",({detail})=>{if(detail.questionId===lastRun?.question?.id)void answerQuestion(detail.answer,"option");});
  function renderQuestion(){
    const q=waitingForAnswer()?lastRun.question:null;questionBox.hidden=!q;studio?.setAgentQuestion?.(q);
    if(!q){renderedQuestion="";answerBatch=[];return;}
    if(renderedQuestion===q.id)return;renderedQuestion=q.id;answerBatch=[];
    questionBox.querySelector("#agent-question-title").textContent=q.question;
    questionBox.querySelector("#agent-question-reason").textContent=q.reason||"";
    questionBox.querySelector("#agent-answer-status").textContent="Waiting for your answer";
    questionBox.querySelector("input").value="";
    questionBox.querySelector("#agent-question-options").replaceChildren(...(q.options||[]).map((option,index)=>{const b=document.createElement("button");b.textContent=(index+1)+". "+option;b.onclick=()=>void answerQuestion(option,"option");return b;}));
  }
  window.addEventListener('draw3d-concept-state',()=>feedback());
  const savedInstruction=()=>!auto.checked?(store.session.transcripts.find(p=>p.id===store.session.pendingAIInstructionId)||(!lastRun?store.session.transcripts.at(-1):undefined)):undefined;
  function feedback() {
    let text = connectionRecovery ? connectionRecovery : waitingForAnswer() && !error ? "Answer needed" : error
      ? "Needs attention: " + error
      : submitting ? (directStage==="preparing"?"Preparing…":lastRun?.automation?"Step "+lastRun.step+" · "+lastRun.activity:"AI "+(lastRun?.activity||"understanding the drawing"))
      : pending.length
        ? busy()
          ? "Next speech request queued"
          : "Speech received · " +
            (speaking || transcribing ? "waiting for speech to finish" : "sending to agent shortly")
        : ready && !busy() && savedInstruction()
          ? "Voice AI paused · say resume AI, then your instruction"
        : lastRun?.state === "running"
          ? "AI " + lastRun.activity
          : lastRun?.state === "failed"
            ? "AI failed: " + lastRun.error
            : lastRun?.state === "stopped"
              ? "AI stopped"
              : lastRun?.state === "completed"
                ? (store.session.acceptedAIRuns?.includes(lastRun.id) ? "Draft accepted · ready for your next instruction" : lastRun.review?.state === "awaiting_feedback" ? "Done · review draft" : "Done · review model")
                : !ready
                  ? "Connecting…"
                  : "Ready · " +
                    (auto.checked ? "speak a request, then pause" : "voice paused · say resume AI");
    if (busy() && pending.length)
      text = "AI " + (lastRun?.activity || "starting") + " · next request queued";
    if(concepts.pending)text="Designs · "+concepts.status;
    const detail = waitingForAnswer() ? lastRun.question.question : lastRun?.state === "completed" && lastRun.answer
      ? lastRun.answer.replace(/\*\*/g, "").slice(0, 220)
      : speechStatus + " | " + audioText;
    activityLog.update({run:lastRun,ready,error,submitting:submitting&&(!desktop||directStage==="preparing")});
    status.textContent = text;
    banner.querySelector("#assistant-state").textContent = text;
    banner.querySelector("#assistant-detail").textContent = detail;
    studio?.setAgentState({status:text,detail,error:!!error||lastRun?.state==="failed",busy:busy(),canRun:desktop?.workspace!=="vr"&&ready&&!busy()&&!!(savedInstruction()||lastRun?.state==="failed"),step:lastRun?.step,moveStartedAt:lastRun?.moveStartedAt||moveBeganAt,targetMoveMs:lastRun?.targetMoveMs||5000,plan:lastRun?.automation?.steps||[],events:lastRun?.events||[]});
    runButton.disabled = busy() || !ready;
    accept.disabled = busy();
    studio.aiDraftReview?.setBusy(busy());
    stop.disabled = !busy() && !pending.length;
    banner.querySelector("#assistant-stop").disabled = stop.disabled;
  }
  function update(data,local=false) {
    if (!data) return;
    if(data.model)modelNeedsTranscription=/^gpt-/.test(data.model);
    if(desktop&&submitting&&!local&&(directStage!=="requesting"||data.run?.mode!=="direct")){ready=data.ready;feedback();return;}
    ready = data.ready;
    if(data.run) lastRun = data.run;
    else if(data.ready&&lastRun?.state==="failed") {
      // A saved failure is history, not the status of this fresh backend connection.
      activityLog.record("Previous AI failure · saved in history", "history", {runId:lastRun.id,error:lastRun.error},lastRun.id+":historical");
      store.session.previousAIRun=lastRun;
      if(store.session.lastAIRun?.id===lastRun.id)delete store.session.lastAIRun;
      lastRun=undefined;error="";store.flush().catch(()=>{});
    }
    else if(lastRun?.state==='waiting_for_answer'&&lastRun.question?.status==='pending')lastRun={...lastRun,backendDetached:true};
    else if(lastRun?.state==='running')lastRun={...lastRun,state:"stopped",activity:"Backend restarted; saved edits remain"};
    if(waitingForAnswer()){store.session.aiPendingQuestion={run:structuredClone(lastRun),goalPrompts:structuredClone(store.session.aiDirectGoal?.prompts||store.session.aiPendingQuestion?.goalPrompts||[])};void store.flush();}
    else if(data.run&&store.session.aiPendingQuestion){delete store.session.aiPendingQuestion;void store.flush();}
    if (ready && error.startsWith("PC connection lost:")) error = "";
    section.querySelector("#ai-model").textContent =
      "Assistant";
    section.querySelector("#ai-answer").textContent = lastRun?.answer || "";
    section.querySelector("#ai-events").textContent = (lastRun?.events || [])
      .map((e) => e.message)
      .join("\n");
    if (
      lastRun &&
      ["completed", "failed", "stopped", "waiting_for_answer"].includes(lastRun.state) &&
      (store.session.lastAIRun?.id !== lastRun.id || store.session.lastAIRun?.state !== lastRun.state || store.session.lastAIRun?.step !== lastRun.step || store.session.lastAIRun?.question?.id !== lastRun.question?.id || store.session.lastAIRun?.question?.status !== lastRun.question?.status)
    ) {
      store.session.lastAIRun = lastRun;
      store.log("ai.run.end", lastRun);
      store.flush().catch(() => {});
      // Follow-ups belong to their own turn, including after a failed run.
    }
    renderQuestion();
    const review=lastRun?.review;
    accept.hidden=!(lastRun?.state === "completed" && review?.state === "awaiting_feedback" && !store.session.acceptedAIRuns?.includes(lastRun.id));
    accept.disabled=busy();
    if(review && reviewSnapshot?.runId !== lastRun.id) {
      try {reviewSnapshot={runId:lastRun.id,revision:sketchReference(store.session.strokes,review.strokeIds).revision};} catch {reviewSnapshot=undefined;}
    }
    const automation=lastRun?.automation;
    section.querySelector("#ai-plan").textContent=automation?["Automated mode · "+automation.state,automation.goal,automation.reason,...automation.steps.map(s=>(s.state==='completed'?'✓ ':s.state==='active'?'▸ ':'○ ')+s.label)].join("\n"):(lastRun?.plan?.regions || []).map(r=>{
      const report=lastRun.regionReports?.find(p=>p.regionId===r.id);
      return (report?.state || "planned")+" · "+r.id.replace(/[-_]/g," ");
    }).join("\n");
    feedback();
  }
  accept.onclick=async()=>{
    const review=lastRun?.review;
    if(busy() || !review || !dispatch) return;
    accept.disabled=true;
    try {
      if(review.strokeIds?.length) {
        if(!reviewSnapshot) throw Error("Review drawing unavailable; inspect the draft again");
        await dispatch("request_complete",{promptIds:review.promptIds,strokeIds:review.strokeIds,expectedRevision:reviewSnapshot.revision,resultModelIds:review.modelIds,expectedModelVersions:Object.fromEntries(review.models.map(m=>[m.id,m.version])),summary:review.summary});
      }
      (store.session.acceptedAIRuns ??= []).push(lastRun.id);
      store.log("ai.draft.accepted",{runId:lastRun.id,review});
      await store.flush();
      accept.hidden=true;
      banner.querySelector("#assistant-state").textContent="Draft accepted · ready for your next instruction";
      studio?.setAgentState({status:"Draft accepted",detail:"Ready for your next instruction"});
    } catch(e) {error=e.message;feedback();} finally {accept.disabled=false;}
  };
  async function directMoves(prompts,continuation=null,requestId=crypto.randomUUID(),previousDraft=lastRun?{answer:lastRun.answer,review:lastRun.review}:undefined,resume=null,conceptId=null){
        let restored=resume?.payload,audioAttached=!!continuation;
        async function restartOriginalGoal(reason,review,confirmedConcept){
          if(directStopped)return;
          const lostRunId=continuation?.runId||restored?.continueRunId||restored?.runId||lastRun?.id;
          const status=await request('ai-status',{});if(directStopped)return;
          if(status.run?.id===lostRunId&&status.run.state==='completed'){delete store.session.aiDirectCheckpoint;update(status,true);await store.flush();return;}
          if(status.run&&['running','waiting_for_answer'].includes(status.run.state)){
            if(status.run.id!==lostRunId){store.session.previousRecoveryCheckpoint=store.session.aiDirectCheckpoint;delete store.session.aiDirectCheckpoint;update(status,true);await store.flush();activityLog.record('A newer AI request is active · preserved the previous task in history','connection');return;}
            const waiting=Error('Backend run state changed; waiting to reconnect to its pending move');waiting.transient=true;throw waiting;
          }
          const savedGoal=confirmedConcept?.goalPrompts||resume?.goalPrompts||store.session.aiDirectGoal?.prompts||store.session.aiDirectCheckpoint?.goalPrompts;
          let goal=savedGoal?.length?structuredClone(savedGoal):structuredClone(prompts);
          if(!savedGoal?.length&&lastRun?.automation?.goal&&prompts.some(p=>p.source?.startsWith('question-')))goal=[{...prompts[0],id:crypto.randomUUID(),text:lastRun.automation.goal,source:'recovered-goal'}];
          const ids=new Set(goal.map(p=>p.id));for(const p of prompts)if(!ids.has(p.id)&&p.text?.trim())goal.push({...structuredClone(p),text:'Saved user clarification: '+p.text});
          const prior={answer:lastRun?.answer,review:review||lastRun?.review||resume?.payload?.review||previousDraft?.review,recovery:'The backend lost the prior run/continuation. Inspect fresh current geometry and native receipts before continuing the ORIGINAL goal. Some requested edits may already be applied; preserve them and never repeat a mutation just because its acknowledgement was lost.',transportFailure:reason};
          continuation=null;restored=null;delete store.session.aiDirectCheckpoint;store.session.aiDirectGoal={prompts:structuredClone(goal),startedAt:Date.now()};await store.flush();
          activityLog.record('Backend reconnected · inspecting saved geometry and continuing the original goal','connection',{reason});
          return directMoves(goal,null,crypto.randomUUID(),prior,null,confirmedConcept?.id||null);
        }

        if(resume?.phase==='ack'){try{const ack=await request('desktop-applied',restored);update(ack,true);delete store.session.aiDirectCheckpoint;await store.flush();continuation=ack.run?.state==='running'?ack.continuation:null;restored=null;audioAttached=true;if(!continuation)return;}catch(e){if(!/No matching direct edit|No model-requested move/.test(e.message))throw e;return restartOriginalGoal(e.message,resume?.payload?.review);}}
        do{
          moveBeganAt=Date.now();directStage="preparing";feedback();
          let evidence=restored?.evidence;
          while(!evidence){if(!await waitForDrawingPause(studio,()=>directStopped||speaking||transcribing||!!input.value.trim(),()=>activityLog.record('AI paused · waiting for drawing to finish','context')))return;
            try{evidence=await attachStrokeArchives(store,await desktop.prepare(prompts.at(-1).id,continuation?.requestedSketchIds),continuation?.requestedStrokeArchiveIds);}catch(e){if(e.applicationFailure?.kind!=='context_changed')throw e;activityLog.record('New drawing received · refreshing AI context','context');}
          }
          const spokenFocus=[...prompts].reverse().find(p=>p.speechFocus)?.speechFocus;if(spokenFocus){evidence.speechFocus=structuredClone(spokenFocus);const focusFrames=await studio.modeling?.speechFocusFrames?.(spokenFocus.view)||[];evidence.frames.push(...focusFrames);}
          evidence.selectionReferences=prompts.flatMap(p=>p.selectionReferences||[]);evidence.selectionReferences.push(captureSelectionReference(studio));evidence.handRoles={draw:studio.drawHand,grab:studio.grabHand};evidence.designVisualizations=(store.session.conceptHistory||[]).slice(-4).map(({asset,...v})=>v);if(studio.aiDraftReview)evidence.previewOnly=true;
          const audioInputs=audioAttached?[]:await Promise.all(prompts.filter(p=>p.audioRef).map(async p=>{const saved=await store.get("assets",[store.session.id,p.audioRef]);if(!saved)throw Error("Saved voice recording missing");return {id:p.id,mimeType:"audio/wav",audio:await blobToBase64(saved.blob)};}));audioAttached=true;
          if(directStopped)throw Error('Stopped before sending the AI request');
          activityLog.record('Drawing packet ready · '+evidence.strokes.length+' stroke(s), '+evidence.frames.length+' image(s)','evidence',{planes:evidence.strokes.map(s=>({id:s.id,plane:s.surface?.frame||s.fit?.pca,fitKind:s.fit?.selected?.kind})),existingFigures:evidence.figures,units:evidence.units});
          directStage="requesting";feedback();
          const payload=restored||{requestId:continuation?crypto.randomUUID():requestId,...(continuation?{continueRunId:continuation.runId,previousTurn:continuation.previousTurn}:{prompt:prompts.map(p=>p.text).join("\n"),promptIds:prompts.map(p=>p.id),promptSource:prompts.at(-1).source,previousDraft}),...(audioInputs.length?{audioInputs}:{}),...(conceptId?{conceptId}:{}),evidence};
          await saveCheckpoint('request',payload,prompts);
          let response;try{response=await request("desktop-edit",payload);}catch(e){if(payload.continueRunId&&/No model-requested move|No matching direct edit/.test(e.message))return restartOriginalGoal(e.message);throw e;}restored=null;connectionRecovery="";
          if(directStopped)return;
          update(response,true);
          if(!response.edit||response.run?.state!=="running"){
            if(/Browser disconnected|Browser did not acknowledge|Backend restarted/.test(response.run?.error||response.run?.activity||''))return restartOriginalGoal(response.run?.error||response.run?.activity);
            throw Error(response.run?.error||'AI did not return a complete drawing edit');
          }
          if(!await waitForDrawingPause(studio,()=>directStopped||speaking||transcribing||!!input.value.trim(),()=>activityLog.record('AI paused · waiting for drawing to finish','context')))return;
          directStage="applying";
          if(response.edit.edits?.length||response.edit.modelEdits?.length||response.edit.solidEdits?.length)await studio.aiDraftReview?.begin(response.run.id);
          const cadCheckpoint=desktop.workspace!=='vr'&&!response.edit.modelEdits?.length&&(response.edit.edits?.length||response.edit.solidEdits?.length)?await studio.aiDraftReview?.checkpoint({includeClean:true}):null;
          let applied,applyError,applicationFailure,visualizationConceptId;
          try{if(response.edit.toolResult){const tool=response.edit.toolResult;activityLog.record('Harness result · '+tool.name,'tool-result',{name:tool.name,reportCount:tool.reports?.length,modelId:tool.result?.modelId});applied={appliedCount:0,review:{kind:'harness-tool',summary:response.edit.summary,sourceStrokeIds:[]}};}else if(response.edit.focusRequest){const focus=await studio.modeling.focusPart(response.edit.focusRequest);activityLog.record('AI focused '+(focus.modelId||'global assembly'),'tool-result',focus);applied={appliedCount:0,review:{kind:'focus',summary:'Focused design frame',sourceStrokeIds:[],focus}};}else if(response.edit.visualizationRequest){const v=response.edit.visualizationRequest;activityLog.record('AI requested product visualization · '+v.reason,'tool-call');const chosen=await concepts.prepare(v.prompt,{runId:response.run.id,toolCallId:v.toolCallId});if(chosen.recovered)return restartOriginalGoal('The visualization review was restored after the backend restarted.',null,chosen);visualizationConceptId=chosen.id;applied={appliedCount:0,review:{kind:'visualization',summary:'User confirmed a revised product visualization',sourceStrokeIds:[]}};}else applied=await desktop.apply(response.edit,evidence,(message,details)=>activityLog.record(message,'local-edit',details),()=>directStopped||speaking||transcribing||!!input.value.trim()||!!studio.active?.size,response.run.id);}
          catch(e){if(response.edit.visualizationRequest&&e.message.startsWith('Concept review cancelled')){directStopped=true;update(await request('ai-stop',{}),true);return;}applyError=e.message;applicationFailure=e.applicationFailure;if(cadCheckpoint&&!applicationFailure&&!directStopped&&!speaking&&!transcribing&&!studio.active?.size){try{await studio.aiDraftReview.restoreCheckpoint(cadCheckpoint);applicationFailure={kind:'cad_rejection',unchanged:true};activityLog.record('Rejected CAD step rolled back · keeping earlier verified work','recovery',{error:e.message});}catch(restoreError){activityLog.record('CAD rollback needs attention: '+restoreError.message,'error');}}if(applicationFailure?.kind==='context_changed'&&!await waitForDrawingPause(studio,()=>directStopped||speaking||transcribing||!!input.value.trim(),()=>activityLog.record('AI paused · waiting for drawing to finish','context')))return;}
          let expectedRevision=store.session.revision;
          const interrupted=!!(directStopped||speaking||transcribing||pending.length||input.value.trim()||studio.active?.size);
          if(!applyError&&applied?.appliedCount>0){studio.aiDraftReview?.markApplied();studio.drawingGroupId=crypto.randomUUID();
            try{const archiveId=await archiveAppliedStrokes({store,studio,evidence:evidence.spatialFit?.components?.length>1?{...evidence,strokes:evidence.strokes.filter(s=>applied.review?.sourceStrokeIds?.includes(s.id))}:evidence,runId:response.run.id,summary:response.edit.summary});
              if(archiveId){expectedRevision++;activityLog.record('Source strokes archived · showing AI result','archive',{archiveId,tool:'recall_strokes'});}
            }catch(e){applyError='Geometry applied; source ink kept because archiving failed: '+e.message;}
          }
          const acknowledgement={runId:response.run.id,turn:response.run.step,preview:!!studio.aiDraftReview?.active,...(visualizationConceptId?{visualizationConceptId}:{}),...applied,error:applyError,applicationFailure,stopForUserInput:!!(interrupted||directStopped||speaking||transcribing||pending.length||input.value.trim()||studio.active?.size||store.session.revision!==expectedRevision)};
          await saveCheckpoint('ack',acknowledgement,prompts);
          let ack;try{ack=await request("desktop-applied",acknowledgement);}catch(e){if(/No matching direct edit|No model-requested move/.test(e.message))return restartOriginalGoal(e.message,applied?.review);throw e;}
          delete store.session.aiDirectCheckpoint;await store.flush();
          update(ack,true);if((applied?.appliedCount>0||ack.run?.state==='completed')&&store.session.pendingConceptReview)await concepts.completeHandoff?.(visualizationConceptId||conceptId||store.session.pendingConceptReview.id);
          const reply=store.session.pendingQuestionAnswer;
          if(reply?.runId===response.run.id&&response.run.step>reply.turn){delete store.session.pendingQuestionAnswer;await store.flush();}
          if(applyError&&!ack.continuation)throw Error(applyError);
          if(applyError&&ack.continuation)activityLog.record(ack.run?.contextRebase?'New drawing received · AI continuing with updated context':'CAD rejected the operation · AI is correcting it',ack.run?.contextRebase?'context':'recovery',{error:applyError,feedback:ack.run?.contextRebase||ack.run?.nativeRecovery});
          if(response.edit.voiceControl){for(const p of prompts){p.voiceControl=response.edit.voiceControl;const saved=store.session.transcripts.find(t=>t.id===p.id);if(saved)saved.voiceControl=p.voiceControl;}await voiceControl(response.edit.voiceControl);}
          continuation=ack.run?.state==="running"?ack.continuation:null;
          if(continuation)activityLog.record('AI requested another move · '+continuation.reason,'continuation',{nextMove:continuation.nextMove});
        }while(continuation&&!directStopped);

  }
  async function saveCheckpoint(phase,payload,prompts){const asset='agent/direct-recovery.json',goalPrompts=store.session.aiDirectGoal?.prompts||prompts;await store.asset(asset,new Blob([JSON.stringify({phase,payload,goalPrompts})],{type:'application/json'}));store.session.aiDirectCheckpoint={asset,phase,prompts,goalPrompts,updatedAt:Date.now()};await store.flush();}
  async function submit(prompts,resume=null) {
      while(studio.aiDraftReview?.recovering)await new Promise(resolve=>setTimeout(resolve,50));
    if (busy()&&!resume) throw Error("Agent is already working");
    submitting = true;correctionPending=false;
    if(!resume)store.session.aiDirectGoal={prompts:structuredClone(prompts),startedAt:Date.now()};else if(resume.goalPrompts?.length)store.session.aiDirectGoal={prompts:structuredClone(resume.goalPrompts),startedAt:Date.now()};
    delete store.session.pendingAIInstructionId;
    if(desktop){directStage="preparing";directStopped=false;}
    if(!resume&&prompts.some(p=>independentPartRequest(p.text))){beginIndependentDrawing(studio);activityLog.record('Independent part requested · released the previous drawing surface','context');}
    error = "";connectionRecovery="";
    feedback();
    activityLog.record("Sending AI request", "request", {prompt:prompts.map(p=>p.text).join("\n"),desktopEvidence:document.body.classList.contains("desktop-studio"),supervision:studio.aiSupervision?.value});
    const requestId = crypto.randomUUID();
    try {
      studio.endAll();
      await store.flush();
      if(desktop){
        let conceptId=resume?.conceptId;
        if(concepts.enabled&&!resume){const snapshot=await desktop.prepare();if(snapshot.strokes.length&&!snapshot.models?.some(m=>!m.hidden)){
          if(prompts.every(p=>['vr-sketch','desktop-sketch'].includes(p.source))){activityLog.record('Sketch ready · say what you want to create to see alternatives','concept');return;}
          const confirmed=await concepts.prepare(prompts.map(p=>p.text).join('\n'));conceptId=confirmed.id;prompts=[{...prompts.at(-1),text:confirmed.prompt}];store.session.aiDirectGoal={prompts:structuredClone(prompts),startedAt:Date.now()};
        }}
        if(directStopped)return;
        await directMoves(prompts,null,requestId,resume?.previousDraft,resume,conceptId);
      }else update(
        await request("ai-run", {
          requestId,
          desktopEvidence: document.body.classList.contains("desktop-studio"),
          previousDraft: lastRun ? {answer:lastRun.answer,plan:lastRun.plan,regionReports:lastRun.regionReports,review:lastRun.review,artifacts:lastRun.artifacts,question:lastRun.question,questions:lastRun.questions} : undefined,
          prompt: prompts.map((p) => p.text).join("\n"),
          promptId: prompts.at(-1).id,
          promptIds: prompts.map((p) => p.id),
        }),
      );
      store.log("ai.run.start", {
        id: lastRun?.id,
        promptIds: prompts.map((p) => p.id),
        automatic: prompts.every((p) => p.source !== "typed"),
      });
    } catch (e) {
      if(!directStopped&&store.session.aiDirectCheckpoint&&recoverableConnectionError(e)){error='';connectionRecovery='Connection interrupted · continuing automatically when connected';resumeAt=Date.now()+3000;activityLog.record(connectionRecovery,'connection');}
      else{error=directStopped?'':e.message+' — AI could not complete this operation.';delete store.session.aiDirectCheckpoint;}
      store.log("ai.handoff.error", { error: e.message, promptIds: prompts.map((p) => p.id) });
    } finally {
      submitting = false;
      directStage="";
      feedback();
    }
  }
  window.addEventListener('draw3d-concept-restored-confirmed',({detail})=>{store.session.pendingRestoredConcept={id:detail.id,prompt:detail.prompt,goalPrompts:detail.goalPrompts};void store.flush();});
  window.addEventListener('draw3d-concept-restored-cancelled',()=>{delete store.session.pendingRestoredConcept;delete store.session.aiDirectCheckpoint;directStopped=true;void store.flush();feedback();});
  auto.onchange = () => {
    store.session.voiceAIEnabled = auto.checked;
    store.session.autoSpeechAgent = auto.checked;
    if (!auto.checked) pending = [];
    store.flush().catch(() => {});
    feedback();
  };
  async function voiceControl(command){
    if(command==='record-start'||command==='record-stop'){if(command==='record-start')studio.drawingRecorder?.start();else await studio.drawingRecorder?.stop();activityLog.record(command==='record-start'?'Drawing example recording started':'Drawing example saved','voice-control');feedback();return;}
    if(command==='stop'){await stop.onclick();return;}
    if(command==='pause'||command==='enable'){
      auto.checked=command==='enable';auto.onchange();
      if(studio.spatialWorkflow)studio.spatialWorkflow.setEnabled(command==='enable');
      else{const toggle=document.querySelector('#desktop-auto-refine');if(toggle){toggle.checked=command==='enable';toggle.dispatchEvent(new Event('change'));}}
      activityLog.record(command==='enable'?'AI resumed by voice':'AI paused by voice','voice-control');feedback();return;
    }
    if(command==='retry'){
      const previous=[...store.session.transcripts].reverse().find(p=>p.text&&!p.voiceControl&&!voiceAICommand(p.text));
      if(!previous){error='Say what you want to create or change.';feedback();return;}
      if(busy())await stop.onclick();
      auto.checked=true;auto.onchange();pending=[{...previous,id:crypto.randomUUID(),source:'voice-retry'}];due=Date.now()+1800;error='';feedback();
    }
  }
  async function queueQuestionAudio(p){
    const q=lastRun.question,runId=lastRun.id,old=store.session.pendingQuestionAnswer;
    const audioPrompts=old?.runId===runId&&old.questionId===q.id?[...old.audioPrompts]:[];
    if(!audioPrompts.some(a=>a.id===p.id))audioPrompts.push(p);
    store.session.pendingQuestionAnswer={runId,questionId:q.id,turn:q.turn,answer:'Recorded voice answer',source:'speech',audioPrompts,state:'queued'};
    await store.flush();
    if(!store.session.transcripts.some(t=>t.id===p.id))addTranscript(p);
    store.log('ai.question.audio.saved',{runId,questionId:q.id,audioId:p.id});
    questionBox.querySelector('#agent-answer-status').textContent='Voice answer saved · sending directly to AI';
    if(!directStopped&&!speaking&&!transcribing&&!answering&&lastRun?.id===runId&&waitingForAnswer())await answerQuestion('Recorded voice answer','speech',false,audioPrompts);
  }
  let conceptAudioQueue=Promise.resolve();
  async function receiveConceptAudio(d){
    if(seen.has(d.id))return;seen.add(d.id);transcribing=true;speechStatus='Transcribing…';feedback();
    try{const saved=await store.get('assets',[store.session.id,d.name]);if(!saved)throw Error('Voice recording is missing');
      const {text}=await request('concept-transcribe',{audioInputs:[{mimeType:'audio/wav',audio:await blobToBase64(saved.blob)}]});
      if(!text?.trim())return;
      const p={id:d.id,text,speechFocus:d.speechFocus,source:'openai-transcription',start:d.start,end:d.end,selectionReferences:[speechSelectionReference,captureSelectionReference(studio,'speech-end')].filter(Boolean)};
      const pendingControl=voiceAICommand(text);if(concepts.pending&&['stop','pause','enable'].includes(pendingControl)){addTranscript({...p,voiceControl:pendingControl});await voiceControl(pendingControl);return;}
      if(concepts.pending){addTranscript({...p,conceptControl:true});if(!concepts.voice(text))activityLog.record('Say choose one, two or three, confirm, regenerate, or cancel','concept');return;}
      const command=voiceAICommand(text);if(command){addTranscript({...p,voiceControl:command});await voiceControl(command);return;}
      if(waitingForAnswer()){addTranscript(p);transcribing=false;speechStatus='Ready for speech';await answerQuestion(text,'speech',false,[p]);return;}
      addTranscript(p);pending.push(p);due=Date.now()+450;error='';activityLog.record('Voice transcribed · '+text,'audio');
    }catch(e){error='Voice instruction could not be processed: '+e.message;}finally{transcribing=false;speechStatus='Ready for speech';feedback();}
  }
  window.addEventListener("draw3d-audio-final",({detail:original})=>{
    if(decisionLab)return;
    if(seen.has(original.id))return;if(!speechFocusByAudio.has(original.id)){speechFocusByAudio.set(original.id,focusForAudio());if(speechFocusByAudio.size>32)speechFocusByAudio.delete(speechFocusByAudio.keys().next().value);}
    const d={...original,speechFocus:speechFocusByAudio.get(original.id)};
    if(concepts.enabled||desktop?.workspace==='desktop'&&modelNeedsTranscription){conceptAudioQueue=conceptAudioQueue.then(()=>receiveConceptAudio(d));return;}
    if(seen.has(d.id))return;seen.add(d.id);
    const p={id:d.id,speechFocus:d.speechFocus,text:'Recorded voice instruction',source:'direct-audio',audioRef:d.name,start:d.start,end:d.end,selectionReferences:[speechSelectionReference,captureSelectionReference(studio,'speech-end')].filter(Boolean)};
    if(waitingForAnswer()){void queueQuestionAudio(p).catch(e=>{error='Voice answer saved locally; could not send: '+e.message;store.log('ai.question.error',{error:e.message});feedback();});return;}
    addTranscript(p);
    pending.push(p);correctionExpected=false;due=Date.now()+450;error='';
    activityLog.record('Voice audio queued · direct to model, no transcription','audio',{audioId:d.id});feedback();
  });
  window.addEventListener("draw3d-transcript-final", ({ detail: p }) => {
    if(decisionLab)return;
    if(p.localCommand||p.conceptControl||p.source==='openai-transcription')return;
    if(concepts.pending&&p.text?.trim()){if(concepts.voice(p.text))seen.add(p.id);return;}
    const spoken=['gemini-audio','browser-speech','browser-on-device'].includes(p.source),command=spoken&&voiceAICommand(p.text);if(spoken&&!p.speechFocus)p.speechFocus=focusForAudio();
    if(command&&!seen.has(p.id)){seen.add(p.id);void voiceControl(command).catch(e=>{error=e.message;feedback();});return;}

    if(waitingForAnswer()&&p.source==="typed"&&p.text?.trim()&&!seen.has(p.id)){seen.add(p.id);void answerQuestion(p.text,"typed",false);return;}
    if(waitingForAnswer() && ["gemini-audio","browser-speech","browser-on-device"].includes(p.source) && p.text?.trim() && !seen.has(p.id)) {
      seen.add(p.id);answerBatch.push(p);answerDue=Date.now()+1800;questionBox.querySelector("#agent-answer-status").textContent="Heard: "+answerBatch.map(a=>a.text).join(" ");return;
    }
    if(!auto.checked&&!correctionExpected&&["typed","gemini-audio","browser-speech","browser-on-device"].includes(p.source)&&p.text?.trim()&&!seen.has(p.id)){
      store.session.pendingAIInstructionId=p.id;
      activityLog.record('Request saved · voice AI paused · say resume AI','request',{prompt:p.text});
      store.flush().catch(()=>{});feedback();return;
    }
    if (
      (!auto.checked&&!correctionExpected) ||
      !["gemini-audio", "browser-speech", "browser-on-device",...(desktop?.workspace==="vr"?["typed"]:[])].includes(p.source) ||
      !p.text?.trim() ||
      seen.has(p.id)
    )
      return;
    seen.add(p.id);
    pending.push(p);correctionExpected=false;
    due = Date.now() + 1800;
    error = "";
    store.log("ai.speech.queued", { promptId: p.id });
    feedback();
  });
  function interruptCreation(reason){
    if(!desktop||!busy()||directStopped||waitingForAnswer()||concepts.pending)return;
    correctionExpected=true;correctionPending=true;directStopped=true;
    activityLog.record('Creation paused · '+reason,'interruption');
    void request("ai-stop",{}).then(data=>update(data,true)).catch(()=>{});
  }
  input.addEventListener('input',()=>{if(input.value.trim())interruptCreation('new text instruction');});
  window.addEventListener("draw3d-speech-activity", ({ detail: d }) => {
    if(d.speaking&&!speaking){speechSelectionReference=captureSelectionReference(studio,'speech-start');speechFocusTracker.start();}if(d.speaking===false&&speaking){const focus=speechFocusTracker.finish();if(focus){speechFocusQueue.push(focus);if(speechFocusQueue.length>4)speechFocusQueue.shift();}}
    if (d.speaking !== undefined) speaking = d.speaking;
    if (d.transcribing !== undefined) transcribing = d.transcribing;
    // A new utterance is a follow-up. Only an explicit stop cancels active voice work.
    if (speaking || transcribing) {due = Date.now() + 1800;answerDue=Date.now()+1800;}
    feedback();
  });
  window.addEventListener("draw3d-speech-status", ({ detail: d }) => {
    speechStatus = d.text;
    feedback();
  });
  setInterval(() => {
    // New speech is queued until the current model turn finishes.
    if(speaking)speechFocusTracker.sample();
    const recoveredChoice=store.session.pendingRestoredConcept;if(recoveredChoice&&ready&&!submitting&&!migrating&&!answering&&!speaking&&!transcribing&&!concepts.pending){delete store.session.pendingRestoredConcept;delete store.session.aiDirectCheckpoint;const goal=recoveredChoice.goalPrompts?.length?recoveredChoice.goalPrompts:[{id:crypto.randomUUID(),text:recoveredChoice.prompt,source:'restored-concept'}];void submit(goal,{phase:'confirmed-concept',conceptId:recoveredChoice.id,goalPrompts:goal,previousDraft:{recovery:'The user explicitly reconfirmed saved design images after the backend restarted. Inspect current models and preserve already applied edits before continuing the original goal.'}});}
    if(busy())feedback();
    if(store.session.aiDirectCheckpoint&&!concepts.pending&&!submitting&&!migrating&&!answering&&!directStopped&&ready&&!speaking&&!transcribing&&!studio.active?.size&&!input.value.trim()&&!pending.length&&Date.now()>=resumeAt){resumeAt=Date.now()+3000;void resumePending();}
    const reply=store.session.pendingQuestionAnswer;
    if(reply&&ready&&!directStopped&&!migrating&&!submitting&&!answering&&!speaking&&!transcribing&&Date.now()>=answerRetryAt&&reply.runId===lastRun?.id&&reply.questionId===lastRun?.question?.id&&(waitingForAnswer()||lastRun.state==='running'&&lastRun.question.status==='answered'&&lastRun.step===lastRun.question.turn))void answerQuestion(reply.answer,reply.source,false,reply.audioPrompts);
    if(answerBatch.length && waitingForAnswer() && !answering && !speaking && !transcribing && Date.now()>=answerDue){const text=answerBatch.map(p=>p.text).join(" ");const batch=answerBatch;answerBatch=[];void answerQuestion(text,"speech",false,batch);}
    if (pending.length && !busy() && ready && !speaking && !transcribing && Date.now() >= due) {
      const batch = pending;
      pending = [];
      void submit(batch);
    }
  }, 250);
  runButton.onclick = async () => {
    if (busy()) return;
    let prompt;
    if (input.value.trim()) {
      prompt = {
        id: crypto.randomUUID(),
        text: input.value.trim(),
        start: store.elapsed(),
        end: store.elapsed(),
        source: "typed",
      };
      seen.add(prompt.id);
      addTranscript(prompt);
      store.session.instructionDraft = "";
      input.value = "";
      window.dispatchEvent(new Event("draw3d-instruction-draft"));
    } else prompt = savedInstruction()||store.session.transcripts.at(-1);
    if (!prompt?.text) {
      error = "Type or speak an instruction first.";
      feedback();
      return;
    }
    const batch=pending.filter(p=>p.id!==prompt.id);pending=[];
    seen.add(prompt.id);
    await submit([...batch,prompt]);
  };
  stop.onclick = async () => {
    correctionPending=false;correctionExpected=false;
    window.dispatchEvent(new Event("draw3d-ai-stopped"));
    pending = [];
    error = "";
    if(desktop)directStopped=true;
    connectionRecovery='';delete store.session.aiDirectCheckpoint;await store.flush();
    try {
      update(await request("ai-stop", {}),true);
    } catch (e) {
      error = e.message;
      feedback();
    }
  };
  banner.querySelector("#assistant-stop").onclick = () => stop.click();
  banner.querySelector("#assistant-details").onclick = () => {
    panel.hidden = false;
    const instructions=document.querySelector("#vr-instructions");if(instructions)instructions.open=true;
    section.scrollIntoView({ block: "nearest" });
  };
  async function uploadAudio() {
    const queue = store.session.audioUploadQueue || [];
    if (uploading || !queue.length || !ready) return;
    uploading = true;
    const item = queue[0];
    try {
      const asset = await store.get("assets", [store.session.id, item.name]);
      if (!asset) throw Error("Recorded audio asset is missing");
      audioText = "Saving audio to PC…";
      feedback();
      await request("audio-log", {
        id: item.id,
        audio: await blobToBase64(asset.blob),
        start: item.start,
        end: item.end,
        transcripts: store.session.transcripts
          .filter((t) => t.end >= item.start && t.start <= item.end)
          .map((t) => ({ id: t.id, text: t.text, source: t.source })),
      });
      queue.shift();
      audioText = "Audio saved on headset + PC";
      store.log("audio.pc.saved", { id: item.id });
      await store.flush();
    } catch (e) {
      audioText = "Audio on headset; PC save pending: " + e.message;
    } finally {
      uploading = false;
      audioStatus.textContent = audioText;
      feedback();
    }
  }
  window.addEventListener("draw3d-audio-saved", () => void uploadAudio());
  setInterval(() => {
    void uploadAudio();
    if(desktop)return;
    request("ai-status", {})
      .then(update)
      .catch((e) => {
        ready = false;
        error = "PC connection lost: " + e.message;
        feedback();
      });
  }, 1500);
  async function archivePreviousDrawing(){
    if(store.session.strokeArchiveMigration===1)return;
    if(store.session.strokes.length&&(store.session.spatialObjects?.length||store.session.desktopFigures?.length||store.session.lastAIRun?.state==='completed')){
      const evidence=await desktop.prepare();await archiveAppliedStrokes({store,studio,evidence,runId:store.session.lastAIRun?.id,summary:'Previous source drawing'});
    }
    store.session.strokeArchiveMigration=1;await store.flush();
  }
  window.addEventListener('draw3d-ready',()=>{migrating=true;queueMicrotask(async()=>{try{await studio.desktopHistory?.ready;await archivePreviousDrawing();if(store.session.pendingConceptReview)await concepts.restorePending?.();}catch(e){error='Could not archive previous drawing: '+e.message;}finally{migrating=false;feedback();}});},{once:true});
  async function resumePending(){if(submitting||migrating||resuming)return;resuming=true;try{const checkpoint=store.session.aiDirectCheckpoint;if(checkpoint){const saved=await store.get('assets',[store.session.id,checkpoint.asset]);if(saved)return await submit(checkpoint.prompts,JSON.parse(await saved.blob.text()));}const prior=[...store.session.transcripts].reverse().find(p=>p.text&&!p.voiceControl&&!voiceAICommand(p.text));if(!prior)return;update(await request('ai-stop',{}),true);return await submit([prior]);}finally{resuming=false;}}
  studio.strokeArchive={archive:async()=>{const evidence=await desktop.prepare();return archiveAppliedStrokes({store,studio,evidence,summary:'Previous source drawing'});},recall:async ids=>attachStrokeArchives(store,await desktop.prepare(),ids)};
  return { update,resumePending,get waitingForAnswer(){return waitingForAnswer();},answerInstruction:(text,source="typed")=>answerQuestion(text,source),get recoveryState(){return {submitting,migrating,answering,directStopped,ready,speaking,transcribing,pending:pending.length,resuming,resumeAt};},get stopped(){return directStopped;}, get ready(){return ready;}, get busy(){return busy();},get conceptEdition(){return concepts.enabled;}, get awaitingInput(){return !!(pending.length||speaking||transcribing);}, async submitInstruction(text, source="desktop-sketch") {
    if(!ready)throw Error("AI backend is unavailable. Start npm run bridge and configure the provider.");
    if(busy())throw Error("AI is already working; drawing changes remain queued.");
    const p={id:crypto.randomUUID(),text,start:store.elapsed(),end:store.elapsed(),source};
    seen.add(p.id);addTranscript(p);await submit([p]);if(error)throw Error(error);return lastRun;
  } };
}
