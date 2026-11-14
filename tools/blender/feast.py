"""Feast and market furniture for Odysseus, modelled in Blender (bpy 4.2).

    python feast.py -- <outdir>   → table.glb, bench.glb, tableware.glb, crate.glb, hay.glb, stall.glb

table.glb      a 5 m trestle table (along X): three plank boards with gaps and end battens on three
               A-frame trestles with a stretcher; top at 0.84 m. The game stretches it along X (scaleX).
bench.glb      a 4 m plank bench on four splayed legs, seat at 0.45 m (along X, stretched like the table).
tableware.glb  what is left of the feast for about 1.6 m of table: bowls, cups (one tipped over), a jug,
               bread, a platter of figs and grapes, bones; origin on the table top.
crate.glb      a 1 m crate of planks with corner battens and a lid, origin on the floor (scaled per crate).
hay.glb        a tied bale of straw 1.2 × 0.8 × 0.7 m, lumpy, two twine bands.
stall.glb      a market stall 2.6 × 1.1 m: counter on legs, posts, a sloping striped cloth awning, baskets.
1 unit = 1 m, Z up, origin on the floor (export_yup turns it into glTF Y-up; Blender +X stays +X).
"""
import bpy, bmesh, math, random, sys
from mathutils import Vector, Matrix, noise

OUT = sys.argv[sys.argv.index('--') + 1]
V = Vector
rnd = random.Random(13)


def mat(name, color, rough=0.75, metal=0.0):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes['Principled BSDF']
    b.inputs['Base Color'].default_value = (*color, 1)
    b.inputs['Roughness'].default_value = rough
    b.inputs['Metallic'].default_value = metal
    return m


def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)


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


def bevel(o, w=0.012, segs=1):
    bpy.ops.object.select_all(action='DESELECT')
    bpy.context.view_layer.objects.active = o
    o.select_set(True)
    m = o.modifiers.new('bevel', 'BEVEL'); m.width = w; m.segments = segs
    bpy.ops.object.modifier_apply(modifier='bevel')


def export(path):
    bpy.ops.object.select_all(action='SELECT')
    bpy.ops.export_scene.gltf(filepath=path, export_format='GLB', export_apply=True, export_yup=True,
                              export_materials='EXPORT', export_normals=True, export_texcoords=False, use_selection=True)
    print('wrote', path, 'faces', sum(len(o.data.polygons) for o in bpy.data.objects if o.type == 'MESH'))


def box(bm, size, m=Matrix.Identity(4)):
    r = bmesh.ops.create_cube(bm, size=1.0)
    bmesh.ops.scale(bm, vec=size, verts=r['verts'])
    bmesh.ops.transform(bm, matrix=m, verts=r['verts'])
    return r['verts']


def cyl(bm, r1, r2, h, segs, m=Matrix.Identity(4), cap=True):
    r = bmesh.ops.create_cone(bm, cap_ends=cap, segments=segs, radius1=r1, radius2=r2, depth=h)
    bmesh.ops.transform(bm, matrix=m, verts=r['verts'])
    return r['verts']


def lathe(bm, profile, segs, m=Matrix.Identity(4)):
    rings = []
    for (r, z) in profile:
        rings.append([bm.verts.new(m @ V((math.cos(k / segs * math.tau) * r, math.sin(k / segs * math.tau) * r, z))) for k in range(segs)])
    for i in range(len(rings) - 1):
        for k in range(segs):
            bm.faces.new((rings[i][k], rings[i][(k + 1) % segs], rings[i + 1][(k + 1) % segs], rings[i + 1][k]))
    if profile[0][0] > 0.001:
        bm.faces.new(rings[0][::-1])
    if profile[-1][0] > 0.001:
        bm.faces.new(rings[-1])


def T(x, y, z):
    return Matrix.Translation((x, y, z))


def R(a, ax):
    return Matrix.Rotation(a, 4, ax)


oak_c, dark_c, pale_c = (0.33, 0.21, 0.11), (0.2, 0.13, 0.07), (0.45, 0.32, 0.18)

# ---------------- table ----------------
reset()
oak = mat('oak', oak_c, 0.8); dark = mat('darkoak', dark_c, 0.85)
L, TOP = 5.0, 0.84
bm = bmesh.new()
for k, y in enumerate((-0.33, 0.0, 0.33)):
    # three boards, each a little different in width and level, small gaps between
    w = 0.31 + rnd.uniform(-0.01, 0.01)
    box(bm, (L, w, 0.055), T(rnd.uniform(-0.02, 0.02), y, TOP - 0.03 + rnd.uniform(-0.004, 0.004)))
