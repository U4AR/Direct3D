import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
export async function patchSplines(root) {
  const backups = process.env.SPLINE_PATCH_BACKUPS || path.resolve(".build/spline-patch-backups");
  async function patch(file, edit) {
    const target = path.join(root, file),
      saved = path.join(backups, file);
    let base;
    try {
      base = await readFile(saved, "utf8");
    } catch {
      base = await readFile(target, "utf8");
      await mkdir(path.dirname(saved), { recursive: true });
      await writeFile(saved, base);
    }
    const current = await readFile(target, "utf8"),
      next = edit(base);
    let last;
    try {
      last = await readFile(saved + ".last", "utf8");
    } catch {}
    if (current !== base && current !== last && current !== next)
      throw Error("Preserve external edits before spline patch: " + file);
    await writeFile(target, next);
    await writeFile(saved + ".last", next);
  }
  const replace = (s, a, b) => {
    if (!s.includes(a)) throw Error("Spline patch anchor missing: " + a.slice(0, 70));
    return s.replace(a, b);
  };
  await writeFile(
    path.join(root, "packages/geometry/src/draw3d-splines.ts"),
    await readFile(new URL("./cad-spline-geometry.ts", import.meta.url), "utf8"),
  );
  await writeFile(
    path.join(root, "apps/web/src/components/Draw3dSplineEditor.tsx"),
    await readFile(new URL("./cad-spline-editor.tsx", import.meta.url), "utf8"),
  );
  const profile = await readFile(new URL("./cad-spline-profile.txt", import.meta.url), "utf8");
  await patch("packages/shared/src/index.ts", (s) =>
    replace(
      replace(
        s,
        "'polygon' | 'line' | 'arc' | 'text';",
        "'polygon' | 'line' | 'arc' | 'text' | 'spline';",
      ),
      "export type SketchObjectData = (",
      "export type SketchObjectData = (\n  | { objectKind:'spline'; segments:{points:[ParamValue,ParamValue,ParamValue,ParamValue,ParamValue,ParamValue,ParamValue,ParamValue]}[]; closed:boolean; }",
    ),
  );
  await patch(
    "packages/geometry/src/index.ts",
    (s) => "export {splineCurves,splinePolyline} from './draw3d-splines';\n" + s,
  );
  await patch("packages/geometry/src/regions.ts", (s) => {
    s = "import {splineCurves,splinePolyline} from './draw3d-splines';\n" + s;
    s = replace(
      s,
      "switch (data.objectKind) {",
      "switch (data.objectKind) {\n    case 'spline': return []; ",
    );
    s = replace(
      s,
      "if (data.objectKind !== 'text') {",
      "if (data.objectKind === 'spline') return draw3dSplineProfile(object,resolve);\n  if (data.objectKind !== 'text') {",
    );
    return s + profile;
  });
  await patch(
    "apps/web/src/lib/objectPolyline.ts",
    (s) =>
      "import {splinePolyline} from '@openzcad/geometry';\n" +
      replace(
        s,
        "switch (data.objectKind) {",
        "switch (data.objectKind) {\n    case 'spline': return [{points:splinePolyline(data,resolve),closed:data.closed}];",
      ),
  );
  await patch("packages/document-core/src/parameter-expressions.ts", (s) =>
    replace(
      s,
      "function sketchObject(data: SketchObjectData, rewrite: Rewrite): void {",
      "function sketchObject(data: SketchObjectData, rewrite: Rewrite): void {\n  if(data.objectKind==='spline'){for(const span of data.segments)span.points=span.points.map(v=>typeof v==='string'?rewrite(v):v) as typeof span.points;return;}",
    ),
  );
  await patch("packages/document-core/src/index.ts", (s) =>
    replace(
      s,
      "switch (data.objectKind) {",
      "switch (data.objectKind) {\n        case 'spline': node.data={...data,segments:data.segments.map(s=>({points:s.points.map((v,i)=>shift(v,i%2?dv:du,'spline coordinate')) as typeof s.points}))}; break;",
    ),
  );
  await patch("packages/kernel-adapter/src/exact-math.ts", (s) =>
    replace(s, "case 'text':", "case 'spline':\n    case 'text':"),
  );
  await patch("apps/web/src/lib/sketch/session.ts", (s) => {
    s = replace(
      s,
      "switch (data.objectKind) {",
      "switch (data.objectKind) {\n    case 'spline': return data.segments.flatMap(s=>[target('endpoint',resolve(s.points[0]),resolve(s.points[1])),target('endpoint',resolve(s.points[6]),resolve(s.points[7]))]);",
    );
    s = replace(
      s,
      "export function sketchObjectMovable(data: SketchObjectData): boolean {",
      "export function sketchObjectMovable(data: SketchObjectData): boolean {\n  if(data.objectKind==='spline')return data.segments.every(s=>s.points.every(isLiteralNumber));",
    );
    s = replace(
      s,
      "  const next = { ...data } as unknown as Record<string, unknown>;",
      "  if(data.objectKind==='spline')return {...data,segments:data.segments.map(s=>({points:s.points.map((v,i)=>resolve(v)+(i%2?dy:dx)) as typeof s.points}))};\n  const next = { ...data } as unknown as Record<string, unknown>;",
    );
    return s;
  });
  await patch("apps/web/src/lib/sketch/editing.ts", (s) =>
    replace(
      s,
      "  const prospective = apply(base, commands);",
      "  if(data.objectKind==='spline')return commands; // Control points are authored directly; downstream exact validation still runs.\n  const prospective = apply(base, commands);",
    ),
  );
  await patch('apps/web/src/App.tsx',s=>replace(s,"if (data.objectKind === 'text') {","if (data.objectKind === 'text' || data.objectKind === 'spline') {"));
  await patch('packages/ai-contracts/src/sketch-dimensions.ts',s=>replace(s,"> = {","> = { spline: [],"));
  await patch("apps/web/src/components/SketchEntityEditor.tsx", (s) => {
    s = "import {Draw3dSplineEditor} from './Draw3dSplineEditor';\n" + s;
    s = replace(
      s,
      "const FIELDS: Record<SketchObjectData['objectKind'], FieldDefinition[]> = {",
      "const FIELDS: Record<SketchObjectData['objectKind'], FieldDefinition[]> = { spline: [],",
    );
    s = replace(s, "switch (kind) {", "switch (kind) { case 'spline': return data;");
    s = replace(s, "export function SketchEntityEditor({", "function StandardSketchEntityEditor({");
    return (
      s +
      "\nexport function SketchEntityEditor(props:SketchEntityEditorProps){return props.data.objectKind==='spline'?<Draw3dSplineEditor {...props}/>:<StandardSketchEntityEditor {...props}/>;}\n"
    );
  });
}
