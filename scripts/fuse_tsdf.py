"""Optional desktop TSDF fusion for dense, calibrated depth bundles.

Install: python -m pip install open3d numpy
Run: python scripts/fuse_tsdf.py draw3d-depth.json review.ply
Sparse strokes generally do not constrain a closed surface. Prefer generated
dense maps; calibration cannot correct inconsistent hallucinated geometry.
"""
import argparse
import json
import numpy as np


def fuse(bundle, voxel=0.005, truncation=0.025):
    import open3d as o3d
    if bundle.get('schema') != 'draw3d.depth.v1':
        raise ValueError('Unsupported depth bundle')
    frames = bundle['frames']
    if not 1 <= len(frames) <= 10:
        raise ValueError('Expected 1–10 views')
    volume = o3d.pipelines.integration.ScalableTSDFVolume(
        voxel_length=voxel, sdf_trunc=truncation,
        color_type=o3d.pipelines.integration.TSDFVolumeColorType.NoColor)
    for f in frames:
        if f['units'] != 'metres' or f['depthConvention'] != 'camera-z':
            raise ValueError('Expected metric camera-z depth')
        w, h = f['width'], f['height']
        if not (2 <= w <= 1024 and 2 <= h <= 1024):
            raise ValueError('Invalid frame dimensions')
        depth = np.asarray(f['depth'], dtype=np.float32).reshape(h, w)
        mask = np.asarray(f['mask'], dtype=bool).reshape(h, w)
        if not np.isfinite(depth).all() or (depth < 0).any() or (depth > 100).any():
            raise ValueError('Invalid depth samples')
        depth[~mask] = 0
        k = f['intrinsics']
        intrinsic = o3d.camera.PinholeCameraIntrinsic(w, h, k['fx'], k['fy'], k['cx'] - 0.5, k['cy'] - 0.5)
        world_from_gl = np.asarray(f['cameraToWorld']).reshape(4, 4, order='F')
        # Three.js uses right/up/back; Open3D uses right/down/forward.
        world_from_cv = world_from_gl @ np.diag([1, -1, -1, 1])
        rgbd = o3d.geometry.RGBDImage.create_from_color_and_depth(
            o3d.geometry.Image(np.zeros((h, w, 3), dtype=np.uint8)),
            o3d.geometry.Image(depth), depth_scale=1.0,
            depth_trunc=float(f.get('far', 20)), convert_rgb_to_intensity=False)
        volume.integrate(rgbd, intrinsic, np.linalg.inv(world_from_cv))
    mesh = volume.extract_triangle_mesh()
    mesh.remove_duplicated_vertices()
    mesh.remove_duplicated_triangles()
    mesh.remove_degenerate_triangles()
    mesh.compute_vertex_normals()
    return mesh


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('input')
    parser.add_argument('output')
    parser.add_argument('--voxel', type=float, default=0.005)
    parser.add_argument('--truncation', type=float, default=0.025)
    args = parser.parse_args()
    if args.voxel <= 0 or args.truncation < args.voxel:
        parser.error('Require 0 < voxel <= truncation')
    import open3d as o3d
    with open(args.input, encoding='utf-8') as stream:
        mesh = fuse(json.load(stream), args.voxel, args.truncation)
    if len(mesh.vertices) == 0:
        raise SystemExit('No surface recovered. Dense, consistent depth maps are required.')
    if not o3d.io.write_triangle_mesh(args.output, mesh):
        raise SystemExit('Could not write mesh')
    print(f'Saved {len(mesh.vertices)} vertices and {len(mesh.triangles)} triangles.')
