"""FreeCAD/OpenCASCADE feature engine. Documents are data, never executable user Python."""
import FreeCAD as App, Part, Sketcher, Mesh
import json, sys, os, time, math, traceback

def fc(p): return App.Vector(p[0]*1000,-p[2]*1000,p[1]*1000)
def web(p): return [p.x/1000,p.z/1000,-p.y/1000]
def basis_rotation(axes):
    m=App.Matrix()
    for col,axis in enumerate(axes):
        a=(axis[0],-axis[2],axis[1])
        for row,n in enumerate(a): setattr(m,'A'+str(row+1)+str(col+1),n)
    return App.Rotation(m)
def placement(p,cylinder=False):
    axes=p.get('axes',[[1,0,0],[0,1,0],[0,0,1]])
    if cylinder: axes=[axes[0],[-n for n in axes[2]],axes[1]]
    return App.Placement(fc(p['center']),basis_rotation(axes))
def source_matrix(flat):
    m=App.Matrix()
    for row in range(4):
        for col in range(4):setattr(m,'A'+str(row+1)+str(col+1),flat[col*4+row]*(1000 if col==3 and row<3 else 1))
    c=App.Matrix(1,0,0,0,0,0,-1,0,0,1,0,0,0,0,0,1)
    return c.multiply(m).multiply(c.inverse())
def transformed_shape(shape,matrix):
    # Rigid/uniform placements preserve analytic circles and cylinders. General
    # transformGeometry unnecessarily converts them to approximated B-splines.
    result=shape.copy()
    result.transformShape(matrix,True,True)
    return result

def primitive(doc,operation,p,name):
    kind=operation[7:]
    if kind=='sketch':
        obj=doc.addObject('Sketcher::SketchObject',name);obj.Placement=placement(p)
        if p.get('radiusMetres'):
            obj.addGeometry(Part.Circle(App.Vector(),App.Vector(0,0,1),p['radiusMetres']*1000),False)
        elif p.get('profileType'):
            w=p['widthMetres']*1000;h=p['heightMetres']*1000;profile=p['profileType']
            if profile=='ellipse':
                if abs(w-h)<1e-8:curve=Part.Circle(App.Vector(),App.Vector(0,0,1),w/2)
                else:
                    curve=Part.Ellipse(App.Vector(w/2,0,0) if w>=h else App.Vector(0,h/2,0),App.Vector(0,h/2,0) if w>=h else App.Vector(-w/2,0,0),App.Vector())
                obj.addGeometry(curve,False)
            elif profile=='rectangle':
                points=[App.Vector(-w/2,-h/2,0),App.Vector(w/2,-h/2,0),App.Vector(w/2,h/2,0),App.Vector(-w/2,h/2,0)]
                for i in range(4):obj.addGeometry(Part.LineSegment(points[i],points[(i+1)%4]),False)
            else:
                r=p['cornerRadiusMetres']*1000;centers=[(w/2-r,-h/2+r),(w/2-r,h/2-r),(-w/2+r,h/2-r),(-w/2+r,-h/2+r)];previous=App.Vector(-w/2+r,-h/2,0)
                for i,(x,y) in enumerate(centers):
                    angle=(-90+i*90)*math.pi/180;points=[App.Vector(x+r*math.cos(angle+j*math.pi/4),y+r*math.sin(angle+j*math.pi/4),0) for j in range(3)]
                    if (previous-points[0]).Length>1e-8:obj.addGeometry(Part.LineSegment(previous,points[0]),False)
                    obj.addGeometry(Part.Arc(*points),False);previous=points[-1]
        elif p.get('profileSegments'):
            end=None;start=None
            for segment in p['profileSegments']:
                points=[App.Vector(a[0]*1000,a[1]*1000,0) for a in segment['points']]
                if end is not None and (end-points[0]).Length>0.002:raise ValueError('Sketch profile segments must meet at shared endpoints')
                if start is None:start=points[0]
                if segment['kind']=='line':curve=Part.LineSegment(*points)
                elif segment['kind']=='arc':curve=Part.Arc(*points)
                else:
                    curve=Part.BSplineCurve();curve.interpolate(points)
                obj.addGeometry(curve,False);end=points[-1]
            if p.get('closed',True) and (end-start).Length>0.002:raise ValueError('Closed sketch segments must return to their first point')
        else:
            points=[App.Vector(a[0]*1000,a[1]*1000,0) for a in p['profilePoints']]
            if p.get('closed',True) and (points[0]-points[-1]).Length>1e-8:points.append(points[0])
            for a,b in zip(points,points[1:]):
                if (a-b).Length>1e-8:obj.addGeometry(Part.LineSegment(a,b),False)
        doc.recompute();return obj
    if kind in ('bspline','pipe'):
        curve=Part.BSplineCurve();points=[App.Vector(*[n*1000 for n in a]) for a in p['points3D']]
        if p.get('closed',False) and (points[0]-points[-1]).Length<0.002:points.pop()
        if len(points)<3:raise ValueError('A periodic spline needs at least three distinct points')
        curve.interpolate(Points=points,PeriodicFlag=p.get('closed',False));edge=curve.toShape()
        if kind=='pipe':
            tangent=edge.tangentAt(edge.FirstParameter);profile=Part.Wire([Part.makeCircle(p['radiusMetres']*1000,edge.valueAt(edge.FirstParameter),tangent)]);path=Part.Wire([edge]);shape=path.makePipeShell([profile],True,p.get('frenet',False))
            if shape.isNull() or not shape.isValid() or len(shape.Solids)!=1 or not shape.isClosed():raise ValueError('Pipe radius/path produced a self-intersecting or non-solid sweep; reduce local curvature/radius or correct the path')
            # Hidden native references make the exact chosen guide/profile inspectable.
            for suffix,source in [('_Path',path),('_Profile',profile)]:
                reference=doc.addObject('Part::Feature',name+suffix);source.Placement=placement(p);reference.Shape=source;reference.Visibility=False
        else:shape=edge
        shape.Placement=placement(p);obj=doc.addObject('Part::Feature',name);obj.Shape=shape;return obj
    if kind=='helix':
        shape=Part.makeHelix(p['pitchMetres']*1000,p['heightMetres']*1000,p['radiusMetres']*1000,0,p.get('leftHanded',False));shape.Placement=App.Placement(fc(p['center']),App.Rotation(App.Vector(0,0,1),fc(p['direction'])));obj=doc.addObject('Part::Feature',name);obj.Shape=shape;return obj
    type_name={'cube':'Part::Box','sphere':'Part::Sphere','cylinder':'Part::Cylinder','torus':'Part::Torus','plane':'Part::Plane','cone':'Part::Cone'}[kind]
    obj=doc.addObject(type_name,name);pos=placement(p,kind in ('cylinder','torus','cone'))
    if kind in ('cube','plane'):
        sizes=p['sizeMetres'];obj.Length=sizes[0]*1000;obj.Width=sizes[1]*1000
        if kind=='cube':obj.Height=sizes[2]*1000
        pos.Base+=pos.Rotation.multVec(App.Vector(-sizes[0]*500,-sizes[1]*500,-sizes[2]*500 if kind=='cube' else 0))
    if kind in ('sphere','cylinder'):obj.Radius=p['radiusMetres']*1000
    if kind=='cylinder':obj.Height=p['heightMetres']*1000;pos.Base+=pos.Rotation.multVec(App.Vector(0,0,-p['heightMetres']*500))
    if kind=='cone':
        obj.Radius1=p['radiusMetres']*1000;obj.Radius2=p['topRadiusMetres']*1000;obj.Height=p['heightMetres']*1000;pos.Base+=pos.Rotation.multVec(App.Vector(0,0,-p['heightMetres']*500))
    if kind=='torus':obj.Radius1=p['radiusMetres']*1000;obj.Radius2=p['minorRadiusMetres']*1000
    obj.Placement=pos;doc.recompute();return obj

