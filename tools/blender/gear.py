"""Odysseus' gear, modelled in Blender (bpy 4.2) and exported as GLB for public/models/.

    python gear.py -- <out dir>

shield.glb  hoplon: bronze bowl, offset rim with a meander (Greek key) band, raised boar emblem,
            rivets, leather lining with arm band (porpax) and hand cord (antilabe).
            Face normal is Blender +Z (= glTF +Y); the game rotates it to face +Z.
sword.glb   leaf-shaped xiphos: blade with a diamond section and midrib along Blender +Z,
            gold cross guard, ribbed ivory grip, lobed bronze pommel. Blade from z=0.10 to z=0.56,
            grip below the guard towards z=0.
"""
import bpy, bmesh, math, sys, random
from mathutils import Vector, Matrix

OUT = sys.argv[sys.argv.index('--') + 1]
random.seed(7)


def clear():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def mat(name, rgb, rough=0.5, metal=0.0):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes['Principled BSDF']
    b.inputs['Base Color'].default_value = (*rgb, 1)
    b.inputs['Roughness'].default_value = rough
    b.inputs['Metallic'].default_value = metal
    return m


def obj_from_bmesh(name, bm, material, smooth=True):
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    o = bpy.data.objects.new(name, me)
    bpy.context.collection.objects.link(o)
    o.data.materials.append(material)
    if smooth:
        for p in me.polygons:
            p.use_smooth = True
    return o


def lathe(name, profile, material, segs=64, close=False):
    """profile: list of (r, z); spun around Z."""
    bm = bmesh.new()
    rings = []
    for (r, z) in profile:
        ring = []
        for i in range(segs):
            a = i / segs * math.tau
            ring.append(bm.verts.new((math.cos(a) * r, math.sin(a) * r, z)))
        rings.append(ring)
    for a, b in zip(rings, rings[1:]):
        for i in range(segs):
            bm.faces.new((a[i], a[(i + 1) % segs], b[(i + 1) % segs], b[i]))
    if close:
        for ring in (rings[0], rings[-1]):
            bm.faces.new(ring)
    bm.normal_update()
    return obj_from_bmesh(name, bm, material)


def ellipsoid(name, loc, scale, material, rot=(0, 0, 0), subdiv=3):
    bm = bmesh.new()
    bmesh.ops.create_icosphere(bm, subdivisions=subdiv, radius=1.0)
    o = obj_from_bmesh(name, bm, material)
    o.location = loc
    o.scale = scale
    o.rotation_euler = rot
    return o


def box(name, loc, size, material, rot=(0, 0, 0)):
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    o = obj_from_bmesh(name, bm, material, smooth=False)
    o.location = loc
    o.scale = size
    o.rotation_euler = rot
    return o


def join(objs, name):
    bpy.ops.object.select_all(action='DESELECT')
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    bpy.ops.object.join()
    bpy.context.active_object.name = name
    return bpy.context.active_object


def bevel(o, width=0.004, segs=2):
    m = o.modifiers.new('bevel', 'BEVEL')
    m.width = width
    m.segments = segs
    m.limit_method = 'ANGLE'


def export(path):
    bpy.ops.object.select_all(action='SELECT')
    bpy.ops.export_scene.gltf(filepath=path, export_format='GLB', export_apply=True, export_yup=True,
                              export_materials='EXPORT', export_normals=True, export_texcoords=False,
                              use_selection=True)


# ====================================================================== shield
clear()
R = 0.34
bronze = mat('bronze', (0.62, 0.40, 0.17), 0.38, 1.0)
bronze_dark = mat('bronze_dark', (0.36, 0.22, 0.09), 0.45, 1.0)
gold = mat('gold', (0.95, 0.72, 0.25), 0.3, 1.0)
leather = mat('leather', (0.16, 0.09, 0.05), 0.9, 0.0)
cord = mat('cord', (0.45, 0.36, 0.22), 0.9, 0.0)

# bowl: a shallow dome (depth ~0.13 R) with the typical offset rim, the inside open
depth = 0.075
prof = []
n = 14
for i in range(n + 1):
    t = i / n
    r = R * 0.90 * t
    z = depth * (1 - t * t)  # parabolic bowl, apex at centre
    prof.append((r, z))
