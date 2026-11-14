"""Painted Greek vases for Odysseus, modelled in Blender (bpy 4.2): a bell krater and a hydria.

    python vases.py -- <outdir>   → krater.glb, hydria.glb

Lathe bodies with hand-thrown irregularity, handles, and the painting as raised bands: a black
ground with a red (clay) figure band, meander keys and tongue patterns along the rims. 1 unit = 1 m,
origin at the foot, Z up. Collision boxes are set in world/level.ts.
"""
import bpy, bmesh, math, sys
from mathutils import Vector, Matrix, noise

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


def radius_at(profile, z):
    for k in range(len(profile) - 1):
        (r0, z0), (r1, z1) = profile[k], profile[k + 1]
        if z0 <= z <= z1:
            return r0 + (r1 - r0) * (z - z0) / max(1e-6, z1 - z0)
    return profile[-1][0]


def lathe_band(bm, profile, z0, z1, segs, inflate=0.0, steps=6):
    """the part of the lathe between z0 and z1, pushed out by `inflate` (for painted bands)"""
    zs = [z0 + (z1 - z0) * i / steps for i in range(steps + 1)]
    rings = []
    for z in zs:
        r = radius_at(profile, z) + inflate
        rings.append([bm.verts.new(V((math.cos(k / segs * math.tau) * r, math.sin(k / segs * math.tau) * r, z))) for k in range(segs)])
    for i in range(len(rings) - 1):
        for k in range(segs):
            bm.faces.new((rings[i][k], rings[i][(k + 1) % segs], rings[i + 1][(k + 1) % segs], rings[i + 1][k]))
    return rings


def lathe(bm, profile, segs):
    rings = []
    for (r, z) in profile:
        rings.append([bm.verts.new(V((math.cos(k / segs * math.tau) * r, math.sin(k / segs * math.tau) * r, z))) for k in range(segs)])
    for i in range(len(rings) - 1):
        for k in range(segs):
            bm.faces.new((rings[i][k], rings[i][(k + 1) % segs], rings[i + 1][(k + 1) % segs], rings[i + 1][k]))
    if profile[0][0] > 0.001:
        bm.faces.new(rings[0][::-1])
    if profile[-1][0] > 0.001:
        bm.faces.new(rings[-1])


def add_box(bm, size, m):
    r = bmesh.ops.create_cube(bm, size=1.0)
    bmesh.ops.scale(bm, vec=size, verts=r['verts'])
    bmesh.ops.transform(bm, matrix=m, verts=r['verts'])


def handle(bm, p0, p1, bulge, r=0.018, segs=12, rings=7):
    """a rounded handle from p0 to p1 bowing outward by `bulge` (a vector)"""
    pts = []
    for i in range(segs + 1):
        t = i / segs
        pts.append(p0.lerp(p1, t) + bulge * math.sin(math.pi * t))
    frames = []
    up = V((0, 0, 1))
    for i in range(segs + 1):
        tng = (pts[min(segs, i + 1)] - pts[max(0, i - 1)]).normalized()
        side = tng.cross(up)
        if side.length < 1e-4:
            side = tng.cross(V((1, 0, 0)))
        side.normalize()
        frames.append((side, side.cross(tng).normalized()))
    rr = []
    for i, p in enumerate(pts):
        s, u = frames[i]
        rr.append([bm.verts.new(p + s * (math.cos(k / rings * math.tau) * r) + u * (math.sin(k / rings * math.tau) * r)) for k in range(rings)])
    for i in range(segs):
        for k in range(rings):
            bm.faces.new((rr[i][k], rr[i][(k + 1) % rings], rr[i + 1][(k + 1) % rings], rr[i + 1][k]))
    bm.faces.new(rr[0][::-1])
    bm.faces.new(rr[-1])


def meander(bm, profile, z, h, segs, n, inflate):
    """a Greek key band: short raised bars alternating up and down around the vase"""
    for i in range(n):
        a = i / n * math.tau
        r = radius_at(profile, z) + inflate
        R = Matrix.Rotation(a, 4, 'Z')
        add_box(bm, (0.006, 0.012, h), R @ Matrix.Translation((r, 0, z)))
        add_box(bm, (0.006, (r * math.tau / n) * 0.6, 0.012), R @ Matrix.Translation((r, 0, z + (h / 2 - 0.006) * (1 if i % 2 else -1))))


def tongues(bm, profile, z, h, segs, n, inflate):
    for i in range(n):
        a = i / n * math.tau
        r = radius_at(profile, z) + inflate
        add_box(bm, (0.006, 0.018, h), Matrix.Rotation(a, 4, 'Z') @ Matrix.Translation((r, 0, z)))


