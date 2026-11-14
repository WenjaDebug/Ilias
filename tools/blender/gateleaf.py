"""One leaf of the great gate of Troy, modelled in Blender (bpy 4.2).

    python gateleaf.py -- <outdir>   → gate_leaf.glb

Origin at the hinge edge, on the ground; the leaf extends along +X (3.5 m) and up +Z (10 m), 0.5 m thick
along Y. The decorated face is +Y (glTF −Z after export: toward the city, where the player stands):
oak planks, three riveted iron bands, bronze sheathing over the lower part, a bronze lion-head boss with
its ring, hinge straps at the hinge edge and two iron brackets at chest height (z ≈ 1.3) for the beam.
The right-hand leaf is the same model mirrored in the game.
"""
import bpy, bmesh, math, sys, random
from mathutils import Vector, Matrix

sys.path.insert(0, __file__.rsplit('/', 1)[0])
OUT = sys.argv[sys.argv.index('--') + 1]
V = Vector
random.seed(7)

W, H, T = 3.5, 10.0, 0.5


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


def add_box(bm, size, m):
    r = bmesh.ops.create_cube(bm, size=1.0)
    bmesh.ops.scale(bm, vec=size, verts=r['verts'])
    bmesh.ops.transform(bm, matrix=m, verts=r['verts'])
    return r['verts']


def add_cyl(bm, r1, r2, h, segs, m, cap=True):
    r = bmesh.ops.create_cone(bm, cap_ends=cap, segments=segs, radius1=r1, radius2=r2, depth=h)
    bmesh.ops.transform(bm, matrix=m, verts=r['verts'])


def add_sphere(bm, r, m, u=12, v=8):
    r_ = bmesh.ops.create_uvsphere(bm, u_segments=u, v_segments=v, radius=r)
    bmesh.ops.transform(bm, matrix=m, verts=r_['verts'])


def add_torus(bm, R, r, segs, rings, m):
    verts = []
    for i in range(segs):
        a = i / segs * math.tau
        ring = []
        for j in range(rings):
            b = j / rings * math.tau
            p = V(((R + r * math.cos(b)) * math.cos(a), (R + r * math.cos(b)) * math.sin(a), r * math.sin(b)))
            ring.append(bm.verts.new(m @ p))
        verts.append(ring)
    for i in range(segs):
        for j in range(rings):
            bm.faces.new((verts[i][j], verts[i][(j + 1) % rings], verts[(i + 1) % segs][(j + 1) % rings], verts[(i + 1) % segs][j]))


def tr(x, y, z):
    return Matrix.Translation(V((x, y, z)))


bpy.ops.wm.read_factory_settings(use_empty=True)

woods = [mat(f'oak{i}', c, 0.78) for i, c in enumerate([(0.30, 0.19, 0.10), (0.26, 0.16, 0.085), (0.34, 0.22, 0.12), (0.23, 0.14, 0.075)])]
iron = mat('iron', (0.09, 0.08, 0.075), 0.5, 0.75)
bronze = mat('bronze', (0.62, 0.42, 0.17), 0.33, 0.9)
darkbronze = mat('darkbronze', (0.36, 0.23, 0.09), 0.45, 0.85)

# ---- planks: 7 uprights, each slightly different in shade and depth, with a bevel groove between them
n = 7
pw = W / n
for i in range(n):
    bm = bmesh.new()
    d = random.uniform(-0.006, 0.006)
    verts = add_box(bm, V((pw - 0.02, T + d * 2, H)), tr(pw * (i + 0.5), 0, H / 2))
    # bevel the long edges a little so the planks read as separate boards
    edges = [e for e in bm.edges if abs(e.verts[0].co.z - e.verts[1].co.z) > H * 0.9]
    bmesh.ops.bevel(bm, geom=edges, offset=0.012, segments=1, affect='EDGES')
    obj_from_bm(f'plank{i}', bm, woods[i % 4])

# ---- iron bands with rivets on both faces; two heavier rails top and bottom
bm = bmesh.new()
for z, h in [(0.35, 0.3), (2.6, 0.26), (5.0, 0.26), (7.4, 0.26), (9.65, 0.3)]:
    for side in (1, -1):
        add_box(bm, V((W - 0.08, 0.05, h)), tr(W / 2, side * (T / 2 + 0.02), z))
        for k in range(6):
            x = 0.3 + k * (W - 0.6) / 5
            add_sphere(bm, 0.045, tr(x, side * (T / 2 + 0.05), z), 8, 6)
