"""Street props for Odysseus, modelled in Blender (bpy 4.2): barrel, amphora (two shapes), cart, wheelbarrow.

    python props.py -- <outdir>   → barrel.glb, amphora.glb, pithos.glb, cart.glb, wheelbarrow.glb

Everything is built from real parts (staves, hoops, planks, spokes, handles) at 1 unit = 1 m with the origin
on the ground, Z up; export_yup turns it into glTF Y-up. world/props.ts instances them, world/level.ts
only records positions and collision boxes.
"""
import bpy, bmesh, math, random, sys
from mathutils import Vector, Matrix, noise

OUT = sys.argv[sys.argv.index('--') + 1]
rnd = random.Random(3)

def mat(name, color, rough=0.8, metal=0.0):
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
    for f in me.polygons: f.use_smooth = smooth
    return o

def add_box(bm, size, m):
    """axis-aligned box (sx, sy, sz) centred at origin, transformed by matrix m"""
    r = bmesh.ops.create_cube(bm, size=1.0)
    verts = r['verts']
    bmesh.ops.scale(bm, vec=size, verts=verts)
    bmesh.ops.transform(bm, matrix=m, verts=verts)
    return verts

def add_cyl(bm, r1, r2, h, segs, m, cap=True):
    r = bmesh.ops.create_cone(bm, cap_ends=cap, segments=segs, radius1=r1, radius2=r2, depth=h)
    bmesh.ops.transform(bm, matrix=m, verts=r['verts'])
    return r['verts']

def add_torus(bm, R, r, segs, rings, m):
    verts = []
    for i in range(segs):
        a = i / segs * math.tau
        ring = []
        for j in range(rings):
            b = j / rings * math.tau
            p = Vector(((R + r * math.cos(b)) * math.cos(a), (R + r * math.cos(b)) * math.sin(a), r * math.sin(b)))
            ring.append(bm.verts.new(m @ p))
        verts.append(ring)
    for i in range(segs):
        for j in range(rings):
            a, b = verts[i][j], verts[i][(j + 1) % rings]
            c, d = verts[(i + 1) % segs][(j + 1) % rings], verts[(i + 1) % segs][j]
            bm.faces.new((a, b, c, d))

def lathe(bm, profile, segs, m=Matrix.Identity(4), close_bottom=True):
    """profile: list of (r, z) from bottom to top; returns nothing, faces added to bm"""
    rings = []
    for (r, z) in profile:
        ring = []
        for k in range(segs):
            a = k / segs * math.tau
            ring.append(bm.verts.new(m @ Vector((math.cos(a) * r, math.sin(a) * r, z))))
        rings.append(ring)
    for i in range(len(rings) - 1):
        for k in range(segs):
            bm.faces.new((rings[i][k], rings[i][(k + 1) % segs], rings[i + 1][(k + 1) % segs], rings[i + 1][k]))
    if close_bottom and profile[0][0] > 0.001:
        bm.faces.new(rings[0][::-1])
    if profile[-1][0] > 0.001:
        bm.faces.new(rings[-1])

def export(path):
    bpy.ops.object.select_all(action='SELECT')
    bpy.ops.export_scene.gltf(filepath=path, export_format='GLB', export_apply=True, export_yup=True,
                              export_materials='EXPORT', export_normals=True, export_texcoords=False, use_selection=True)
    print('wrote', path, 'faces', sum(len(o.data.polygons) for o in bpy.data.objects if o.type == 'MESH'))

wood_c = (0.42, 0.29, 0.17)
dark_c = (0.24, 0.16, 0.10)
iron_c = (0.12, 0.11, 0.10)