prof += [(R * 0.93, -0.004), (R * 0.985, -0.012), (R, -0.02), (R, -0.034), (R * 0.985, -0.042), (R * 0.93, -0.046),
         (R * 0.90, -0.03)]
bowl = lathe('bowl', prof, bronze, segs=96)
# inner lining (leather) following the bowl from beneath
inner = [(R * 0.88 * (1 - i / n), depth * (1 - (1 - i / n) ** 2) - 0.012) for i in range(n + 1)]
lining = lathe('lining', inner, leather, segs=64)
# hammered surface: a faint displacement on the bowl only
tex = bpy.data.textures.new('hammer', 'CLOUDS')
tex.noise_scale = 0.03
d = bowl.modifiers.new('hammer', 'DISPLACE')
d.texture = tex
d.strength = 0.0025
d.mid_level = 0.5

# meander band around the rim: continuous Greek key made of thin raised bars
band_r = R * 0.78
bar_h = 0.0035
parts = []
N = 20
seg = math.tau / N
w = band_r * seg  # arc width of one key unit
bw = w * 0.11  # bar thickness
def arc_bar(a0, a1, r, name):
    """a raised bar following the circle between angles a0..a1 at radius r"""
    bm = bmesh.new()
    steps = max(2, int((a1 - a0) / seg * 6))
    lo, hi = [], []
    for k in range(steps + 1):
        a = a0 + (a1 - a0) * k / steps
        for lst, rr in ((lo, r - bw / 2), (hi, r + bw / 2)):
            lst.append((math.cos(a) * rr, math.sin(a) * rr))
    zb = depth * (1 - (r / (R * 0.9)) ** 2)
    vb, vt = [], []
    for (x, y) in lo + hi[::-1]:
        vb.append(bm.verts.new((x, y, zb - 0.002)))
        vt.append(bm.verts.new((x, y, zb + bar_h)))
    m = steps + 1
    bm.faces.new(vt)
    for i in range(len(vb)):
        j = (i + 1) % len(vb)
        bm.faces.new((vb[i], vb[j], vt[j], vt[i]))
    bm.normal_update()
    return obj_from_bmesh(name, bm, gold, smooth=False)

def rad_bar(a, r0, r1, name):
    bm = bmesh.new()
    c, s = math.cos(a), math.sin(a)
    nx, ny = -s * bw / 2, c * bw / 2
    zb = depth * (1 - ((r0 + r1) / 2 / (R * 0.9)) ** 2)
    pts = [(c * r0 + nx, s * r0 + ny), (c * r1 + nx, s * r1 + ny), (c * r1 - nx, s * r1 - ny), (c * r0 - nx, s * r0 - ny)]
    vb = [bm.verts.new((x, y, zb - 0.004)) for x, y in pts]
    vt = [bm.verts.new((x, y, zb + bar_h)) for x, y in pts]
    bm.faces.new(vt)
    for i in range(4):
        j = (i + 1) % 4
        bm.faces.new((vb[i], vb[j], vt[j], vt[i]))
    bm.normal_update()
    return obj_from_bmesh(name, bm, gold, smooth=False)

half = w * 0.42
r_out, r_in = band_r + half, band_r - half
for i in range(N):
    a = i * seg
    # one key unit: outer arc, drop in, inner hook, back out
    parts.append(arc_bar(a, a + seg * 0.62, r_out, 'k%da' % i))
    parts.append(rad_bar(a + seg * 0.62, r_in, r_out, 'k%db' % i))
    parts.append(arc_bar(a + seg * 0.25, a + seg * 0.62, r_in, 'k%dc' % i))
    parts.append(rad_bar(a + seg * 0.25, r_in, band_r, 'k%dd' % i))
    parts.append(arc_bar(a + seg * 0.25, a + seg * 0.45, band_r, 'k%de' % i))
    parts.append(rad_bar(a, r_out - 0.0005, r_out + 0.0005, 'k%df' % i))  # tiny join
