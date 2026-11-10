"""Local CadQuery worker. Accepts a bounded declarative document, never Python code."""
import json, math, sys
from pathlib import Path
import cadquery as cq


def number(value, name, low, high):
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value) or not low <= value <= high:
        raise ValueError(f"{name} must be between {low} and {high} mm")
    return float(value)


def build(document):
    if document.get("schema") != "draw3d.cad.v1":
        raise ValueError("Unsupported CAD document")
    operations = document.get("operations")
    if not isinstance(operations, list) or not 1 <= len(operations) <= 24:
        raise ValueError("Use between 1 and 24 CAD operations")
    solid = None
    for index, item in enumerate(operations):
        kind, operation = item.get("type"), item.get("operation", "add")
        if operation not in ("add", "cut", "intersect"):
            raise ValueError("Unknown solid operation")
        if index == 0 and operation != "add":
            raise ValueError("The first operation must add a solid")
        position = item.get("position", [0, 0, 0])
        if not isinstance(position, list) or len(position) != 3:
            raise ValueError("Position needs X, Y and Z")
        position = tuple(number(v, "Position", -2000, 2000) for v in position)
        plane = cq.Workplane("XY")
        if kind == "box":
            size = item.get("size")
            if not isinstance(size, list) or len(size) != 3:
                raise ValueError("Box needs width, depth and height")
            part = plane.box(*(number(v, "Box dimension", 0.1, 2000) for v in size))
        elif kind == "cylinder":
            part = plane.cylinder(number(item.get("height"), "Height", 0.1, 2000), number(item.get("radius"), "Radius", 0.1, 1000))
        elif kind == "sphere":
            part = plane.sphere(number(item.get("radius"), "Radius", 0.1, 1000))
        else:
            raise ValueError("Choose box, cylinder or sphere")
        part = part.translate(position)
        solid = part if solid is None else solid.union(part) if operation == "add" else solid.cut(part) if operation == "cut" else solid.intersect(part)
        if not solid.solids().vals() or not solid.val().isValid():
            raise ValueError(f"Operation {index + 1} leaves no valid solid; check dimensions and overlap")
    return solid


def compile_document(document, directory):
    solid = build(document)
    shape = solid.val()
    vertices, triangles = shape.tessellate(0.25, 0.15)
    if len(vertices) > 250000:
        raise ValueError("CAD preview is too complex")
    cq.exporters.export(solid, str(directory / "model.step"))
    cq.exporters.export(solid, str(directory / "model.stl"), tolerance=0.25, angularTolerance=0.15)
    bounds = shape.BoundingBox()
    result = {"engine": "CadQuery", "version": cq.__version__, "units": "mm", "volumeMm3": sum(s.Volume() for s in solid.solids().vals()), "solids": len(solid.solids().vals()), "dimensionsMm": [bounds.xlen, bounds.ylen, bounds.zlen], "mesh": {"vertices": [[v.x / 1000, v.z / 1000, -v.y / 1000] for v in vertices], "triangles": triangles}}
    (directory / "preview.json").write_text(json.dumps(result), encoding="utf-8")
    return result


if __name__ == "__main__":
    try:
        if sys.argv[1] == "--health":
            print(json.dumps({"ready": True, "engine": "CadQuery", "version": cq.__version__, "license": "Apache-2.0"}))
        else:
            folder = Path(sys.argv[1])
            document = json.loads((folder / "document.json").read_text(encoding="utf-8"))
            compile_document(document, folder)
            print(json.dumps({"ok": True}))
    except Exception as error:
        print(json.dumps({"error": str(error)}))
        sys.exit(1)
