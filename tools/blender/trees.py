"""Trees for Odysseus, grown in Blender (bpy 4.2) with an own recursive branching generator.

    python trees.py -- <outdir>      → cypress.glb (≈7 m tall), olive.glb (≈4.5 m tall, ≈6 m wide)

Branches are real tubes (rings bridged along a slightly wandering axis, tapering toward the tips,
bark jittered with 3D noise). The olive forks three to four times into a wide crown; every twig end
carries a cluster of small lanceolate leaves (opaque two-sided quads, so no textures are needed).
The cypress is a straight trunk with steep side branches wrapped in dense, slightly irregular
foliage lobes that follow a tall flame-shaped envelope. Material names ('olive', 'olivebark',
'cypress', 'cypressbark') are what world/props.ts expects. Blender Z-up; export_yup turns it into glTF Y-up.
"""
import bpy, bmesh, random, math, sys
from mathutils import Vector, Matrix, noise

OUT = sys.argv[sys.argv.index('--') + 1]
bpy.ops.wm.read_factory_settings(use_empty=True)

def mat(name, color, rough=0.9, two_sided=False):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    bsdf = m.node_tree.nodes['Principled BSDF']
    bsdf.inputs['Base Color'].default_value = (*color, 1)
    bsdf.inputs['Roughness'].default_value = rough
    bsdf.inputs['Metallic'].default_value = 0.0
    m.use_backface_culling = not two_sided
    return m

def frame(d):
    """two unit vectors perpendicular to direction d"""
    d = d.normalized()
    a = Vector((0, 0, 1)) if abs(d.z) < 0.9 else Vector((1, 0, 0))
    u = d.cross(a).normalized()
    v = d.cross(u).normalized()
    return u, v

class Wood:
    """collects branch tubes in one bmesh"""
    def __init__(self, sides=7, bark_noise=0.08):
        self.bm = bmesh.new()
        self.sides = sides
        self.bark_noise = bark_noise
        self.tips = []      # (position, direction, radius) of twig ends → leaves
        self.nodes = []     # (position, radius) along branches → cypress foliage

    def ring(self, p, d, r):
        u, v = frame(d)
        verts = []
        for k in range(self.sides):
            a = k / self.sides * math.tau
            q = p + (u * math.cos(a) + v * math.sin(a)) * r
            # bark relief: bumps scale with the radius so twigs stay smooth
            n = noise.noise(q * 6.0) * self.bark_noise * r + noise.noise(q * 1.7) * self.bark_noise * 0.6 * r
            q = q + (q - p).normalized() * n
            verts.append(self.bm.verts.new(q))
        return verts

    def bridge(self, r0, r1):
        n = self.sides
        for k in range(n):
            self.bm.faces.new((r0[k], r0[(k + 1) % n], r1[(k + 1) % n], r1[k]))

    def branch(self, p, d, length, r0, r1, segs, wander, up, gravity, depth, spec, rnd):
        """grow one branch from p along d; spawns children according to spec[depth]"""
        d = d.normalized()
        prev = self.ring(p, d, r0)
        pts = [(p.copy(), d.copy(), r0)]
        for i in range(1, segs + 1):
            t = i / segs
            # the axis wanders a little, tends up (phototropism) and sags under its weight
            d = (d + Vector((rnd.uniform(-1, 1), rnd.uniform(-1, 1), rnd.uniform(-1, 1))) * wander
                 + Vector((0, 0, 1)) * up - Vector((0, 0, 1)) * gravity * t).normalized()
            p = p + d * (length / segs)
            r = r0 + (r1 - r0) * t
            ring = self.ring(p, d, r)
            self.bridge(prev, ring)
            prev = ring
            pts.append((p.copy(), d.copy(), r))
            self.nodes.append((p.copy(), r))
        self.bm.faces.new(prev[::-1])  # cap
        if depth + 1 < len(spec):
            s = spec[depth + 1]
            # children along the upper part of the branch and a fan at the end
            count = rnd.randint(*s['count'])
            for c in range(count):
                along = rnd.uniform(*s['along'])
                idx = min(len(pts) - 1, int(along * segs))
                bp, bd, br = pts[idx]
                u, v = frame(bd)
                az = rnd.uniform(0, math.tau)
                ang = rnd.uniform(*s['angle'])
                cd = (bd * math.cos(ang) + (u * math.cos(az) + v * math.sin(az)) * math.sin(ang)).normalized()
                cr0 = br * rnd.uniform(*s['radius'])
                clen = length * rnd.uniform(*s['length'])
                self.branch(bp, cd, clen, cr0, cr0 * s['taper'], s['segs'], s['wander'], s['up'], s['gravity'], depth + 1, spec, rnd)
        else:
            self.tips.append((p.copy(), d.copy(), r1))

    def to_object(self, name, material):
        me = bpy.data.meshes.new(name)
        self.bm.to_mesh(me)
        o = bpy.data.objects.new(name, me)
        bpy.context.collection.objects.link(o)
        o.data.materials.append(material)
        for f in me.polygons: f.use_smooth = True
        return o

