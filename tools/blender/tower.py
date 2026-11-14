"""Pieces for the palace tower and its balcony, modelled in Blender (bpy 4.2).

    python tower.py -- <outdir>   → balustrade.glb, brazier.glb, door.glb

balustrade.glb  a 2 m marble balustrade (base, 5 turned balusters, moulded rail), origin at the floor,
                centred on X, running along X, 1.05 m high.
brazier.glb     a bronze tripod brazier, 1.0 m high bowl rim; origin on the floor. The game puts a Fire on
                the bowl (object 'bowl' marks the rim centre).
door.glb        a heavy bronze-studded door 1.6 × 3.0 m with frame, origin at the floor centre, face along ±Y.
1 unit = 1 m, Z up.
"""
import bpy, bmesh, math, sys
from mathutils import Vector, Matrix

OUT = sys.argv[sys.argv.index('--') + 1]
V = Vector


def mat(name, color, rough=0.6, metal=0.0):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes['Principled BSDF']
    b.inputs['Base Color'].default_value = (*color, 1)
    b.inputs['Roughness'].default_value = rough
    b.inputs['Metallic'].default_value = metal
    return m


def obj_from_bm(name, bm, material, smooth=True):
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    o = bpy.data.objects.new(name, me)
    bpy.context.collection.objects.link(o)
    o.data.materials.append(material)
    for f in me.polygons:
        f.use_smooth = smooth
    return o


def add_box(bm, size, m):
    r = bmesh.ops.create_cube(bm, size=1.0)
    bmesh.ops.scale(bm, vec=size, verts=r['verts'])
    bmesh.ops.transform(bm, matrix=m, verts=r['verts'])


def add_cyl(bm, r1, r2, h, segs, m, cap=True):
    r = bmesh.ops.create_cone(bm, cap_ends=cap, segments=segs, radius1=r1, radius2=r2, depth=h)
    bmesh.ops.transform(bm, matrix=m, verts=r['verts'])


def add_sphere(bm, r, m, u=12, v=8):
    r_ = bmesh.ops.create_uvsphere(bm, u_segments=u, v_segments=v, radius=r)
    bmesh.ops.transform(bm, matrix=m, verts=r_['verts'])


def lathe(bm, profile, segs, m=Matrix.Identity(4)):
    rings = []
    for (r, z) in profile:
        ring = []
        for i in range(segs):
            a = i / segs * math.tau
            ring.append(bm.verts.new(m @ V((r * math.cos(a), r * math.sin(a), z))))
        rings.append(ring)
    for a, b in zip(rings, rings[1:]):
        for i in range(segs):
            bm.faces.new((a[i], a[(i + 1) % segs], b[(i + 1) % segs], b[i]))
    if profile[0][0] > 1e-4:
        bm.faces.new(list(reversed(rings[0])))
    if profile[-1][0] > 1e-4:
        bm.faces.new(rings[-1])


def tr(x, y, z):
    return Matrix.Translation(V((x, y, z)))


def export(path):
    bpy.ops.object.select_all(action='SELECT')
    bpy.ops.export_scene.gltf(filepath=path, export_format='GLB', export_apply=True, export_yup=True,
                              export_materials='EXPORT', export_normals=True, export_texcoords=False, use_selection=True)
    print('wrote', path, 'faces', sum(len(o.data.polygons) for o in bpy.data.objects if o.type == 'MESH'))


# ---------------- balustrade ----------------
bpy.ops.wm.read_factory_settings(use_empty=True)
marble = mat('marble', (0.80, 0.76, 0.68), 0.5)
bm = bmesh.new()
add_box(bm, V((2.0, 0.34, 0.12)), tr(0, 0, 0.06))          # base
add_box(bm, V((2.0, 0.30, 0.10)), tr(0, 0, 1.0))           # rail
add_box(bm, V((2.0, 0.36, 0.05)), tr(0, 0, 0.925))         # rail moulding
obj_from_bm('rails', bm, marble, smooth=False)
bm = bmesh.new()
prof = [(0.09, 0), (0.09, 0.06), (0.05, 0.08), (0.05, 0.18), (0.11, 0.30), (0.12, 0.40), (0.10, 0.52), (0.065, 0.66), (0.075, 0.72), (0.06, 0.78), (0.09, 0.82), (0.09, 0.9), (0, 0.9)]
for i in range(5):
    x = -0.8 + i * 0.4
    lathe(bm, prof, 14, tr(x, 0, 0.12))
