"""The gatehouse beside Troy's gate, modelled in Blender (bpy 4.2): a real little house, not a box.

    python gatehouse.py -- <outdir>   → gatehouse.glb

6.5 × 6.5 m footprint, walls 5.2 m, a pitched terracotta roof (ridge along X at 7.3 m) with cover tiles
and ridge tiles, rafter tails under the eaves, a stone base course and corner quoins, a door opening
1.6 × 3.0 m in the north face (local x −0.25; the door itself is mounted by the game) with a stone
frame, a shuttered window beside it and one in the east wall. Origin at the floor centre; the north
face is at Blender +Y (= −Z in the game), 1 unit = 1 m.
"""
import bpy, bmesh, math, sys, random
from mathutils import Vector, Matrix

OUT = sys.argv[sys.argv.index('--') + 1]
V = Vector
random.seed(3)


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


def cyl(bm, r0, r1, length, segs, m):
    r = bmesh.ops.create_cone(bm, cap_ends=True, segments=segs, radius1=r0, radius2=r1, depth=length)
    bmesh.ops.transform(bm, matrix=m, verts=r['verts'])


def export(path):
    bpy.ops.object.select_all(action='SELECT')
    bpy.ops.export_scene.gltf(filepath=path, export_format='GLB', export_apply=True, export_yup=True,
                              export_materials='EXPORT', export_normals=True, export_texcoords=False, use_selection=True)
    print('wrote', path, 'faces', sum(len(o.data.polygons) for o in bpy.data.objects if o.type == 'MESH'))


bpy.ops.wm.read_factory_settings(use_empty=True)
plaster = mat('plaster', (0.6, 0.52, 0.4), 0.85)
stone = mat('stone', (0.45, 0.41, 0.36), 0.8)
oak = mat('oak', (0.30, 0.19, 0.10), 0.75)
tile = mat('tile', (0.62, 0.30, 0.18), 0.7)
dark = mat('dark', (0.05, 0.04, 0.035), 0.9)

W, D, H = 6.5, 6.5, 5.2          # footprint and wall height
T = 0.5                           # wall thickness
RIDGE, OVER = 7.3, 0.45           # ridge height, eaves overhang
DX, DW, DH = -0.25, 1.6, 3.0      # door (north face)
hx, hy = W / 2, D / 2

# ---- walls (plaster), each face built from pieces so the door and the windows are real openings
bm = bmesh.new()
base = 0.9
# north face (+Y): left of the door, right of the door (with the window hole), over the door
box(bm, -hx, DX - DW / 2, hy - T, hy, base, H)
win_n = (1.9, 1.5, 0.9, 1.1)      # x, sill, width, height
wx, ws, ww, wh = win_n
box(bm, DX + DW / 2, wx - ww / 2, hy - T, hy, base, H)
box(bm, wx + ww / 2, hx, hy - T, hy, base, H)
box(bm, wx - ww / 2, wx + ww / 2, hy - T, hy, base, ws)
box(bm, wx - ww / 2, wx + ww / 2, hy - T, hy, ws + wh, H)
box(bm, DX - DW / 2, DX + DW / 2, hy - T, hy, DH, H)
# south face (−Y, against the city wall) and west (against the tower)
box(bm, -hx, hx, -hy, -hy + T, base, H)
box(bm, -hx, -hx + T, -hy + T, hy - T, base, H)
# east face with a window
ex, es, ew, eh = 0.6, 1.6, 0.8, 1.0
box(bm, hx - T, hx, -hy + T, ex - ew / 2, base, H)
box(bm, hx - T, hx, ex + ew / 2, hy - T, base, H)
box(bm, hx - T, hx, ex - ew / 2, ex + ew / 2, base, es)
box(bm, hx - T, hx, ex - ew / 2, ex + ew / 2, es + eh, H)
# gables (triangles) over the east and west walls up to the ridge
for sx in (-1, 1):
    x0, x1 = (hx - T, hx) if sx > 0 else (-hx, -hx + T)
    n = 12
    for i in range(n):
        y0 = -hy + i * D / n
        y1 = y0 + D / n
        zt = RIDGE - (RIDGE - H) * abs((y0 + y1) / 2) / hy
        box(bm, x0, x1, y0, y1, H - 0.01, zt)
obj_from_bm('walls', bm, plaster)

# ---- stone: base course of big blocks, corner quoins, the door frame and lintel, window sills
bm = bmesh.new()
# (the north course stops at the door jambs: the doorway goes down to the floor, with a worn threshold)
for (x0, x1, y0, y1) in [(-hx - 0.06, DX - DW / 2, hy - T, hy + 0.06), (DX + DW / 2, hx + 0.06, hy - T, hy + 0.06), (-hx - 0.06, hx + 0.06, -hy - 0.06, -hy + T), (-hx - 0.06, -hx + T, -hy, hy), (hx - T, hx + 0.06, -hy, hy)]:
    box(bm, x0, x1, y0, y1, 0, base)
