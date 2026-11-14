"""Marble monuments for Odysseus, modelled in Blender (bpy 4.2): a horse statue and two pedestals.

    python statue.py -- <outdir>   → horse_statue.glb, pedestal.glb, pillar.glb

The horse is a solid loft (body, neck, head, legs, tail, mane, ears) fused with a voxel remesh and
smoothed, so it reads as one carved block of marble, not as glued parts. 1 unit = 1 m, origin on the
pedestal top under the belly, the horse faces +Y in Blender (= −Z in glTF, the game turns it).
pedestal.glb: square base 1.3 m × 1.3 m, 1.3 m high (mouldings, raised panels).
pillar.glb: round column for the busts, 0.6 m plinth, 1.4 m high.
"""
import bpy, bmesh, math, sys
from mathutils import Vector, Matrix

OUT = sys.argv[sys.argv.index('--') + 1]
V = Vector


def mat(name, color, rough=0.5, metal=0.0):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes['Principled BSDF']
    b.inputs['Base Color'].default_value = (*color, 1)
    b.inputs['Roughness'].default_value = rough
    b.inputs['Metallic'].default_value = metal
    return m


def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)


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


def frames(points):
    """parallel-transport frames (right, up) along a polyline"""
    n = len(points)
    tangents = [(points[min(n - 1, i + 1)] - points[max(0, i - 1)]).normalized() for i in range(n)]
    up = V((0, 0, 1))
    if abs(tangents[0].dot(up)) > 0.95:
        up = V((0, 1, 0))
    right = tangents[0].cross(up).normalized()
    out = []
    for t in tangents:
        right = (right - t * right.dot(t)).normalized()
        out.append((right, right.cross(t).normalized()))
    return out


def tube(bm, points, section, segs=28):
    """a closed solid loft: `section(t, angle) -> (rx, ry)`; capped with a fan at both ends"""
    fr = frames(points)
    rings = []
    n = len(points)
    for i, p in enumerate(points):
        t = i / (n - 1)
        right, up = fr[i]
        ring = []
        for k in range(segs):
            a = k / segs * math.tau
            rx, ry = section(t, a)
            ring.append(bm.verts.new(p + right * (math.cos(a) * rx) + up * (math.sin(a) * ry)))
        rings.append(ring)
    for i in range(n - 1):
        for k in range(segs):
            bm.faces.new((rings[i][k], rings[i][(k + 1) % segs], rings[i + 1][(k + 1) % segs], rings[i + 1][k]))
    c0 = bm.verts.new(points[0])
    c1 = bm.verts.new(points[-1])
    for k in range(segs):
        bm.faces.new((rings[0][(k + 1) % segs], rings[0][k], c0))
        bm.faces.new((rings[-1][k], rings[-1][(k + 1) % segs], c1))


def ell(rx, ry):
    return lambda t, a: (rx, ry)


marble_c = (0.80, 0.78, 0.74)

# ----------------------------------------------------------------------------------------------
# the horse: Blender space, X right, Y forward (the horse looks along +Y), Z up
# ----------------------------------------------------------------------------------------------
reset()
marble = mat('marble', marble_c, 0.38)
bm = bmesh.new()


def B(x, fwd, up):
    return V((x, fwd, up))


# body: a deep barrel, 1.9 m long, back at 1.5 m
body_pts = [B(0, -0.95 + 1.9 * t, 1.18 + 0.05 * math.sin(math.pi * t) ** 2 - 0.04 * (t > 0.7) * (t - 0.7) / 0.3) for t in (i / 20 for i in range(21))]


def body_section(t, a):
    taper = 1 - 0.46 * abs(2 * t - 1) ** 2.6
    chest = 1 + 0.08 * max(0.0, t - 0.6) / 0.4
    rx = 0.36 * taper * chest
    ry = 0.40 * taper * chest * (1.06 if math.sin(a) < 0 else 0.96)
    return rx, ry