# ---------------- barrel: 20 bulging staves (each its own shade), four dark hoops with rivets, a planked lid, a bung ----------------
reset()
woods = [mat(f'wood{i}', (wood_c[0] * k, wood_c[1] * k, wood_c[2] * k), 0.85) for i, k in enumerate((0.8, 0.92, 1.05, 1.18))]
dark = mat('darkwood', dark_c, 0.9); iron = mat('iron', iron_c, 0.45, 0.85)
H, R0, BULGE, N = 0.95, 0.31, 0.075, 20
stave_objs = []
for i in range(N):
    a0 = i / N * math.tau + 0.006
    a1 = (i + 1) / N * math.tau - 0.006
    bm = bmesh.new()
    rows = []
    for zi in range(9):
        z = zi / 8 * H
        r = R0 + BULGE * math.sin(math.pi * zi / 8) ** 0.9 + rnd.uniform(-0.004, 0.004)
        row = []
        for (a, rr) in ((a0, r), (a1, r), (a1, r - 0.03), (a0, r - 0.03)):
            row.append(bm.verts.new(Vector((math.cos(a) * rr, math.sin(a) * rr, z))))
        rows.append(row)
    for zi in range(8):
        for k in range(4):
            bm.faces.new((rows[zi][k], rows[zi][(k + 1) % 4], rows[zi + 1][(k + 1) % 4], rows[zi + 1][k]))
    bm.faces.new(rows[0][::-1]); bm.faces.new(rows[8])
    stave_objs.append(obj_from_bm(f'stave{i}', bm, woods[(i * 7) % 4], smooth=True))
bm = bmesh.new()
for z in (0.09, 0.33, 0.62, 0.86):
    r = R0 + BULGE * math.sin(math.pi * z / H) ** 0.9 + 0.014
    add_torus(bm, r, 0.016, 40, 6, Matrix.Translation((0, 0, z)))
    for k in range(10):
        a = k / 10 * math.tau + 0.1
        add_box(bm, (0.02, 0.02, 0.02), Matrix.Rotation(a, 4, 'Z') @ Matrix.Translation((r + 0.012, 0, z)))
obj_from_bm('barrel_hoops', bm, iron)
bm = bmesh.new()
for i in range(-3, 4):
    w = 0.085
    x = i * 0.092
    half = math.sqrt(max(0.0, (R0 - 0.035) ** 2 - x * x))
    add_box(bm, (w, half * 2, 0.03), Matrix.Translation((x, 0, H - 0.015)))
obj_from_bm('barrel_lid', bm, dark, smooth=False)
bm = bmesh.new()
add_cyl(bm, 0.03, 0.025, 0.05, 10, Matrix.Translation((R0 + BULGE - 0.01, 0, 0.5)) @ Matrix.Rotation(math.radians(90), 4, 'Y'))
obj_from_bm('barrel_bung', bm, dark)
export(OUT + '/barrel.glb')

# ---------------- amphora: lathe with a narrow foot, two handles ----------------
def amphora(path, profile, handle_z, handle_out, squat=False):
    reset()
    clay = mat('clay', (0.52, 0.29, 0.17) if not squat else (0.46, 0.27, 0.16), 0.75)
    band = mat('clayband', (0.16, 0.09, 0.06), 0.8)
    bm = bmesh.new()
    lathe(bm, profile, 28)
    # a little hand-thrown irregularity
    for v in bm.verts:
        n = noise.noise(v.co * 7.0) * 0.006
        v.co += Vector((v.co.x, v.co.y, 0)).normalized() * n
    obj_from_bm('amphora_body', bm, clay)
    bm = bmesh.new()
    for s in (-1, 1):
        # a handle: half torus standing on the shoulder, bent outward
        R, r = 0.11, 0.022
        mtx = Matrix.Translation((s * handle_out, 0, handle_z)) @ Matrix.Rotation(math.radians(90), 4, 'X') @ Matrix.Rotation(math.radians(0 if s > 0 else 180), 4, 'Z')
        segs, rings = 14, 7
        verts = []
        for i in range(segs + 1):
            a = i / segs * math.pi
            ring = []
            for j in range(rings):
                b = j / rings * math.tau
                p = Vector(((R + r * math.cos(b)) * math.cos(a), (R + r * math.cos(b)) * math.sin(a), r * math.sin(b)))
                ring.append(bm.verts.new(mtx @ p))
            verts.append(ring)
        for i in range(segs):
            for j in range(rings):
                bm.faces.new((verts[i][j], verts[i][(j + 1) % rings], verts[i + 1][(j + 1) % rings], verts[i + 1][j]))
        bm.faces.new(verts[0][::-1]); bm.faces.new(verts[-1])
    obj_from_bm('amphora_handles', bm, clay)
    # painted bands (thin rings) around the shoulder and neck
    bm = bmesh.new()
    zmax = profile[-1][1]
    for (z, rr) in ((zmax * 0.62, None), (zmax * 0.86, None)):
        # radius at z by interpolation
        for k in range(len(profile) - 1):
            (r0, z0), (r1, z1) = profile[k], profile[k + 1]
            if z0 <= z <= z1:
                rr = r0 + (r1 - r0) * (z - z0) / max(1e-6, z1 - z0)
        add_torus(bm, rr + 0.003, 0.006, 28, 5, Matrix.Translation((0, 0, z)))
    obj_from_bm('amphora_bands', bm, band)
    export(path)