# two gold rings framing the band
for rr, nm in ((r_out + w * 0.12, 'ringo'), (r_in - w * 0.12, 'ringi')):
    zb = depth * (1 - (rr / (R * 0.9)) ** 2)
    ring = lathe(nm, [(rr - bw * 0.6, zb - 0.002), (rr - bw * 0.6, zb + bar_h * 0.8), (rr + bw * 0.6, zb + bar_h * 0.8), (rr + bw * 0.6, zb - 0.002)], gold, 96)
    parts.append(ring)
meander = join(parts, 'meander')

# rivets along the rim
riv = []
for i in range(24):
    a = i / 24 * math.tau
    riv.append(ellipsoid('r%d' % i, (math.cos(a) * R * 0.95, math.sin(a) * R * 0.95, -0.005), (0.006, 0.006, 0.004), bronze_dark, subdiv=1))
rivets = join(riv, 'rivets')

# boar emblem: side view of a charging boar, built from flattened lobes, standing proud of the bowl
boar_parts = []
zc = depth + 0.004
def lobe(name, x, y, sx, sy, sz=0.010, rot=0.0):
    o = ellipsoid(name, (x, y, zc), (sx, sy, sz), gold, rot=(0, 0, rot))
    boar_parts.append(o)
    return o
lobe('body', -0.015, 0.0, 0.105, 0.058, 0.012, 0.08)
lobe('shoulder', 0.045, 0.012, 0.055, 0.052, 0.013, -0.1)
lobe('haunch', -0.085, -0.004, 0.05, 0.048, 0.012, 0.15)
lobe('neck', 0.08, -0.005, 0.04, 0.04, 0.011, -0.3)
lobe('head', 0.112, -0.012, 0.046, 0.036, 0.011, -0.45)
lobe('snout', 0.152, -0.034, 0.026, 0.015, 0.008, -0.55)
lobe('ear', 0.1, 0.038, 0.016, 0.022, 0.006, 0.5)
# bristle crest along the back
for k in range(9):
    t = k / 8
    x = -0.1 + t * 0.19
    y = 0.056 - 0.012 * abs(t - 0.5) * 2 + 0.004 * math.sin(t * 9)
    lobe('bristle%d' % k, x, y, 0.009, 0.017, 0.006, 0.4 - t * 0.5)
# legs (front stretched forward, back pushing)
lobe('legf1', 0.075, -0.058, 0.014, 0.042, 0.009, 0.5)
lobe('legf2', 0.045, -0.06, 0.011, 0.034, 0.008, -0.2)
lobe('legb1', -0.09, -0.06, 0.014, 0.042, 0.009, -0.4)
lobe('legb2', -0.112, -0.055, 0.011, 0.034, 0.008, 0.3)
# hooves
for x, y in ((0.085, -0.088), (0.04, -0.09), (-0.098, -0.09), (-0.125, -0.085)):
    lobe('hoof', x, y, 0.009, 0.007, 0.008)
# tusk (ivory)
ivory = mat('ivory', (0.92, 0.88, 0.76), 0.5, 0.0)
tusk = ellipsoid('tusk', (0.15, -0.006, zc), (0.013, 0.004, 0.004), ivory, rot=(0, 0, 0.9))
# eye as a dark bead
eye = ellipsoid('eye', (0.118, 0.012, zc + 0.009), (0.004, 0.004, 0.003), bronze_dark, subdiv=1)
boar = join(boar_parts, 'boar')
# fuse the lobes into one relief: voxel remesh, then smooth it into a cast-metal look
rm = boar.modifiers.new('remesh', 'REMESH')
rm.mode = 'VOXEL'
rm.voxel_size = 0.003
rm.use_smooth_shade = True
sm = boar.modifiers.new('smooth', 'SMOOTH')
sm.factor = 0.8
sm.iterations = 6
bpy.ops.object.select_all(action='DESELECT')
boar.select_set(True)
bpy.context.view_layer.objects.active = boar
bpy.ops.object.modifier_apply(modifier='remesh')
bpy.ops.object.modifier_apply(modifier='smooth')
# bring the relief down to a game-friendly count
dc = boar.modifiers.new('decimate', 'DECIMATE')
dc.ratio = min(1.0, 6000 / max(1, len(boar.data.polygons)))
bpy.ops.object.modifier_apply(modifier='decimate')
for p in boar.data.polygons:
    p.use_smooth = True
