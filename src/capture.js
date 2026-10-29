import * as THREE from "three";
import { planViews, DEPTH_SCHEMA } from "./depth.js";
const depthMaterial = new THREE.ShaderMaterial({
  vertexShader: `varying float z; void main(){vec4 p=modelViewMatrix*vec4(position,1.0);z=-p.z;gl_Position=projectionMatrix*p;}`,
  fragmentShader: `precision highp float; varying float z; void main(){float n=floor(z*10000.0+0.5);gl_FragColor=vec4(floor(n/65536.0),floor(mod(n,65536.0)/256.0),mod(n,256.0),255.0)/255.0;}`,
  side: THREE.DoubleSide,
});
function imageURL(bytes, size) {
  const c = document.createElement("canvas");
  c.width = c.height = size;
  c.getContext("2d").putImageData(
    new ImageData(new Uint8ClampedArray(bytes), size, size),
    0,
    0,
  );
  return c.toDataURL("image/png");
}
function flip(bytes, size) {
  const out = new Uint8Array(bytes.length);
  for (let y = 0; y < size; y++)
    out.set(
      bytes.subarray(y * size * 4, (y + 1) * size * 4),
      (size - y - 1) * size * 4,
    );
  return out;
}
export async function captureSketch(
  renderer,
  drawingGroup,
  strokes,
  mode = "auto",
  revision = 0,
) {
  const plan = planViews(strokes, mode),
    size = 256,
    frames = [],
    scene = new THREE.Scene();
  drawingGroup.updateMatrixWorld(true);
  drawingGroup.traverse((object) => {
    if (object.isMesh) {
      const mesh = new THREE.Mesh(object.geometry, object.material);
      mesh.applyMatrix4(object.matrixWorld);
      mesh.frustumCulled = false;
      scene.add(mesh);
    }
  });
  const target = new THREE.WebGLRenderTarget(size, size, {
    format: THREE.RGBAFormat,
    type: THREE.UnsignedByteType,
    depthBuffer: true,
  });
  target.texture.colorSpace = THREE.NoColorSpace;
  const oldTarget = renderer.getRenderTarget(),
    oldXR = renderer.xr.enabled,
    oldColor = renderer.getClearColor(new THREE.Color()),
    oldAlpha = renderer.getClearAlpha(),
    oldTone = renderer.toneMapping;
  renderer.xr.enabled = false;
  renderer.toneMapping = THREE.NoToneMapping;
  try {
    for (let index = 0; index < plan.directions.length; index++) {
      const camera = new THREE.PerspectiveCamera(
        50,
        1,
        Math.max(0.005, plan.distance - plan.radius * 1.5),
        plan.distance + plan.radius * 1.5,
      );
      camera.position.copy(
        new THREE.Vector3(...plan.center).add(
          new THREE.Vector3(...plan.directions[index])
            .normalize()
            .multiplyScalar(plan.distance),
        ),
      );
      if (
        Math.abs(plan.directions[index][1]) === 1 &&
        !plan.directions[index][0] &&
        !plan.directions[index][2]
      )
        camera.up.set(0, 0, -1);
      camera.lookAt(...plan.center);
      camera.updateMatrixWorld(true);
      renderer.setRenderTarget(target);
      renderer.setClearColor(0x000000, 0);
      renderer.clear();
      scene.overrideMaterial = depthMaterial;
      renderer.render(scene, camera);
      const raw = new Uint8Array(size * size * 4);
      renderer.readRenderTargetPixels(target, 0, 0, size, size, raw);
      const rgba = flip(raw, size),
        depth = [],
        mask = [];
      for (let i = 0; i < size * size; i++) {
        const valid = rgba[i * 4 + 3] > 0;
        mask.push(valid ? 1 : 0);
        depth.push(
          valid
            ? (rgba[i * 4] * 65536 + rgba[i * 4 + 1] * 256 + rgba[i * 4 + 2]) /
                10000
            : 0,
        );
      }
      const gray = new Uint8Array(size * size * 4);
      for (let i = 0; i < depth.length; i++) {
        const v = mask[i]
          ? Math.round(
              16 +
                239 *
                  (1 - (depth[i] - camera.near) / (camera.far - camera.near)),
            )
          : 0;
        gray.set([v, v, v, 255], i * 4);
      }
      scene.overrideMaterial = null;
      renderer.setClearColor(0x10151e, 1);
      renderer.clear();
      renderer.render(scene, camera);
      renderer.readRenderTargetPixels(target, 0, 0, size, size, raw);
      const focal = size / (2 * Math.tan(THREE.MathUtils.degToRad(25)));
      frames.push({
        id: `view-${index + 1}`,
        width: size,
        height: size,
        units: "metres",
        depthConvention: "camera-z",
        pixelOrigin: "top-left",
        matrixOrder: "column-major",
        cameraConvention: "threejs-right-up-back",
        intrinsics: { fx: focal, fy: focal, cx: size / 2, cy: size / 2 },
        cameraToWorld: camera.matrixWorld.toArray(),
        near: camera.near,
        far: camera.far,
        depth,
        mask,
        sketchImage: imageURL(flip(raw, size), size),
        depthImage: imageURL(gray, size),
        provenance: "measured-sketch",
      });
    }
  } finally {
    renderer.setRenderTarget(oldTarget);
    renderer.setClearColor(oldColor, oldAlpha);
    renderer.xr.enabled = oldXR;
    renderer.toneMapping = oldTone;
    target.dispose();
  }
  return {
    schema: DEPTH_SCHEMA,
    id: crypto.randomUUID(),
    created: new Date().toISOString(),
    revision,
    plan,
    frames,
  };
}
export async function decodeGeneratedImage(dataURL, width, height) {
  const image = await createImageBitmap(await (await fetch(dataURL)).blob());
  try {
    if (Math.abs(image.width / image.height - width / height) > 0.02)
      throw new Error("Generated image changed the camera aspect ratio.");
    const c = document.createElement("canvas");
    c.width = width;
    c.height = height;
    const ctx = c.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(image, 0, 0, width, height);
    return ctx.getImageData(0, 0, width, height).data;
  } finally {
    image.close();
  }
}