def figures(bm, profile, z0, z1, n, inflate):
    """a frieze of stylised figures (red on black): simple raised silhouettes – torso, head, a spear or a shield"""
    for i in range(n):
        a = i / n * math.tau + 0.1
        zc = (z0 + z1) / 2
        h = z1 - z0
        r = radius_at(profile, zc) + inflate
        R = Matrix.Rotation(a, 4, 'Z')
        add_box(bm, (0.006, 0.05, h * 0.45), R @ Matrix.Translation((r, 0, zc - h * 0.05)))         # body
        add_box(bm, (0.006, 0.028, 0.028), R @ Matrix.Translation((r, 0, zc + h * 0.3)))              # head
        add_box(bm, (0.006, 0.025, h * 0.35), R @ Matrix.Translation((r, -0.03, zc - h * 0.28)))      # legs
        add_box(bm, (0.006, 0.025, h * 0.35), R @ Matrix.Translation((r, 0.03, zc - h * 0.28)))
        if i % 2:
            add_box(bm, (0.006, 0.008, h * 0.9), R @ Matrix.Translation((r, 0.055, zc)))               # spear
        else:
            add_box(bm, (0.006, 0.07, 0.07), R @ Matrix.Translation((r, -0.055, zc + h * 0.05)))        # shield


def vase(path, profile, handles, paint, segs=32):
    reset()
    clay = mat('clay', (0.60, 0.33, 0.17), 0.65)
    black = mat('glaze', (0.06, 0.05, 0.045), 0.35)
    bm = bmesh.new()
    lathe(bm, profile, segs)
    for v in bm.verts:
        v.co += V((v.co.x, v.co.y, 0)).normalized() * (noise.noise(v.co * 6.0) * 0.004)
    body = obj_from_bm('vase_body', bm, clay)
    # the black glaze: large bands of the body pushed out a hair
    bm = bmesh.new()
    for (z0, z1) in paint['black']:
        lathe_band(bm, profile, z0, z1, segs, 0.004, 8)
    obj_from_bm('vase_glaze', bm, black)
    # the painting in clay red on the black: meander, tongues, figures
    bm = bmesh.new()
    for (z, h, n) in paint.get('meander', []):
        meander(bm, profile, z, h, segs, n, 0.008)
    for (z, h, n) in paint.get('tongues', []):
        tongues(bm, profile, z, h, segs, n, 0.008)
    for (z0, z1, n) in paint.get('figures', []):
        figures(bm, profile, z0, z1, n, 0.008)
    obj_from_bm('vase_paint', bm, clay, smooth=False)
    bm = bmesh.new()
    for (p0, p1, bulge, r) in handles:
        handle(bm, V(p0), V(p1), V(bulge), r)
    obj_from_bm('vase_handles', bm, black)
    export(path)


# bell krater: a wide mouth on a slender foot, two small handles low on the body, 0.55 m high
krater_profile = [(0.0, 0.0), (0.12, 0.0), (0.13, 0.025), (0.08, 0.05), (0.075, 0.12), (0.10, 0.16), (0.14, 0.2), (0.19, 0.3),
                  (0.215, 0.4), (0.225, 0.47), (0.235, 0.52), (0.26, 0.55), (0.26, 0.565), (0.24, 0.565), (0.22, 0.55), (0.0, 0.55)]
vase(OUT + '/krater.glb', krater_profile,
     [((0.17, -0.07, 0.24), (0.17, 0.07, 0.24), (0.07, 0, 0.0), 0.016), ((-0.17, -0.07, 0.24), (-0.17, 0.07, 0.24), (-0.07, 0, 0.0), 0.016)],
     {'black': [(0.0, 0.16), (0.2, 0.3), (0.46, 0.565)], 'meander': [(0.31, 0.03, 32)], 'tongues': [(0.5, 0.045, 36)], 'figures': [(0.32, 0.45, 8)]})

# hydria: a water jar, round shoulder, flaring neck, two side handles and one back handle, 0.5 m high
hydria_profile = [(0.0, 0.0), (0.09, 0.0), (0.1, 0.02), (0.085, 0.04), (0.12, 0.1), (0.17, 0.2), (0.19, 0.3), (0.175, 0.37),
                  (0.12, 0.42), (0.085, 0.44), (0.08, 0.48), (0.1, 0.5), (0.11, 0.51), (0.09, 0.51), (0.0, 0.5)]
vase(OUT + '/hydria.glb', hydria_profile,
     [((0.16, -0.06, 0.31), (0.16, 0.06, 0.31), (0.06, 0, 0.03), 0.015), ((-0.16, -0.06, 0.31), (-0.16, 0.06, 0.31), (-0.06, 0, 0.03), 0.015),
      ((0, -0.135, 0.37), (0, -0.095, 0.49), (0, -0.07, 0.0), 0.014)],
     {'black': [(0.0, 0.1), (0.35, 0.42), (0.46, 0.51)], 'meander': [(0.11, 0.025, 28)], 'tongues': [(0.405, 0.03, 30)], 'figures': [(0.13, 0.33, 7)]})