top = obj_from_bm('table_top', bm, oak)
bevel(top, 0.01)
bm = bmesh.new()
for x in (-L / 2 + 0.12, L / 2 - 0.12):
    box(bm, (0.1, 1.02, 0.05), T(x, 0, TOP - 0.08))          # end battens under the boards
for x in (-L / 2 + 0.45, 0.0, L / 2 - 0.45):
    # A-frame trestle: two splayed legs, a cross bar under the top, a foot rail
    for sy in (-1, 1):
        box(bm, (0.08, 0.08, 0.9), T(x, sy * 0.27, 0.42) @ R(sy * 0.22, 'X'))
    box(bm, (0.09, 0.98, 0.09), T(x, 0, TOP - 0.1))
    box(bm, (0.07, 0.86, 0.07), T(x, 0, 0.18))
box(bm, (L - 0.9, 0.07, 0.07), T(0, 0, 0.42))                 # stretcher along the table
legs = obj_from_bm('table_frame', bm, dark)
bevel(legs, 0.008)
export(OUT + '/table.glb')

# ---------------- bench ----------------
reset()
oak = mat('oak', oak_c, 0.8); dark = mat('darkoak', dark_c, 0.85)
L = 4.0
bm = bmesh.new()
box(bm, (L, 0.32, 0.06), T(0, 0, 0.42))
seat = obj_from_bm('bench_seat', bm, oak)
bevel(seat, 0.012)
bm = bmesh.new()
for x in (-L / 2 + 0.3, L / 2 - 0.3):
    for sy in (-1, 1):
        box(bm, (0.07, 0.07, 0.46), T(x, sy * 0.1, 0.2) @ R(sy * 0.2, 'X'))
    box(bm, (0.08, 0.3, 0.05), T(x, 0, 0.37))
box(bm, (L - 0.6, 0.05, 0.05), T(0, 0, 0.16))
obj_from_bm('bench_legs', bm, dark)
export(OUT + '/bench.glb')

# ---------------- tableware (on the table top: origin = top surface) ----------------
reset()
clay = mat('clay', (0.55, 0.26, 0.13), 0.7); black = mat('blackglaze', (0.05, 0.04, 0.035), 0.35)
bronze = mat('bronze', (0.6, 0.4, 0.17), 0.35, 0.9); bread = mat('bread', (0.58, 0.38, 0.17), 0.85)
fig = mat('fig', (0.22, 0.08, 0.12), 0.6); grape = mat('grape', (0.18, 0.1, 0.22), 0.3); bone = mat('bone', (0.78, 0.72, 0.6), 0.7)
wood = mat('wood', pale_c, 0.8)
def kylix(bm, m):
    lathe(bm, [(0.0, 0.0), (0.035, 0.0), (0.03, 0.01), (0.012, 0.02), (0.012, 0.05), (0.09, 0.075), (0.1, 0.09), (0.095, 0.092), (0.0, 0.06)], 20, m)
def bowl(bm, m, r=0.13):
    lathe(bm, [(0.0, 0.0), (0.05, 0.0), (r * 0.8, 0.03), (r, 0.07), (r * 0.95, 0.075), (0.0, 0.035)], 22, m)
def jug(bm, m):
    lathe(bm, [(0.0, 0.0), (0.06, 0.0), (0.1, 0.07), (0.11, 0.14), (0.07, 0.23), (0.045, 0.27), (0.055, 0.3), (0.0, 0.29)], 20, m)
bm_c, bm_b, bm_z = bmesh.new(), bmesh.new(), bmesh.new()
kylix(bm_b, T(-0.55, 0.22, 0)); kylix(bm_b, T(0.4, -0.25, 0))
kylix(bm_b, T(0.1, 0.3, 0.09) @ R(1.4, 'X'))              # one cup tipped over
bowl(bm_c, T(-0.2, -0.2, 0)); bowl(bm_c, T(0.62, 0.18, 0), 0.11)
jug(bm_c, T(-0.72, -0.12, 0))
bowl(bm_z, T(0.05, 0.0, 0), 0.2)                           # a bronze platter (wide, shallow)
obj_from_bm('cups', bm_b, black, smooth=True)
obj_from_bm('bowls', bm_c, clay, smooth=True)
obj_from_bm('platter', bm_z, bronze, smooth=True)
bm = bmesh.new()
for (x, y, s) in ((-0.38, 0.05, 1.0), (0.3, 0.05, 0.8)):
    r = bmesh.ops.create_uvsphere(bm, u_segments=16, v_segments=8, radius=0.1 * s)
    bmesh.ops.scale(bm, vec=(1.3, 0.9, 0.55), verts=r['verts'])
    bmesh.ops.translate(bm, vec=(x, y, 0.045 * s), verts=r['verts'])
