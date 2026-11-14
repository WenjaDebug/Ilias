"""A seated marble lion for the gate of Troy (bpy 4.2) – the archaic guardian type (Delos lions):
sitting on its haunches, forelegs straight, chest high, head up, a thick ruff of stylised mane locks.

    python lion.py -- <outdir>   → lion_statue.glb, plinth.glb

The body is sculpted from overlapping ellipsoids and capsules fused by a voxel remesh, so there are
no seams or sawn-off tube ends. 1 unit = 1 m, origin on the plinth top between the paws, the lion
looks along +Y in Blender (= −Z in glTF). About 2.4 m long, 2.0 m high.
plinth.glb: the lion's moulded marble plinth, 1.9 × 3.1 m, 1.2 m high, origin at the floor centre.
"""
import bpy, bmesh, math, sys, random
from mathutils import Vector, Matrix

OUT = sys.argv[sys.argv.index('--') + 1]
V = Vector
random.seed(7)


def mat(name, color, rough=0.5, metal=0.0):
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


def export(path):
    bpy.ops.object.select_all(action='SELECT')
    bpy.ops.export_scene.gltf(filepath=path, export_format='GLB', export_apply=True, export_yup=True,
                              export_materials='EXPORT', export_normals=True, export_texcoords=False, use_selection=True)
    print('wrote', path, 'faces', sum(len(o.data.polygons) for o in bpy.data.objects if o.type == 'MESH'))


def bezier(p0, p1, p2, p3, n):
    return [p0 * (1 - t) ** 3 + p1 * 3 * t * (1 - t) ** 2 + p2 * 3 * t * t * (1 - t) + p3 * t ** 3 for t in (i / (n - 1) for i in range(n))]


# (x right, y forward, z up)
def ellipsoid(bm, center, radii, rot=None, u=18, v=12):
    """an ellipsoid; `rot` is an optional rotation matrix applied before the translation"""
    r = bmesh.ops.create_uvsphere(bm, u_segments=u, v_segments=v, radius=1.0)
    m = Matrix.Translation(center) @ (rot or Matrix.Identity(4)) @ Matrix.Diagonal((*radii, 1.0))
    bmesh.ops.transform(bm, matrix=m, verts=r['verts'])


def capsule(bm, a, b, r0, r1, segs=14):
    """a tapered capsule from a to b (spheres at both ends, cone between)"""
    d = b - a
    L = d.length
    rot = V((0, 0, 1)).rotation_difference(d.normalized()).to_matrix().to_4x4()
    r = bmesh.ops.create_cone(bm, cap_ends=True, segments=segs, radius1=r0, radius2=r1, depth=L)
    bmesh.ops.transform(bm, matrix=Matrix.Translation((a + b) / 2) @ rot, verts=r['verts'])
    ellipsoid(bm, a, (r0, r0, r0), None, 12, 8)
    ellipsoid(bm, b, (r1, r1, r1), None, 12, 8)


def along(points, radius, segs=14):
    """capsule chain along a polyline; radius(t) -> r"""
    n = len(points)
    for i in range(n - 1):
        t0, t1 = i / (n - 1), (i + 1) / (n - 1)
        capsule(bm, points[i], points[i + 1], radius(t0), radius(t1), segs)


def rotxyz(x=0.0, y=0.0, z=0.0):
    return Matrix.Rotation(z, 4, 'Z') @ Matrix.Rotation(y, 4, 'Y') @ Matrix.Rotation(x, 4, 'X')


marble = mat('marble', (0.82, 0.79, 0.74), 0.36)
bpy.ops.wm.read_factory_settings(use_empty=True)
marble = mat('marble', (0.82, 0.79, 0.74), 0.36)
bm = bmesh.new()

# ---- hindquarters: the lion sits, so the rump is low and wide, the thighs fold forward on the ground
ellipsoid(bm, V((0, -0.95, 0.5)), (0.40, 0.42, 0.42))                     # rump
for s in (-1, 1):
    ellipsoid(bm, V((s * 0.3, -0.78, 0.36)), (0.22, 0.42, 0.36), rotxyz(x=-0.35))   # thigh (folded)
    ellipsoid(bm, V((s * 0.33, -0.35, 0.14)), (0.12, 0.34, 0.13))                   # shin lying forward
    ellipsoid(bm, V((s * 0.34, 0.02, 0.09)), (0.13, 0.17, 0.085))                   # hind paw
    for k in (-1.5, -0.5, 0.5, 1.5):
        ellipsoid(bm, V((s * 0.34 + k * 0.058, 0.17, 0.065)), (0.03, 0.055, 0.045), None, 10, 7)