def imported(doc,source,folder,name):
    if source.get('nativeSource'):
        native=source['nativeSource'];shape=Part.Shape();shape.read(os.path.join(os.path.dirname(folder),native['artifactId'],'model.brep'))
        shape=transformed_shape(shape,source_matrix(native['matrix']))
        obj=doc.addObject('Part::Feature',name);obj.Shape=shape;return obj
    if source.get('analytic'):
        a=source['analytic'];p=a['parameters'];kind=a['kind']
        if kind in ('cuboid','cylinder','plane'):obj=primitive(doc,'create_'+{'cuboid':'cube','cylinder':'cylinder','plane':'plane'}[kind],p,name)
        else:
            shape=Part.makeSphere(1);m=App.Matrix();axes=p['axes'];r=p['radiiMetres']
            for col,axis in enumerate(axes):
                v=fc([n*r[col] for n in axis])
                for row,n in enumerate((v.x,v.y,v.z)):setattr(m,'A'+str(row+1)+str(col+1),n)
            c=fc(p['center']);m.A14=c.x;m.A24=c.y;m.A34=c.z;obj=doc.addObject('Part::Feature',name);obj.Shape=shape.transformGeometry(m)
        if a['matrix']!=[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1]:
            transformed=doc.addObject('Part::Feature',name+'_placement');transformed.Shape=transformed_shape(obj.Shape,source_matrix(a['matrix']));obj.Visibility=False;obj=transformed
        return obj
    vertices=source['vertices'];indices=source['indices']
    if len(indices)>120000:raise ValueError('A complex mesh is better edited in Blender; use native CAD primitives or a STEP/FreeCAD source for exact solid operations')
    mesh=Mesh.Mesh(([fc(vertices[i:i+3]) for i in range(0,len(vertices),3)],[indices[i:i+3] for i in range(0,len(indices),3)]))
    shape=Part.Shape();shape.makeShapeFromMesh(mesh.Topology,.01);shape=shape.removeSplitter()
    if shape.Shells and shape.isClosed():
        solids=[Part.Solid(shell) for shell in shape.Shells];shape=solids[0] if len(solids)==1 else Part.makeCompound(solids)
    elif len(shape.Faces)==1:shape=shape.Faces[0]
    if not shape.isValid():raise ValueError('Input mesh cannot be converted to a valid CAD shape; repair it in Blender first')
    obj=doc.addObject('Part::Feature',name);obj.Shape=shape;return obj

def wire_preview(shape):
    vertices=[];indices=[];radius=.3
    for edge in shape.Edges:
        points=edge.discretize(Deflection=.15)
        for a,b in zip(points,points[1:]):
            d=b-a
            if d.Length<1e-8:continue
            d.normalize();u=d.cross(App.Vector(0,0,1) if abs(d.z)<.9 else App.Vector(0,1,0));u.normalize();v=d.cross(u)
            base=len(vertices)//3
            for center in (a,b):
                for i in range(8):vertices.extend(web(center+u*(radius*math.cos(i*math.pi/4))+v*(radius*math.sin(i*math.pi/4))))
            for i in range(8):j=(i+1)%8;indices.extend([base+i,base+j,base+8+j,base+i,base+8+j,base+8+i])
    return vertices,indices


