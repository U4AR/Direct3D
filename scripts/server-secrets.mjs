import {readFileSync} from 'node:fs';
// Docker secrets are mounted only in backend services, never in the web build.
for(const name of ['META_API_KEY','GEMINI_API_KEY','GEMINI_AGENT_API_KEY','VERTEX_AGENT_API_KEY','OPENAI_API_KEY','MODELING_SERVICE_TOKEN']){
 if(process.env[name+'_FILE'])process.env[name]=readFileSync(process.env[name+'_FILE'],'utf8').trim();
}