amphora(OUT + '/amphora.glb',
        [(0.0, 0.0), (0.09, 0.0), (0.11, 0.03), (0.13, 0.12), (0.21, 0.32), (0.27, 0.52), (0.275, 0.64), (0.24, 0.82),
         (0.16, 0.98), (0.11, 1.06), (0.1, 1.14), (0.115, 1.19), (0.13, 1.21), (0.13, 1.23), (0.1, 1.23)],
        handle_z=0.98, handle_out=0.19)
amphora(OUT + '/pithos.glb',
        [(0.0, 0.0), (0.16, 0.0), (0.2, 0.02), (0.31, 0.16), (0.37, 0.36), (0.36, 0.52), (0.3, 0.66), (0.24, 0.74),
         (0.25, 0.78), (0.26, 0.8), (0.21, 0.8)],
        handle_z=0.6, handle_out=0.34, squat=True)

# ---------------- cart: planked bed, rails, two spoked wheels, shafts resting on the ground ----------------
reset()
wood = mat('wood', wood_c, 0.85); dark = mat('darkwood', dark_c, 0.9); iron = mat('iron', iron_c, 0.45, 0.85)
L, W, AXLE_Z, WHEEL_R = 2.4, 1.4, 0.58, 0.56
tilt = Matrix.Rotation(math.radians(-7), 4, 'X') @ Matrix.Translation((0, 0, 0.0))   # the shafts dip toward the front (+Y)
bm = bmesh.new()
for i in range(6):
    x = -W / 2 + 0.12 + i * (W - 0.24) / 5
    add_box(bm, (0.2, L, 0.05), tilt @ Matrix.Translation((x, 0, AXLE_Z + 0.2)))
for y in (-L / 2 + 0.1, 0, L / 2 - 0.1):
    add_box(bm, (W, 0.1, 0.1), tilt @ Matrix.Translation((0, y, AXLE_Z + 0.12)))
for s in (-1, 1):
    for y in (-L / 2 + 0.1, 0, L / 2 - 0.1):
        add_box(bm, (0.07, 0.07, 0.55), tilt @ Matrix.Translation((s * (W / 2 - 0.04), y, AXLE_Z + 0.5)))
    for z in (0.38, 0.62):
        add_box(bm, (0.04, L, 0.12), tilt @ Matrix.Translation((s * (W / 2 - 0.04), 0, AXLE_Z + 0.12 + z)))
    # shafts
    add_box(bm, (0.07, 1.9, 0.07), tilt @ Matrix.Translation((s * 0.45, L / 2 + 0.75, AXLE_Z + 0.1)) @ Matrix.Rotation(math.radians(-6), 4, 'X'))