# hinge straps: three iron L-straps wrapping the hinge edge, with knuckles
for z in (1.2, 5.0, 8.8):
    for side in (1, -1):
        add_box(bm, V((1.4, 0.05, 0.22)), tr(0.7, side * (T / 2 + 0.03), z))
        for k in range(3):
            add_sphere(bm, 0.045, tr(0.3 + k * 0.45, side * (T / 2 + 0.06), z), 8, 6)
    add_cyl(bm, 0.12, 0.12, 0.6, 12, tr(-0.02, 0, z))  # knuckle on the hinge edge
# bolt brackets: U-irons on the inside face (+Y) at the beam's height
for x in (1.3, 2.9):
    add_box(bm, V((0.14, 0.42, 0.08)), tr(x, T / 2 + 0.21, 1.05))  # seat
    add_box(bm, V((0.14, 0.08, 0.55)), tr(x, T / 2 + 0.46, 1.3))   # lip
    add_box(bm, V((0.3, 0.05, 0.6)), tr(x, T / 2 + 0.03, 1.35))    # back plate
    for dz in (-0.2, 0.2):
        add_sphere(bm, 0.04, tr(x, T / 2 + 0.06, 1.35 + dz), 8, 6)
obj_from_bm('ironwork', bm, iron)

# ---- bronze sheathing of the lower part (+Y face): plates with rivet rows and a raised rim
bm = bmesh.new()
rows, cols = 3, 4
ph, pw2 = 2.1 / rows, (W - 0.3) / cols
for r in range(rows):
    for c in range(cols):
        x = 0.15 + pw2 * (c + 0.5)
        z = 0.55 + ph * (r + 0.5)
        add_box(bm, V((pw2 - 0.03, 0.03, ph - 0.03)), tr(x, T / 2 + 0.015, z))
        for dx in (-pw2 / 2 + 0.08, pw2 / 2 - 0.08):
            for dz in (-ph / 2 + 0.08, ph / 2 - 0.08):
                add_sphere(bm, 0.03, tr(x + dx, T / 2 + 0.04, z + dz), 8, 6)
obj_from_bm('sheathing', bm, darkbronze)

# ---- lion-head boss with a ring (the knocker), bronze, at 3.6 m on the inside face
bm = bmesh.new()
cx, cz = W * 0.56, 3.6
add_cyl(bm, 0.34, 0.3, 0.06, 20, Matrix.Rotation(math.pi / 2, 4, 'X') @ tr(0, 0, 0) @ Matrix.Identity(4))
bmesh.ops.translate(bm, vec=V((cx, T / 2 + 0.03, cz)), verts=bm.verts[:])
head = bmesh.new()
add_sphere(head, 0.2, Matrix.Scale(0.75, 4, V((0, 1, 0))) @ tr(0, 0, 0), 16, 12)          # face
add_sphere(head, 0.09, tr(0, 0.12, -0.08), 10, 8)                                          # muzzle
for sx in (-1, 1):
    add_sphere(head, 0.06, tr(sx * 0.12, 0.05, 0.14), 8, 6)                                # ears
    add_sphere(head, 0.035, tr(sx * 0.07, 0.15, 0.04), 8, 6)                               # eyes
# mane: a ring of flame-like spikes round the face
for i in range(14):
    a = i / 14 * math.tau
    m = tr(math.cos(a) * 0.24, 0.0, math.sin(a) * 0.24) @ Matrix.Rotation(-a, 4, 'Y') @ Matrix.Rotation(math.pi / 2, 4, 'X')
    add_cyl(head, 0.055, 0.0, 0.16, 6, m)
bmesh.ops.translate(head, vec=V((cx, T / 2 + 0.08, cz)), verts=head.verts[:])
# ring hanging from the muzzle
add_torus(head, 0.2, 0.025, 20, 8, tr(cx, T / 2 + 0.2, cz - 0.3) @ Matrix.Rotation(math.pi / 2, 4, 'X'))
o = obj_from_bm('lionhead', head, bronze, smooth=True)
obj_from_bm('bossplate', bm, bronze, smooth=True)

bpy.ops.object.select_all(action='SELECT')
bpy.ops.export_scene.gltf(filepath=OUT + '/gate_leaf.glb', export_format='GLB', export_apply=True, export_yup=True,
                          export_materials='EXPORT', export_normals=True, export_texcoords=False, use_selection=True)
print('wrote', OUT + '/gate_leaf.glb', 'faces', sum(len(o.data.polygons) for o in bpy.data.objects if o.type == 'MESH'))