def topology_selection(shape, parameters, references, key):
    edges=key=='edgeIndices';items=shape.Edges if edges else shape.Faces
    selected=parameters.get(key,list(range(1,len(items)+1)))
    if any(not isinstance(i,int) or i<1 or i>len(items) for i in selected):
        raise ValueError('Selected '+key+' do not exist on the native input solid')
    anchors=(references or {}).get('edges' if edges else 'faces')
    if not anchors:return selected
    if [a['index'] for a in anchors]!=selected:raise ValueError('Topology anchors do not match the requested selection')
    resolved=[]
    for anchor in anchors:
        matches=[]
        for index,item in enumerate(items):
            if index+1 in resolved:continue
            try:kind=item.Curve.__class__.__name__ if edges else item.Surface.__class__.__name__
            except Exception:kind='Degenerate'
            if kind!=anchor['type'] or (item.CenterOfMass-fc(anchor['center'])).Length>0.002:continue
            metric=item.Length/1000 if edges else item.Area/1e6
            expected=anchor.get('lengthMetres' if edges else 'areaMetres2')
            if expected is None or abs(metric-expected)>max(1e-10,abs(expected)*1e-6):continue
            if edges and anchor.get('endpoints'):
                points=[v.Point for v in item.Vertexes]
                if points and any(min((fc(p)-v).Length for v in points)>0.002 for p in anchor['endpoints']):continue
            matches.append(index+1)
        if len(matches)!=1:raise ValueError('Cannot uniquely resolve selected '+key+' '+str(anchor['index'])+' after rebuild; target geometry changed. Refresh the selection; no edit was applied.')
        resolved.append(matches[0])
    return resolved


def saved_feature(doc,index):
    marked=[o for o in doc.Objects if 'Draw3DFeatureIndex' in o.PropertiesList and o.Draw3DFeatureIndex==index]
    if marked:return marked[-1]
    return doc.getObject('Feature'+str(index+1)) or doc.getObject('Feature'+str(index+1)+'_1')

def feature_input(obj):
    if obj is None:return None
    for key in ('Draw3DInputObject','Base','Source'):
        value=getattr(obj,key,None)
        if hasattr(value,'Shape'):return value
    for key in ('Faces','Sections'):
        value=getattr(obj,key,None)
        if value and hasattr(value[0],'Shape'):return value[0]
    return None

def anchor_selection(shape,p):
    refs={}
    for key,label,items in [('edgeIndices','edges',shape.Edges),('faceIndices','faces',shape.Faces)]:
        if key not in p:continue
        refs[label]=[]
        for index in p[key]:
            if index<1 or index>len(items):raise ValueError('Historical feature selection is absent from its saved input')
            item=items[index-1]
            try:kind=item.Curve.__class__.__name__ if label=='edges' else item.Surface.__class__.__name__
            except Exception:kind='Degenerate'
            a={'index':index,'center':web(item.CenterOfMass),'type':kind}
            a['lengthMetres' if label=='edges' else 'areaMetres2']=item.Length/1000 if label=='edges' else item.Area/1e6
            if label=='edges' and item.Vertexes:a['endpoints']=[web(item.Vertexes[0].Point),web(item.Vertexes[-1].Point)]
            refs[label].append(a)
    return refs

def exact_brep_bounds(shape):
    # BoundBox may prefer cached tessellation and shrink circular extents.
    try:return shape.optimalBoundingBox(False,False)
    except Exception:return shape.BoundBox


def native_bounds(shape):
    box=exact_brep_bounds(shape);corners=[web(App.Vector(x,y,z)) for x in (box.XMin,box.XMax) for y in (box.YMin,box.YMax) for z in (box.ZMin,box.ZMax)]
    return {'min':[min(p[i] for p in corners) for i in range(3)],'max':[max(p[i] for p in corners) for i in range(3)]}

def extract_native_region(shape,p,references=None):
    kind=p['regionType'];selection={}
    if kind=='faces':
        indices=topology_selection(shape,p,references,'faceIndices');selection={'requestedFaceIndices':p['faceIndices'],'resolvedFaceIndices':indices};result=Part.makeCompound([shape.Faces[i-1] for i in indices])
    elif kind=='solids':
        indices=p['solidIndices']
        if any(i<1 or i>len(shape.Solids) for i in indices):raise ValueError('Selected solid indices are absent from the exact input artifact')
        result=Part.makeCompound([shape.Solids[i-1] for i in indices]);selection={'solidIndices':indices}
    else:
        if kind=='box':
            sizes=[v*1000 for v in p['sizeMetres']];selector=Part.makeBox(*sizes);pos=placement(p);pos.Base+=pos.Rotation.multVec(App.Vector(*[-v/2 for v in sizes]));selector.Placement=pos
        else:
            extent=max(shape.BoundBox.DiagonalLength*4+(shape.BoundBox.Center-fc(p['pivot'])).Length*2,1);direction=fc(p['direction']);direction.normalize()
            if p['regionSide']=='negative':direction=-direction
            pos=App.Placement(fc(p['pivot']),App.Rotation(App.Vector(0,0,1),direction));pos.Base+=pos.Rotation.multVec(App.Vector(-extent/2,-extent/2,0));selector=Part.makeBox(extent,extent,extent);selector.Placement=pos
        result=shape.common(selector).removeSplitter()
    if result.isNull() or not result.isValid() or not result.Faces:raise ValueError('The selected native region contains no valid geometry; source body unchanged')
    if kind!='faces' and (not result.Solids or result.Volume<=1e-6):raise ValueError('The selected region does not contain a closed solid; source body unchanged')
    return result,selection

