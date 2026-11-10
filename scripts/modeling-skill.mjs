import {readFileSync} from 'node:fs';
let cached;
export function nativeModelingSkill(){if(process.env.DRAW3D_MODELING_SKILL==='0')return '';cached??=readFileSync(new URL('../agent-skills/native-cad-collaboration/SKILL.md',import.meta.url),'utf8').replace(/^---[\s\S]*?---\s*/,'');return 'BEGIN_DRAW3D_MODELING_SKILL\n'+cached+'\nEND_DRAW3D_MODELING_SKILL';}
