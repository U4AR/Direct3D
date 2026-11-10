# SPDX-License-Identifier: GPL-3.0-or-later
"""Persistent local Blender engine. Structured documents only; no AI-generated Python."""
import bpy, bmesh, json, sys, os, time, traceback
from mathutils import Matrix, Vector

def to_blender(p): return (p[0], -p[2], p[1])
def to_web(p): return (p[0], p[2], -p[1])

def clean_mesh(mesh):
    bm=bmesh.new(); bm.from_mesh(mesh)
    bmesh.ops.remove_doubles(bm, verts=list(bm.verts), dist=1e-8)
    bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces))
    if bm.calc_volume(signed=True)<-1e-12: bmesh.ops.reverse_faces(bm, faces=list(bm.faces))
    bm.to_mesh(mesh); bm.free(); mesh.update()

def primitive(op, p, name):
    kind=op[7:]
    if kind=='cube':
        bpy.ops.mesh.primitive_cube_add(size=1); obj=bpy.context.object
        obj.scale=tuple(p['sizeMetres']); bpy.ops.object.transform_apply(location=False,rotation=False,scale=True)
    elif kind=='plane':
        bpy.ops.mesh.primitive_plane_add(size=1); obj=bpy.context.object
        obj.scale=(p['sizeMetres'][0],p['sizeMetres'][1],1); bpy.ops.object.transform_apply(location=False,rotation=False,scale=True)
    elif kind=='sphere': bpy.ops.mesh.primitive_uv_sphere_add(segments=48,ring_count=24,radius=p['radiusMetres']); obj=bpy.context.object
    elif kind=='cylinder': bpy.ops.mesh.primitive_cylinder_add(vertices=64,radius=p['radiusMetres'],depth=p['heightMetres']); obj=bpy.context.object
    elif kind=='torus': bpy.ops.mesh.primitive_torus_add(major_radius=p['radiusMetres'],minor_radius=p['minorRadiusMetres'],major_segments=64,minor_segments=16); obj=bpy.context.object
    else: raise ValueError('Unsupported Blender primitive')
    # Web space is Y-up. Cubes/planes use XYZ axes; cylinders/torus have local Z as height.
    axes=p.get('axes',((1,0,0),(0,1,0),(0,0,1)))
    basis=(axes[0],tuple(-v for v in axes[2]),axes[1]) if kind in ('cylinder','torus') else axes
    obj['draw3d_axis_order']='XZY' if kind in ('cylinder','torus') else 'XYZ'
    matrix=Matrix([to_blender(a) for a in basis]).transposed().to_4x4(); matrix.translation=Vector(to_blender(p['center']))
    obj.matrix_world=matrix; obj.name=name
    return obj