# ---- torso: rising from the rump to a deep chest
spine = bezier(V((0, -0.85, 0.62)), V((0, -0.4, 0.7)), V((0, 0.15, 0.95)), V((0, 0.5, 1.12)), 13)
for i, p in enumerate(spine):
    t = i / 12
    ellipsoid(bm, p, (0.33 - 0.04 * abs(t - 0.5), 0.3, 0.36 + 0.06 * t), rotxyz(x=-0.3 * t))
ellipsoid(bm, V((0, 0.5, 0.98)), (0.36, 0.3, 0.42))                       # chest
ellipsoid(bm, V((0, 0.62, 0.72)), (0.3, 0.22, 0.3))                       # breast between the forelegs

# ---- forelegs: straight, planted, with heavy paws
for s in (-1, 1):
    capsule(bm, V((s * 0.26, 0.5, 1.0)), V((s * 0.27, 0.56, 0.5)), 0.15, 0.115, 16)   # upper
    capsule(bm, V((s * 0.27, 0.56, 0.5)), V((s * 0.27, 0.6, 0.14)), 0.11, 0.105, 16)  # lower
    ellipsoid(bm, V((s * 0.27, 0.72, 0.095)), (0.145, 0.2, 0.09))                      # paw
    for k in (-1.5, -0.5, 0.5, 1.5):
        ellipsoid(bm, V((s * 0.27 + k * 0.066, 0.9, 0.065)), (0.034, 0.06, 0.05), None, 10, 7)

# ---- neck and head: the head high and slightly forward, looking at the visitor
ellipsoid(bm, V((0, 0.6, 1.3)), (0.24, 0.26, 0.26))                       # neck
head_c = V((0, 0.78, 1.58))
ellipsoid(bm, head_c, (0.22, 0.24, 0.21))                                 # skull
ellipsoid(bm, head_c + V((0, 0.2, -0.06)), (0.15, 0.2, 0.12))             # muzzle
ellipsoid(bm, head_c + V((0, 0.3, -0.01)), (0.09, 0.07, 0.06))            # nose block
ellipsoid(bm, head_c + V((0, 0.18, -0.16)), (0.12, 0.17, 0.07))           # lower jaw
for s in (-1, 1):
    ellipsoid(bm, head_c + V((s * 0.1, 0.17, 0.09)), (0.065, 0.07, 0.035))           # brow ridge
    ellipsoid(bm, head_c + V((s * 0.17, -0.02, 0.2)), (0.055, 0.04, 0.07))           # ear
    ellipsoid(bm, head_c + V((s * 0.12, 0.26, -0.03)), (0.05, 0.06, 0.05))           # cheek / whisker pad

# ---- mane: an archaic ruff of thick stylised locks in rings round the face, spilling over the
# shoulders and the chest; each lock is a teardrop pointing outward, overlapping its neighbours
def lock(center, direction, length, r):
    d = direction.normalized()
    rot = V((0, 0, 1)).rotation_difference(d).to_matrix().to_4x4()
    ellipsoid(bm, center + d * length * 0.5, (r, r, length * 0.5), rot, 12, 8)
    ellipsoid(bm, center + d * length * 0.85, (r * 0.6, r * 0.6, length * 0.22), rot, 10, 6)   # tapering tip

# the inner mane: a shaggy cap round the back of the head (the face stays free), every lock
# sweeping back and down over the neck
mane_c = head_c + V((0, -0.06, -0.08))
N = 90
for i in range(N):
    # fibonacci sphere sampling
    zf = 1 - 2 * (i + 0.5) / N
    rr = math.sqrt(max(0.0, 1 - zf * zf))
    ph = i * 2.399963
    d = V((math.cos(ph) * rr, zf, math.sin(ph) * rr))   # (x, forward, up)
    if d.y > 0.35:
        continue                                        # the face
    if d.z < -0.55 and d.y > -0.3:
        continue                                        # the throat (chest locks come separately)
    base = mane_c + d * 0.27
    sweep = V((d.x * 0.55, d.y * 0.4 - 0.8, d.z * 0.5 - 0.3)).normalized()
    lock(base, sweep, 0.32 * (0.85 + 0.3 * random.random()), 0.08)