def verify_collaboration(shape,guard,folder):
    if not shape.Solids or not shape.isValid():raise ValueError('Collaboration guard requires a valid solid result; hand overlapping work to one specialist')
    # Read the immutable artifact BRep directly: opening the same checkpoint FCStd
    # can alias the live modified document and would defeat the comparison.
    original=Part.Shape();original.read(os.path.join(os.path.dirname(folder),guard['artifactId'],'model.brep'))
    if not original.Solids or not original.isValid():raise ValueError('Collaboration input is not a valid native solid')
    changes=[]
    for delta in [original.cut(shape),shape.cut(original)]:
        if not delta.isNull() and delta.Faces and abs(delta.Volume)>1e-6:
            if not delta.isValid():raise ValueError('Cannot prove actual feature influence; hand dependent work to one specialist')
            changes.append(native_bounds(delta))
    bounds=None
    if changes:
        bounds={'min':[min(b['min'][i] for b in changes) for i in range(3)],'max':[max(b['max'][i] for b in changes) for i in range(3)]}
        claimed=guard['bounds'];tolerance=0.000002
        if any(bounds['min'][i]<claimed['min'][i]-tolerance or bounds['max'][i]>claimed['max'][i]+tolerance for i in range(3)):raise ValueError('Collaboration conflict: native geometry changed outside the assigned region; source unchanged. Actual changed bounds '+json.dumps(bounds)+'. Consolidate these features under one specialist.')
    return {'artifactId':guard['artifactId'],'bounds':guard['bounds'],'changedBounds':bounds,'inside':True,'method':'exact native symmetric difference','toleranceMetres':0.000002}

def analytic_geometry(item,face=False,solid=None):
    """Compact exact support geometry in native metres Y-up, without fitting.

    Axial ranges use non-triangulated optimal BRep bounds after rigid alignment.
    Boundary roles require containment proof at a point on the trimmed face.
    Unknown optional data is omitted independently of known support geometry.
    """
    try:
        geometry=item.Surface if face else item.Curve;kind=geometry.__class__.__name__
        if kind not in ('Cylinder','Cone','Sphere','Toroid','Circle','Line'):return None
        if kind=='Line':
            direction=item.tangentAt(item.FirstParameter);direction.normalize()
            return {'kind':'line','origin':web(item.valueAt(item.FirstParameter)),'direction':web(direction*1000)}
        center=geometry.Center;axis=App.Vector(geometry.Axis);axis.normalize()
        result={'kind':{'Toroid':'torus'}.get(kind,kind.lower()),'center':web(center),'axis':web(axis*1000)}
        if kind=='Toroid':result.update({'majorRadiusMetres':geometry.MajorRadius/1000,'minorRadiusMetres':geometry.MinorRadius/1000})
        else:result['radiusMetres']=geometry.Radius/1000
        if kind=='Cone':result.update({'semiAngleRad':geometry.SemiAngle,'apex':web(geometry.Apex)})
    except Exception:return None
    if not face:return result
    try:
        transform=App.Placement(App.Vector(),App.Rotation(axis,App.Vector(0,0,1))).multiply(App.Placement(-center,App.Rotation())).toMatrix()
        aligned=transformed_shape(item,transform);bounds=aligned.optimalBoundingBox(False,False)
        result['axialRangeMetres']={'min':bounds.ZMin/1000,'max':bounds.ZMax/1000}
        if kind=='Cone':
            u0,u1,v0,v1=item.ParameterRange;radii=[]
            for v in (v0,v1):
                delta=item.valueAt((u0+u1)/2,v)-center;radii.append((delta-axis*delta.dot(axis)).Length/1000)
            result['radialRangeMetres']={'min':min(radii),'max':max(radii)}
    except Exception:pass
    if solid is not None and kind in ('Cylinder','Cone','Sphere'):
        try:
            u0,u1,v0,v1=item.ParameterRange
            for uf,vf in ((.37,.43),(.63,.57),(.25,.75),(.75,.25)):
                point=item.valueAt(u0+(u1-u0)*uf,v0+(v1-v0)*vf)
                if not item.isInside(point,1e-6,True):continue
                radial=point-center
                if kind!='Sphere':radial-=axis*radial.dot(axis)
                if radial.Length<1e-7:continue
                probe=max(.0005,min(.02,radial.Length*.00001));radial.normalize()
                smaller=solid.isInside(point-radial*probe,1e-7,False);larger=solid.isInside(point+radial*probe,1e-7,False)
                if smaller==larger:continue
                result.update({'boundaryRole':'exterior' if smaller else 'cavity','radialMaterialSide':'smallerRadius' if smaller else 'largerRadius'});break
        except Exception:pass
    return result


