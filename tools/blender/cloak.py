"""Woollen cloaks for the gate captain and Hector, modelled in Blender (bpy 4.2).

    python cloak.py -- <out dir>   → cloak.glb (captain, 0.95 m), cloak_long.glb (Hector, 1.25 m)

A heavy wool cloak hanging from the shoulders: gathered under a rolled collar with two bronze fibulae,
flaring towards the hem, falling in vertical folds that deepen downwards, wrapping a little round the
back, with a dark woven border at the hem. Origin at the cloth's centre; width along glTF X, height along
glTF Y, the outside facing glTF +Z (away from the wearer's back), as the old flat plane it replaces.
"""
import bpy, bmesh, math, sys, random
from mathutils import Matrix, Vector

OUT = sys.argv[sys.argv.index('--') + 1]


def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def mat(name, rgb, rough=0.9, metal=0.0, sheen=0.0):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    m.use_backface_culling = False
    b = m.node_tree.nodes['Principled BSDF']
    b.inputs['Base Color'].default_value = (*rgb, 1)
    b.inputs['Roughness'].default_value = rough
    b.inputs['Metallic'].default_value = metal
    return m


def cloak(w_top, w_hem, h, seed, path):
    reset()
    random.seed(seed)
    wool = mat('wool', (0.17, 0.014, 0.009), 0.92)
    border = mat('border', (0.09, 0.03, 0.008), 0.8)
    bronze = mat('bronze', (0.55, 0.33, 0.12), 0.35, 1.0)
    nx, nz = 26, 34
    bm = bmesh.new()
    rows = []
    phases = [random.uniform(0, math.tau) for _ in range(3)]
    for j in range(nz + 1):
        t = j / nz  # 0 at the collar, 1 at the hem
        z = h / 2 - t * h
        half = (w_top + (w_hem - w_top) * (t ** 0.8)) / 2
        row = []
        for i in range(nx + 1):
            u = i / nx * 2 - 1  # -1..1 across
            x = u * half
            # folds: a few broad ones and finer ones, deeper towards the hem, pinched flat at the collar
            amp = 0.008 + 0.06 * t ** 1.1
            f = (math.sin(u * 5.2 + phases[0]) * 0.6 + math.sin(u * 11.0 + phases[1]) * 0.3 + math.sin(u * 17.0 + phases[2]) * 0.1)
            out = amp * f
            # wrapping round the back: the edges come forward (Blender +Y = towards the wearer)
            wrap = (0.05 + 0.05 * (1 - t)) * u * u
            # the hem swings a little, uneven
            zz = z + (0.012 * math.sin(u * 7.0 + phases[1]) * t ** 4)
            row.append(bm.verts.new((x, wrap - out, zz)))
        rows.append(row)
    faces_border = []
    for j in range(nz):
        for i in range(nx):
            fa = bm.faces.new((rows[j][i], rows[j + 1][i], rows[j + 1][i + 1], rows[j][i + 1]))
            if j >= nz - 3:
                faces_border.append(fa)
    me = bpy.data.meshes.new('cloak')
    for fa in faces_border:
        fa.material_index = 1
    bm.to_mesh(me)
    bm.free()
    o = bpy.data.objects.new('cloak', me)
    bpy.context.collection.objects.link(o)
    o.data.materials.append(wool)
    o.data.materials.append(border)
    for p in me.polygons:
        p.use_smooth = True
    sol = o.modifiers.new('thick', 'SOLIDIFY')
    sol.thickness = 0.012
    sol.offset = 0
    # the rolled collar the cloth is gathered under
    bm = bmesh.new()
    seg = 14
    ring_n = 10
    rings = []
    for k in range(seg + 1):
        x = -w_top / 2 * 1.02 + k / seg * w_top * 1.02
        u = x / (w_top / 2)
        cy = 0.1 * u * u
        ring = []
        for r in range(ring_n):
            a = r / ring_n * math.tau
            rad = 0.026 * (1 - 0.25 * abs(u) ** 3)
            ring.append(bm.verts.new((x, cy - 0.005 + math.cos(a) * rad, h / 2 + 0.008 + math.sin(a) * rad)))
        rings.append(ring)
    for a, b in zip(rings, rings[1:]):
        for r in range(ring_n):
            bm.faces.new((a[r], a[(r + 1) % ring_n], b[(r + 1) % ring_n], b[r]))
    for ring, rev in ((rings[0], True), (rings[-1], False)):
        bm.faces.new(list(reversed(ring)) if rev else ring)
    me = bpy.data.meshes.new('collar')
    bm.to_mesh(me)
    bm.free()
    c = bpy.data.objects.new('collar', me)
    bpy.context.collection.objects.link(c)
    c.data.materials.append(wool)
    for p in me.polygons:
        p.use_smooth = True
    # two bronze fibulae (round brooches) where it is pinned at the shoulders
    for sx in (-1, 1):
        x = sx * w_top / 2 * 0.86
        u = x / (w_top / 2)
        bpy.ops.mesh.primitive_cylinder_add(vertices=20, radius=0.034, depth=0.012,
                                            location=(x, 0.1 * u * u - 0.03, h / 2 + 0.004),
                                            rotation=(math.pi / 2, 0, 0))
        b = bpy.context.active_object
        b.data.materials.append(bronze)
        bpy.ops.mesh.primitive_uv_sphere_add(segments=12, ring_count=8, radius=0.014,
                                             location=(x, 0.1 * u * u - 0.038, h / 2 + 0.004))
        b2 = bpy.context.active_object
        b2.data.materials.append(bronze)
    bpy.ops.object.select_all(action='DESELECT')
    bpy.ops.export_scene.gltf(filepath=path, export_format='GLB', export_apply=True, export_yup=True,
                              export_texcoords=False, export_normals=True)


cloak(0.5, 0.7, 0.95, 3, OUT + '/cloak.glb')
cloak(0.56, 0.82, 1.25, 5, OUT + '/cloak_long.glb')
print('done')
