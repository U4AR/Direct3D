import importlib.util, math, tempfile, unittest
from pathlib import Path
import cadquery as cq
spec=importlib.util.spec_from_file_location("cad_engine",Path(__file__).parents[1]/"scripts/cad-engine.py")
engine=importlib.util.module_from_spec(spec);spec.loader.exec_module(engine)
def doc(*operations): return {"schema":"draw3d.cad.v1","operations":list(operations)}
box={"type":"box","size":[100,100,100],"operation":"add"}
class CADTests(unittest.TestCase):
    def test_cut_volume_step_roundtrip_and_metric_preview(self):
        document=doc(box,{"type":"cylinder","radius":10,"height":120,"operation":"cut"})
        with tempfile.TemporaryDirectory() as folder:
            result=engine.compile_document(document,Path(folder))
            self.assertAlmostEqual(result["volumeMm3"],1000000-math.pi*100*100,places=4)
            self.assertEqual(result["solids"],1)
            self.assertAlmostEqual(cq.importers.importStep(str(Path(folder)/"model.step")).val().Volume(),result["volumeMm3"],places=3)
            self.assertTrue((Path(folder)/"model.stl").stat().st_size>100)
            self.assertTrue(all(abs(v)<=.051 for p in result["mesh"]["vertices"] for v in p))
    def test_disjoint_union_preserves_both_solids(self):
        solid=engine.build(doc(box,{**box,"position":[200,0,0]}))
        self.assertEqual(len(solid.solids().vals()),2)
        self.assertAlmostEqual(sum(s.Volume() for s in solid.solids().vals()),2000000)
    def test_intersection(self):
        solid=engine.build(doc(box,{**box,"position":[50,0,0],"operation":"intersect"}))
        self.assertAlmostEqual(solid.val().Volume(),500000)
    def test_reject_invalid_and_empty(self):
        for document in [doc(),doc({**box,"size":[float("nan"),1,1]}),doc({**box,"operation":"cut"}),doc({"type":"python","code":"bad"}),doc(box,{**box,"operation":"cut"})]:
            with self.assertRaises(ValueError):engine.build(document)
if __name__=="__main__":unittest.main()