# a shallow joint line in the base course, either side of the door
box(bm, -hx - 0.07, DX - DW / 2 - 0.3, hy - 0.02, hy + 0.07, 0.44, 0.47)
box(bm, DX + DW / 2 + 0.3, hx + 0.07, hy - 0.02, hy + 0.07, 0.44, 0.47)
# the threshold: one low worn slab across the doorway, flush with the street
box(bm, DX - DW / 2, DX + DW / 2, hy - T, hy + 0.12, 0, 0.05)
# quoins up the four corners
for sx in (-1, 1):
    for sy in (-1, 1):
        for k in range(8):
            z0 = base + k * 0.54
            long_ = k % 2 == 0
            lx = 0.6 if long_ else 0.38
            ly = 0.38 if long_ else 0.6
            box(bm, sx * hx - (lx if sx > 0 else 0) - 0.04 * (sx < 0) + 0.04 * (sx > 0) - (0 if sx > 0 else 0), sx * hx + (0.04 if sx > 0 else lx + 0.04) if False else sx * hx + (0.04 if sx > 0 else 0) - (lx if sx < 0 else 0) + (lx if sx > 0 else 0) * 0, sy * hy - (ly if sy > 0 else 0) + 0.04 * (sy > 0) - 0.04 * (sy < 0), sy * hy + (0.04 if sy > 0 else 0) + (0 if sy < 0 else 0) + (ly if sy < 0 else 0), z0, z0 + 0.5)
# door frame: jambs and a heavy lintel with a relieving slab
box(bm, DX - DW / 2 - 0.3, DX - DW / 2, hy - 0.1, hy + 0.1, 0, DH + 0.1)
box(bm, DX + DW / 2, DX + DW / 2 + 0.3, hy - 0.1, hy + 0.1, 0, DH + 0.1)
box(bm, DX - DW / 2 - 0.45, DX + DW / 2 + 0.45, hy - 0.12, hy + 0.14, DH, DH + 0.45)
box(bm, DX - 0.9, DX + 0.9, hy - 0.08, hy + 0.1, DH + 0.45, DH + 0.7)
# window sills
box(bm, wx - ww / 2 - 0.12, wx + ww / 2 + 0.12, hy - 0.1, hy + 0.12, ws - 0.1, ws + 0.02)
box(bm, hx - 0.1, hx + 0.12, ex - ew / 2 - 0.12, ex + ew / 2 + 0.12, es - 0.1, es + 0.02)
obj_from_bm('stone', bm, stone)

# ---- roof: two slopes with eaves, rafter tails, cover tiles and ridge tiles
bm = bmesh.new()
slope = math.atan2(RIDGE - H, hy + OVER)
L = math.hypot(RIDGE - H + 0.12, hy + OVER)
for sy in (-1, 1):
    # slope plank as a thin box rotated about X
    mtx = Matrix.Translation(V((0, sy * (hy + OVER) / 2, H + (RIDGE - H) / 2 + 0.1))) @ Matrix.Rotation(-sy * slope, 4, 'X')
    r = bmesh.ops.create_cube(bm, size=1.0)
    bmesh.ops.scale(bm, vec=V((W + 2 * OVER, L, 0.1)), verts=r['verts'])
    bmesh.ops.transform(bm, matrix=mtx, verts=r['verts'])
# ridge beam cover
box(bm, -hx - OVER, hx + OVER, -0.18, 0.18, RIDGE + 0.02, RIDGE + 0.2)
obj_from_bm('roofdeck', bm, tile)

bm = bmesh.new()
for sy in (-1, 1):
    down = V((0, sy * math.cos(slope), -math.sin(slope)))      # direction down the slope
    top = V((0, 0, RIDGE + 0.16))
    # cover tiles every 0.42 m across, running down the slope
    n = int((W + 2 * OVER) / 0.42)
    for i in range(n + 1):
        x = -hx - OVER + 0.1 + i * 0.42
        a = top + V((x, 0, 0)) + down * 0.05
        b = top + V((x, 0, 0)) + down * (L - 0.02)
        rot = V((0, 0, 1)).rotation_difference((b - a).normalized()).to_matrix().to_4x4()
        r = bmesh.ops.create_cone(bm, cap_ends=True, segments=10, radius1=0.085, radius2=0.085, depth=(b - a).length)
        bmesh.ops.transform(bm, matrix=Matrix.Translation((a + b) / 2) @ rot, verts=r['verts'])
        # the lip of every tile course: small ridges across, every 0.5 m down the slope
    for k in range(1, int(L / 0.5) + 1):
        c = top + down * (k * 0.5)
        r = bmesh.ops.create_cube(bm, size=1.0)
        bmesh.ops.scale(bm, vec=V((W + 2 * OVER - 0.05, 0.06, 0.05)), verts=r['verts'])
        bmesh.ops.transform(bm, matrix=Matrix.Translation(c) @ Matrix.Rotation(-sy * slope, 4, 'X'), verts=r['verts'])