obj_from_bm('bread', bm, bread, smooth=True)
bm = bmesh.new()
for i in range(7):
    a = i / 7 * math.tau
    r = bmesh.ops.create_uvsphere(bm, u_segments=10, v_segments=6, radius=0.028)
    bmesh.ops.translate(bm, vec=(0.05 + math.cos(a) * 0.08, math.sin(a) * 0.08, 0.06), verts=r['verts'])
obj_from_bm('figs', bm, fig, smooth=True)
bm = bmesh.new()
for i in range(14):
    r = bmesh.ops.create_uvsphere(bm, u_segments=8, v_segments=5, radius=0.016)
    bmesh.ops.translate(bm, vec=(0.06 + rnd.uniform(-0.04, 0.04), rnd.uniform(-0.03, 0.03), 0.06 + (i % 3) * 0.02), verts=r['verts'])
obj_from_bm('grapes', bm, grape, smooth=True)
bm = bmesh.new()
for (x, y, a) in ((0.75, -0.05, 0.4), (0.82, 0.02, -0.3)):
    cyl(bm, 0.012, 0.01, 0.16, 8, T(x, y, 0.015) @ R(a, 'Z') @ R(math.pi / 2, 'Y'))
obj_from_bm('bones', bm, bone, smooth=True)
export(OUT + '/tableware.glb')

# ---------------- crate ----------------
reset()
pl = mat('planks', (0.42, 0.3, 0.17), 0.85); dk = mat('batten', dark_c, 0.85); ir = mat('nails', (0.12, 0.11, 0.1), 0.5, 0.8)
bm = bmesh.new()
# planks on four sides (horizontal, with gaps) and on the lid, each 0.18 wide
for side in range(4):
    rot = R(side * math.pi / 2, 'Z')
    for k in range(5):
        z = 0.1 + k * 0.2
        box(bm, (0.96, 0.03, 0.17), rot @ T(0, 0.485, z))
for k in range(5):
    box(bm, (0.96, 0.17, 0.03), T(0, -0.4 + k * 0.2, 0.985))
box(bm, (0.94, 0.94, 0.94), T(0, 0, 0.5))   # dark inside behind the gaps
obj_from_bm('crate_planks', bm, pl)
bm = bmesh.new()
for sx in (-1, 1):
    for sy in (-1, 1):
        box(bm, (0.08, 0.08, 1.0), T(sx * 0.47, sy * 0.47, 0.5))
for side in range(4):
    box(bm, (1.0, 0.04, 0.07), R(side * math.pi / 2, 'Z') @ T(0, 0.5, 0.97))
    box(bm, (1.0, 0.04, 0.07), R(side * math.pi / 2, 'Z') @ T(0, 0.5, 0.04))
    box(bm, (1.2, 0.035, 0.07), R(side * math.pi / 2, 'Z') @ T(0, 0.505, 0.5) @ R(0.78, 'Y'))   # a diagonal brace
obj_from_bm('crate_battens', bm, dk)
bm = bmesh.new()
for side in range(4):
    for x in (-0.42, 0.42):
        for z in (0.04, 0.97):
            cyl(bm, 0.012, 0.012, 0.01, 6, R(side * math.pi / 2, 'Z') @ T(x, 0.522, z) @ R(math.pi / 2, 'X'))
obj_from_bm('crate_nails', bm, ir)
export(OUT + '/crate.glb')

