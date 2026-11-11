import {SUPERVISION_LEVELS,SUPERVISION_LABELS,SUPERVISION_HELP,normalizeSupervision} from './ai-supervision-policy.js';
const key='draw3d.ai.supervision';
export function initAISupervision(studio,store,parent){
 const root=document.createElement('section');root.id='ai-supervision-controls';root.innerHTML='<label for="ai-supervision">AI supervision</label><select id="ai-supervision" aria-label="AI supervision"></select><details><summary>About supervision</summary><p id="ai-supervision-help" class="hint"></p></details>';
 const select=root.querySelector('select'),help=root.querySelector('p');for(const level of SUPERVISION_LEVELS){const option=document.createElement('option');option.value=level;option.textContent=SUPERVISION_LABELS[level];select.append(option);}parent.querySelector('#ai-model').after(root);
 let initial=store.session.aiSupervision;if(initial==='balanced'&&!store.session.aiSupervisionChosen)initial=undefined;try{initial=localStorage.getItem(key)||initial;}catch{}let value=normalizeSupervision(initial);
 function set(level,{write=true,announce=true}={}){value=normalizeSupervision(level);select.value=value;help.textContent=SUPERVISION_HELP[value]+' Applies to the next AI request.';store.session.aiSupervision=value;if(write)try{localStorage.setItem(key,value);}catch{}store.flush().catch(()=>{});studio.updateHUD?.();if(announce)window.dispatchEvent(new CustomEvent('draw3d-ai-log',{detail:{message:'AI supervision · '+SUPERVISION_LABELS[value],kind:'preference',details:{level:value}}}));}
 select.onchange=()=>{store.session.aiSupervisionChosen=true;set(select.value);};window.addEventListener('storage',e=>{if(e.key===key)set(e.newValue,{write:false});});
 const api={get value(){return value;},evidence:()=>({level:value}),set,cycle:()=>set(SUPERVISION_LEVELS[(SUPERVISION_LEVELS.indexOf(value)+1)%SUPERVISION_LEVELS.length])};studio.aiSupervision=api;set(value,{write:false,announce:false});return api;
}