# ridge tiles: half-rounds along the ridge
for i in range(int((W + 2 * OVER) / 0.45) + 1):
    x = -hx - OVER + 0.2 + i * 0.45
    cyl(bm, 0.14, 0.14, 0.42, 10, Matrix.Translation(V((x, 0, RIDGE + 0.2))) @ Matrix.Rotation(math.pi / 2, 4, 'Y'))
# antefixes (little palmettes) at the eaves ends of every cover tile row, as small upright slabs
for sy in (-1, 1):
    n = int((W + 2 * OVER) / 0.42)
    for i in range(n + 1):
        x = -hx - OVER + 0.1 + i * 0.42
        ye = sy * (hy + OVER)
        box(bm, x - 0.09, x + 0.09, ye - 0.03, ye + 0.03, H + 0.05, H + 0.32)
obj_from_bm('tiles', bm, tile, smooth=True)

# ---- timber: rafter tails under the eaves, the tie beams and rafters seen from inside, shutters
bm = bmesh.new()
for sy in (-1, 1):
    for i in range(11):
        x = -hx + 0.3 + i * 0.59
        # rafter from the wall top out to the eaves, following the slope
        a = V((x, sy * (hy - 0.2), H - 0.05))
        b = V((x, sy * (hy + OVER - 0.05), H - 0.05 - (OVER + 0.15) * math.tan(slope)))
        rot = V((0, 0, 1)).rotation_difference((b - a).normalized()).to_matrix().to_4x4()
        r = bmesh.ops.create_cube(bm, size=1.0)
        bmesh.ops.scale(bm, vec=V((0.16, 0.14, (b - a).length + 0.2)), verts=r['verts'])
        bmesh.ops.transform(bm, matrix=Matrix.Translation((a + b) / 2) @ rot, verts=r['verts'])
        # the inner rafter up to the ridge (seen from inside the house)
        a2 = V((x, sy * (hy - 0.25), H - 0.05))
        b2 = V((x, 0, RIDGE - 0.1))
        rot = V((0, 0, 1)).rotation_difference((b2 - a2).normalized()).to_matrix().to_4x4()
        r = bmesh.ops.create_cube(bm, size=1.0)
        bmesh.ops.scale(bm, vec=V((0.14, 0.14, (b2 - a2).length)), verts=r['verts'])
        bmesh.ops.transform(bm, matrix=Matrix.Translation((a2 + b2) / 2) @ rot, verts=r['verts'])
# tie beams across and the ridge beam
for x in (-2.0, 0.2, 2.4):
    box(bm, x - 0.1, x + 0.1, -hy + T, hy - T, H - 0.3, H - 0.08)
box(bm, -hx + T, hx - T, -0.1, 0.1, RIDGE - 0.32, RIDGE - 0.1)
# wall plates on top of the long walls
for sy in (-1, 1):
    box(bm, -hx - 0.05, hx + 0.05, sy * (hy - T / 2) - 0.2, sy * (hy - T / 2) + 0.2, H - 0.1, H + 0.02)
# shutters: the north window's shutters stand open against the wall, the east one is closed
for s in (-1, 1):
    sxp = wx + s * (ww / 2 + 0.02 + 0.22)
    box(bm, sxp - 0.2, sxp + 0.2, hy + 0.02, hy + 0.07, ws + 0.02, ws + wh - 0.02)
    box(bm, sxp - 0.2, sxp + 0.2, hy + 0.07, hy + 0.09, ws + 0.1, ws + 0.16)
    box(bm, sxp - 0.2, sxp + 0.2, hy + 0.07, hy + 0.09, ws + wh - 0.16, ws + wh - 0.1)
box(bm, hx + 0.02, hx + 0.07, ex - ew / 2, ex + ew / 2, es + 0.02, es + eh - 0.02)
box(bm, hx + 0.07, hx + 0.09, ex - ew / 2 + 0.04, ex + ew / 2 - 0.04, es + 0.1, es + 0.16)
box(bm, hx + 0.07, hx + 0.09, ex - ew / 2 + 0.04, ex + ew / 2 - 0.04, es + eh - 0.16, es + eh - 0.1)
# window frame of the north window
for s in (-1, 1):
    box(bm, wx + s * ww / 2 - 0.05, wx + s * ww / 2 + 0.05, hy - T + 0.05, hy + 0.02, ws, ws + wh)
box(bm, wx - ww / 2, wx + ww / 2, hy - T + 0.05, hy + 0.02, ws + wh - 0.06, ws + wh + 0.02)
obj_from_bm('timber', bm, oak)

# the dark of the open north window (a shutter-less opening into the lit room reads black at night)
bm = bmesh.new()
box(bm, wx - ww / 2 + 0.02, wx + ww / 2 - 0.02, hy - T + 0.2, hy - T + 0.22, ws + 0.02, ws + wh - 0.02)
obj_from_bm('darkglass', bm, dark)

export(OUT + '/gatehouse.glb')