def leaves(name, tips, material, rnd, per_tip=(18, 30), size=(0.09, 0.14), spread=0.32, droop=0.35, width=0.42):
    """lanceolate leaf quads clustered around twig ends"""
    bm = bmesh.new()
    for (p, d, r) in tips:
        n = rnd.randint(*per_tip)
        for i in range(n):
            c = p + d * rnd.uniform(-0.15, 0.25) + Vector((rnd.uniform(-1, 1), rnd.uniform(-1, 1), rnd.uniform(-0.6, 0.6))) * spread
            L = rnd.uniform(*size)
            ax = Vector((rnd.uniform(-1, 1), rnd.uniform(-1, 1), rnd.uniform(-droop, 0.4))).normalized()
            side = ax.cross(Vector((rnd.uniform(-1, 1), rnd.uniform(-1, 1), rnd.uniform(-1, 1)))).normalized()
            a = bm.verts.new(c)
            b = bm.verts.new(c + ax * L * 0.5 + side * L * width * 0.5)
            t = bm.verts.new(c + ax * L)
            e = bm.verts.new(c + ax * L * 0.5 - side * L * width * 0.5)
            bm.faces.new((a, b, t, e))
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    o = bpy.data.objects.new(name, me)
    bpy.context.collection.objects.link(o)
    o.data.materials.append(material)
    return o

def lobes(name, items, material, rnd):
    """cypress foliage: irregular ellipsoid lobes (icosphere level 1, noise-jittered) at (pos, dir, scale)"""
    # build per lobe so vertices can be transformed individually
    bm = bmesh.new()
    for (p, d, s) in items:
        tmp = bmesh.new()
        bmesh.ops.create_icosphere(tmp, subdivisions=2, radius=1.0)
        rot = d.to_track_quat('Z', 'Y').to_matrix().to_4x4()
        for v in tmp.verts:
            q = Vector((v.co.x * s.x, v.co.y * s.y, v.co.z * s.z))
            q = q * (1 + noise.noise(q * 3.1 + p) * 0.22)
            v.co = rot @ q + p
        tmp.to_mesh(me_tmp := bpy.data.meshes.new('tmp'))
        bm.from_mesh(me_tmp)
        bpy.data.meshes.remove(me_tmp)
        tmp.free()
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    o = bpy.data.objects.new(name, me)
    bpy.context.collection.objects.link(o)
    o.data.materials.append(material)
    for f in me.polygons: f.use_smooth = True
    return o

def export(path):
    bpy.ops.object.select_all(action='SELECT')
    bpy.ops.export_scene.gltf(filepath=path, export_format='GLB', export_apply=True, export_yup=True,
                              export_materials='EXPORT', export_normals=True, export_texcoords=False, use_selection=True)
    print('wrote', path, 'tris', sum(len(o.data.polygons) for o in bpy.data.objects if o.type == 'MESH'))

def clear_scene():
    for o in list(bpy.data.objects): bpy.data.objects.remove(o, do_unlink=True)
    for m in list(bpy.data.meshes): bpy.data.meshes.remove(m)

