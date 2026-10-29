import importlib.util
from pathlib import Path
import unittest
import numpy as np

spec = importlib.util.spec_from_file_location('fusion', Path(__file__).parents[1] / 'scripts/fuse_tsdf.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class FusionTests(unittest.TestCase):
    def test_six_calibrated_views_recover_metric_sphere(self):
        frames = []
        width = 64
        y, x = np.mgrid[:width, :width]
        camera_rays = np.stack([(x + .5 - width / 2) / 70, -(y + .5 - width / 2) / 70, -np.ones_like(x)], axis=-1)
        for position in [[0,0,1], [1,0,0], [0,0,-1], [-1,0,0], [0,1,0], [0,-1,0]]:
            position = np.array(position, dtype=float)
            forward = -position
            up = np.array([0,0,-1] if abs(position[1]) == 1 else [0,1,0])
            right = np.cross(forward, up)
            right /= np.linalg.norm(right)
            up = np.cross(right, forward)
            world_from_camera = np.eye(4)
            world_from_camera[:3,:3] = np.column_stack([right, up, -forward])
            world_from_camera[:3,3] = position
            rays = camera_rays @ world_from_camera[:3,:3].T
            a = np.sum(rays * rays, axis=-1)
            b = 2 * np.sum(rays * position, axis=-1)
            c = np.sum(position * position) - .3 ** 2
            discriminant = b*b - 4*a*c
            valid = discriminant >= 0
            z = np.where(valid, (-b - np.sqrt(np.maximum(discriminant, 0))) / (2*a), 0)
            frames.append({'width':width,'height':width,'depth':z.ravel().tolist(),'mask':valid.ravel().astype(int).tolist(),
                           'intrinsics':{'fx':70,'fy':70,'cx':32,'cy':32},'cameraToWorld':world_from_camera.flatten(order='F').tolist(),
                           'far':2,'units':'metres','depthConvention':'camera-z'})
        mesh = module.fuse({'schema':'draw3d.depth.v1','frames':frames}, voxel=.01, truncation=.04)
        vertices = np.asarray(mesh.vertices)
        self.assertGreater(len(vertices), 1000)
        np.testing.assert_allclose(vertices.min(axis=0), [-.3]*3, atol=.02)
        np.testing.assert_allclose(vertices.max(axis=0), [.3]*3, atol=.02)


if __name__ == '__main__':
    unittest.main()
