const str = { type: "string" };
const strings = { type: "array", items: str };
const tool = (name, description, properties, required) => ({ name, description,
  inputSchema: { type: "object", properties, required, additionalProperties: false } });
export const regionalTools = [
  tool("agent_ask_question", "Ask the user one consequential design question and suspend this same run until they answer by voice, typing or an option. Supply 2 to 4 concise choices. Use when intent affects topology, CAD versus mesh, depth, attachment or feature choice; avoid asking about minor details. Only the orchestrator asks. The tool returns the real user answer and resumes this conversation.",
    { question: str, options: { type: "array", items: str, minItems: 2, maxItems: 4 }, reason: str, region: str }, ["question", "options"]),
  tool("agent_plan", "Record a small dependency-ordered regional modeling plan before delegating. Each specialist receives the complete original goal and plan. Region stroke IDs must be explicitly inspected; choose spline-extrude, revolve, mesh-from-projection or another justified technique. Replanning cannot discard completed regions.", {
    regions: { type: "array", minItems: 1, maxItems: 8, items: {
      type: "object", additionalProperties: false,
      properties: { id: str, goal: str, mode: { enum: ["cad", "sculpt"] }, strokeIds: strings,
        dependsOn: strings, modelIds: strings, technique: str, acceptanceCriteria: strings,
        ranges: { type: "array", minItems: 1, items: { type: "object", additionalProperties: false,
          properties: { strokeId: str, start: { type: "integer", minimum: 0 }, end: { type: "integer", minimum: 1 } },
          required: ["strokeId", "start", "end"] } } },
      required: ["id", "goal", "mode", "strokeIds", "technique", "acceptanceCriteria"] } },
  }, ["regions"]),
  tool("agent_delegate", "Execute one region specialist using a real model loop with the total goal, full plan, dependencies and prior region reports. Runs serially in this same session. Inspect the structured report; do not repeat failed mutations blindly. Maximum 8 specialists, 40 turns each, shared 160-turn budget. Reuse supplied artifact handles and partial models rather than rebuilding inspected regions.",
    { regionId: str, instructions: str }, ["regionId"]),
  tool("agent_review", "Stage the verified assembly for user feedback. Requires a scene_models refresh and an agent_capture or sketch_views image covering all result IDs after the last geometry edit. Leaves drawings visible; user feedback is required before further polish or archival. Does not claim fidelity automatically. Every unbuilt or failed planned region needs an explicit omittedRegions reason; omit its strokes from acceptance.",
    { modelIds: { ...strings, minItems: 1 }, summary: str, uncertainties: strings, placementReason: str,
      omittedRegions: { type: "array", items: { type: "object", additionalProperties: false,
        properties: { regionId: str, reason: str }, required: ["regionId", "reason"] } } }, ["modelIds", "summary"]),
];
export function checkedPlan(regions, reports = []) {
  const ids = new Set(regions.map((r) => r.id));
  if (ids.size !== regions.length || regions.some((r) => !r.id.trim() || !r.goal.trim()))
    throw Error("Region IDs must be unique and nonempty; each region needs a goal");
  const visited = new Set(), active = new Set();
  function visit(id) {
    if (!ids.has(id)) throw Error("Unknown region dependency " + id);
    if (active.has(id)) throw Error("Region dependencies contain a cycle");
    if (visited.has(id)) return;
    active.add(id);
    for (const next of regions.find((r) => r.id === id).dependsOn || []) visit(next);
    active.delete(id); visited.add(id);
  }
  for (const id of ids) visit(id);
  for (const region of regions) for (const range of region.ranges || []) {
    if (!region.strokeIds.includes(range.strokeId) || range.end <= range.start)
      throw Error("Region range must have ordered endpoints inside an assigned stroke");
  }
  for (const report of reports) {
    if (!ids.has(report.regionId)) throw Error("Cannot discard an already attempted region");
  }
  return regions.map((r) => ({ ...r, dependsOn: r.dependsOn || [], modelIds: r.modelIds || [] }));
}
export const geometryTools = new Set([
  "drawing_create", "drawing_update",
  "cad_create_project", "cad_execute", "cad_trace_projection", "cad_set_sketch_plane", "cad_undo", "cad_redo",
  "sculpt_create", "sculpt_brush", "sculpt_from_projection", "sculpt_tube", "sculpt_undo", "sculpt_redo", "model_transform",
  "primitive_from_strokes", "model_transfer", "model_align_to_sketch", "model_match_sketch", "model_visibility",
  "surface_create", "surface_update", "surface_fit", "surface_trim", "surface_commit", "model_mirror", "model_pattern",
]);
export const childForbidden = new Set([
  "agent_plan", "agent_delegate", "agent_review", "agent_ask_question", "request_complete", "sketch_visibility",
  "cad_create_project", "cad_undo", "cad_redo", "sculpt_undo", "sculpt_redo",
]);
export function checkChildScope(tool, args, region, owned) {
  if (["surface_update","surface_fit","surface_trim","surface_commit"].includes(tool) && !owned.has(args.surfaceId)) throw Error("Region cannot edit an unassigned surface");
  const permitted = (id) => owned.has(id) || owned.has("sculpt::" + id) || owned.has("cad::" + id);
  for (const id of [args.modelId, ...(args.modelIds || []), ...(args.resultModelIds || [])].filter(Boolean)) {
    if (geometryTools.has(tool) && !permitted(id)) throw Error("Region cannot modify an unassigned model: " + id);
  }
  if (["sculpt_tube","stroke_fit_curve"].includes(tool) && args.strokeId && !region.strokeIds.includes(args.strokeId))
    throw Error("Region tube path exceeds its assigned strokes");
  if (["sculpt_tube","stroke_fit_curve"].includes(tool) && args.strokeId && region.ranges?.length)
    throw Error("Partial-stroke region: provide explicit tube points from the assigned interval");
  if (tool === "sculpt_brush" && !permitted(args.id)) throw Error("Region cannot brush an unassigned mesh");
  if (args.strokeIds?.some((id) => !region.strokeIds.includes(id))) throw Error("Region stroke selection exceeds its assigned contract");
  if (args.ranges?.some((range) => !region.strokeIds.includes(range.strokeId))) throw Error("Region sample range exceeds its assigned strokes");
  if (region.ranges?.length && args.ranges?.some((range) => !region.ranges.some((allowed) =>
    allowed.strokeId === range.strokeId && range.start >= allowed.start && range.end <= allowed.end)))
    throw Error("Region sample range exceeds its assigned interval");
  if (["sketch_project", "sketch_pca", "sketch_fit_primitive", "surface_fit"].includes(tool) && region.ranges?.length && !args.ranges)
    args.ranges = region.ranges;
  if (["sketch_project", "sketch_fit_plane", "sketch_pca", "sketch_fit_primitive", "stroke_load"].includes(tool) && !args.strokeIds && region.strokeIds.length)
    args.strokeIds = region.strokeIds;
  if (tool === "sketch_fit_plane" && region.ranges?.length)
    throw Error("Partial-stroke region: fit using sketch_pca/sketch_fit_primitive with assigned ranges, then sketch_project with an explicit plane");
  if (tool === "primitive_from_strokes") {
    if (region.ranges?.length) throw Error("Partial-stroke region: use projection/native creation for the assigned ranges instead of a whole-stroke primitive");
    if (args.workspace && args.workspace !== region.mode) throw Error("Primitive workspace must match assigned region");
    args.workspace = region.mode;
  }
  if (tool.startsWith("cad_") && geometryTools.has(tool) && region.mode !== "cad") throw Error("Sculpt specialist cannot edit CAD");
  if (tool.startsWith("sculpt_") && geometryTools.has(tool) && region.mode !== "sculpt") throw Error("CAD specialist cannot edit SculptGL");
  if (tool === "cad_execute" && /^(delete|import|moveFeature|updateFeature|setParameter|renameParameter|configureParameter)/.test(args.operation))
    throw Error("Global/destructive CAD operation reserved for orchestrator review");
}


