// A generated preview is compiled to the existing native document format and validated by the server.
export function appendGeneratedRecipe(document,recipe,{additive=false,toolId='preview-feature'}={}){
 if(!Array.isArray(recipe)||!recipe.length||recipe.length>6||!recipe[0].operation.startsWith('create_')||recipe.some((s,i)=>!['create_cube','create_sphere','create_cylinder','create_sketch','extrude','revolve'].includes(s.operation)||i>0&&s.operation.startsWith('create_')))throw Error('Unsupported fitted CAD recipe');
 const d=structuredClone(document),target=additive?toolId:d.targetId;for(const step of recipe)d.operations.push({operation:step.operation,targetId:target,toolIds:[],name:step.name||'Preview '+step.operation,parameters:structuredClone(step.parameters)});if(additive)d.operations.push({operation:'union',targetId:d.targetId,toolIds:[target],name:'Join sketch feature',parameters:{}});return d;
}