def export_native_object(doc,obj,folder,started,verification,traces):
    shape=obj.Shape;vertices=[];indices=[];faces=[]
    native_edges=list(shape.Edges);analytic_solid=shape.Solids[0] if len(shape.Solids)==1 else None
    for face_index,face in enumerate(shape.Faces):
        points,triangles=face.tessellate(.12);offset=len(vertices)//3;start=len(indices)//3
        for point in points:vertices.extend(web(point))
        for triangle in triangles:indices.extend(offset+i for i in triangle)
        normal=None
        try:normal=web(face.normalAt(0,0)*1000)
        except Exception:pass
        descriptor=analytic_geometry(face,True,analytic_solid)
        faces.append({'index':face_index+1,'type':face.Surface.__class__.__name__,'center':web(face.CenterOfMass),'areaMetres2':face.Area/1e6,'normal':normal,'bounds':native_bounds(face),'triangleStart':start,'triangleCount':len(triangles),'edgeIndices':[next((i+1 for i,edge in enumerate(native_edges) if edge.isSame(local)),0) for local in face.Edges],**({'analytic':descriptor} if descriptor else {})})
    if not indices:vertices,indices=wire_preview(shape)
    if not indices:raise ValueError('FreeCAD produced no visible geometry')
    if len(vertices)>600000 or len(indices)>1200000:raise ValueError('CAD preview is too detailed for Quest')
    bbox=exact_brep_bounds(shape);corners=[web(App.Vector(x,y,z)) for x in (bbox.XMin,bbox.XMax) for y in (bbox.YMin,bbox.YMax) for z in (bbox.ZMin,bbox.ZMax)]
    edges=[]
    for i,e in enumerate(shape.Edges):
        if i>=2048:break
        try:curve_type=e.Curve.__class__.__name__
        except Exception:curve_type='Degenerate'
        polyline=[]
        try:polyline=[web(point) for point in e.discretize(Number=2 if curve_type=='Line' else 48)]
        except Exception:polyline=[web(vertex.Point) for vertex in e.Vertexes]
        descriptor=analytic_geometry(e)
        edges.append({'index':i+1,'type':curve_type,'center':web(e.CenterOfMass),'lengthMetres':e.Length/1000,'bounds':native_bounds(e),'polyline':polyline,**({'analytic':descriptor} if descriptor else {})})
    for candidate in doc.Objects:
        if 'Draw3DResult' in candidate.PropertiesList:candidate.Draw3DResult=False
    obj.Visibility=True
    if 'Draw3DResult' not in obj.PropertiesList:obj.addProperty('App::PropertyBool','Draw3DResult','Draw3D')
    obj.Draw3DResult=True;doc.recompute();os.makedirs(folder,exist_ok=True);doc.saveAs(os.path.join(folder,'model.FCStd'));Part.export([obj],os.path.join(folder,'model.step'));shape.exportStl(os.path.join(folder,'model.stl'));shape.exportBrep(os.path.join(folder,'model.brep'))
    return {'vertices':vertices,'indices':indices,'metrics':{'vertexCount':len(vertices)//3,'triangleCount':len(indices)//3,'watertight':bool(shape.Solids) and shape.isClosed(),'valid':shape.isValid(),'solids':len(shape.Solids),'volumeMetres3':shape.Volume/1e9 if shape.Solids else 0,'bounds':{'min':[min(p[i] for p in corners) for i in range(3)],'max':[max(p[i] for p in corners) for i in range(3)]},'faceCount':len(shape.Faces),'edgeCount':len(shape.Edges),'solidRegions':[{'index':i+1,'center':web(solid.CenterOfMass),'bounds':native_bounds(solid),'volumeMetres3':solid.Volume/1e9} for i,solid in enumerate(shape.Solids)],'faces':faces[:2048],'edges':edges},'verification':{**verification,'nativeStatus':list(obj.State),'selectedTopologyVerified':bool(traces[-1].get('selection'))},'features':traces,'elapsedMs':round((time.perf_counter()-started)*1000),'version':'.'.join(App.Version()[:3])}

def export_independent_region(data,folder,started,verification):
    part_doc=App.newDocument('ExtractedPart');source=part_doc.addObject('Part::Feature','SourceSnapshot');source.Shape=data['source'];source.Visibility=False
    part=part_doc.addObject('Part::Feature','Region');part.Shape=data['shape'];part.Label=data['name'];part.addProperty('App::PropertyInteger','Draw3DFeatureIndex','Draw3D');part.Draw3DFeatureIndex=0;part.addProperty('App::PropertyLink','Draw3DInputObject','Draw3D');part.Draw3DInputObject=source;part_doc.recompute()
    trace=[{'operation':'extract_region','featureIndex':0,'name':data['name'],'parameters':data['parameters'],'selection':data['selection'],'effect':None}]
    result=export_native_object(part_doc,part,folder,started,{**verification,'independentRegion':True},trace)
    App.closeDocument(part_doc.Name);return result

def run(document,folder):
    started=time.perf_counter();extracted_part=None;independent_extraction=None;region_report=None
    for name in list(App.listDocuments()):App.closeDocument(name)
    checkpoint=document.get('checkpoint');checkpoint_count=checkpoint['operationCount'] if checkpoint else 0
    if not checkpoint and document.get('referenceArtifactId'):
        reference_doc=App.openDocument(os.path.join(os.path.dirname(folder),document['referenceArtifactId'],'model.FCStd'))
        for oi,operation in enumerate(document['operations']):
            if operation.get('topologyReferences'):continue
            original=feature_input(saved_feature(reference_doc,oi))
            if original is not None:operation['topologyReferences']=anchor_selection(original.Shape,operation.get('parameters',{}))
        App.closeDocument(reference_doc.Name)
    doc=App.openDocument(os.path.join(os.path.dirname(folder),checkpoint['artifactId'],'model.FCStd')) if checkpoint else App.newDocument('Draw3D')
    objects={};traces=[]
    if checkpoint:
        saved=next((o for o in reversed(doc.Objects) if 'Draw3DResult' in o.PropertiesList and o.Draw3DResult),None)
        if saved is None:saved=next(o for o in reversed(doc.Objects) if hasattr(o,'Shape'))
        input_index=checkpoint.get('beforeFeatureIndex')
        if input_index is not None:
            original_input=feature_input(saved_feature(doc,input_index))
            if original_input is None:raise ValueError('Saved native feature input is unavailable; original geometry was not changed')
            saved=original_input
            for oi,operation in enumerate(document['operations']):
                if oi<input_index or operation.get('topologyReferences'):continue
                original=feature_input(saved_feature(doc,oi))
                if original is not None:operation['topologyReferences']=anchor_selection(original.Shape,operation.get('parameters',{}))
        shape=saved.Shape.copy()
        for old in doc.Objects:
            if hasattr(old,'Visibility'):old.Visibility=False
            if 'Draw3DResult' in old.PropertiesList:old.Draw3DResult=False
        frozen=doc.addObject('Part::Feature','CheckpointBase');frozen.Shape=shape;objects[document['targetId']]=frozen
    for i,source in enumerate(document['meshes']):
        if checkpoint and source['id']==document['targetId']:continue
        objects[source['id']]=imported(doc,source,folder,'Source'+str(i+1))
    for index,op in enumerate(document['operations']):
        kind=op['operation'];p=op.get('parameters',{});target=op['targetId'];name='Feature'+str(index+1);selection_receipt=None
        if index<checkpoint_count:
            traces.append({'operation':kind,'name':op['name'],'featureIndex':index,'fromCheckpoint':True});continue
        if kind.startswith('create_'):obj=primitive(doc,kind,p,name)
        else:
            base=objects[target];tools=[objects[t] for t in op['toolIds']]
            if kind=='convert':
                obj=doc.addObject('Part::Feature',name);obj.Shape=base.Shape.copy()
                if not obj.Shape.Solids:raise ValueError('Return to CAD requires a closed solid mesh or a CAD body')
            elif kind in ('hole','hole_pattern'):
                direction=fc(p['direction']);direction.normalize();center=fc(p['center'])
                if p.get('axes'):
                    u=fc(p['axes'][0]);u.normalize()
                    if abs(u.dot(direction))>.999:raise ValueError('Pattern X axis must lie in the drilling plane')
                    u-=direction*u.dot(direction);u.normalize()
                else:
                    u=App.Vector(1,0,0) if abs(direction.x)<.9 else App.Vector(0,1,0)
                    u-=direction*u.dot(direction);u.normalize()
                v=direction.cross(u);v.normalize();pattern=p.get('patternType','grid' if kind=='hole_pattern' else 'single');offsets=[(0,0)]
                if pattern=='linear':offsets=[((i-(p['count']-1)/2)*p['spacingMetres']*1000,0) for i in range(p['count'])]
                if pattern=='grid':offsets=[((c-(p['columns']-1)/2)*p['spacingUMetres']*1000,(r-(p['rows']-1)/2)*p['spacingVMetres']*1000) for r in range(p['rows']) for c in range(p['columns'])]
                if pattern=='circular':offsets=[(math.cos(i*2*math.pi/p['count'])*p['patternRadiusMetres']*1000,math.sin(i*2*math.pi/p['count'])*p['patternRadiusMetres']*1000) for i in range(p['count'])]
                cutters=[];bbox=base.Shape.BoundBox
                through=p.get('through',True);span=max(1,bbox.DiagonalLength+(center-bbox.Center).Length)*2
                for hi,(x,y) in enumerate(offsets):
                    point=center+u*x+v*y;tool=doc.addObject('Part::Cylinder',name+'_Hole'+str(hi+1));tool.Radius=p['radiusMetres']*1000;tool.Height=span*2 if through else p['depthMetres']*1000
                    tool.Placement=App.Placement(point-direction*span if through else point,App.Rotation(App.Vector(0,0,1),direction));tool.Visibility=False;cutters.append(tool)
                doc.recompute();tool=cutters[0]
                if len(cutters)>1:
                    tool=doc.addObject('Part::MultiFuse',name+'_Pattern');tool.Shapes=cutters;tool.Refine=True;tool.Visibility=False;doc.recompute()
                obj=doc.addObject('Part::Cut',name);obj.Base=base;obj.Tool=tool;obj.Refine=True;doc.recompute()
                if abs(base.Shape.Volume-obj.Shape.Volume)<1e-6:raise ValueError('Hole does not intersect the target body; check centre and drilling direction')
            elif kind in ('difference','union','intersect'):
                obj=base
                for ti,tool in enumerate(tools):
                    feature=doc.addObject({'difference':'Part::Cut','union':'Part::Fuse','intersect':'Part::Common'}[kind],name+'_'+str(ti+1));feature.Base=obj;feature.Tool=tool
                    if 'Refine'in feature.PropertiesList:feature.Refine=True
                    obj.Visibility=False;tool.Visibility=False;doc.recompute();obj=feature
            elif kind=='draft':
                selected=topology_selection(base.Shape,p,op.get('topologyReferences'),'faceIndices');selection_receipt={'requestedFaceIndices':p['faceIndices'],'resolvedFaceIndices':selected,'faceCenters':[web(base.Shape.Faces[i-1].CenterOfMass) for i in selected]}
                if not base.Shape.Solids:raise ValueError('Draft requires a solid body')
                draft_body=doc.addObject('PartDesign::Body',name+'_DraftBody');draft_base=draft_body.newObject('PartDesign::Feature',name+'_DraftInput');draft_base.Shape=base.Shape.copy()
                neutral=doc.addObject('Part::Feature',name+'_NeutralPlane');neutral.Shape=Part.makePlane(max(1,base.Shape.BoundBox.DiagonalLength*2),max(1,base.Shape.BoundBox.DiagonalLength*2),fc(p['pivot']),fc(p['neutralNormal']));neutral.Visibility=False
                pull=doc.addObject('Part::Feature',name+'_PullDirection');direction=fc(p['direction']);direction.normalize();pull.Shape=Part.makeLine(fc(p['pivot']),fc(p['pivot'])+direction*1000);pull.Visibility=False;doc.recompute()
                obj=draft_body.newObject('PartDesign::Draft',name);obj.Base=(draft_base,['Face'+str(i) for i in selected]);obj.NeutralPlane=(neutral,['Face1']);obj.PullDirection=(pull,['Edge1']);obj.Angle=abs(p['angleDeg']);obj.Reversed=p['angleDeg']<0;obj.Refine=True;draft_base.Visibility=False
            elif kind in ('offset','thicken'):
                source=base.Shape
                if p.get('faceIndices'):
                    selected=topology_selection(source,p,op.get('topologyReferences'),'faceIndices');selection_receipt={'requestedFaceIndices':p['faceIndices'],'resolvedFaceIndices':selected};faces=[source.Faces[i-1] for i in selected];source=faces[0] if len(faces)==1 else Part.makeShell(faces)
                if kind=='thicken' and source.Solids:raise ValueError('Thicken needs an open surface/shell or explicit selected faces; use shell to hollow a solid')
                distance=p['thicknessMetres'] if kind=='thicken' else p['distanceMetres'];result=source.makeOffsetShape(distance*1000,.001,join=2 if p.get('joinType')=='intersection' else 0,fill=kind=='thicken')
                obj=doc.addObject('Part::Feature',name);obj.Shape=result
            elif kind=='mirror':
                normal=fc(p.get('direction',{'X':[1,0,0],'Y':[0,1,0],'Z':[0,0,1]}[p.get('axis','X')]));normal.normalize();plane=fc(p.get('pivot',[0,0,0]));a=[normal.x,normal.y,normal.z];b=[plane.x,plane.y,plane.z];matrix=App.Matrix()
                for row in range(3):
                    for col in range(3):setattr(matrix,'A'+str(row+1)+str(col+1),(1 if row==col else 0)-2*a[row]*a[col])
                    setattr(matrix,'A'+str(row+1)+'4',2*a[row]*sum(a[i]*b[i] for i in range(3)))
                mirrored=base.Shape.transformGeometry(matrix)
                if mirrored.Volume<0:mirrored.reverse()
                obj=doc.addObject('Part::Feature',name);obj.Shape=base.Shape.fuse(mirrored).removeSplitter() if p.get('keepOriginal',False) else mirrored
            elif kind=='body_pattern':
                shapes=[base.Shape.copy()];direction=fc(p['direction']);direction.normalize();pivot=fc(p.get('pivot',[0,0,0]));count=p['count']
                for number in range(1,count):
                    shape=base.Shape.copy()
                    if p['patternType']=='linear':shape.translate(direction*(number*p['spacingMetres']*1000))
                    else:shape.rotate(pivot,direction,number*p['angleDeg']/(count if abs(p['angleDeg']-360)<1e-8 else count-1))
                    shapes.append(shape)
                obj=doc.addObject('Part::Feature',name);obj.Shape=shapes[0].multiFuse(shapes[1:]).removeSplitter() if p.get('fuse',False) else Part.makeCompound(shapes)
            elif kind in ('extract_region','split_region'):
                extracted,selection_receipt=extract_native_region(base.Shape,p,op.get('topologyReferences'))
                region_report={'selector':p['regionType'],'sourceBounds':native_bounds(base.Shape),'extractedBounds':native_bounds(extracted),'sourceVolumeMetres3':base.Shape.Volume/1e9,'extractedVolumeMetres3':extracted.Volume/1e9,'parameterFrame':'native'}
                obj=doc.addObject('Part::Feature',name)
                if kind=='split_region':
                    remainder=base.Shape.cut(extracted).removeSplitter()
                    if remainder.isNull() or not remainder.isValid() or not remainder.Solids or remainder.Volume<=1e-6:raise ValueError('Split would leave no closed source remainder; use extract_region to copy an entire body')
                    error=abs(base.Shape.Volume-remainder.Volume-extracted.Volume)/max(base.Shape.Volume,1)
                    if error>1e-7:raise ValueError('Split does not conserve native solid volume; source body unchanged')
                    obj.Shape=remainder;region_report.update({'remainderBounds':native_bounds(remainder),'remainderVolumeMetres3':remainder.Volume/1e9,'relativeConservationError':error})
                    extracted_part={'shape':extracted,'source':base.Shape.copy(),'name':op['name']+' · extracted part','parameters':dict(p),'selection':selection_receipt}
                else:
                    obj.Shape=extracted;independent_extraction={'shape':extracted,'source':base.Shape.copy(),'name':op['name'],'parameters':dict(p),'selection':selection_receipt}
            elif kind=='thread':
                pitch=p['pitchMetres']*1000;height=p['heightMetres']*1000;depth=p['threadDepthMetres']*1000;clearance=p.get('clearanceMetres',0)*1000 if p.get('internal',False) else 0
                radius=p['radiusMetres']*1000+clearance;helix=Part.Wire(Part.makeHelix(pitch,height,radius,0,p.get('leftHanded',False)).Edges)
                slope=math.atan2(pitch,2*math.pi*radius);axial=App.Vector(0,-math.sin(slope)*( -1 if p.get('leftHanded',False) else 1),math.cos(slope));radial=App.Vector(1,0,0);origin=App.Vector(radius,0,0)
                points=[origin-radial*(depth*.2)-axial*(pitch*.32),origin+radial*depth,origin-radial*(depth*.2)+axial*(pitch*.32)]
                profile=Part.Wire(Part.makePolygon(points+[points[0]]).Edges);ridge=helix.makePipeShell([profile],True,True)
                ridge.Placement=App.Placement(fc(p['center']),App.Rotation(App.Vector(0,0,1),fc(p['direction'])))
                tool=doc.addObject('Part::Feature',name+'_HelicalTool');tool.Shape=ridge;tool.Visibility=False
                obj=doc.addObject('Part::Cut' if p.get('internal',False) else 'Part::Fuse',name);obj.Base=base;obj.Tool=tool;obj.Refine=True;doc.recompute()
                delta=obj.Shape.Volume-base.Shape.Volume
                if (p.get('internal',False) and delta>=-1e-6) or (not p.get('internal',False) and delta<=1e-6):raise ValueError('Helical thread does not engage the target wall; check native axis, root radius and thread extent')
                if len(obj.Shape.Solids)!=1:raise ValueError('Thread must form one connected solid with the target; check root radius and wall contact')
            elif kind in ('fillet','chamfer'):
                obj=doc.addObject('Part::Fillet' if kind=='fillet' else 'Part::Chamfer',name);obj.Base=base
                selected=topology_selection(base.Shape,p,op.get('topologyReferences'),'edgeIndices');selection_receipt={'requestedEdgeIndices':p.get('edgeIndices'),'resolvedEdgeIndices':selected,'edgeCenters':[web(base.Shape.Edges[i-1].CenterOfMass) for i in selected]};obj.Edges=[(i,p['widthMetres']*1000,p['widthMetres']*1000) for i in selected]
            elif kind=='shell':
                selected=topology_selection(base.Shape,p,op.get('topologyReferences'),'faceIndices');selection_receipt={'requestedFaceIndices':p['faceIndices'],'resolvedFaceIndices':selected};obj=doc.addObject('Part::Thickness',name);obj.Faces=(base,['Face'+str(i) for i in selected]);obj.Value=-p['thicknessMetres']*1000
            elif kind=='extrude':
                obj=doc.addObject('Part::Extrusion',name);obj.Base=base;direction=fc(p['direction']);direction.normalize();obj.Dir=direction;obj.LengthFwd=p['distanceMetres']*1000;obj.Solid=True
            elif kind=='revolve':
                obj=doc.addObject('Part::Revolution',name);obj.Source=base;direction=fc(p['direction']);direction.normalize();obj.Axis=direction;obj.Base=fc(p.get('pivot',[0,0,0]));obj.Angle=p['angleDeg'];obj.Solid=True
            elif kind=='loft':
                obj=doc.addObject('Part::Loft',name);obj.Sections=[base]+tools;obj.Solid=p.get('solid',True);obj.Ruled=p.get('ruled',False);obj.Closed=p.get('closed',False)
            elif kind=='sweep':
                if len(tools)!=1:raise ValueError('A sweep needs exactly one path body')
                obj=doc.addObject('Part::Sweep',name);obj.Sections=[base];obj.Spine=(tools[0],['Edge'+str(i+1) for i in range(len(tools[0].Shape.Edges))]);obj.Solid=p.get('solid',True);obj.Frenet=p.get('frenet',False)
            else:raise ValueError('Unsupported native CAD operation '+kind)
            base.Visibility=False
        if 'Draw3DFeatureIndex' not in obj.PropertiesList:obj.addProperty('App::PropertyInteger','Draw3DFeatureIndex','Draw3D')
        obj.Draw3DFeatureIndex=index
        if not kind.startswith('create_'):
            if 'Draw3DInputObject' not in obj.PropertiesList:obj.addProperty('App::PropertyLink','Draw3DInputObject','Draw3D')
            obj.Draw3DInputObject=base
        obj.Label=op['name'];doc.recompute()
        if kind=='draft':doc.recompute()  # PartDesign settles its newly linked neutral/pull references on the second dependency pass.
        if any(state in ('Invalid','Error') for state in obj.State):raise ValueError('FreeCAD rejected '+kind+': '+obj.getStatusString())
        if obj.Shape.isNull() or not obj.Shape.isValid():raise ValueError('FreeCAD rejected '+kind+': invalid or empty result; choose compatible dimensions or topology')
        if kind in ('difference','union','intersect','fillet','chamfer','shell','extrude','revolve','loft','sweep','convert','hole','hole_pattern','thread','mirror','body_pattern','draft','thicken','split_region') and not obj.Shape.Solids and not (kind in ('loft','sweep') and not p.get('solid',True)):raise ValueError('CAD operation did not produce a closed solid')
        effect=None
        if not kind.startswith('create_'):
            effect={'inputVolumeMetres3':base.Shape.Volume/1e9,'outputVolumeMetres3':obj.Shape.Volume/1e9,'volumeDeltaMetres3':(obj.Shape.Volume-base.Shape.Volume)/1e9,'inputFaces':len(base.Shape.Faces),'outputFaces':len(obj.Shape.Faces),'inputEdges':len(base.Shape.Edges),'outputEdges':len(obj.Shape.Edges)}
            if kind in ('fillet','chamfer','draft','offset','thicken') and obj.Shape.isSame(base.Shape):raise ValueError('Native '+kind+' did not change the requested geometry')
        objects[target]=obj;traces.append({'operation':kind,'name':op['name'],'featureIndex':index,'parameters':p,'selection':selection_receipt,'effect':effect})
    obj=objects[document['targetId']]
    verification={'checkpoint':checkpoint,'executedOperationCount':len(document['operations'])-checkpoint_count}
    if region_report:verification['region']=region_report
    if document.get('collaborationValidation'):verification['collaboration']=verify_collaboration(obj.Shape,document['collaborationValidation'],folder)
    if independent_extraction and document['operations'][-1]['operation']=='extract_region':
        result=export_independent_region(independent_extraction,folder,started,verification)
    else:result=export_native_object(doc,obj,folder,started,verification,traces)
    if extracted_part:
        secondary=export_independent_region(extracted_part,os.path.join(folder,'part-0'),started,{'executedOperationCount':1,'region':region_report,'derivedFromTransaction':True})
        result['parts']=[{'directory':'part-0','role':'extracted','name':extracted_part['name'],'result':secondary}]
    return result


print('DRAW3D_READY '+json.dumps({'version':'.'.join(App.Version()[:3])}),flush=True)
for line in sys.stdin:
    try:
        message=json.loads(line);result=run(message['document'],message['folder']);response={'id':message['id'],'result':result}
    except Exception as error:
        response={'id':message.get('id') if 'message'in locals() else None,'error':str(error)};traceback.print_exc(file=sys.stderr)
    print('DRAW3D_RESULT '+json.dumps(response,separators=(',',':'),allow_nan=False),flush=True)