const artifactTools = new Set(["surface_create", "surface_update", "surface_fit", "surface_trim", "surface_commit", "stroke_fit_curve", "curve_refit", "stroke_load", "sketch_fit_plane", "sketch_plane_update", "sketch_project", "sketch_pca", "sketch_fit_primitive"]);
const omittedArrays = new Set(["points", "vertices", "indices", "samples", "inliers", "outliers", "inlierIndices", "outlierIndices"]);
function slim(value, key = "", depth = 0) {
  if (value == null || typeof value === "boolean" || typeof value === "number") return value;
  if (typeof value === "string") return /^data:/.test(value) ? undefined : value.slice(0, 1600);
  if (depth > 9) return "[Nested metadata omitted]";
  if (Array.isArray(value)) {
    if (omittedArrays.has(key)) return { count: value.length };
    return value.slice(0, 40).map((entry) => slim(entry, "", depth + 1));
  }
  if (typeof value !== "object") return undefined;
  return Object.fromEntries(Object.entries(value).filter(([name]) => !["image", "dataUrl", "base64", "audio"].includes(name))
    .map(([name, entry]) => [name, slim(entry, name, depth + 1)]).filter(([, entry]) => entry !== undefined));
}
export function savedArtifact(tool, args, result, regionId) {
  if (!artifactTools.has(tool) || !result || result.error || result.isError) return null;
  const handle = result.id || result.projectionId || result.planeId;
  let artifact = { key: (["sketch_fit_plane", "sketch_plane_update"].includes(tool) ? "plane" : tool) + ":" + (handle || JSON.stringify(args)), tool, args: slim(args), result: slim(result),
    ...(regionId ? { regionId } : {}) };
  if (JSON.stringify(artifact).length > 10000) {
    // Large sample diagnostics stay in the tool log; retain reusable identity, frame, and main errors here.
    const r = artifact.result;
    artifact.result = Object.fromEntries(["id", "projectionId", "planeId", "planeVersion", "version", "strokeIds", "sketchRevision", "frame", "plane", "diagnostics", "fit", "errors", "extent", "outlierCount", "imageMapping", "primitive", "pca"].filter((key) => r[key] !== undefined).map((key) => [key, r[key]]));
  }
  return artifact;
}
export function boundedArtifacts(items) {
  const unique = new Map();
  for (const item of items || []) {
    if (!item || !artifactTools.has(item.tool)) continue;
    const artifact = savedArtifact(item.tool, item.args || {}, item.result, item.regionId);
    if (!artifact || JSON.stringify(artifact).length > 12000) continue;
    unique.delete(artifact.key); unique.set(artifact.key, artifact);
  }
  const artifacts = [...unique.values()].slice(-40);
  while (JSON.stringify(artifacts).length > 50000) artifacts.shift();
  return artifacts;
}