obj_from_bm('balusters', bm, marble)
export(OUT + '/balustrade.glb')

# ---------------- brazier ----------------
bpy.ops.wm.read_factory_settings(use_empty=True)
bronze = mat('bronze', (0.55, 0.36, 0.14), 0.4, 0.9)
soot = mat('soot', (0.08, 0.06, 0.05), 0.9, 0.2)
bm = bmesh.new()
# three legs, slightly splayed, with claw feet
for i in range(3):
    a = i / 3 * math.tau
    top = V((math.cos(a) * 0.22, math.sin(a) * 0.22, 0.78))
    foot = V((math.cos(a) * 0.42, math.sin(a) * 0.42, 0.0))
    mid = (top + foot) / 2
    d = top - foot
    rot = V((0, 0, 1)).rotation_difference(d.normalized()).to_matrix().to_4x4()
    add_cyl(bm, 0.03, 0.035, d.length, 8, tr(*mid) @ rot)
    add_sphere(bm, 0.055, tr(*foot) @ tr(0, 0, 0.04), 8, 6)
    add_sphere(bm, 0.045, tr(*top), 8, 6)
# ring brace between the legs
for i in range(24):
    a = i / 24 * math.tau
    add_cyl(bm, 0.018, 0.018, 0.09, 6, tr(math.cos(a) * 0.3, math.sin(a) * 0.3, 0.42) @ Matrix.Rotation(a + math.pi / 2, 4, 'Z') @ Matrix.Rotation(math.pi / 2, 4, 'X'))
# the bowl
bowl = [(0.18, 0.76), (0.42, 0.82), (0.5, 0.9), (0.52, 1.0), (0.5, 1.02), (0.46, 1.0), (0.44, 0.9), (0.2, 0.86)]
lathe(bm, bowl, 24)
# rim bead
for i in range(24):
    a = i / 24 * math.tau
    add_sphere(bm, 0.03, tr(math.cos(a) * 0.51, math.sin(a) * 0.51, 1.01), 6, 4)
obj_from_bm('brazier', bm, bronze)
# coals
bm = bmesh.new()
lathe(bm, [(0.0, 0.86), (0.3, 0.88), (0.4, 0.92), (0.3, 0.97), (0.0, 0.99)], 16)
o = obj_from_bm('bowl', bm, soot)
export(OUT + '/brazier.glb')

# ---------------- door ----------------
bpy.ops.wm.read_factory_settings(use_empty=True)
oak = mat('oak', (0.27, 0.17, 0.09), 0.78)
iron = mat('iron', (0.09, 0.08, 0.075), 0.5, 0.75)
bronze = mat('bronze', (0.62, 0.42, 0.17), 0.33, 0.9)
bm = bmesh.new()
for i in range(4):
    add_box(bm, V((0.38, 0.12, 2.9)), tr(-0.6 + i * 0.4, 0, 1.45))
obj_from_bm('planks', bm, oak, smooth=False)
bm = bmesh.new()
add_box(bm, V((0.18, 0.22, 3.1)), tr(-0.89, 0, 1.55))
add_box(bm, V((0.18, 0.22, 3.1)), tr(0.89, 0, 1.55))
add_box(bm, V((1.96, 0.22, 0.2)), tr(0, 0, 3.0))
obj_from_bm('frame', bm, mat('stone', (0.6, 0.56, 0.5), 0.7), smooth=False)
bm = bmesh.new()
for z in (0.5, 1.5, 2.5):
    for side in (1, -1):
        add_box(bm, V((1.5, 0.04, 0.14)), tr(0, side * 0.08, z))
        for k in range(5):
            add_sphere(bm, 0.03, tr(-0.6 + k * 0.3, side * 0.11, z), 8, 6)
obj_from_bm('bands', bm, iron)
bm = bmesh.new()
add_sphere(bm, 0.08, tr(0.55, -0.12, 1.3), 10, 8)
obj_from_bm('knob', bm, bronze)
export(OUT + '/door.glb')
