"""Pieces that make the palace tower look like a palace, modelled in Blender (bpy 4.2).

    python palace.py -- <outdir>   → stairs.glb, column.glb, frieze.glb, trophy.glb, throne.glb, mosaic.glb

stairs.glb   a marble flight of 10 steps (rise 0.45, run 0.55, 1.2 m wide) with solid cheeks either side, a
             moulded handrail and ball-topped newel posts. Origin at the floor under the front edge of the first
             step, centred on X, rising along +Y (= −Z in the game). 5.5 m long, 4.5 m high (+ rails).
column.glb   an Ionic column 4.2 m high: square plinth, moulded base, fluted shaft, volute capital. Origin at
             the floor centre.
frieze.glb   a 2 m painted frieze band 0.5 m high: gold meander on deep blue between two red fillets with a
             dentil course underneath. Origin at the bottom centre, the face toward +Y.
trophy.glb   a bronze shield with two crossed spears for a wall. Origin at the wall, face toward +Y, 1.6 m.
throne.glb   Hector's throne on a two-step dais: gilded, lion-paw feet, red seat. Origin at the floor centre,
             facing +Y. 1.5 m wide, 2.1 m high.
mosaic.glb   a round floor mosaic 3 m across: a star in concentric rings (terracotta, black, ochre, white).
             Origin at its centre, 2 cm thick.
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


def obj_from_bm(name, bm, material, smooth=False):
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    o = bpy.data.objects.new(name, me)
    bpy.context.collection.objects.link(o)
    o.data.materials.append(material)
    for f in me.polygons:
        f.use_smooth = smooth
    return o


def box(bm, x0, x1, y0, y1, z0, z1):
    r = bmesh.ops.create_cube(bm, size=1.0)
    bmesh.ops.scale(bm, vec=V((x1 - x0, y1 - y0, z1 - z0)), verts=r['verts'])
    bmesh.ops.translate(bm, vec=V(((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2)), verts=r['verts'])


def boxm(bm, size, m):
    r = bmesh.ops.create_cube(bm, size=1.0)
    bmesh.ops.scale(bm, vec=size, verts=r['verts'])
    bmesh.ops.transform(bm, matrix=m, verts=r['verts'])


def cyl(bm, r0, r1, length, segs, m):
    r = bmesh.ops.create_cone(bm, cap_ends=True, segments=segs, radius1=r0, radius2=r1, depth=length)
    bmesh.ops.transform(bm, matrix=m, verts=r['verts'])


def sphere(bm, r, m, u=14, v=10):
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


def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)


MARBLE = (0.84, 0.80, 0.72)
GOLD = (0.95, 0.72, 0.30)

# ---------------- stairs ----------------
reset()
marble = mat('marble', MARBLE, 0.42)
marble2 = mat('marble_dark', (0.62, 0.58, 0.52), 0.5)
N, RISE, RUN, WID = 10, 0.45, 0.55, 1.2
bm = bmesh.new()
for i in range(N):
    y0, y1 = i * RUN, (i + 1) * RUN
    # the solid mass of the step (down to the floor) and a tread slab with a nosing that overhangs
    box(bm, -WID / 2, WID / 2, y0, y1, 0, (i + 1) * RISE - 0.06)
    box(bm, -WID / 2 - 0.02, WID / 2 + 0.02, y0 - 0.04, y1, (i + 1) * RISE - 0.06, (i + 1) * RISE)
obj_from_bm('steps', bm, marble)
bm = bmesh.new()
# cheeks: a sloped solid wall either side, 0.16 thick, rising with the steps, 0.95 m above the treads
CH = 0.95
for s in (-1, 1):
    x0, x1 = (WID / 2, WID / 2 + 0.16) if s > 0 else (-WID / 2 - 0.16, -WID / 2)
    for i in range(N):
        y0, y1 = i * RUN, (i + 1) * RUN
        box(bm, x0, x1, y0, y1, 0, (i + 1) * RISE + CH)
    # the capping: a moulded rail that follows the slope (segments)
    for i in range(N):
        y0, y1 = i * RUN, (i + 1) * RUN
        box(bm, x0 - 0.04, x1 + 0.04, y0 - 0.02, y1 + 0.02, (i + 1) * RISE + CH, (i + 1) * RISE + CH + 0.08)
# newel posts with balls at the foot and the head of the flight
for s in (-1, 1):
    xc = s * (WID / 2 + 0.08)
    lathe(bm, [(0.17, 0), (0.17, 0.08), (0.12, 0.1), (0.12, CH + RISE + 0.05), (0.15, CH + RISE + 0.1), (0.15, CH + RISE + 0.16), (0, CH + RISE + 0.16)], 12, tr(xc, -0.05, 0))
    sphere(bm, 0.13, tr(xc, -0.05, CH + RISE + 0.28))
    top = N * RISE
    lathe(bm, [(0.17, top - 0.2), (0.17, top - 0.1), (0.12, top - 0.08), (0.12, top + CH + 0.05), (0.15, top + CH + 0.1), (0.15, top + CH + 0.16), (0, top + CH + 0.16)], 12, tr(xc, N * RUN + 0.1, 0))
    sphere(bm, 0.13, tr(xc, N * RUN + 0.1, top + CH + 0.28))
obj_from_bm('cheeks', bm, marble2)
export(OUT + '/stairs.glb')

# ---------------- column ----------------
reset()
marble = mat('marble', MARBLE, 0.4)
bm = bmesh.new()
box(bm, -0.42, 0.42, -0.42, 0.42, 0, 0.12)                                         # plinth
lathe(bm, [(0.36, 0.12), (0.36, 0.17), (0.32, 0.2), (0.33, 0.25), (0.3, 0.29), (0.27, 0.33)], 24)   # base torus + scotia
obj_from_bm('base', bm, marble, smooth=False)
bm = bmesh.new()
# fluted shaft: 20 flutes as a star-shaped profile, tapering 0.26 → 0.22
F = 20
rings = []
for (z, r) in [(0.33, 0.265), (1.3, 0.255), (2.4, 0.24), (3.65, 0.225)]:
    ring = []
    for i in range(F * 2):
        a = i / (F * 2) * math.tau
        rr = r if i % 2 == 0 else r - 0.022
        ring.append(bm.verts.new(V((rr * math.cos(a), rr * math.sin(a), z))))
    rings.append(ring)
for a, b in zip(rings, rings[1:]):
    for i in range(F * 2):
        bm.faces.new((a[i], a[(i + 1) % (F * 2)], b[(i + 1) % (F * 2)], b[i]))
bm.faces.new(list(reversed(rings[0])))
bm.faces.new(rings[-1])
obj_from_bm('shaft', bm, marble, smooth=True)
bm = bmesh.new()
# capital: astragal, echinus with beads, the volute cushion with two spirals, abacus
lathe(bm, [(0.2, 3.63), (0.24, 3.66), (0.24, 3.7), (0.22, 3.72), (0.3, 3.8), (0.34, 3.86), (0.3, 3.88)], 24)
for i in range(16):
    a = i / 16 * math.tau
    sphere(bm, 0.03, tr(math.cos(a) * 0.3, math.sin(a) * 0.3, 3.84), 8, 6)
box(bm, -0.42, 0.42, -0.2, 0.2, 3.86, 4.04)                                         # cushion between the volutes
for s in (-1, 1):
    # a spiral volute: a tube wound 1.5 turns, its axis along Y
    cx, cz = s * 0.36, 3.95
    pts = []
    for k in range(40):
        t = k / 39
        ang = t * math.pi * 3
        r = 0.16 - 0.1 * t
        pts.append(V((cx + s * (r * math.cos(ang)) * 0.0 + r * math.cos(ang) * 0.9, 0, cz + r * math.sin(ang))))
    for k in range(len(pts) - 1):
        a_, b_ = pts[k], pts[k + 1]
        d = b_ - a_
        rot = V((0, 0, 1)).rotation_difference(d.normalized()).to_matrix().to_4x4()
        rad = 0.05 - 0.025 * (k / 39)
        r_ = bmesh.ops.create_cone(bm, cap_ends=True, segments=8, radius1=rad, radius2=rad, depth=d.length * 1.15)
        bmesh.ops.transform(bm, matrix=Matrix.Translation((a_ + b_) / 2) @ rot, verts=r_['verts'])
    # the volute's drum (seen from the side) and the eye
    cyl(bm, 0.17, 0.17, 0.4, 20, tr(cx, 0, cz) @ Matrix.Rotation(math.pi / 2, 4, 'X'))
    sphere(bm, 0.045, tr(cx, 0.21, cz), 8, 6)
    sphere(bm, 0.045, tr(cx, -0.21, cz), 8, 6)
box(bm, -0.46, 0.46, -0.3, 0.3, 4.08, 4.2)                                          # abacus
obj_from_bm('capital', bm, marble, smooth=True)
export(OUT + '/column.glb')

# ---------------- frieze ----------------
reset()
blue = mat('lapis', (0.08, 0.14, 0.36), 0.6)
red = mat('red', (0.5, 0.1, 0.08), 0.65)
gold = mat('gold', GOLD, 0.35, 0.9)
stone = mat('stone', MARBLE, 0.5)
bm = bmesh.new()
box(bm, -1.0, 1.0, 0, 0.06, 0.1, 0.4)                                               # the blue ground
obj_from_bm('ground', bm, blue)
bm = bmesh.new()
box(bm, -1.0, 1.0, 0, 0.065, 0.4, 0.45)                                             # red fillets
box(bm, -1.0, 1.0, 0, 0.065, 0.05, 0.1)
obj_from_bm('fillets', bm, red)
bm = bmesh.new()
# meander: Greek key, unit 0.25 m wide, bars 0.03 thick, repeated 8 times
U, B = 0.25, 0.03
for k in range(8):
    x = -1.0 + k * U
    # one key: a top bar, a hook turning down and in
    box(bm, x, x + U, 0, 0.075, 0.33, 0.33 + B)
    box(bm, x, x + U, 0, 0.075, 0.17, 0.17 + B)
    box(bm, x, x + B, 0, 0.075, 0.17, 0.33)
    box(bm, x + U - 0.1, x + U - 0.1 + B, 0, 0.075, 0.2, 0.3)
    box(bm, x + 0.05, x + 0.05 + B, 0, 0.075, 0.22, 0.3)
    box(bm, x + 0.05, x + U - 0.1 + B, 0, 0.075, 0.22, 0.22 + B)
    box(bm, x + 0.09, x + 0.09 + B, 0, 0.075, 0.25, 0.3)
    box(bm, x + 0.09, x + 0.15, 0, 0.075, 0.27, 0.27 + B)
obj_from_bm('meander', bm, gold)
bm = bmesh.new()
box(bm, -1.0, 1.0, 0, 0.08, 0.45, 0.5)                                              # cornice
for k in range(16):
    x = -1.0 + 0.03 + k * 0.125
    box(bm, x, x + 0.065, 0, 0.07, 0.0, 0.05)                                       # dentils
obj_from_bm('stonework', bm, stone)
export(OUT + '/frieze.glb')

# ---------------- trophy ----------------
reset()
bronze = mat('bronze', (0.62, 0.42, 0.17), 0.35, 0.9)
ash = mat('ash', (0.42, 0.3, 0.16), 0.7)
iron = mat('iron', (0.3, 0.3, 0.32), 0.45, 0.85)
bm = bmesh.new()
# a round hoplon on the wall: dished, with a rim and a boss (axis along Y, face toward +Y)
prof = [(0.0, 0.0), (0.12, 0.02), (0.3, 0.06), (0.44, 0.1), (0.5, 0.12), (0.52, 0.1), (0.52, 0.04), (0.5, 0.0)]
lathe(bm, [(r, z) for (r, z) in prof], 32, Matrix.Rotation(-math.pi / 2, 4, 'X') @ tr(0, 0, 0.1))
sphere(bm, 0.07, tr(0, 0.21, 0), 12, 8)
for i in range(12):
    a = i / 12 * math.tau
    sphere(bm, 0.025, tr(math.cos(a) * 0.45, 0.19, math.sin(a) * 0.45), 6, 4)
obj_from_bm('shield', bm, bronze)
bm = bmesh.new()
for s in (-1, 1):
    rot = Matrix.Rotation(s * 0.42, 4, 'Y')
    cyl(bm, 0.018, 0.018, 2.2, 8, tr(0, 0.05, 0) @ rot)
obj_from_bm('shafts', bm, ash)
bm = bmesh.new()
for s in (-1, 1):
    rot = Matrix.Rotation(s * 0.42, 4, 'Y')
    cyl(bm, 0.04, 0.0, 0.32, 8, tr(0, 0.05, 0) @ rot @ tr(0, 0, 1.26))
    cyl(bm, 0.025, 0.015, 0.1, 8, tr(0, 0.05, 0) @ rot @ tr(0, 0, 1.12))
obj_from_bm('heads', bm, iron)
export(OUT + '/trophy.glb')

# ---------------- throne ----------------
reset()
gold = mat('gold', GOLD, 0.35, 0.9)
red = mat('cloth', (0.52, 0.08, 0.07), 0.9)
marble = mat('marble', MARBLE, 0.45)
bm = bmesh.new()
box(bm, -0.75, 0.75, -0.6, 0.7, 0, 0.18)                                            # dais lower step
box(bm, -0.6, 0.6, -0.5, 0.45, 0.18, 0.34)                                          # upper step
obj_from_bm('dais', bm, marble)
bm = bmesh.new()
# seat box, arm rests, high back with a rounded top; lion-paw feet
box(bm, -0.42, 0.42, -0.42, 0.3, 0.34, 0.84)
box(bm, -0.46, 0.46, -0.48, 0.34, 0.8, 0.86)
for s in (-1, 1):
    box(bm, s * 0.38 - 0.06, s * 0.38 + 0.06, -0.42, 0.28, 0.86, 1.1)                   # arm uprights
    box(bm, s * 0.38 - 0.07, s * 0.38 + 0.07, -0.46, 0.3, 1.1, 1.18)                   # arm rests
    sphere(bm, 0.07, tr(s * 0.38, 0.3, 1.14))
    for fy in (-0.34, 0.22):
        # paw: a flattened sphere with three toe beads
        r_ = bmesh.ops.create_uvsphere(bm, u_segments=10, v_segments=7, radius=1.0)
        bmesh.ops.transform(bm, matrix=tr(s * 0.36, fy, 0.4) @ Matrix.Diagonal((0.1, 0.12, 0.07, 1)), verts=r_['verts'])
        for k in (-1, 0, 1):
            sphere(bm, 0.03, tr(s * 0.36 + k * 0.055, fy - 0.1, 0.37), 6, 4)
box(bm, -0.44, 0.44, -0.48, -0.36, 0.84, 1.9)                                        # back
lathe(bm, [(0.0, 0), (0.44, 0.0), (0.44, 0.12), (0.0, 0.12)], 24, tr(0, -0.36, 1.9) @ Matrix.Rotation(math.pi / 2, 4, 'X') @ Matrix.Diagonal((1, 1, 1, 1)))   # rounded top
sphere(bm, 0.09, tr(0, -0.42, 2.0))
# gilded rosettes on the back
for (x, z) in [(-0.25, 1.4), (0.25, 1.4), (0, 1.65), (-0.25, 1.15), (0.25, 1.15)]:
    cyl(bm, 0.07, 0.07, 0.03, 12, tr(x, -0.35, z) @ Matrix.Rotation(math.pi / 2, 4, 'X'))
obj_from_bm('throne', bm, gold, smooth=True)
bm = bmesh.new()
box(bm, -0.4, 0.4, -0.4, 0.28, 0.86, 0.98)                                          # cushion
box(bm, -0.4, 0.4, -0.36, -0.28, 0.98, 1.75)                                        # back pad
obj_from_bm('cushion', bm, red)
export(OUT + '/throne.glb')

# ---------------- mosaic ----------------
reset()
cols = {'terra': mat('terra', (0.55, 0.26, 0.16), 0.8), 'black': mat('black', (0.08, 0.07, 0.07), 0.7), 'ochre': mat('ochre', (0.72, 0.56, 0.22), 0.75), 'white': mat('white', (0.86, 0.84, 0.78), 0.6)}
R = 1.5
# rings: (r0, r1, material)
rings = [(0, 0.35, 'terra'), (0.35, 0.42, 'black'), (0.42, 0.95, 'white'), (0.95, 1.02, 'black'), (1.02, 1.4, 'ochre'), (1.4, 1.5, 'black')]
objs = {}
for (r0, r1, name) in rings:
    bm = bmesh.new()
    prof = [(r0, 0), (r0, 0.02), (r1, 0.02), (r1, 0)] if r0 > 0 else [(0.0001, 0.02), (r1, 0.02), (r1, 0)]
    lathe(bm, prof, 48)
    obj_from_bm('ring_' + name + str(r0), bm, cols[name])
# an eight-pointed star on the white ring, laid as flat triangles (slightly raised)
bm = bmesh.new()
for k in range(8):
    a = k / 8 * math.tau
    tip = V((math.cos(a) * 0.9, math.sin(a) * 0.9, 0.025))
    l = V((math.cos(a - 0.3) * 0.42, math.sin(a - 0.3) * 0.42, 0.025))
    r_ = V((math.cos(a + 0.3) * 0.42, math.sin(a + 0.3) * 0.42, 0.025))
    bm.faces.new((bm.verts.new(l), bm.verts.new(tip), bm.verts.new(r_)))
obj_from_bm('star', bm, cols['terra'])
# wave crests round the ochre ring (a running-wave border, as small arcs)
bm = bmesh.new()
for k in range(28):
    a = k / 28 * math.tau
    cyl(bm, 0.09, 0.09, 0.012, 12, tr(math.cos(a) * 1.21, math.sin(a) * 1.21, 0.026))
obj_from_bm('waves', bm, cols['black'])
export(OUT + '/mosaic.glb')