print('boar polys', len(boar.data.polygons))
# tail curl: a thin arc
tail = lathe('tail', [(0.016, 0), (0.016, 0.006)], gold, 16)
tail.location = (-0.135, 0.04, zc)
tail.scale = (1, 1, 1)

# inside: porpax (bronze arm band through the centre) and antilabe (cord near the rim)
porpax = lathe('porpax', [(0.05, -0.02), (0.05, 0.03), (0.056, 0.03), (0.056, -0.02)], bronze_dark, 24)
porpax.location = (0, 0, depth * 0.1 - 0.02)
porpax.rotation_euler = (math.pi / 2, 0, 0)
bm = bmesh.new()
bmesh.ops.create_cone(bm, cap_ends=True, segments=10, radius1=0.006, radius2=0.006, depth=0.2)
cordo = obj_from_bmesh('antilabe', bm, cord)
cordo.location = (-R * 0.68, 0, -0.01)
cordo.rotation_euler = (math.pi / 2, 0, 0)
for (x, nm) in ((-R * 0.68 - 0.0, 'cl1'),):
    pass
export(OUT + '/shield.glb')

# ====================================================================== sword
clear()
steel = mat('steel', (0.70, 0.69, 0.66), 0.28, 1.0)
gold = mat('gold', (0.95, 0.72, 0.25), 0.3, 1.0)
ivory = mat('ivory', (0.88, 0.82, 0.68), 0.55, 0.0)
bronze = mat('bronze', (0.62, 0.40, 0.17), 0.38, 1.0)

# blade: leaf outline, diamond section with a pronounced midrib
z0, z1 = 0.10, 0.56
outline = [(0.0, 0.012), (0.08, 0.022), (0.2, 0.034), (0.33, 0.032), (0.42, 0.018), (0.46, 0.0)]  # (t along blade, half width)
def half_w(t):
    for (ta, wa), (tb, wb) in zip(outline, outline[1:]):
        if ta <= t <= tb:
            u = (t - ta) / (tb - ta)
            u = u * u * (3 - 2 * u)
            return wa + (wb - wa) * u
    return 0.0
bm = bmesh.new()
M = 28
rings = []
for i in range(M + 1):
    t = (z1 - z0) * i / M
    hw = half_w(t)
    th = 0.0045 * (1 - (i / M) ** 2) + 0.0008  # midrib thickness
    if hw < 0.001:
        hw = 0.0008
    ring = [bm.verts.new((-hw, 0, z0 + t)), bm.verts.new((0, th, z0 + t)), bm.verts.new((hw, 0, z0 + t)), bm.verts.new((0, -th, z0 + t))]
    rings.append(ring)
for a, b in zip(rings, rings[1:]):
    for k in range(4):
        bm.faces.new((a[k], a[(k + 1) % 4], b[(k + 1) % 4], b[k]))
bm.faces.new(rings[0][::-1])
bm.normal_update()
blade = obj_from_bmesh('blade', bm, steel, smooth=False)
# cross guard: a flattened lens with slightly down-swept ends
guard = ellipsoid('guard', (0, 0, z0), (0.055, 0.012, 0.012), gold)
collar = lathe('collar', [(0.0, z0 - 0.01), (0.013, z0 - 0.01), (0.015, z0 - 0.002), (0.012, z0 + 0.004), (0.0, z0 + 0.004)], gold, 24)
# ribbed grip
grip_parts = [lathe('gripcore', [(0.0, 0.0), (0.011, 0.0), (0.012, 0.03), (0.0115, 0.06), (0.011, z0 - 0.01), (0.0, z0 - 0.01)], ivory, 20)]
for k in range(4):
    zz = 0.012 + k * 0.021
    grip_parts.append(lathe('rib%d' % k, [(0.011, zz - 0.0025), (0.0135, zz), (0.011, zz + 0.0025)], gold, 20))
grip = join(grip_parts, 'grip')
# pommel: three lobes
pom = [ellipsoid('pom0', (0, 0, -0.006), (0.019, 0.013, 0.012), bronze)]
for s in (-1, 1):
    pom.append(ellipsoid('pom%d' % s, (s * 0.012, 0, -0.012), (0.011, 0.01, 0.01), bronze))
pommel = join(pom, 'pommel')
export(OUT + '/sword.glb')
print('DONE')