# ---------------- hay bale ----------------
reset()
straw = mat('straw', (0.62, 0.5, 0.26), 0.95); twine = mat('twine', (0.3, 0.22, 0.12), 0.9)
bm = bmesh.new()
r = bmesh.ops.create_cube(bm, size=1.0)
bmesh.ops.scale(bm, vec=(1.2, 0.8, 0.7), verts=r['verts'])
bmesh.ops.translate(bm, vec=(0, 0, 0.35), verts=r['verts'])
bmesh.ops.bevel(bm, geom=bm.edges[:], offset=0.08, segments=3, affect='EDGES')
bmesh.ops.subdivide_edges(bm, edges=bm.edges[:], cuts=3, use_grid_fill=True)
for v in bm.verts:
    n = noise.noise(v.co * 6.0) * 0.025 + noise.noise(v.co * 23.0) * 0.012
    v.co += v.co.normalized() * n if v.co.length > 0 else V()
    if v.co.z < 0.01: v.co.z = 0.0
obj_from_bm('bale', bm, straw, smooth=True)
bm = bmesh.new()
for x in (-0.3, 0.3):
    for (sx, sy, sz, tx, tz) in ((0.03, 0.83, 0.012, 0, 0.705), (0.03, 0.83, 0.012, 0, 0.0)):
        box(bm, (sx, sy, sz), T(x, 0, tz))
    for sy in (-1, 1):
        box(bm, (0.03, 0.012, 0.7), T(x, sy * 0.405, 0.35))
obj_from_bm('twine', bm, twine)
export(OUT + '/hay.glb')

# ---------------- market stall ----------------
reset()
oak = mat('oak', oak_c, 0.8); dark = mat('darkoak', dark_c, 0.85)
red = mat('cloth_red', (0.38, 0.08, 0.05), 0.95); ochre = mat('cloth_ochre', (0.62, 0.45, 0.16), 0.95)
wick = mat('wicker', (0.5, 0.38, 0.2), 0.9)
bm = bmesh.new()
box(bm, (2.6, 1.1, 0.07), T(0, 0, 0.86))
box(bm, (2.5, 0.04, 0.3), T(0, 0.53, 0.68))              # front board under the counter
obj_from_bm('stall_counter', bm, oak)
bm = bmesh.new()
for (x, y) in ((-1.22, -0.48), (1.22, -0.48), (-1.22, 0.48), (1.22, 0.48)):
    box(bm, (0.08, 0.08, 0.84), T(x, y, 0.42))
for x in (-1.27, 1.27):
    cyl(bm, 0.045, 0.05, 2.6, 8, T(x, -0.62, 1.3))
    cyl(bm, 0.045, 0.05, 2.2, 8, T(x, 0.72, 1.1))
    box(bm, (0.06, 1.42, 0.06), T(x, 0.05, 2.05) @ R(-0.27, 'X'))    # rafter for the awning
obj_from_bm('stall_frame', bm, dark)
# the awning: a striped cloth in panels, sagging a little between the rafters, with a scalloped hem
for k in range(6):
    bm = bmesh.new()
    x0 = -1.35 + k * 0.45
    nx, ny = 3, 6
    verts = []
    for j in range(ny + 1):
        row = []
        for i in range(nx + 1):
            u, v = i / nx, j / ny
            x = x0 + u * 0.45
            y = -0.66 + v * 1.45
            z = 2.38 - v * 0.4 - math.sin(u * math.pi) * 0.025 - math.sin(v * math.pi) * 0.05
            row.append(bm.verts.new((x, y, z)))
        verts.append(row)
    for j in range(ny):
        for i in range(nx):
            bm.faces.new((verts[j][i], verts[j][i + 1], verts[j + 1][i + 1], verts[j + 1][i]))
    # hem flap hanging at the front
    a, b = verts[ny][0].co.copy(), verts[ny][nx].co.copy()
    h0 = bm.verts.new(a); h1 = bm.verts.new(b)
    h2 = bm.verts.new(b + V((0, 0.02, -0.16))); h3 = bm.verts.new(a + V((0, 0.02, -0.16)))
    bm.faces.new((h0, h1, h2, h3))
    o = obj_from_bm('awning_%d' % k, bm, red if k % 2 == 0 else ochre, smooth=True)
    o.modifiers.new('solid', 'SOLIDIFY').thickness = 0.012
# baskets on the counter
bm = bmesh.new()
for (x, r) in ((-0.8, 0.2), (0.15, 0.24), (0.85, 0.17)):
    lathe(bm, [(0.0, 0.0), (r * 0.8, 0.0), (r, 0.12), (r * 1.05, 0.14), (r * 0.98, 0.15), (r * 0.85, 0.05)], 18, T(x, -0.1, 0.895))
obj_from_bm('baskets', bm, wick, smooth=True)
export(OUT + '/stall.glb')
