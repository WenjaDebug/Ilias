"""Gate machinery for Odysseus, modelled in Blender (bpy 4.2): the great bolt, its padlock, the winch and a bell.

    python gate.py -- <outdir>   → bolt.glb, padlock.glb, winch.glb, boltslot.glb, bell.glb

bolt.glb    an oak beam 6 m long (along X) with iron straps and a ring; origin at its centre.
padlock.glb a big iron padlock with a shackle; origin at the shackle's top.
winch.glb   a capstan: oak drum on an upright pivot in a stone socket, four push bars at chest height, chain
            wound round it running to a wall pulley (the turning part is the object 'drum', spun about the
            vertical axis by the game); origin on the floor at the pivot.
boltslot.glb the stone-framed socket in the tower flank that the bolt slides into; origin at the opening.
bell.glb    a bronze alarm bell with clapper under a small wooden gallows; origin on the floor.
1 unit = 1 m, Z up (export_yup turns it into glTF Y-up).
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


def add_box(bm, size, m):
    r = bmesh.ops.create_cube(bm, size=1.0)
    bmesh.ops.scale(bm, vec=size, verts=r['verts'])
    bmesh.ops.transform(bm, matrix=m, verts=r['verts'])


def add_cyl(bm, r1, r2, h, segs, m, cap=True):
    r = bmesh.ops.create_cone(bm, cap_ends=cap, segments=segs, radius1=r1, radius2=r2, depth=h)
    bmesh.ops.transform(bm, matrix=m, verts=r['verts'])


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


oak_c = (0.36, 0.24, 0.13)
dark_c = (0.2, 0.13, 0.08)
iron_c = (0.13, 0.12, 0.11)
bronze_c = (0.62, 0.42, 0.18)

# ---------------- the bolt: a squared oak beam, chamfered, iron straps every metre, a ring at each end ----------------
reset()
oak = mat('oak', oak_c, 0.8); iron = mat('iron', iron_c, 0.5, 0.85)
L, S = 6.0, 0.42
bm = bmesh.new()
add_box(bm, (L, S, S), Matrix.Identity(4))
beam = obj_from_bm('bolt_beam', bm, oak, smooth=False)
bpy.context.view_layer.objects.active = beam
beam.select_set(True)
bv = beam.modifiers.new('bevel', 'BEVEL'); bv.width = 0.04; bv.segments = 2
bpy.ops.object.modifier_apply(modifier='bevel')
bm = bmesh.new()
for k in range(-3, 4):
    x = k * 0.9
    add_box(bm, (0.12, S + 0.03, S + 0.03), Matrix.Translation((x, 0, 0)))
    for (dy, dz) in ((S / 2 + 0.02, S / 2 - 0.1), (S / 2 + 0.02, -S / 2 + 0.1), (-S / 2 - 0.02, 0.0)):
        add_box(bm, (0.03, 0.03, 0.03), Matrix.Translation((x + 0.045, dy, dz)))
for sx in (-1, 1):
    add_torus(bm, 0.12, 0.022, 20, 8, Matrix.Translation((sx * (L / 2 + 0.12), 0, 0)) @ Matrix.Rotation(math.radians(90), 4, 'X'))
obj_from_bm('bolt_iron', bm, iron, smooth=True)
export(OUT + '/bolt.glb')

# ---------------- padlock: a fat iron body with a chamfer, a keyhole plate, the shackle on top ----------------
reset()
iron = mat('iron', iron_c, 0.45, 0.85); bronze = mat('bronze', bronze_c, 0.35, 0.9)
bm = bmesh.new()
add_box(bm, (0.26, 0.1, 0.3), Matrix.Translation((0, 0, -0.33)))
body = obj_from_bm('lock_body', bm, iron, smooth=False)
bpy.context.view_layer.objects.active = body
body.select_set(True)
bv = body.modifiers.new('bevel', 'BEVEL'); bv.width = 0.025; bv.segments = 3
bpy.ops.object.modifier_apply(modifier='bevel')
bm = bmesh.new()
# shackle: half torus + two straight legs
R, r = 0.09, 0.022
verts = []
segs, rings = 16, 8
for i in range(segs + 1):
    a = i / segs * math.pi
    ring = []
    for j in range(rings):
        b = j / rings * math.tau
        p = V(((R + r * math.cos(b)) * math.cos(a), r * math.sin(b), (R + r * math.cos(b)) * math.sin(a) - 0.09))
        ring.append(bm.verts.new(p))
    verts.append(ring)
for i in range(segs):
    for j in range(rings):
        bm.faces.new((verts[i][j], verts[i][(j + 1) % rings], verts[i + 1][(j + 1) % rings], verts[i + 1][j]))
bm.faces.new(verts[0][::-1]); bm.faces.new(verts[-1])
for sx in (-1, 1):
    add_cyl(bm, r, r, 0.12, 10, Matrix.Translation((sx * R, 0, -0.15)))
obj_from_bm('lock_shackle', bm, iron)
bm = bmesh.new()
lathe(bm, [(0.0, 0), (0.05, 0), (0.05, 0.012), (0.0, 0.012)], 16, Matrix.Translation((0, -0.05, -0.33)) @ Matrix.Rotation(math.radians(90), 4, 'X'))
add_box(bm, (0.014, 0.014, 0.05), Matrix.Translation((0, -0.062, -0.34)))
obj_from_bm('lock_plate', bm, bronze)
export(OUT + '/padlock.glb')

# ---------------- winch: a capstan – Odysseus pushes one of its four bars and walks it round ----------------
# A heavy oak drum turning on an upright iron pivot in a stone socket; four long bars stick out of the
# cap at chest height (1.25 m), worn pale where hands push them. The chain is wound round the drum and
# runs off west (−X) up to an iron pulley at the wall. The turning part (drum, cap, bars, wound chain)
# is the object 'drum' (rotating about the vertical axis in the game); origin on the floor at the pivot.
reset()
oak = mat('oak', oak_c, 0.8); dark = mat('darkoak', dark_c, 0.85); iron = mat('iron', iron_c, 0.5, 0.85)
stone = mat('stone', (0.42, 0.39, 0.35), 0.85); worn = mat('worn', (0.55, 0.42, 0.27), 0.6)
DR, BAR_Z, BAR_L = 0.36, 1.25, 1.35
# stone socket: a low round plinth with a chamfered lip and a ring of iron
bm = bmesh.new()
lathe(bm, [(0.0, 0.0), (0.72, 0.0), (0.72, 0.16), (0.66, 0.22), (0.5, 0.24), (0.0, 0.24)], 32)
obj_from_bm('capstan_socket', bm, stone, smooth=False)
bm = bmesh.new()
add_torus(bm, 0.52, 0.025, 32, 6, Matrix.Translation((0, 0, 0.245)))
obj_from_bm('capstan_ring', bm, iron)
# the turning part
bm = bmesh.new()
# drum: 16 staves round a core, waisted so the chain stays on it, flanges top and bottom
n = 16
for i in range(n):
    a = i / n * math.tau
    add_box(bm, (0.1, 0.142, 0.78), Matrix.Rotation(a, 4, "Z") @ Matrix.Translation((DR - 0.03, 0, 0.28 + 0.39)))
add_cyl(bm, DR - 0.03, DR - 0.03, 0.78, 24, Matrix.Translation((0, 0, 0.67)))
for z in (0.3, 1.04):
    add_cyl(bm, DR + 0.09, DR + 0.09, 0.07, 28, Matrix.Translation((0, 0, z)))
# the cap: a thick square-ish head with four mortises the bars go through
add_cyl(bm, 0.3, 0.34, 0.32, 8, Matrix.Translation((0, 0, BAR_Z)))
drum_oak = obj_from_bm('drum_oak', bm, oak, smooth=False)
bm = bmesh.new()
for k in range(4):
    a = k / 4 * math.tau
    rot = Matrix.Rotation(a, 4, 'Z')
    # the bar: slightly tapered, squared, from the cap out to BAR_L
    add_box(bm, (BAR_L - 0.2, 0.085, 0.09), rot @ Matrix.Translation((0.2 + (BAR_L - 0.2) / 2, 0, BAR_Z)))
obj_from_bm('drum_bars', bm, dark, smooth=False)
bm = bmesh.new()
for k in range(4):
    rot = Matrix.Rotation(k / 4 * math.tau, 4, 'Z')
    # the outer half of each bar polished by hands
    add_box(bm, (0.5, 0.092, 0.097), rot @ Matrix.Translation((BAR_L - 0.32, 0, BAR_Z)))
obj_from_bm('drum_grips', bm, worn, smooth=False)
bm = bmesh.new()
# iron: bands round the drum, a cap plate, the pivot pin, and the wound chain
for z in (0.42, 0.67, 0.92):
    add_cyl(bm, DR + 0.012, DR + 0.012, 0.035, 28, Matrix.Translation((0, 0, z)))
add_cyl(bm, 0.2, 0.2, 0.04, 16, Matrix.Translation((0, 0, BAR_Z + 0.18)))
add_cyl(bm, 0.05, 0.05, 0.2, 10, Matrix.Translation((0, 0, BAR_Z + 0.28)))
for i in range(60):
    a = i / 60 * math.tau * 3.0
    z = 0.4 + i * 0.0095
    m = Matrix.Rotation(a, 4, 'Z') @ Matrix.Translation((DR + 0.035, 0, z)) @ Matrix.Rotation(math.radians(90 * (i % 2)), 4, 'Y') @ Matrix.Rotation(math.radians(90), 4, 'X')
    add_torus(bm, 0.032, 0.009, 10, 6, m)
obj_from_bm('drum_iron', bm, iron)
# group the turning parts under one object 'drum' at the pivot
bpy.ops.object.select_all(action='DESELECT')
parts = [o for o in bpy.data.objects if o.name.startswith('drum_')]
for o in parts:
    o.select_set(True)
bpy.context.view_layer.objects.active = parts[0]
bpy.ops.object.join()
bpy.context.view_layer.objects.active.name = 'drum'
# the chain off the drum: from the drum's west side, rising to a pulley on the wall 2.6 m out, 2.4 m up
bm = bmesh.new()
p0, p1 = V((-DR - 0.04, 0, 0.62)), V((-2.5, 0, 2.35))
seg = (p1 - p0)
cnt = int(seg.length / 0.058)
d = seg.normalized()
ang = math.atan2(d.z, d.x)
for i in range(cnt):
    q = p0 + seg * (i / cnt)
    add_torus(bm, 0.032, 0.009, 10, 6, Matrix.Translation(q) @ Matrix.Rotation(-ang, 4, 'Y') @ Matrix.Rotation(math.radians(90), 4, 'Y') @ Matrix.Rotation(math.radians(90 * (i % 2)), 4, 'Z'))
# the pulley: an iron sheave in a bracket, and the chain going on into the wall
add_cyl(bm, 0.16, 0.16, 0.06, 20, Matrix.Translation((-2.55, 0, 2.45)) @ Matrix.Rotation(math.radians(90), 4, 'X'))
for sy in (-1, 1):
    add_box(bm, (0.36, 0.025, 0.06), Matrix.Translation((-2.62, sy * 0.05, 2.45)))
add_box(bm, (0.12, 0.14, 0.5), Matrix.Translation((-2.78, 0, 2.45)))
for i in range(6):
    add_torus(bm, 0.032, 0.009, 10, 6, Matrix.Translation((-2.62 - i * 0.03, 0, 2.6 + i * 0.04)) @ Matrix.Rotation(math.radians(90 * (i % 2)), 4, 'Z'))
obj_from_bm('winch_chain', bm, iron)
export(OUT + '/winch.glb')

# ---------------- bolt slot: the stone-framed opening in the tower's flank the bolt slides into ----------------
# Set flush on the tower face, facing −X (the passage) at bolt height; origin at the opening's centre on the
# wall face. A deep dark socket behind a frame of dressed blocks, the sill polished by the beam.
reset()
stone = mat('stone', (0.2, 0.15, 0.115), 0.85); dark = mat('dark', (0.02, 0.016, 0.012), 0.95); worn = mat('wornstone', (0.3, 0.23, 0.17), 0.6)
iron = mat('iron', iron_c, 0.5, 0.85)
O = 0.56   # opening (square, the beam is 0.42)
bm = bmesh.new()
# jambs, lintel and sill as proud blocks around the opening (x = depth into the passage)
for sy in (-1, 1):
    add_box(bm, (0.16, 0.3, O + 0.5), Matrix.Translation((-0.08, sy * (O / 2 + 0.15), 0)))
add_box(bm, (0.2, O + 0.9, 0.3), Matrix.Translation((-0.1, 0, O / 2 + 0.15)))
obj_from_bm('slot_frame', bm, stone, smooth=False)
bpy.context.view_layer.objects.active = bpy.data.objects['slot_frame']
bpy.data.objects['slot_frame'].select_set(True)
bv = bpy.data.objects['slot_frame'].modifiers.new('bevel', 'BEVEL'); bv.width = 0.02; bv.segments = 2
bpy.ops.object.modifier_apply(modifier='bevel')
bm = bmesh.new()
add_box(bm, (0.22, O + 0.7, 0.2), Matrix.Translation((-0.11, 0, -O / 2 - 0.1)))
obj_from_bm('slot_sill', bm, worn, smooth=False)
# the socket: a dark box going into the wall (its open end at the face), so the beam vanishes into black
bm = bmesh.new()
add_box(bm, (1.2, O, O), Matrix.Translation((0.6, 0, 0)))
bmesh.ops.reverse_faces(bm, faces=bm.faces[:])
obj_from_bm('slot_socket', bm, dark, smooth=False)
# two iron guide plates inside the mouth
bm = bmesh.new()
for sz in (-1, 1):
    add_box(bm, (0.3, O - 0.04, 0.02), Matrix.Translation((0.12, 0, sz * (O / 2 - 0.01))))
obj_from_bm('slot_iron', bm, iron, smooth=False)
export(OUT + '/boltslot.glb')

# ---------------- alarm bell: bronze bell under a wooden gallows with a clapper and pull rope ----------------
reset()
oak = mat('oak', oak_c, 0.8); iron = mat('iron', iron_c, 0.5, 0.85); bronze = mat('bronze', bronze_c, 0.35, 0.9)
bm = bmesh.new()
for sx in (-1, 1):
    add_box(bm, (0.16, 0.16, 2.6), Matrix.Translation((sx * 0.6, 0, 1.3)))
add_box(bm, (1.5, 0.16, 0.16), Matrix.Translation((0, 0, 2.55)))
add_box(bm, (0.08, 0.08, 0.7), Matrix.Translation((0.45, 0, 2.2)) @ Matrix.Rotation(math.radians(45), 4, 'Y'))
add_box(bm, (0.08, 0.08, 0.7), Matrix.Translation((-0.45, 0, 2.2)) @ Matrix.Rotation(math.radians(-45), 4, 'Y'))
obj_from_bm('bell_frame', bm, oak, smooth=False)
bm = bmesh.new()
lathe(bm, [(0.0, 0.0), (0.3, 0.0), (0.31, 0.04), (0.26, 0.12), (0.22, 0.3), (0.2, 0.45), (0.14, 0.55), (0.08, 0.58), (0.0, 0.58)], 28, Matrix.Translation((0, 0, 1.85)))
add_torus(bm, 0.06, 0.02, 14, 8, Matrix.Translation((0, 0, 2.47)) @ Matrix.Rotation(math.radians(90), 4, 'X'))
obj_from_bm('bell', bm, bronze)
bm = bmesh.new()
add_cyl(bm, 0.02, 0.02, 0.35, 8, Matrix.Translation((0, 0, 2.1)))
r = bmesh.ops.create_icosphere(bm, subdivisions=2, radius=0.06)
bmesh.ops.transform(bm, matrix=Matrix.Translation((0, 0, 1.9)), verts=r['verts'])
obj_from_bm('bell_clapper', bm, iron)
export(OUT + '/bell.glb')
