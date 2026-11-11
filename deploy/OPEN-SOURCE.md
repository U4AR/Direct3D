# Server modeling components and licenses

Draw3D uses unmodified official Blender 4.5.9 LTS (GPL-3.0-or-later) and FreeCAD 1.1.4 (LGPL-2.1-or-later, with separately licensed dependencies including OpenCASCADE). Their complete upstream distributions, bundled notices and licenses are retained in /opt/blender and /opt/freecad. No paid CAD SDK or commercial plugin is required. Docker Engine and Compose can be used without Docker Desktop.

Sources and exact versions:
- Blender: https://projects.blender.org/blender/blender/src/tag/v4.5.9 ; https://www.blender.org/about/license/
- FreeCAD: https://github.com/FreeCAD/FreeCAD/tree/1.1.4 ; https://github.com/FreeCAD/FreeCAD/blob/1.1.4/LICENSE
- OpenZCAD browser editor: https://github.com/esaueng/OpenZCAD/tree/ae6553b498d5ba04d8c7b5cc43d97682bd5f94a3 (Apache-2.0). Its dependency notices are served at /cad/THIRD-PARTY-NOTICES.md and /cad/licenses/.
- SculptGL: https://github.com/stephomi/sculptgl/tree/8e45dafc0f7906e5238dfffc1a2df742bd25f29d (MIT); /sculpt/LICENSE.
- Three.js MIT; Node.js MIT with bundled third-party notices; Caddy Apache-2.0; Docker Engine/Compose Apache-2.0.

Commercial use permissions for the engines are separate from the Draw3D application license. Original Draw3D application code is licensed under PolyForm Noncommercial 1.0.0; see [LICENSE.md](../LICENSE.md) and [NOTICE.md](../NOTICE.md). AI API usage is billed by its provider. If redistributing binaries/images, retain notices and satisfy the applicable source-code and relinking requirements, including the exact corresponding source and any modifications. Upstream links identify sources but are not a substitute for fulfilling distribution obligations. This integration does not remove or bypass licensing requirements.

The Blender worker adapter is GPL-3.0-or-later. Other original application files use PolyForm Noncommercial 1.0.0 unless a file or component has its own license notice. Model outputs remain separate from the engine's software license; see Blender's official FAQ for output ownership.