# ---------------- olive: short, gnarled, forking trunk; wide silver-green crown ----------------
rnd = random.Random(11)
bark = mat('olivebark', (0.33, 0.27, 0.20), 0.95)
leaf = mat('olive', (0.32, 0.43, 0.24), 0.85, two_sided=True)
w = Wood(sides=8, bark_noise=0.35)
olive_spec = [
    None,  # trunk (grown explicitly below)
    dict(count=(3, 4), along=(0.75, 1.0), angle=(0.45, 0.95), radius=(0.55, 0.7), length=(0.9, 1.3), taper=0.55, segs=5, wander=0.22, up=0.08, gravity=0.0),
    dict(count=(3, 4), along=(0.4, 1.0), angle=(0.4, 0.9), radius=(0.5, 0.7), length=(0.7, 1.0), taper=0.5, segs=4, wander=0.3, up=0.05, gravity=0.04),
    dict(count=(2, 4), along=(0.3, 1.0), angle=(0.4, 1.0), radius=(0.45, 0.65), length=(0.6, 0.9), taper=0.4, segs=3, wander=0.35, up=0.02, gravity=0.08),
    dict(count=(2, 3), along=(0.3, 1.0), angle=(0.4, 1.1), radius=(0.4, 0.6), length=(0.6, 0.9), taper=0.35, segs=2, wander=0.4, up=0.0, gravity=0.12),
]
# the trunk: thick, leaning, twisted – two short stems rising from a swollen base
base = Vector((0, 0, -0.05))
w.branch(base, Vector((0.06, 0.03, 1)), 1.6, 0.34, 0.24, 6, 0.12, 0.12, 0.0, 0, olive_spec, rnd)
w.branch(base + Vector((0.18, -0.1, 0.3)), Vector((0.3, -0.25, 1)), 1.2, 0.2, 0.13, 4, 0.15, 0.15, 0.0, 0, olive_spec, rnd)
trunk_o = w.to_object('olive_wood', bark)
# root flare: a squat ring of knuckles at the base
bm = bmesh.new()
for k in range(7):
    a = k / 7 * math.tau + rnd.uniform(-0.2, 0.2)
    tmp = bmesh.new()
    bmesh.ops.create_icosphere(tmp, subdivisions=1, radius=1.0)
    for v in tmp.verts:
        q = Vector((v.co.x * 0.16, v.co.y * 0.12, v.co.z * 0.14))
        q = Matrix.Rotation(a, 4, 'Z') @ q
        v.co = q + Vector((math.cos(a) * 0.3, math.sin(a) * 0.3, 0.02))
    tmp.to_mesh(me_tmp := bpy.data.meshes.new('tmp')); bm.from_mesh(me_tmp); bpy.data.meshes.remove(me_tmp); tmp.free()
me = bpy.data.meshes.new('olive_roots'); bm.to_mesh(me)
roots = bpy.data.objects.new('olive_roots', me); bpy.context.collection.objects.link(roots); roots.data.materials.append(bark)
for f in me.polygons: f.use_smooth = True
leaves('olive_leaves', w.tips, leaf, rnd, per_tip=(70, 95), size=(0.13, 0.21), spread=0.42, droop=0.5, width=0.3)
print('olive tips', len(w.tips))
export(OUT + '/olive.glb')
clear_scene()

# ---------------- cypress: built like the olive – real branches and twigs, every tip a cluster of
# small scale-leaf sprays – in a tall flame-shaped column; a dark inner core keeps it from looking
# see-through at a distance ----------------
rnd = random.Random(5)
cbark = mat('cypressbark', (0.26, 0.20, 0.15), 0.95)
needle = mat('cypress', (0.17, 0.26, 0.13), 0.9, two_sided=True)
core = mat('cypress_core', (0.035, 0.06, 0.03), 1.0)
H = 7.0
def envelope(z):
    """crown radius at height z (0..H): narrow foot, widest at a third, tapering to a point"""
    t = max(0.0, min(1.0, (z - 0.3) / (H - 0.3)))
    return 0.95 * math.sin(math.pi * t ** 0.75) ** 0.8 * (1 - 0.35 * t) + 0.05