tube(bm, body_pts, body_section, 32)
# shoulders and haunches: two flatter lobes blended into the body by the remesh
tube(bm, [B(0, 0.45 + 0.5 * t, 1.12) for t in (i / 6 for i in range(7))], lambda t, a: (0.40 * (1 - 0.5 * abs(2 * t - 1) ** 2), 0.33 * (1 - 0.5 * abs(2 * t - 1) ** 2)), 24)
tube(bm, [B(0, -0.95 + 0.5 * t, 1.12) for t in (i / 6 for i in range(7))], lambda t, a: (0.42 * (1 - 0.5 * abs(2 * t - 1) ** 2), 0.36 * (1 - 0.5 * abs(2 * t - 1) ** 2)), 24)
# neck: arched, rising from the withers
neck_pts = bezier(B(0, 0.75, 1.42), B(0, 1.05, 1.85), B(0, 1.22, 2.05), B(0, 1.38, 2.22), 12)
tube(bm, neck_pts, lambda t, a: (0.24 * (1 - 0.35 * t), 0.34 * (1 - 0.3 * t) * (1.1 if math.sin(a) > 0 else 1.0)), 24)
# head: skull then a long muzzle, carried down-forward
head_pts = bezier(B(0, 1.34, 2.25), B(0, 1.62, 2.18), B(0, 1.78, 1.95), B(0, 1.98, 1.78), 10)
tube(bm, head_pts, lambda t, a: (0.15 * (1 - 0.4 * t), 0.19 * (1 - 0.45 * t) * (1.18 if (math.sin(a) < -0.3 and t < 0.45) else 1.0)), 20)
# jaw / cheek
tube(bm, [B(0, 1.42 + 0.14 * t, 2.08 - 0.08 * t) for t in (i / 4 for i in range(5))], ell(0.16, 0.13), 16)
# ears
for x in (-0.07, 0.07):
    tube(bm, [B(x + x * 1.2 * t, 1.30 - 0.03 * t, 2.32 + 0.17 * t) for t in (i / 4 for i in range(5))], lambda t, a: (0.045 * (1 - 0.85 * t), 0.03 * (1 - 0.8 * t)), 10)
# mane: a ridge along the crest of the neck
mane_pts = [p + V((0, -0.06, 0.30 - 0.04 * i / 11)) for i, p in enumerate(neck_pts)]
tube(bm, mane_pts, lambda t, a: (0.06, 0.14 * (1 - 0.3 * abs(2 * t - 1))), 12)
# forelock between the ears
tube(bm, [B(0, 1.33 + 0.16 * t, 2.36 - 0.16 * t) for t in (i / 4 for i in range(5))], lambda t, a: (0.07 * (1 - 0.6 * t), 0.05), 10)

# legs: three standing, the left foreleg raised and bent
def leg(points):
    def sec(t, a):
        r = 0.115 * (1 - 0.35 * t) + 0.03 * math.exp(-((t - 0.45) / 0.07) ** 2) + 0.035 * max(0.0, 1 - t / 0.2)
        return r, r * 1.1
    tube(bm, points, sec, 16)
    # hoof
    hp = points[-1]
    tube(bm, [hp + V((0, 0, 0.08)), hp + V((0, 0.02, -0.10))], lambda t, a: (0.095 + 0.015 * t, 0.105 + 0.02 * t), 16)


leg([B(0.23, 0.62, 1.05), B(0.23, 0.66, 0.70), B(0.23, 0.70, 0.40), B(0.24, 0.68, 0.10)])          # right fore, standing
leg([B(-0.23, 0.62, 1.05), B(-0.24, 0.80, 0.78), B(-0.26, 0.98, 0.62), B(-0.27, 1.05, 0.52)])      # left fore, raised and folded
leg([B(0.22, -0.70, 1.0), B(0.23, -0.82, 0.72), B(0.23, -0.74, 0.40), B(0.24, -0.70, 0.10)])       # right hind
leg([B(-0.22, -0.70, 1.0), B(-0.23, -0.90, 0.72), B(-0.24, -0.86, 0.40), B(-0.25, -0.84, 0.10)])   # left hind, set back
# thighs blend the hind legs into the haunches
for x in (-0.21, 0.21):
    tube(bm, [B(x, -0.72, 1.06), B(x * 1.05, -0.80, 0.80)], ell(0.16, 0.19), 14)
# tail: a thick plait falling to the hocks
tail_pts = bezier(B(0, -0.98, 1.38), B(0.02, -1.22, 1.30), B(0.08, -1.26, 0.95), B(0.10, -1.15, 0.55), 10)
tube(bm, tail_pts, lambda t, a: (0.075 * (1 - 0.5 * t) + 0.02, 0.09 * (1 - 0.5 * t) + 0.02), 14)

horse = obj_from_bm('horse', bm, marble)
bpy.context.view_layer.objects.active = horse
horse.select_set(True)
# fuse everything into one marble block, then soften the carving
rm = horse.modifiers.new('remesh', 'REMESH')
rm.mode = 'VOXEL'
rm.voxel_size = 0.022
rm.use_smooth_shade = True
bpy.ops.object.modifier_apply(modifier='remesh')
sm = horse.modifiers.new('smooth', 'SMOOTH')
sm.factor = 0.6
sm.iterations = 4
bpy.ops.object.modifier_apply(modifier='smooth')
dec = horse.modifiers.new('decimate', 'DECIMATE')
dec.ratio = min(1.0, 14000 / max(1, len(horse.data.polygons)))
bpy.ops.object.modifier_apply(modifier='decimate')
for f in horse.data.polygons:
    f.use_smooth = True
