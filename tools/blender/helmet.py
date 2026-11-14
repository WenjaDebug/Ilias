"""Greek bronze helmet for the Achaean soldiers, modelled in Blender (bpy 4.2).

    python helmet.py -- <outdir>   → helmet.glb

Corinthian type: a domed bowl, a brow ridge, long cheek guards, a nose guard, a short flared neck guard,
and a low crest holder. Origin at the centre of the head, Z up, the face looks along −Y in Blender
(= +Z in glTF, the character's forward). Fits a head of ~0.19 m width; 1 unit = 1 m.
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


def strip(bm, profile, a0, a1, segs, rx=1.0, ry=1.0):
    """an open lathe strip over the angular range a0..a1 (radians, 0 = +X, −90° = −Y = the face);
    profile is a list of (r, z); the ring is elliptical (rx, ry) so the bowl fits a head"""
    rings = []
    for (r, z) in profile:
        ring = [bm.verts.new(V((math.cos(a0 + (a1 - a0) * k / segs) * r * rx, math.sin(a0 + (a1 - a0) * k / segs) * r * ry, z))) for k in range(segs + 1)]
        rings.append(ring)
    for i in range(len(rings) - 1):
        for k in range(segs):
            bm.faces.new((rings[i][k], rings[i][k + 1], rings[i + 1][k + 1], rings[i + 1][k]))
    return rings


def add_box(bm, size, m):
    r = bmesh.ops.create_cube(bm, size=1.0)
    bmesh.ops.scale(bm, vec=size, verts=r['verts'])
    bmesh.ops.transform(bm, matrix=m, verts=r['verts'])


bpy.ops.wm.read_factory_settings(use_empty=True)
bronze = mat('bronze', (0.62, 0.40, 0.18), 0.32, 0.9)
dark = mat('dark_bronze', (0.22, 0.14, 0.07), 0.5, 0.8)
horse_hair = mat('crest', (0.08, 0.06, 0.05), 0.9)

RX, RY = 0.112, 0.128  # head ellipse at the brow (half widths)
F = -math.pi / 2       # the face direction
bm = bmesh.new()
# the bowl: from the crown down to the brow line (z = 0), slightly flared brow ridge
bowl = [(0.0, 0.165), (0.35, 0.160), (0.62, 0.142), (0.82, 0.112), (0.94, 0.072), (1.0, 0.030), (1.02, 0.0), (1.05, -0.012)]
strip(bm, bowl, 0, math.tau, 48, RX, RY)
# back and sides below the brow: the skull piece sweeps down to the neck guard which flares out
back = [(1.05, -0.012), (1.03, -0.05), (1.02, -0.09), (1.06, -0.115), (1.14, -0.13)]
strip(bm, back, F + math.radians(42), F + math.radians(318), 40, RX, RY)
# cheek guards: two long plates either side of the face, tapering to a point below the jaw
for side in (-1, 1):
    a_in = F + side * math.radians(16)     # the edge next to the nose guard
    a_out = F + side * math.radians(44)    # joins the skull piece
    cheek = [(1.05, -0.012), (1.03, -0.045), (1.0, -0.085), (0.97, -0.115), (0.93, -0.145)]
    rings = strip(bm, cheek, a_out, a_in, 8, RX, RY)
    # pull the lower inner corner back so the guard ends in a point under the cheek, leaving the mouth free
    for i, ring in enumerate(rings):
        t = i / (len(rings) - 1)
        for k, v in enumerate(ring):
            s = k / (len(ring) - 1)  # 0 at the skull side, 1 at the nose side
            v.co.z += 0.055 * t * t * s
shell = obj_from_bm('helmet_shell', bm, bronze)
# nose guard: a thin bar down from the brow
bm = bmesh.new()
add_box(bm, (0.026, 0.012, 0.085), Matrix.Translation((0, -RY * 1.04 - 0.002, -0.052)) @ Matrix.Rotation(math.radians(8), 4, 'X'))
# brow band: a raised rim following the brow line all round
for k in range(48):
    a = k / 48 * math.tau
    add_box(bm, (0.018, 0.008, 0.012), Matrix.Translation((math.cos(a) * RX * 1.06, math.sin(a) * RY * 1.06, -0.004)) @ Matrix.Rotation(a + math.pi / 2, 4, 'Z'))
# crest holder: a low fore-and-aft ridge on the crown
add_box(bm, (0.014, 0.16, 0.022), Matrix.Translation((0, 0.0, 0.168)))
trim = obj_from_bm('helmet_trim', bm, dark, smooth=False)
# a short horsehair crest along the ridge (plain soldiers: short and dark; the officers get the tall one in game)
bm = bmesh.new()
for i in range(9):
    y = -0.07 + i * 0.0175
    h = 0.045 + 0.02 * math.sin(math.pi * i / 8)
    add_box(bm, (0.02 - 0.001 * i, 0.016, h), Matrix.Translation((0, y, 0.178 + h / 2)) @ Matrix.Rotation(math.radians(-18), 4, 'X'))
crest = obj_from_bm('helmet_crest', bm, horse_hair, smooth=False)

bpy.context.view_layer.objects.active = shell
shell.select_set(True)
sol = shell.modifiers.new('solidify', 'SOLIDIFY')
sol.thickness = 0.006
sol.offset = -1.0
bpy.ops.object.modifier_apply(modifier='solidify')
bpy.ops.object.shade_smooth_by_angle(angle=math.radians(50))
bpy.ops.object.select_all(action='SELECT')
bpy.ops.export_scene.gltf(filepath=OUT + '/helmet.glb', export_format='GLB', export_apply=True, export_yup=True,
                          export_materials='EXPORT', export_normals=True, export_texcoords=False, use_selection=True)
print('wrote helmet.glb faces', sum(len(o.data.polygons) for o in bpy.data.objects if o.type == 'MESH'))