def run(document, folder):
    started=time.perf_counter()
    for obj in list(bpy.data.objects): bpy.data.objects.remove(obj,do_unlink=True)
    for mesh in list(bpy.data.meshes):
        if mesh.users==0: bpy.data.meshes.remove(mesh)
    bpy.context.scene.unit_settings.system='METRIC'; bpy.context.scene.unit_settings.scale_length=1
    objects={}
    for source in document['meshes']:
        mesh=bpy.data.meshes.new(source['name']); v=source['vertices']; ind=source['indices']
        center=[(min(v[i::3])+max(v[i::3]))*.5 for i in range(3)]
        mesh.from_pydata([tuple(v[i+j]-center[j] for j in range(3)) for i in range(0,len(v),3)],[],[ind[i:i+3] for i in range(0,len(ind),3)])
        clean_mesh(mesh); obj=bpy.data.objects.new(source['name'],mesh); bpy.context.collection.objects.link(obj)
        matrix=Matrix([to_blender(a) for a in ((1,0,0),(0,1,0),(0,0,1))]).transposed().to_4x4(); matrix.translation=Vector(to_blender(center)); obj.matrix_world=matrix; obj['draw3d_axis_order']='XYZ'; objects[source['id']]=obj
    traces=[]
    for index,op in enumerate(document['operations']):
        operation=op['operation']; p=op.get('parameters',{}); target=op['targetId']
        if operation.startswith('create_'):
            obj=primitive(operation,p,op['name']); objects[target]=obj
        else:
            obj=objects[target]; name=str(index+1)+'. '+op['name']
            if operation=='convert':pass
            elif operation in ('difference','union','intersect'):
                for tool_id in op['toolIds']:
                    tool=objects[tool_id]; tool.hide_render=True; tool.hide_set(True)
                    mod=obj.modifiers.new(name,'BOOLEAN'); mod.operation={'difference':'DIFFERENCE','union':'UNION','intersect':'INTERSECT'}[operation]; mod.solver='EXACT'; mod.object=tool
            elif operation=='bevel':
                mod=obj.modifiers.new(name,'BEVEL'); mod.width=p['widthMetres']; mod.segments=p.get('segments',3); mod.limit_method='ANGLE'
            elif operation=='subdivision':
                mod=obj.modifiers.new(name,'SUBSURF'); mod.levels=p.get('levels',1); mod.render_levels=mod.levels
            elif operation=='solidify':
                mod=obj.modifiers.new(name,'SOLIDIFY'); mod.thickness=p['thicknessMetres']; mod.offset=0; mod.use_even_offset=True
            elif operation=='smooth':
                mod=obj.modifiers.new(name,'SMOOTH'); mod.factor=p.get('factor',.5); mod.iterations=p.get('iterations',3)
            elif operation=='mirror':
                mod=obj.modifiers.new(name,'MIRROR'); mod.use_clip=True
                axis=obj.get('draw3d_axis_order','XYZ').index(p.get('axis','X')); mod.use_axis=tuple(i==axis for i in range(3))
            elif operation=='decimate':
                mod=obj.modifiers.new(name,'DECIMATE'); mod.ratio=p.get('ratio',.5)
            elif operation=='remesh':
                mod=obj.modifiers.new(name,'REMESH'); mod.mode='VOXEL'; mod.voxel_size=p['voxelMetres']; mod.use_smooth_shade=True
            else: raise ValueError('Unsupported Blender modifier '+operation)
        bpy.context.view_layer.update(); traces.append({'operation':operation,'name':op['name'],'featureIndex':index})
    obj=objects[document['targetId']]
    depsgraph=bpy.context.evaluated_depsgraph_get(); evaluated=obj.evaluated_get(depsgraph); mesh=evaluated.to_mesh()
    try:
        mesh.calc_loop_triangles()
        if not mesh.vertices or not mesh.loop_triangles: raise ValueError('Operation produced no surface; no changes were applied')
        if len(mesh.vertices)>200000 or len(mesh.loop_triangles)>400000: raise ValueError('Result too detailed for the web/VR scene; reduce subdivision or remesh resolution')
        vertices=[n for vertex in mesh.vertices for n in to_web(evaluated.matrix_world @ vertex.co)]
        indices=[i for triangle in mesh.loop_triangles for i in triangle.vertices]
        bm=bmesh.new(); bm.from_mesh(mesh); bmesh.ops.remove_doubles(bm,verts=list(bm.verts),dist=1e-8)
        manifold=all(e.is_manifold for e in bm.edges); volume=abs(bm.calc_volume(signed=True)*evaluated.matrix_world.determinant()); bm.free()
        xyz=[vertices[i::3] for i in range(3)]; bounds={'min':[min(a) for a in xyz],'max':[max(a) for a in xyz]}
    finally: evaluated.to_mesh_clear()
    for item in bpy.context.selected_objects: item.select_set(False)
    obj.hide_set(False); obj.hide_render=False; obj.select_set(True); bpy.context.view_layer.objects.active=obj
    os.makedirs(folder,exist_ok=True)
    bpy.ops.wm.save_as_mainfile(filepath=os.path.join(folder,'model.blend'),check_existing=False,compress=True)
    bpy.ops.export_scene.gltf(filepath=os.path.join(folder,'model.glb'),export_format='GLB',use_selection=True,export_apply=True,export_yup=True)
    return {'vertices':vertices,'indices':indices,'metrics':{'vertexCount':len(vertices)//3,'triangleCount':len(indices)//3,'watertight':manifold,'volumeMetres3':volume,'bounds':bounds},'features':traces,'elapsedMs':round((time.perf_counter()-started)*1000),'version':bpy.app.version_string}

print('DRAW3D_READY '+json.dumps({'version':bpy.app.version_string}),flush=True)
for line in sys.stdin:
    try:
        message=json.loads(line); result=run(message['document'],message['folder']); response={'id':message['id'],'result':result}
    except Exception as error:
        response={'id':message.get('id') if 'message' in locals() else None,'error':str(error)}
        traceback.print_exc(file=sys.stderr)
    print('DRAW3D_RESULT '+json.dumps(response,separators=(',',':'),allow_nan=False),flush=True)
