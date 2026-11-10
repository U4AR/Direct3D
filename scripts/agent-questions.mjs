import { randomUUID } from "node:crypto";

const pending = new WeakMap();
export const runInFlight = (run) => ["running", "waiting_for_answer"].includes(run?.state);

// This clock counts actual work time, excluding time spent waiting for the human.
export function createPausableDeadline(onExpire, limitMs = 1800000, clock = {}) {
  const now = clock.now || Date.now;
  const schedule = clock.setTimeout || setTimeout;
  const cancel = clock.clearTimeout || clearTimeout;
  let remaining = limitMs, started = now(), timer, stopped = false, paused = true;
  const resume = () => {
    if (stopped || !paused) return;
    paused = false; started = now();
    timer = schedule(() => { stopped = true; onExpire(); }, Math.max(0, remaining));
    timer?.unref?.();
  };
  const pause = () => {
    if (stopped || paused) return;
    remaining = Math.max(0, remaining - (now() - started));
    cancel(timer); paused = true;
  };
  const dispose = () => { stopped = true; cancel(timer); };
  resume();
  return { pause, resume, dispose };
}

export async function askAgentQuestion(run, args, signal, onWaiting = async () => {}) {
  signal.throwIfAborted();
  if (pending.has(run)) throw Error("A clarification question is already pending");
  if (typeof args.question !== "string" || !args.question.trim() || args.question.length > 600)
    throw Error("Provide one concise question up to 600 characters");
  if (!Array.isArray(args.options) || args.options.length < 2 || args.options.length > 4 ||
      args.options.some((option) => typeof option !== "string" || !option.trim() || option.length > 120) ||
      new Set(args.options.map((option) => option.trim().toLowerCase())).size !== args.options.length)
    throw Error("Provide 2 to 4 distinct short answer options, each at most 120 characters");
  if (args.reason !== undefined && (typeof args.reason !== "string" || args.reason.length > 1000)) throw Error("Question reason is too long");
  if (args.region !== undefined && (typeof args.region !== "string" || args.region.length > 160)) throw Error("Invalid question region");
  if ((run.questions?.length || 0) >= 12) throw Error("Clarification limit reached; summarize the unresolved decisions");
  const question = { id: randomUUID(), question: args.question.trim(), options: args.options.map((option) => option.trim()),
    ...(args.reason ? { reason: args.reason } : {}), ...(args.region ? { region: args.region } : {}),
    status: "pending", askedAt: Date.now() };
  run.questions ||= [];
  run.questions.push(question);
  run.question = question;
  run.state = "waiting_for_answer";
  run.pauseDeadline?.();
  let resolveAnswer, rejectAnswer;
  const answer = new Promise((resolve, reject) => { resolveAnswer = resolve; rejectAnswer = reject; });
  // Attach a handler immediately: onWaiting may asynchronously log while a Stop arrives.
  answer.catch(() => {});
  const abort = () => {
    if (question.status === "pending") { question.status = "cancelled"; question.cancelledAt = Date.now(); }
    pending.delete(run);
    rejectAnswer(signal.reason || Error("Question cancelled"));
  };
  pending.set(run, { question, resolve: resolveAnswer, signal });
  signal.addEventListener("abort", abort, { once: true });
  try {
    if (signal.aborted) abort();
    await onWaiting(question);
    return await answer;
  } finally {
    signal.removeEventListener("abort", abort);
    if (question.status === "pending") { question.status = "cancelled"; question.cancelledAt = Date.now(); }
    pending.delete(run);
    if (!signal.aborted) {
      run.state = "running";
      run.resumeDeadline?.();
    }
  }
}

// Direct edits do not suspend an MCP tool: the human answer authorizes the next direct move.
export function askDirectQuestion(run,text,options=[]){
 if(typeof text!=='string'||!text.trim()||text.length>600)throw Error('Provide one concise question up to 600 characters');
 if(run.question?.status==='pending')throw Error('A clarification question is already pending');
 const question={id:randomUUID(),question:text.trim(),options,status:'pending',askedAt:Date.now(),turn:run.step};
 (run.questions??=[]).push(question);run.question=question;run.state='waiting_for_answer';run.awaitingContinuation=false;run.continuationRequestedAt=undefined;run.finishedAt=undefined;run.activity='Waiting for your answer';
 return question;
}
export function directContinuation(run){
 if(!run?.awaitingContinuation)return null;
 const clarified=run.question?.status==='answered'&&run.question.turn===run.step;
 const move=clarified?{reason:'The user answered the design question',nextMove:'Continue the original request using the user clarification and current geometry.'}:run.contextRebasePending?{reason:'New drawing or model input received',nextMove:'Continue the original request using the updated drawing and current geometry. The stale proposal was not applied.'}:run.nativeRecoveryPending?{reason:'Correct the rejected native operation using engine feedback',nextMove:'Inspect the unchanged current geometry and correct the rejected operation; preserve the original user request.'}:run.edit?.continuation;
 return move?{runId:run.id,previousTurn:run.step,requestedSketchIds:run.edit?.requestedSketchIds||[],requestedStrokeArchiveIds:run.edit?.requestedStrokeArchiveIds||[],...move}:null;
}

export function answerAgentQuestion(run, data) {
  if (!run || data.runId !== run.id) throw Error("No matching AI run for this answer");
  if (typeof data.questionId !== "string") throw Error("Provide the question ID");
  if (typeof data.answer !== "string" || !data.answer.trim() || data.answer.length > 12000)
    throw Error("Provide an answer up to 12,000 characters");
  const source = data.source || "typed";
  if (!["typed", "speech", "option"].includes(source)) throw Error("Answer source must be typed, speech, or option");
  const answer = data.answer.trim();
  const question = run.questions?.find((q) => q.id === data.questionId);
  if (!question) throw Error("No matching clarification question");
  if (question.status === "answered") {
    if (question.answer !== answer) throw Error("This question already has a different answer");
    return { accepted: true, duplicate: true, questionId: question.id };
  }
  if(run.mode==='direct'){
    if(question.status!=='pending'||run.state!=='waiting_for_answer'||run.question?.id!==question.id||run.controller?.signal.aborted)throw Error('This question is no longer awaiting an answer');
    Object.assign(question,{status:'answered',answer,source,answeredAt:Date.now()});run.state='running';run.awaitingContinuation=true;run.continuationRequestedAt=Date.now();run.activity='Answer received; preparing the next edit';if(run.automation)run.automation.state='running';
    return {accepted:true,duplicate:false,questionId:question.id};
  }
  const waiter = pending.get(run);
  if (question.status !== "pending" || run.state !== "waiting_for_answer" || waiter?.question.id !== question.id || waiter.signal.aborted)
    throw Error("This question is no longer awaiting an answer");
  Object.assign(question, { status: "answered", answer, source, answeredAt: Date.now() });
  // Resolve exactly this suspended tool call. Never create another agent run.
  waiter.resolve({ questionId: question.id, question: question.question, answer, source,
    ...(question.region ? { region: question.region } : {}), answeredAt: question.answeredAt });
  return { accepted: true, duplicate: false, questionId: question.id };
}