print('horse polys', len(horse.data.polygons))
export(OUT + '/horse_statue.glb')

# ----------------------------------------------------------------------------------------------
# pedestal: plinth, base mouldings, die with raised panels, cornice, cap – 1.3 × 1.3 × 1.3 m
# ----------------------------------------------------------------------------------------------
def add_box(bm, size, m):
    r = bmesh.ops.create_cube(bm, size=1.0)
    bmesh.ops.scale(bm, vec=size, verts=r['verts'])
    bmesh.ops.transform(bm, matrix=m, verts=r['verts'])
    return r['verts']


def slab(bm, w, z0, h):
    add_box(bm, (w, w, h), Matrix.Translation((0, 0, z0 + h / 2)))


reset()
marble = mat('marble', marble_c, 0.38)
bm = bmesh.new()
W, H = 1.3, 1.3
slab(bm, W + 0.30, 0.00, 0.14)      # plinth
slab(bm, W + 0.20, 0.14, 0.06)      # torus course
slab(bm, W + 0.10, 0.20, 0.05)      # fillet
slab(bm, W, 0.25, 0.80)             # die
slab(bm, W + 0.10, 1.05, 0.05)      # bed mould
slab(bm, W + 0.20, 1.10, 0.08)      # cornice
slab(bm, W + 0.26, 1.18, 0.12)      # cap, top at 1.30
# raised panels on the four faces of the die
for ang in range(4):
    R = Matrix.Rotation(ang * math.pi / 2, 4, 'Z')
    for (dx, dz, sx, sz) in [(0, 0.95, 0.9, 0.05), (0, 0.35, 0.9, 0.05), (-0.425, 0.65, 0.05, 0.65), (0.425, 0.65, 0.05, 0.65)]:
        add_box(bm, (sx, 0.04, sz), R @ Matrix.Translation((dx, W / 2 + 0.01, dz)))
ped = obj_from_bm('pedestal', bm, marble, smooth=False)
bpy.context.view_layer.objects.active = ped
ped.select_set(True)
bv = ped.modifiers.new('bevel', 'BEVEL')
bv.width = 0.012
bv.segments = 2
bv.limit_method = 'ANGLE'
bpy.ops.object.modifier_apply(modifier='bevel')
for f in ped.data.polygons:
    f.use_smooth = True
bpy.ops.object.shade_smooth_by_angle(angle=math.radians(40))
export(OUT + '/pedestal.glb')

# ----------------------------------------------------------------------------------------------
# pillar for the busts: square plinth, round fluted shaft, capital with abacus – 0.6 m, 1.4 m high
# ----------------------------------------------------------------------------------------------
def lathe(bm, profile, segs, m=Matrix.Identity(4)):
    rings = []
    for (r, z) in profile:
        rings.append([bm.verts.new(m @ V((math.cos(k / segs * math.tau) * r, math.sin(k / segs * math.tau) * r, z))) for k in range(segs)])
    for i in range(len(rings) - 1):
        for k in range(segs):
            bm.faces.new((rings[i][k], rings[i][(k + 1) % segs], rings[i + 1][(k + 1) % segs], rings[i + 1][k]))
    bm.faces.new(rings[0][::-1])
    bm.faces.new(rings[-1])


reset()
marble = mat('marble', marble_c, 0.38)
bm = bmesh.new()
slab(bm, 0.60, 0.0, 0.10)
slab(bm, 0.52, 0.10, 0.04)
prof = [(0.25, 0.14), (0.25, 0.18), (0.21, 0.22), (0.19, 0.26), (0.19, 1.15), (0.21, 1.20), (0.25, 1.25), (0.27, 1.30), (0.27, 1.32)]
lathe(bm, prof, 24)
pil = obj_from_bm('pillar_round', bm, marble)
bm = bmesh.new()
# flutes: 16 shallow grooves read as raised ribs between them
for k in range(16):
    a = k / 16 * math.tau
    add_box(bm, (0.035, 0.03, 0.86), Matrix.Rotation(a, 4, 'Z') @ Matrix.Translation((0.185, 0, 0.705)))
slab(bm, 0.56, 1.32, 0.08)   # abacus, top at 1.40
ribs = obj_from_bm('pillar_ribs', bm, marble, smooth=False)
export(OUT + '/pillar.glb')