w = Wood(sides=7, bark_noise=0.25)
# trunk, then steep side branches that fork twice; their length follows the envelope
w.branch(Vector((0, 0, -0.05)), Vector((0, 0, 1)), H * 0.95, 0.17, 0.025, 12, 0.012, 0.0, 0.0, 0, [None], rnd)
trunk_tips = []
z = 0.5
while z < H - 0.25:
    r = envelope(z)
    for k in range(rnd.randint(3, 4)):
        a = rnd.uniform(0, math.tau)
        d = Vector((math.cos(a), math.sin(a), rnd.uniform(1.4, 2.4))).normalized()
        L = r * rnd.uniform(1.0, 1.35) / max(0.3, math.hypot(d.x, d.y))
        L = min(L, r * 2.6 + 0.2)
        rad = 0.012 + 0.035 * r
        spec = [None,
                dict(count=(2, 3), along=(0.35, 1.0), angle=(0.35, 0.8), radius=(0.55, 0.75), length=(0.35, 0.55), taper=0.45, segs=2, wander=0.25, up=0.12, gravity=0.0),
                dict(count=(2, 3), along=(0.4, 1.0), angle=(0.4, 0.9), radius=(0.5, 0.7), length=(0.45, 0.7), taper=0.4, segs=2, wander=0.3, up=0.1, gravity=0.02)]
        w.branch(Vector((0, 0, z)), d, L * 0.55, rad, rad * 0.5, 3, 0.1, 0.18, 0.0, 0, spec, rnd)
    z += 0.32
w.to_object('cypress_wood', cbark)

# sprays: flat fans of scale leaves (three overlapping lanceolate quads) at the twig tips and, to close
# the column, scattered over the whole envelope surface, pointing outward and up like real cypress
bm = bmesh.new()
def spray(c, out_dir, L):
    up = Vector((0, 0, 1))
    ax0 = (out_dir * 0.55 + up * 0.85 + Vector((rnd.uniform(-1, 1), rnd.uniform(-1, 1), rnd.uniform(-0.3, 0.3))) * 0.35).normalized()
    for k in range(3):
        ax = (ax0 + Vector((rnd.uniform(-1, 1), rnd.uniform(-1, 1), rnd.uniform(-1, 1))) * 0.35).normalized()
        side = ax.cross(out_dir + Vector((rnd.uniform(-0.3, 0.3), rnd.uniform(-0.3, 0.3), 0))).normalized()
        if side.length < 0.1: side = frame(ax)[0]
        l = L * rnd.uniform(0.7, 1.15)
        wdt = l * rnd.uniform(0.32, 0.45)
        a = bm.verts.new(c)
        b = bm.verts.new(c + ax * l * 0.45 + side * wdt * 0.5)
        t = bm.verts.new(c + ax * l)
        e = bm.verts.new(c + ax * l * 0.45 - side * wdt * 0.5)
        bm.faces.new((a, b, t, e))
for (p, d, r) in w.tips:
    for i in range(rnd.randint(7, 11)):
        c = p + Vector((rnd.uniform(-1, 1), rnd.uniform(-1, 1), rnd.uniform(-1, 1))) * 0.14
        o = Vector((c.x, c.y, 0))
        o = o.normalized() if o.length > 1e-3 else Vector((1, 0, 0))
        spray(c, o, rnd.uniform(0.16, 0.26))
z = 0.35
while z < H:
    r = envelope(z)
    n = max(4, int(r * 62))
    for i in range(n):
        a = rnd.uniform(0, math.tau)
        rr = r * rnd.uniform(0.78, 1.04)
        c = Vector((math.cos(a) * rr, math.sin(a) * rr, z + rnd.uniform(-0.07, 0.07)))
        spray(c, Vector((math.cos(a), math.sin(a), 0)), rnd.uniform(0.15, 0.25) * (0.7 + 0.5 * min(1, r)))
    z += 0.11
# a pointed leader at the very top
for i in range(14):
    a = rnd.uniform(0, math.tau)
    spray(Vector((math.cos(a) * 0.05, math.sin(a) * 0.05, H - 0.3 + rnd.uniform(0, 0.25))), Vector((math.cos(a), math.sin(a), 0)), 0.22)
me = bpy.data.meshes.new('cypress_sprays'); bm.to_mesh(me)
so = bpy.data.objects.new('cypress_sprays', me); bpy.context.collection.objects.link(so); so.data.materials.append(needle)
print('cypress sprays', len(me.polygons), 'tips', len(w.tips))

# dark inner core (low-poly, irregular) a little inside the spray shell
items = []
z = 0.5
while z < H - 0.4:
    r = envelope(z)
    for i in range(max(2, int(r * 6))):
        a = rnd.uniform(0, math.tau)
        rr = r * rnd.uniform(0.0, 0.35)
        items.append((Vector((math.cos(a) * rr, math.sin(a) * rr, z)), Vector((0, 0, 1)), Vector((r * 0.5, r * 0.5, 0.42))))
    z += 0.3
lobes('cypress_core', items, core, rnd)
export(OUT + '/cypress.glb')
