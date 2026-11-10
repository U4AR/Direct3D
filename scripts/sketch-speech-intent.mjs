import {readProvider} from './provider-read.mjs';
import {decisionCost} from './decision-sketch-api.mjs';

export async function classifySketchSpeech(data,{question,apiKey=process.env.OPENAI_API_KEY,fetcher=fetch,onRetry}={}) {
 const words=data.text;
 if(typeof words!=='string'||!words.trim()||words.length>4000)throw Error('Voice instruction must contain 1–4000 characters');
 if(!apiKey)throw Error('Speech filter needs a configured backend');
 const body={model:'gpt-6-luna',input:[{role:'user',content:[{type:'input_text',text:JSON.stringify({
  transcript:words,currentInstruction:String(data.currentInstruction||'').slice(0,500),question:String(question||data.question||'').slice(0,500),hasSketch:!!data.hasSketch
 })}]}],questions:[{name:'speech_intent',type:'choice',
  instructions:'Is the transcript addressed to this drawing or CAD workspace? Consider the transcript in its original language and the supplied context. Accept creation, editing, view or selection instructions, dimensions, design descriptions, corrections, questions and brief replies that answer the current design question. If a mixed utterance contains an actionable design request, accept. A prior design request alone does not make a new unrelated conversation relevant. Ignore clearly unrelated conversation, background media and transcription noise.',
  choices:[{value:'modeling',description:'A design or workspace utterance, including a plausible contextual follow-up.'},{value:'unrelated',description:'Background speech or an unrelated conversation.'}]}]};
 const json=await readProvider(fetcher,'https://api.openai.com/v1/decisions',{method:'POST',headers:{Authorization:'Bearer '+apiKey,'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(12000)},async response=>{
 if(!response.ok)throw Error('Speech filter unavailable (HTTP '+response.status+')');
 return response.json();
 },{stage:'Speech filter',onRetry});
 const answer=json.answers?.find(a=>a.name==='speech_intent'&&a.type==='choice');
 if(!['modeling','unrelated'].includes(answer?.choice))throw Error('Speech filter returned no decision');
 return {choice:answer.choice,confidence:answer.confidence,cost:decisionCost(json.usage)};
}