# the outer collar: a ring of longer locks round the base of the neck, spilling onto the shoulders and chest
axis = V((0, 0.35, 1)).normalized()
ring_c = head_c + V((0, -0.2, -0.38))
u = V((1, 0, 0))
w = axis.cross(u).normalized()
for i in range(26):
    a = i / 26 * math.tau
    d = u * math.cos(a) + w * math.sin(a)
    base = ring_c + d * 0.4
    sweep = (d * 0.5 + V((0, -0.35, -1.0))).normalized()
    lock(base, sweep, 0.36 * (0.85 + 0.3 * random.random()), 0.09)
# the beard and the chest locks hanging between the forelegs
for i in range(5):
    x = -0.16 + i * 0.08
    lock(head_c + V((x, 0.1, -0.2)), V((x * 0.5, 0.15, -1)), 0.26, 0.06)
for i in range(6):
    x = -0.25 + i * 0.1
    lock(V((x, 0.72, 1.18)), V((x * 0.6, 0.35, -1)), 0.32, 0.075)

# ---- tail: curled round the right haunch, tuft at the end
tail = bezier(V((0.05, -1.3, 0.55)), V((0.5, -1.35, 0.3)), V((0.7, -0.9, 0.1)), V((0.55, -0.45, 0.1)), 10)
along(tail, lambda t: 0.065 - 0.02 * t, 10)
ellipsoid(bm, tail[-1] + V((0, 0.12, 0)), (0.075, 0.13, 0.07))

lion = obj_from_bm('lion', bm, marble)
bpy.context.view_layer.objects.active = lion
lion.select_set(True)
rm = lion.modifiers.new('remesh', 'REMESH')
rm.mode = 'VOXEL'
rm.voxel_size = 0.018
rm.use_smooth_shade = True
bpy.ops.object.modifier_apply(modifier='remesh')
sm = lion.modifiers.new('smooth', 'SMOOTH')
sm.factor = 0.5
sm.iterations = 3
bpy.ops.object.modifier_apply(modifier='smooth')
dec = lion.modifiers.new('decimate', 'DECIMATE')
dec.ratio = min(1.0, 16000 / max(1, len(lion.data.polygons)))
bpy.ops.object.modifier_apply(modifier='decimate')
for f in lion.data.polygons:
    f.use_smooth = True
print('lion polys', len(lion.data.polygons))
export(OUT + '/lion_statue.glb')

# ---------------------------------------------------------------------------------------------
# the plinth: a stepped marble block with a cyma moulding under the top slab and a plain base course
# ---------------------------------------------------------------------------------------------
bpy.ops.wm.read_factory_settings(use_empty=True)
marble = mat('marble', (0.82, 0.79, 0.74), 0.36)
bm = bmesh.new()


def block(x0, x1, y0, y1, z0, z1):
    r = bmesh.ops.create_cube(bm, size=1.0)
    bmesh.ops.scale(bm, vec=V((x1 - x0, y1 - y0, z1 - z0)), verts=r['verts'])
    bmesh.ops.translate(bm, vec=V(((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2)), verts=r['verts'])


W, D = 1.9, 3.1
block(-W / 2 - 0.08, W / 2 + 0.08, -D / 2 - 0.08, D / 2 + 0.08, 0, 0.16)            # base course
block(-W / 2, W / 2, -D / 2, D / 2, 0.16, 0.95)                                      # the die
# cyma moulding: a few stepped bands growing outward under the top slab
for i, (inset, z0, z1) in enumerate([(0.0, 0.95, 1.0), (-0.03, 1.0, 1.05), (-0.07, 1.05, 1.1), (-0.1, 1.1, 1.2)]):
    block(-W / 2 + inset, W / 2 - inset, -D / 2 + inset, D / 2 - inset, z0, z1)
# a sunken panel on each long side and the front
for sx in (-1, 1):
    block(sx * (W / 2 - 0.02), sx * (W / 2 + 0.03), -D / 2 + 0.3, D / 2 - 0.3, 0.3, 0.8)
block(-W / 2 + 0.3, W / 2 - 0.3, D / 2 - 0.02, D / 2 + 0.03, 0.3, 0.8)
block(-W / 2 + 0.3, W / 2 - 0.3, -D / 2 - 0.03, -D / 2 + 0.02, 0.3, 0.8)
plinth = obj_from_bm('plinth', bm, marble, smooth=False)
export(OUT + '/plinth.glb')