# back board
add_box(bm, (W, 0.04, 0.55), tilt @ Matrix.Translation((0, -L / 2 + 0.02, AXLE_Z + 0.5)))
obj_from_bm('cart_wood', bm, wood, smooth=False)
bm = bmesh.new()
add_cyl(bm, 0.045, 0.045, W + 0.5, 10, Matrix.Translation((0, 0, AXLE_Z)) @ Matrix.Rotation(math.radians(90), 4, 'Y'))
obj_from_bm('cart_axle', bm, dark)
bm = bmesh.new()
for s in (-1, 1):
    x = s * (W / 2 + 0.16)
    rot = Matrix.Translation((x, 0, AXLE_Z)) @ Matrix.Rotation(math.radians(90), 4, 'Y')
    add_torus(bm, WHEEL_R - 0.03, 0.045, 32, 8, rot)                  # felloe
    add_cyl(bm, 0.09, 0.09, 0.16, 12, rot)                            # hub
    for i in range(10):
        a = i / 10 * math.tau
        m = rot @ Matrix.Rotation(a, 4, 'Z') @ Matrix.Translation((0, WHEEL_R / 2 - 0.03, 0)) @ Matrix.Rotation(math.radians(90), 4, 'X')
        add_cyl(bm, 0.02, 0.025, WHEEL_R - 0.1, 6, m)
obj_from_bm('cart_wheels', bm, dark)
bm = bmesh.new()
for s in (-1, 1):
    add_torus(bm, WHEEL_R, 0.014, 40, 6, Matrix.Translation((s * (W / 2 + 0.16), 0, AXLE_Z)) @ Matrix.Rotation(math.radians(90), 4, 'Y'))
obj_from_bm('cart_tyres', bm, iron)
export(OUT + '/cart.glb')

# ---------------- wheelbarrow: a plank box on two handles, one spoked wheel in front, two legs behind ----------------
reset()
wood = mat('wood', wood_c, 0.85); dark = mat('darkwood', dark_c, 0.9); iron = mat('iron', iron_c, 0.45, 0.85)
bm = bmesh.new()
lean = Matrix.Rotation(math.radians(-10), 4, 'X')  # handles down at the back (−Y), wheel in front (+Y)
base = Matrix.Translation((0, 0, 0.36)) @ lean
# two handles 1.7 m long
for s in (-1, 1):
    add_box(bm, (0.06, 1.7, 0.06), base @ Matrix.Translation((s * 0.26, -0.15, 0)))
# box: floor planks, two sides, front and back boards
for i in range(4):
    add_box(bm, (0.14, 0.9, 0.03), base @ Matrix.Translation((-0.24 + i * 0.16, 0.05, 0.05)))
for s in (-1, 1):
    add_box(bm, (0.03, 0.9, 0.32), base @ Matrix.Translation((s * 0.32, 0.05, 0.2)) @ Matrix.Rotation(s * math.radians(-12), 4, 'Y'))
add_box(bm, (0.7, 0.03, 0.28), base @ Matrix.Translation((0, 0.5, 0.18)) @ Matrix.Rotation(math.radians(15), 4, 'X'))
add_box(bm, (0.6, 0.03, 0.24), base @ Matrix.Translation((0, -0.4, 0.15)) @ Matrix.Rotation(math.radians(-15), 4, 'X'))
# legs
for s in (-1, 1):
    add_box(bm, (0.05, 0.05, 0.36), base @ Matrix.Translation((s * 0.26, -0.7, -0.17)))
obj_from_bm('barrow_wood', bm, wood, smooth=False)
bm = bmesh.new()
wr = 0.27
wm = base @ Matrix.Translation((0, 0.78, -0.1)) @ Matrix.Rotation(math.radians(90), 4, 'Y')
add_torus(bm, wr - 0.025, 0.03, 24, 7, wm)
add_cyl(bm, 0.05, 0.05, 0.14, 10, wm)
for i in range(8):
    m = wm @ Matrix.Rotation(i / 8 * math.tau, 4, 'Z') @ Matrix.Translation((0, wr / 2 - 0.02, 0)) @ Matrix.Rotation(math.radians(90), 4, 'X')
    add_cyl(bm, 0.015, 0.018, wr - 0.08, 6, m)
add_cyl(bm, 0.02, 0.02, 0.7, 8, base @ Matrix.Translation((0, 0.78, -0.1)) @ Matrix.Rotation(math.radians(90), 4, 'Y'))
obj_from_bm('barrow_wheel', bm, dark)
bm = bmesh.new()
add_torus(bm, wr, 0.012, 32, 6, wm)
obj_from_bm('barrow_tyre', bm, iron)
export(OUT + '/wheelbarrow.glb')
