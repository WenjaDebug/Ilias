"""The palace and its tower for Odysseus, modelled in Blender (bpy 4.2) in WORLD coordinates.

    python citadel.py -- <outdir>   → palace_bldg.glb, tower_bldg.glb

Both models are placed at the world origin by the game (world/level.ts keeps the collision boxes, which follow
exactly the same numbers as below). World x → Blender x, world z → Blender −y, world y (up) → Blender z.

palace_bldg.glb  the palace: ashlar outer walls on a plinth course with pilasters, a moulded cornice and a
                 triglyph frieze; the door framed by half columns under a pediment, bronze-studded door leaves
                 standing open; the window with a stone frame; inside plaster walls with a red dado, a black
                 band and a painted top band, marble chequer floors, a timber-beamed ceiling; the captain's
                 kline (bed) and the low table for the key; the upper storey with lit windows, a tiled gable
                 roof with pediments, acroteria and a bronze sun disc; two corner towers with battlements and
                 fire bowls; red banners either side of the door.
tower_bldg.glb   the palace tower (x 90..102, z −58..−44.4): four floors with wide dog-leg marble stairs
                 (two 2.1 m flights and a landing per storey), balustrades round the stair well, plaster walls
                 with dado and painted bands, chequer floors, beamed ceilings, slit windows, string courses,
                 battlements; the big balcony on the west side on four piers with its balustrade.

Materials named tex_* are re-textured in the game with its PBR sets (sandstone, plaster, wood); UVs are
box-projected in metres / 4 so the textures run on across all pieces.
"""
import bpy, bmesh, math, random, sys
from mathutils import Vector, Matrix

OUT = sys.argv[sys.argv.index('--') + 1]
rnd = random.Random(7)

# ---------------------------------------------------------------- helpers

MATS = {}


def mat(name, color, rough=0.7, metal=0.0, emit=None):
    if name in MATS:
        return MATS[name]
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes['Principled BSDF']
    b.inputs['Base Color'].default_value = (*color, 1)
    b.inputs['Roughness'].default_value = rough
    b.inputs['Metallic'].default_value = metal
    if emit:
        b.inputs['Emission Color'].default_value = (*emit, 1)
        b.inputs['Emission Strength'].default_value = 1.0
    MATS[name] = m
    return m


class Layers:
    """one bmesh per material; everything is collected and turned into one object per material at the end"""

    def __init__(self):
        self.bms = {}

    def bm(self, m):
        if m not in self.bms:
            self.bms[m] = bmesh.new()
        return self.bms[m]

    def build(self, name):
        objs = []
        for m, bm in self.bms.items():
            bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
            uv = bm.loops.layers.uv.new('UVMap')
            for f in bm.faces:
                n = f.normal
                ax, ay, az = abs(n.x), abs(n.y), abs(n.z)
                for l in f.loops:
                    c = l.vert.co
                    if az >= ax and az >= ay:
                        u, v = c.x, c.y
                    elif ax >= ay:
                        u, v = c.y, c.z
                    else:
                        u, v = c.x, c.z
                    l[uv].uv = (u / 4.0, v / 4.0)
            me = bpy.data.meshes.new(name + '_' + MATS_NAME[m])
            bm.to_mesh(me)
            bm.free()
            o = bpy.data.objects.new(name + '_' + MATS_NAME[m], me)
            bpy.context.collection.objects.link(o)
            o.data.materials.append(m)
            objs.append(o)
        self.bms = {}
        return objs


MATS_NAME = {}


def M(name, color, rough=0.7, metal=0.0, emit=None):
    m = mat(name, color, rough, metal, emit)
    MATS_NAME[m] = name
    return m


def wbox(L, m, x0, x1, y0, y1, z0, z1):
    """axis-aligned box given in WORLD coordinates (x, y up, z)"""
    if x1 - x0 < 1e-4 or y1 - y0 < 1e-4 or z1 - z0 < 1e-4:
        return
    bm = L.bm(m)
    r = bmesh.ops.create_cube(bm, size=1.0)
    bmesh.ops.scale(bm, vec=(x1 - x0, z1 - z0, y1 - y0), verts=r['verts'])
    bmesh.ops.translate(bm, vec=((x0 + x1) / 2, -(z0 + z1) / 2, (y0 + y1) / 2), verts=r['verts'])


def wquad(L, m, pts):
    """a polygon from WORLD points (x, y, z)"""
    bm = L.bm(m)
    vs = [bm.verts.new((p[0], -p[2], p[1])) for p in pts]
    bm.faces.new(vs)


def wprism(L, m, pts2d, axis, a0, a1):
    """an extruded polygon: pts2d in the plane across `axis` ('x': (z, y) pairs, 'z': (x, y) pairs), from a0 to a1"""
    bm = L.bm(m)
    def P(p, a):
        if axis == 'z':
            return bm.verts.new((p[0], -a, p[1]))
        return bm.verts.new((a, -p[0], p[1]))
    f0 = [P(p, a0) for p in pts2d]
    f1 = [P(p, a1) for p in pts2d]
    bm.faces.new(f0)
    bm.faces.new(list(reversed(f1)))
    n = len(pts2d)
    for i in range(n):
        j = (i + 1) % n
        bm.faces.new((f0[i], f0[j], f1[j], f1[i]))


def wcyl(L, m, x, z, y0, y1, r0, r1, segs=16):
    bm = L.bm(m)
    r = bmesh.ops.create_cone(bm, cap_ends=True, segments=segs, radius1=r0, radius2=r1, depth=y1 - y0)
    bmesh.ops.translate(bm, vec=(x, -z, (y0 + y1) / 2), verts=r['verts'])


def wlathe(L, m, x, z, y, profile, segs=16):
    """profile: (r, h) pairs from the bottom, spun round the vertical through (x, y, z)"""
    bm = L.bm(m)
    rings = []
    for (r, h) in profile:
        rings.append([bm.verts.new((x + math.cos(k / segs * math.tau) * r, -z + math.sin(k / segs * math.tau) * r, y + h)) for k in range(segs)])
    for a, b in zip(rings, rings[1:]):
        for k in range(segs):
            bm.faces.new((a[k], a[(k + 1) % segs], b[(k + 1) % segs], b[k]))
    if profile[-1][0] > 0:
        bm.faces.new(rings[-1])


def export(path):
    bpy.ops.object.select_all(action='SELECT')
    bpy.ops.export_scene.gltf(filepath=path, export_format='GLB', export_apply=True, export_yup=True,
                              export_materials='EXPORT', export_normals=True, export_texcoords=True, use_selection=True)
    print('wrote', path, 'faces', sum(len(o.data.polygons) for o in bpy.data.objects if o.type == 'MESH'))


def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    MATS.clear()
    MATS_NAME.clear()


def materials():
    return dict(
        stone=M('tex_sandstone', (0.85, 0.72, 0.56), 0.9),
        stone2=M('tex_sandstone_dark', (0.66, 0.55, 0.42), 0.9),
        plaster=M('tex_plaster', (0.9, 0.82, 0.68), 0.9),
        ochre=M('paint_ochre', (0.36, 0.07, 0.035), 0.75),
        black=M('paint_black', (0.03, 0.025, 0.02), 0.7),
        blue=M('paint_blue', (0.05, 0.12, 0.2), 0.7),
        yellow=M('paint_yellow', (0.62, 0.42, 0.12), 0.7),
        marble=M('marble', (0.78, 0.74, 0.66), 0.35),
        marble2=M('marble_dark', (0.3, 0.17, 0.12), 0.35),
        marble3=M('marble_grey', (0.55, 0.52, 0.47), 0.4),
        wood=M('tex_wood', (0.45, 0.3, 0.18), 0.85),
        bronze=M('bronze', (0.55, 0.36, 0.14), 0.35, 1.0),
        tile=M('rooftile', (0.42, 0.15, 0.07), 0.8),
        cloth=M('cloth_red', (0.3, 0.025, 0.02), 0.9),
        gold=M('gold', (0.8, 0.55, 0.2), 0.3, 1.0),
        glow=M('window_glow', (0.06, 0.02, 0.01), 0.9, emit=(1.0, 0.42, 0.14)),
        dark=M('recess', (0.02, 0.015, 0.012), 1.0),
    )


# ---------------------------------------------------------------- shared pieces

def lining(L, k, axis, at, a0, a1, side, y0, y1, doors=()):
    """the inside finish of a wall face: plaster, a red dado with a black band, a painted top band.
    axis 'x': the face is the plane x = at spanning z a0..a1, the room lies on the `side` (+1/−1) of it;
    axis 'z': the plane z = at spanning x a0..a1. doors: (b0, b1, top) gaps along the face."""
    segs = [(a0, a1)]
    for (b0, b1, top) in doors:
        out = []
        for (s0, s1) in segs:
            if b1 <= s0 or b0 >= s1:
                out.append((s0, s1))
                continue
            if b0 > s0:
                out.append((s0, b0))
            if b1 < s1:
                out.append((b1, s1))
        segs = out
    layers = [  # (material, offset from wall, y from, y to)
        (k['plaster'], 0.02, y0, y1),
        (k['ochre'], 0.03, y0, y0 + 1.05),
        (k['black'], 0.035, y0 + 1.05, y0 + 1.15),
        (k['black'], 0.035, y1 - 0.75, y1 - 0.7),
        (k['black'], 0.035, y1 - 0.42, y1 - 0.37),
    ]
    for (s0, s1) in segs:
        for (m, off, ya, yb) in layers:
            if axis == 'x':
                x0, x1 = (at, at + off) if side > 0 else (at - off, at)
                wbox(L, m, x0, x1, ya, yb, s0, s1)
            else:
                z0, z1 = (at, at + off) if side > 0 else (at - off, at)
                wbox(L, m, s0, s1, ya, yb, z0, z1)
        # the painted top band: alternating blue and yellow tablets (a simple meander rhythm)
        n = max(1, int((s1 - s0) / 0.5))
        w = (s1 - s0) / n
        for i in range(n):
            m = k['blue'] if i % 2 == 0 else k['yellow']
            c0, c1 = s0 + i * w + 0.03, s0 + (i + 1) * w - 0.03
            if axis == 'x':
                x0, x1 = (at, at + 0.04) if side > 0 else (at - 0.04, at)
                wbox(L, m, x0, x1, y1 - 0.68, y1 - 0.44, c0, c1)
            else:
                z0, z1 = (at, at + 0.04) if side > 0 else (at - 0.04, at)
                wbox(L, m, c0, c1, y1 - 0.68, y1 - 0.44, z0, z1)
    # the band and the door gaps: plain stone door frames (jambs and lintel) proud of the plaster
    for (b0, b1, top) in doors:
        for c in (b0, b1):
            if axis == 'x':
                x0, x1 = (at, at + 0.06) if side > 0 else (at - 0.06, at)
                wbox(L, k['stone2'], x0, x1, y0, top + 0.25, c - 0.2 if c == b0 else c, c if c == b0 else c + 0.2)
            else:
                z0, z1 = (at, at + 0.06) if side > 0 else (at - 0.06, at)
                wbox(L, k['stone2'], c - 0.2 if c == b0 else c, c if c == b0 else c + 0.2, y0, top + 0.25, z0, z1)
        if axis == 'x':
            x0, x1 = (at, at + 0.06) if side > 0 else (at - 0.06, at)
            wbox(L, k['stone2'], x0, x1, top, top + 0.25, b0 - 0.2, b1 + 0.2)
        else:
            z0, z1 = (at, at + 0.06) if side > 0 else (at - 0.06, at)
            wbox(L, k['stone2'], b0 - 0.2, b1 + 0.2, top, top + 0.25, z0, z1)


def chequer(L, k, x0, x1, z0, z1, y, size=1.0, border=True):
    """a marble floor: light and dark squares inside a dark border band"""
    b = 0.3 if border else 0.0
    if border:
        wbox(L, k['marble2'], x0, x1, y - 0.02, y, z0, z0 + b)
        wbox(L, k['marble2'], x0, x1, y - 0.02, y, z1 - b, z1)
        wbox(L, k['marble2'], x0, x0 + b, y - 0.02, y, z0 + b, z1 - b)
        wbox(L, k['marble2'], x1 - b, x1, y - 0.02, y, z0 + b, z1 - b)
    nx = max(1, round((x1 - x0 - 2 * b) / size))
    nz = max(1, round((z1 - z0 - 2 * b) / size))
    sx = (x1 - x0 - 2 * b) / nx
    sz = (z1 - z0 - 2 * b) / nz
    for i in range(nx):
        for j in range(nz):
            m = k['marble'] if (i + j) % 2 == 0 else k['marble3']
            wbox(L, m, x0 + b + i * sx, x0 + b + (i + 1) * sx, y - 0.02, y, z0 + b + j * sz, z0 + b + (j + 1) * sz)


def beams(L, k, x0, x1, z0, z1, y, along='z', step=1.6):
    """a plaster ceiling at height y with timber beams"""
    wbox(L, k['plaster'], x0, x1, y, y + 0.03, z0, z1)
    if along == 'z':
        x = x0 + step / 2
        while x < x1 - 0.1:
            wbox(L, k['wood'], x - 0.12, x + 0.12, y - 0.28, y, z0, z1)
            x += step
    else:
        z = z0 + step / 2
        while z < z1 - 0.1:
            wbox(L, k['wood'], x0, x1, y - 0.28, y, z - 0.12, z + 0.12)
            z += step


def balustrade(L, k, axis, at, a0, a1, y_at, h=1.0, posts=True):
    """a marble balustrade along x (axis 'x': runs along x at z = at) or along z (at x = at); y_at(c) gives
    the floor under it at coordinate c (so it can follow a stair flight)"""
    n = max(1, int(abs(a1 - a0) / 0.28))
    for i in range(n + 1):
        c = a0 + (a1 - a0) * i / n
        y = y_at(c)
        # turned baluster: bulb low, neck high
        prof = [(0.07, 0.0), (0.07, 0.08), (0.05, 0.1), (0.075, 0.32), (0.06, 0.52), (0.035, 0.66), (0.05, h - 0.18), (0.07, h - 0.12), (0.0, h - 0.12)]
        if axis == 'x':
            wlathe(L, k['marble'], c, at, y + 0.08, prof, 10)
        else:
            wlathe(L, k['marble'], at, c, y + 0.08, prof, 10)
    # plinth and hand rail in short pieces that follow the floor
    m = max(1, int(abs(a1 - a0) / 0.5))
    for i in range(m):
        c0 = a0 + (a1 - a0) * i / m
        c1 = a0 + (a1 - a0) * (i + 1) / m
        ya, yb = y_at(c0), y_at(c1)
        lo, hi = min(c0, c1), max(c0, c1)
        if axis == 'x':
            wquad_rail(L, k, 'x', at, c0, c1, ya, yb, h)
        else:
            wquad_rail(L, k, 'z', at, c0, c1, ya, yb, h)
    if posts:
        for c in (a0, a1):
            y = y_at(c)
            if axis == 'x':
                wbox(L, k['marble'], c - 0.14, c + 0.14, y, y + h + 0.06, at - 0.14, at + 0.14)
            else:
                wbox(L, k['marble'], at - 0.14, at + 0.14, y, y + h + 0.06, c - 0.14, c + 0.14)


def wquad_rail(L, k, axis, at, c0, c1, ya, yb, h):
    """a sloping (or flat) plinth + hand rail segment between c0 and c1 (floor heights ya, yb)"""
    for (m, b0, b1, w) in ((k['marble'], 0.0, 0.09, 0.13), (k['marble'], h - 0.12, h, 0.16)):
        if axis == 'x':
            pts = [(c0, ya + b0), (c1, yb + b0), (c1, yb + b1), (c0, ya + b1)]
            wprism(L, m, pts, 'z', at - w / 2, at + w / 2)
        else:
            # across x: pts are (z, y) pairs
            pts = [(c0, ya + b0), (c1, yb + b0), (c1, yb + b1), (c0, ya + b1)]
            wprism(L, m, pts, 'x', at - w / 2, at + w / 2)


def cornice(L, k, x0, x1, z0, z1, y, out=0.35):
    """a moulded cornice round a rectangle at height y (three projecting courses)"""
    for (dy0, dy1, o) in ((0.0, 0.18, out * 0.35), (0.18, 0.32, out * 0.7), (0.32, 0.5, out)):
        wbox(L, k['stone2'], x0 - o, x1 + o, y + dy0, y + dy1, z0 - o, z1 + o)


def merlons(L, k, x0, x1, z0, z1, y, size=0.7, gap=0.55, h=0.9):
    for (a0, a1, fixed, axis) in ((x0, x1, z0, 'x'), (x0, x1, z1, 'x'), (z0, z1, x0, 'z'), (z0, z1, x1, 'z')):
        n = max(1, int((a1 - a0) / (size + gap)))
        step = (a1 - a0) / n
        for i in range(n):
            c = a0 + step * (i + 0.5)
            if axis == 'x':
                zz0, zz1 = (fixed, fixed + 0.5) if fixed == z0 else (fixed - 0.5, fixed)
                wbox(L, k['stone'], c - size / 2, c + size / 2, y, y + h, zz0, zz1)
                wbox(L, k['stone2'], c - size / 2 - 0.04, c + size / 2 + 0.04, y + h, y + h + 0.08, zz0 - 0.04, zz1 + 0.04)
            else:
                xx0, xx1 = (fixed, fixed + 0.5) if fixed == x0 else (fixed - 0.5, fixed)
                wbox(L, k['stone'], xx0, xx1, y, y + h, c - size / 2, c + size / 2)
                wbox(L, k['stone2'], xx0 - 0.04, xx1 + 0.04, y + h, y + h + 0.08, c - size / 2 - 0.04, c + size / 2 + 0.04)


def column(L, k, x, z, y0, h, r=0.36):
    """a fluted column with a moulded base and an Ionic-like capital"""
    wbox(L, k['marble'], x - 0.5, x + 0.5, y0, y0 + 0.16, z - 0.5, z + 0.5)
    wlathe(L, k['marble'], x, z, y0 + 0.16, [(r + 0.1, 0), (r + 0.1, 0.08), (r + 0.04, 0.12), (r + 0.06, 0.18), (r, 0.22), (0, 0.22)], 20)
    # flutes: a 20-sided shaft, tapering
    wlathe(L, k['marble'], x, z, y0 + 0.38, [(r, 0), (r * 0.86, h - 0.9), (0, h - 0.9)], 20)
    top = y0 + 0.38 + h - 0.9
    wlathe(L, k['marble'], x, z, top, [(r * 0.9, 0), (r * 1.05, 0.08), (r * 1.05, 0.14), (0, 0.14)], 20)
    # volutes either side and the abacus
    for s in (-1, 1):
        bm = L.bm(k['marble'])
        r_ = bmesh.ops.create_cone(bm, cap_ends=True, segments=14, radius1=0.13, radius2=0.13, depth=0.5)
        bmesh.ops.rotate(bm, verts=r_['verts'], cent=(0, 0, 0), matrix=Matrix.Rotation(math.pi / 2, 3, 'Y'))
        bmesh.ops.rotate(bm, verts=r_['verts'], cent=(0, 0, 0), matrix=Matrix.Rotation(math.pi / 2, 3, 'Z'))
        bmesh.ops.translate(bm, verts=r_['verts'], vec=(x + s * (r + 0.02), -z, top + 0.2))
    wbox(L, k['marble'], x - r - 0.2, x + r + 0.2, top + 0.3, top + 0.42, z - r - 0.15, z + r + 0.15)


# ================================================================ the palace
reset()
k = materials()
L = Layers()
PX0, PX1, PZ0, PZ1, PH, PT = 74, 98, -44, -16, 6.7, 0.8
S0, S1 = PZ1 - PT / 2, PZ1 + PT / 2
doorX, doorW = 86, 3.2
winX0, winX1 = 76.8, 78.4
TDX, TDW = 93.0, 1.6
CEIL = 4.2
FL = 0.05  # the floors sit clearly above the street plane (0), or the two flicker through each other

# --- outer walls (sandstone), same pieces as the collision boxes
def pw(x0, x1, z0, z1, y0=0, y1=PH, m=None):
    wbox(L, m or k['stone'], x0, x1, y0, y1, z0, z1)

pw(PX0 - PT / 2, winX0, S0, S1)
pw(winX0, winX1, S0, S1, 0, 1.0)
pw(winX0, winX1, S0, S1, 2.9, PH)
pw(winX1, doorX - doorW / 2, S0, S1)
pw(doorX - doorW / 2, doorX + doorW / 2, S0, S1, 4.0, PH)
pw(doorX + doorW / 2, PX1 + PT / 2, S0, S1)
pw(PX0 - PT / 2, TDX - TDW / 2, PZ0 - PT / 2, PZ0 + PT / 2)
pw(TDX + TDW / 2, PX1 + PT / 2, PZ0 - PT / 2, PZ0 + PT / 2)
pw(TDX - TDW / 2, TDX + TDW / 2, PZ0 - PT / 2, PZ0 + PT / 2, 3.0, PH)
pw(PX0 - PT / 2, PX0 + PT / 2, PZ0, PZ1)
pw(PX1 - PT / 2, PX1 + PT / 2, PZ0, PZ1)
# interior partitions (plaster cores) and the solid masses either side of the corridor
HZ0, CZ0 = -27, -37.5
pw(79.6, 80.4, HZ0, -22, 0, CEIL, k['plaster'])
pw(92.0, 92.8, HZ0, -21.6, 0, CEIL, k['plaster'])
pw(92.0, 92.8, -19.0, S0, 0, CEIL, k['plaster'])
pw(92.0, 92.8, -21.6, -19.0, 3.2, CEIL, k['plaster'])
pw(PX0, 84.6, CZ0, HZ0, 0, CEIL, k['plaster'])
pw(87.4, PX1, CZ0, HZ0, 0, CEIL, k['plaster'])
pw(PX0 - PT / 2, PX1 + PT / 2, PZ0 - PT / 2, PZ1 + PT / 2, CEIL + 0.03, PH - 0.02)  # the floor of the terrace / ceiling mass
# the corner towers (solid blocks, 4.2 m square, 14 m high)
for tx in (PX0 + 1.6, PX1 - 1.6):
    tz = PZ0 + 1.6
    wbox(L, k['stone'], tx - 2.1, tx + 2.1, 0, 14, tz - 2.1, tz + 2.1)
    cornice(L, k, tx - 2.1, tx + 2.1, tz - 2.1, tz + 2.1, 13.5, 0.25)
    merlons(L, k, tx - 2.35, tx + 2.35, tz - 2.35, tz + 2.35, 14.0, 0.6, 0.45, 0.9)
    # the fire bowl on a short stem (the game lights it)
    wlathe(L, k['bronze'], tx, tz, 14.0, [(0.25, 0), (0.12, 0.1), (0.12, 0.25), (0.75, 0.42), (0.85, 0.58), (0.8, 0.6), (0.0, 0.45)], 18)
    for y in (4.2, 9.0):
        wbox(L, k['stone2'], tx - 2.2, tx + 2.2, y, y + 0.22, tz - 2.2, tz + 2.2)

# --- exterior dressing: plinth course, string course at the ceiling, cornice and parapet at the top
for (x0, x1, z0, z1) in ((PX0 - PT / 2, PX1 + PT / 2, S0, S1), (PX0 - PT / 2, PX1 + PT / 2, PZ0 - PT / 2, PZ0 + PT / 2)):
    pass
def outer_band(y0, y1, o, m):
    # south (with the door and window gaps), north, west, east
    for (a, b) in ((PX0 - PT / 2 - o, winX0), (winX1, doorX - doorW / 2 - 0.55), (doorX + doorW / 2 + 0.55, PX1 + PT / 2 + o)):
        if y0 < 2.9 and y1 > 1.0 and a >= winX0 - 0.01 and b <= winX1 + 0.01:
            continue
        wbox(L, m, a, b, y0, y1, S1, S1 + o)
    wbox(L, m, PX0 - PT / 2 - o, PX1 + PT / 2 + o, y0, y1, PZ0 - PT / 2 - o, PZ0 - PT / 2)
    wbox(L, m, PX0 - PT / 2 - o, PX0 - PT / 2, y0, y1, PZ0 - PT / 2, PZ1 + PT / 2)
    wbox(L, m, PX1 + PT / 2, PX1 + PT / 2 + o, y0, y1, PZ0 - PT / 2, PZ1 + PT / 2)

outer_band(0, 0.6, 0.1, k['stone2'])          # plinth
outer_band(0.6, 0.68, 0.06, k['stone2'])
outer_band(4.2, 4.38, 0.07, k['stone2'])      # string course at the ceiling
# the frieze under the cornice on the front: triglyphs (dark, grooved) and plain metopes
y0, y1 = 5.55, 6.15
x = PX0 - PT / 2 + 0.2
while x < PX1 + PT / 2 - 0.6:
    wbox(L, k['stone2'], x, x + 0.45, y0, y1, S1, S1 + 0.06)
    for g in (0.12, 0.22, 0.32):
        wbox(L, k['black'], x + g - 0.02, x + g + 0.02, y0 + 0.06, y1 - 0.08, S1 + 0.06, S1 + 0.075)
    x += 1.2
outer_band(6.15, 6.35, 0.12, k['stone2'])
outer_band(6.35, 6.55, 0.24, k['stone2'])
outer_band(6.55, 6.7, 0.36, k['stone2'])
# parapet on the terrace edge with small acroteria at the corners
for (x0, x1, z0, z1) in ((PX0 - PT / 2, PX1 + PT / 2, S1 - 0.3, S1), (PX0 - PT / 2, PX0 - PT / 2 + 0.3, -31.0, S1), (PX1 + PT / 2 - 0.3, PX1 + PT / 2, -31.0, S1)):
    wbox(L, k['stone'], x0, x1, 6.7, 7.5, z0, z1)
    wbox(L, k['stone2'], x0 - 0.05, x1 + 0.05, 7.5, 7.6, z0 - 0.05, z1 + 0.05)
for xa in (PX0 - PT / 2 + 0.2, PX1 + PT / 2 - 0.2):
    wbox(L, k['stone2'], xa - 0.25, xa + 0.25, 7.6, 8.3, S1 - 0.3, S1)
    wlathe(L, k['gold'], xa, S1 - 0.15, 8.3, [(0.18, 0), (0.05, 0.25), (0.14, 0.4), (0.0, 0.55)], 12)
# pilasters along the front (between the openings) and the flanks
def pilaster_s(x):
    wbox(L, k['stone2'], x - 0.32, x + 0.32, 0.6, 5.55, S1, S1 + 0.12)
    wbox(L, k['stone2'], x - 0.4, x + 0.4, 5.3, 5.55, S1, S1 + 0.18)
    wbox(L, k['stone2'], x - 0.4, x + 0.4, 0.6, 0.85, S1, S1 + 0.18)
for x in (74.6, 80.4, 82.4, 89.6, 91.6, 94.6, 97.4):
    pilaster_s(x)
for z in (-19.5, -24.0, -28.5, -33.0, -37.5, -42.0):
    for (xw, s) in ((PX0 - PT / 2, -1), (PX1 + PT / 2, 1)):
        x0, x1 = (xw, xw + 0.12) if s > 0 else (xw - 0.12, xw)
        wbox(L, k['stone2'], x0, x1, 0.6, 5.55, z - 0.32, z + 0.32)
# the door: half columns, entablature and a pediment; bronze-studded oak leaves standing open inside
for xc in (doorX - doorW / 2 - 0.42, doorX + doorW / 2 + 0.42):
    wbox(L, k['marble'], xc - 0.45, xc + 0.45, 0, 0.2, S1 - 0.1, S1 + 0.45)
    wlathe(L, k['marble'], xc, S1 + 0.05, 0.2, [(0.36, 0), (0.36, 0.1), (0.3, 0.16), (0.3, 3.9), (0.36, 4.0), (0.4, 4.2), (0.0, 4.2)], 20)
wbox(L, k['marble'], doorX - doorW / 2 - 0.95, doorX + doorW / 2 + 0.95, 4.4, 4.75, S1, S1 + 0.5)
wbox(L, k['marble'], doorX - doorW / 2 - 1.05, doorX + doorW / 2 + 1.05, 4.75, 4.9, S1, S1 + 0.6)
pw_ = doorW / 2 + 1.05
wprism(L, k['marble'], [(doorX - pw_, 4.9), (doorX + pw_, 4.9), (doorX, 5.85)], 'z', S1, S1 + 0.55)
wprism(L, k['gold'], [(doorX - 0.45, 5.05), (doorX + 0.45, 5.05), (doorX, 5.5)], 'z', S1 + 0.55, S1 + 0.6)
for s in (-1, 1):
    hx = doorX + s * doorW / 2
    leaf_x0, leaf_x1 = (hx - 0.12, hx) if s > 0 else (hx, hx + 0.12)
    leaf_x0 += -s * 0.0
    x0, x1 = (hx - 0.14, hx - 0.02) if s > 0 else (hx + 0.02, hx + 0.14)
    wbox(L, k['wood'], x0, x1, FL, 3.95, S0 - 1.6, S0 - 0.05)
    for yy in (0.6, 2.0, 3.4):
        wbox(L, k['bronze'], x0 - 0.01, x1 + 0.01, yy, yy + 0.08, S0 - 1.58, S0 - 0.07)
    for yy in (0.35, 1.3, 2.7, 3.7):
        for zz in (-0.4, -0.8, -1.2):
            wbox(L, k['bronze'], x0 - 0.02, x1 + 0.02, yy, yy + 0.05, S0 + zz - 0.025, S0 + zz + 0.025)
# three marble steps up to the door
for st in range(3):
    w = doorW + 2 - st * 0.4
    zc = PZ1 - PT / 2 - 0.3 - st * 0.35
    wbox(L, k['marble'], doorX - w / 2, doorX + w / 2, 0, 0.12 * (st + 1), S1 + 0.0 + st * 0.35, S1 + 0.35 + st * 0.35)
# the window: a stone frame with a sill and a little cornice
wbox(L, k['stone2'], winX0 - 0.22, winX0, 0.9, 3.0, S1, S1 + 0.12)
wbox(L, k['stone2'], winX1, winX1 + 0.22, 0.9, 3.0, S1, S1 + 0.12)
wbox(L, k['stone2'], winX0 - 0.3, winX1 + 0.3, 0.88, 1.0, S1, S1 + 0.2)
wbox(L, k['stone2'], winX0 - 0.3, winX1 + 0.3, 2.9, 3.15, S1, S1 + 0.2)
# banners from the cornice either side of the door
for bx in (doorX - 3.6, doorX + 3.6):
    wbox(L, k['wood'], bx - 0.75, bx + 0.75, 5.0, 5.08, S1 + 0.08, S1 + 0.16)
    bm = L.bm(k['cloth'])
    cols, rows = 8, 6
    grid = []
    for j in range(rows + 1):
        row = []
        t = j / rows
        for i in range(cols + 1):
            u = i / cols
            x = bx - 0.6 + 1.2 * u
            y = 5.0 - 2.7 * t - (0.18 * (1 - abs(u * 2 - 1)) if j == rows else 0)
            z = S1 + 0.12 + 0.03 * math.sin(u * math.pi * 4) * (0.3 + t)
            row.append(bm.verts.new((x, -z, y)))
        grid.append(row)
    for j in range(rows):
        for i in range(cols):
            bm.faces.new((grid[j][i], grid[j][i + 1], grid[j + 1][i + 1], grid[j + 1][i]))
    wbox(L, k['gold'], bx - 0.6, bx + 0.6, 2.42, 2.52, S1 + 0.13, S1 + 0.19)
    wcyl(L, k['gold'], bx, S1 + 0.17, 3.6, 3.62, 0.25, 0.25, 16)

# --- interior
# floors: chequer in the hall, the corridor and the chamber; plain stone in the side rooms
chequer(L, k, 80.4, 92.0, HZ0, S0, FL)
chequer(L, k, 84.6, 87.4, CZ0, HZ0, FL, 0.93, False)
chequer(L, k, PX0 + PT / 2, PX1 - PT / 2, PZ0 + PT / 2, CZ0, FL, 1.0)
wbox(L, k['stone2'], PX0 + PT / 2, 79.6, 0, FL, HZ0, S0)
wbox(L, k['stone2'], 92.8, PX1 - PT / 2, 0, FL, HZ0, S0)
# wall linings per room
Y0, Y1 = FL, CEIL
# hall
lining(L, k, 'z', S0, 80.4, 92.0, -1, Y0, Y1, doors=((doorX - doorW / 2, doorX + doorW / 2, 4.0),))
lining(L, k, 'z', HZ0, 80.4, 92.0, 1, Y0, Y1, doors=((84.6, 87.4, 4.0),))
lining(L, k, 'x', 80.4, HZ0, -22, 1, Y0, Y1)
lining(L, k, 'x', 92.0, HZ0, S0, -1, Y0, Y1, doors=((-21.6, -19.0, 3.2),))
# store room
lining(L, k, 'z', S0, PX0 + PT / 2, 79.6, -1, Y0, Y1, doors=((winX0, winX1, 2.9),))
lining(L, k, 'z', HZ0, PX0 + PT / 2, 79.6, 1, Y0, Y1)
lining(L, k, 'x', PX0 + PT / 2, HZ0, S0, 1, Y0, Y1)
lining(L, k, 'x', 79.6, HZ0, -22, -1, Y0, Y1)
# guard room
lining(L, k, 'z', S0, 92.8, PX1 - PT / 2, -1, Y0, Y1)
lining(L, k, 'z', HZ0, 92.8, PX1 - PT / 2, 1, Y0, Y1)
lining(L, k, 'x', PX1 - PT / 2, HZ0, S0, -1, Y0, Y1)
lining(L, k, 'x', 92.8, HZ0, S0, 1, Y0, Y1, doors=((-21.6, -19.0, 3.2),))
# corridor
lining(L, k, 'x', 84.6, CZ0, HZ0, 1, Y0, Y1)
lining(L, k, 'x', 87.4, CZ0, HZ0, -1, Y0, Y1)
# chamber (the corner tower blocks stand in its corners)
lining(L, k, 'z', PZ0 + PT / 2, 77.7, 94.3, 1, Y0, Y1, doors=((TDX - TDW / 2, TDX + TDW / 2, 3.0),))
lining(L, k, 'z', CZ0, PX0 + PT / 2, PX1 - PT / 2, -1, Y0, Y1, doors=((84.6, 87.4, 4.0),))
lining(L, k, 'x', PX0 + PT / 2, -40.3, CZ0, 1, Y0, Y1)
lining(L, k, 'x', PX1 - PT / 2, -40.3, CZ0, -1, Y0, Y1)
lining(L, k, 'x', 77.7, PZ0 + PT / 2, -40.3, 1, Y0, Y1)
lining(L, k, 'x', 94.3, PZ0 + PT / 2, -40.3, -1, Y0, Y1)
lining(L, k, 'z', -40.3, PX0 + PT / 2, 77.7, -1, Y0, Y1)
lining(L, k, 'z', -40.3, 94.3, PX1 - PT / 2, -1, Y0, Y1)
# ceilings with beams
beams(L, k, 80.4, 92.0, HZ0, S0, CEIL - 0.03, 'z')
beams(L, k, PX0 + PT / 2, 79.6, HZ0, S0, CEIL - 0.03, 'x')
beams(L, k, 92.8, PX1 - PT / 2, HZ0, S0, CEIL - 0.03, 'x')
beams(L, k, 84.6, 87.4, CZ0, HZ0, CEIL - 0.03, 'x', 1.4)
beams(L, k, PX0 + PT / 2, PX1 - PT / 2, PZ0 + PT / 2, CZ0, CEIL - 0.03, 'z', 1.8)
# the captain's kline: a carved bed with turned legs, a mattress, a bolster and a red cover; the headrest at
# the west end (he lies with his head there)
bx, bz = 85.0, -41.8
for (lx, lz) in ((-1.05, -0.55), (1.05, -0.55), (-1.05, 0.55), (1.05, 0.55)):
    wlathe(L, k['wood'], bx + lx, bz + lz, FL, [(0.07, 0), (0.09, 0.06), (0.05, 0.12), (0.08, 0.22), (0.05, 0.3), (0.06, 0.34), (0.0, 0.34)], 10)
wbox(L, k['wood'], bx - 1.15, bx + 1.15, 0.34, 0.42, bz - 0.62, bz + 0.62)
wbox(L, k['gold'], bx - 1.16, bx + 1.16, 0.36, 0.39, bz + 0.6, bz + 0.63)
wbox(L, k['plaster'], bx - 1.08, bx + 1.08, 0.42, 0.55, bz - 0.56, bz + 0.56)
wbox(L, k['cloth'], bx - 0.55, bx + 1.1, 0.5, 0.58, bz - 0.6, bz + 0.6)
wlathe(L, k['plaster'], 0, 0, 0, [(0.0, 0)], 4) if False else None
bm = L.bm(k['plaster'])
r_ = bmesh.ops.create_cone(bm, cap_ends=True, segments=12, radius1=0.12, radius2=0.12, depth=1.0)
bmesh.ops.rotate(bm, verts=r_['verts'], cent=(0, 0, 0), matrix=Matrix.Rotation(math.pi / 2, 3, 'X'))
bmesh.ops.translate(bm, verts=r_['verts'], vec=(bx - 0.95, -bz, 0.66))
wprism(L, k['wood'], [(bz - 0.62, 0.42), (bz + 0.62, 0.42), (bz + 0.62, 0.85), (bz + 0.3, 1.0), (bz - 0.62, 0.95)], 'x', bx - 1.2, bx - 1.1)
# the low table for the key (top at 0.88 m) with lion-paw legs
tx_, tz_ = 88.2, -41.2
wbox(L, k['wood'], tx_ - 1.1, tx_ + 1.1, 0.8, 0.88, tz_ - 0.5, tz_ + 0.5)
wbox(L, k['gold'], tx_ - 1.11, tx_ + 1.11, 0.82, 0.85, tz_ - 0.51, tz_ + 0.51)
for (lx, lz) in ((-0.95, -0.38), (0.95, -0.38), (-0.95, 0.38), (0.95, 0.38)):
    wlathe(L, k['wood'], tx_ + lx, tz_ + lz, FL, [(0.1, 0), (0.08, 0.08), (0.05, 0.18), (0.06, 0.5), (0.045, 0.7), (0.08, 0.76), (0.0, 0.76)], 10)
# a rug with a border beside the bed
wbox(L, k['cloth'], 86.9, 89.5, FL, FL + 0.012, -41.5, -39.7)
wbox(L, k['yellow'], 87.05, 89.35, FL + 0.012, FL + 0.016, -41.35, -41.25)
wbox(L, k['yellow'], 87.05, 89.35, FL + 0.012, FL + 0.016, -39.95, -39.85)

# --- the upper storey over the back half, its lit windows, the gable roof with pediments
UX0, UX1, UZ0, UZ1 = PX0 + 0.4, PX1 - 0.4, -43.7, -30.9
wbox(L, k['stone'], UX0, UX1, PH, 11.5, UZ0, UZ1)
for (dy0, dy1, o) in ((11.5, 11.7, 0.15), (11.7, 11.9, 0.3), (11.9, 12.1, 0.45)):
    wbox(L, k['stone2'], UX0 - o, UX1 + o, dy0, dy1, UZ0 - o, UZ1 + o)
wbox(L, k['stone2'], UX0 - 0.08, UX1 + 0.08, PH, PH + 0.5, UZ0 - 0.08, UZ1 + 0.08)
for kk in range(5):
    x = PX0 + 4.2 + kk * 3.9
    wbox(L, k['glow'], x - 0.5, x + 0.5, 8.05, 9.95, UZ1, UZ1 + 0.02)
    wbox(L, k['stone2'], x - 0.7, x - 0.5, 7.9, 10.1, UZ1, UZ1 + 0.15)
    wbox(L, k['stone2'], x + 0.5, x + 0.7, 7.9, 10.1, UZ1, UZ1 + 0.15)
    wbox(L, k['stone2'], x - 0.8, x + 0.8, 10.1, 10.35, UZ1, UZ1 + 0.3)
    wbox(L, k['stone2'], x - 0.75, x + 0.75, 7.8, 7.95, UZ1, UZ1 + 0.25)
    # the same on the flanks: two windows each side
for zz in (-34.5, -40.0):
    for (xw, s) in ((UX0, -1), (UX1, 1)):
        x0, x1 = (xw, xw + 0.02) if s > 0 else (xw - 0.02, xw)
        wbox(L, k['glow'], x0, x1, 8.05, 9.95, zz - 0.5, zz + 0.5)
        x0, x1 = (xw, xw + 0.25) if s > 0 else (xw - 0.25, xw)
        wbox(L, k['stone2'], x0, x1, 10.1, 10.35, zz - 0.8, zz + 0.8)
# gable roof: ridge along z at x 86, eaves at the cornice
RY0, RY1 = 12.1, 15.1
EX0, EX1 = UX0 - 0.45, UX1 + 0.45
ridge = (EX0 + EX1) / 2
for (xe, s) in ((EX0, -1), (EX1, 1)):
    # the roof plane
    wprism(L, k['tile'], [(UZ0 - 0.5, 0), (UZ1 + 0.5, 0), (UZ1 + 0.5, 0.12), (UZ0 - 0.5, 0.12)], 'x', 0, 0) if False else None
    bm = L.bm(k['tile'])
    p = [(xe, RY0, UZ0 - 0.5), (ridge, RY1, UZ0 - 0.5), (ridge, RY1, UZ1 + 0.5), (xe, RY0, UZ1 + 0.5)]
    vs = [bm.verts.new((a, -c, b)) for (a, b, c) in p]
    vs2 = [bm.verts.new((a, -c, b - 0.15)) for (a, b, c) in p]
    bm.faces.new(vs)
    bm.faces.new(list(reversed(vs2)))
    for i in range(4):
        j = (i + 1) % 4
        bm.faces.new((vs[i], vs2[i], vs2[j], vs[j]))
    # cover tiles: rounded ribs down the slope
    z = UZ0 - 0.35
    while z < UZ1 + 0.4:
        bm2 = L.bm(k['tile'])
        n = 10
        for i in range(n):
            t0, t1 = i / n, (i + 1) / n
            xa, xb = xe + (ridge - xe) * t0, xe + (ridge - xe) * t1
            ya, yb = RY0 + (RY1 - RY0) * t0, RY0 + (RY1 - RY0) * t1
            r = bmesh.ops.create_cone(bm2, cap_ends=True, segments=6, radius1=0.08, radius2=0.075, depth=math.hypot(xb - xa, yb - ya) * 1.02)
            ang = math.atan2(yb - ya, (xb - xa))
            bmesh.ops.rotate(bm2, verts=r['verts'], cent=(0, 0, 0), matrix=Matrix.Rotation(math.pi / 2, 3, 'Y'))
            bmesh.ops.rotate(bm2, verts=r['verts'], cent=(0, 0, 0), matrix=Matrix.Rotation(-ang if s < 0 else ang, 3, 'Y') if False else Matrix.Rotation(-ang, 3, 'Y'))
            bmesh.ops.translate(bm2, verts=r['verts'], vec=((xa + xb) / 2, -z, (ya + yb) / 2 + 0.03))
        z += 0.42
# ridge tiles and the two pediments (front and back) with raking cornices, a sun disc and acroteria
wbox(L, k['tile'], ridge - 0.18, ridge + 0.18, RY1 - 0.05, RY1 + 0.15, UZ0 - 0.55, UZ1 + 0.55)
for (zf, s) in ((UZ1 + 0.45, 1), (UZ0 - 0.45, -1)):
    za, zb = (zf - 1.2, zf) if s > 0 else (zf, zf + 1.2)
    wprism(L, k['stone'], [(EX0 + 0.2, RY0), (EX1 - 0.2, RY0), (ridge, RY1 - 0.1)], 'z', za, zb)
    for (x_a, x_b) in ((EX0 - 0.1, ridge), (ridge, EX1 + 0.1)):
        ya = RY0 if x_a < ridge - 0.01 else RY1 + 0.05
        yb = RY1 + 0.05 if x_a < ridge - 0.01 else RY0
        zz0, zz1 = (zf, zf + 0.25) if s > 0 else (zf - 0.25, zf)
        bm = L.bm(k['stone2'])
        p = [(x_a, ya), (x_b, yb), (x_b, yb + 0.3), (x_a, ya + 0.3)]
        f0 = [bm.verts.new((a, -zz0, b)) for (a, b) in p]
        f1 = [bm.verts.new((a, -zz1, b)) for (a, b) in p]
        bm.faces.new(f0)
        bm.faces.new(list(reversed(f1)))
        for i in range(4):
            j = (i + 1) % 4
            bm.faces.new((f0[i], f0[j], f1[j], f1[i]))
    if s > 0:
        # the bronze sun disc with rays in the tympanum
        bm = L.bm(k['bronze'])
        r = bmesh.ops.create_cone(bm, cap_ends=True, segments=24, radius1=0.9, radius2=0.9, depth=0.12)
        bmesh.ops.rotate(bm, verts=r['verts'], cent=(0, 0, 0), matrix=Matrix.Rotation(math.pi / 2, 3, 'X'))
        bmesh.ops.translate(bm, verts=r['verts'], vec=(ridge, -(zf + 0.05), 13.15))
        for i in range(12):
            a = i / 12 * math.tau
            wbox(L, k['gold'], ridge + math.cos(a) * 1.1 - 0.06, ridge + math.cos(a) * 1.1 + 0.06, 13.15 + math.sin(a) * 1.1 - 0.06, 13.15 + math.sin(a) * 1.1 + 0.06, zf + 0.02, zf + 0.08) if 13.15 + math.sin(a) * 1.1 > RY0 + 0.15 else None
    for (xa, ya) in ((ridge, RY1 + 0.3), (EX0 + 0.1, RY0 + 0.3), (EX1 - 0.1, RY0 + 0.3)):
        wlathe(L, k['gold'], xa, zf, ya, [(0.22, 0), (0.08, 0.2), (0.25, 0.45), (0.12, 0.7), (0.0, 0.8)], 12)

objs = L.build('palace')
export(OUT + '/palace_bldg.glb')

# ================================================================ the tower
reset()
k = materials()
L = Layers()
TX0, TX1, TZ0, TZ1, TT = 90.0, 102.0, -58.0, -44.4, 0.5
IX0, IX1, IZ0, IZ1 = TX0 + TT, TX1 - TT, TZ0 + TT, TZ1 - TT   # inside faces
F = [0.0, 4.5, 9.0, 13.5]
TROOF = 18.0
SLAB = 0.3
# the stair well (east side): flight A (x 99.4..101.5) up north from z −49.5 to −54, the landing to the north wall,
# flight B (x 97.2..99.3) back south up to the next floor; a spine wall between the flights
WX0, WSP0, WSP1, WX1 = 97.2, 99.3, 99.4, IX1
SZF, SZL = -49.5, -54.0       # foot / landing edge of the flights
BAL0, BAL1 = -52.4, -47.6      # balcony doorway in the west wall (top floor)
STEPS = 11


def tw(x0, x1, z0, z1, y0, y1):
    wbox(L, k['stone'], x0, x1, y0, y1, z0, z1)

# walls
tw(TX0, TDX - TDW / 2, TZ1 - TT, TZ1, 0, TROOF)
tw(TDX + TDW / 2, TX1, TZ1 - TT, TZ1, 0, TROOF)
tw(TDX - TDW / 2, TDX + TDW / 2, TZ1 - TT, TZ1, 3.0, TROOF)
tw(TX1 - TT, TX1, TZ0, TZ1, 0, TROOF)
tw(TX0, TX1, TZ0, TZ0 + TT, 0, TROOF)
tw(TX0, TX0 + TT, TZ0, BAL0, 0, TROOF)
tw(TX0, TX0 + TT, BAL1, TZ1, 0, TROOF)
tw(TX0, TX0 + TT, BAL0, BAL1, 0, F[3])
tw(TX0, TX0 + TT, BAL0, BAL1, F[3] + 3.6, TROOF)
# exterior: plinth, string courses at the floors, cornice and battlements on top
for (y0, y1, o) in ((0, 0.7, 0.12), (4.5, 4.72, 0.08), (9.0, 9.22, 0.08), (13.5, 13.72, 0.08), (17.4, 17.6, 0.15), (17.6, 17.8, 0.3), (17.8, 18.0, 0.45)):
    wbox(L, k['stone2'], TX0 - o, TX1 + o, y0, y1, TZ0 - o, TZ0)
    wbox(L, k['stone2'], TX1, TX1 + o, y0, y1, TZ0 - o, TZ1 + o)
    if y0 < 13.4 or y0 > 17:
        wbox(L, k['stone2'], TX0 - o, TX0, y0, y1, TZ0 - o, TZ1 + o)
    else:
        wbox(L, k['stone2'], TX0 - o, TX0, y0, y1, TZ0 - o, BAL0 - 0.3)
        wbox(L, k['stone2'], TX0 - o, TX0, y0, y1, BAL1 + 0.3, TZ1 + o)
    if TX1 > 98.4:
        wbox(L, k['stone2'], 98.4, TX1 + o, y0, y1, TZ1, TZ1 + o)
wbox(L, k['stone'], TX0, TX1, TROOF, TROOF + 0.3, TZ0, TZ1)
merlons(L, k, TX0 - 0.2, TX1 + 0.2, TZ0 - 0.2, TZ1 + 0.2, TROOF + 0.3, 0.7, 0.5, 0.95)
# slit windows with frames and a warm glow (east and north faces, every floor)
for fy in F[:3] + [F[3]]:
    for zc in (-55.5, -51.0, -46.5):
        wbox(L, k['glow'], TX1, TX1 + 0.02, fy + 1.6, fy + 3.2, zc - 0.22, zc + 0.22)
        wbox(L, k['stone2'], TX1, TX1 + 0.14, fy + 1.45, fy + 1.6, zc - 0.45, zc + 0.45)
        wbox(L, k['stone2'], TX1, TX1 + 0.14, fy + 3.2, fy + 3.4, zc - 0.45, zc + 0.45)
    for xc in (93.0, 96.0, 99.0):
        wbox(L, k['glow'], xc - 0.22, xc + 0.22, fy + 1.6, fy + 3.2, TZ0 - 0.02, TZ0)
        wbox(L, k['stone2'], xc - 0.45, xc + 0.45, fy + 1.45, fy + 1.6, TZ0 - 0.14, TZ0)
        wbox(L, k['stone2'], xc - 0.45, xc + 0.45, fy + 3.2, fy + 3.4, TZ0 - 0.14, TZ0)
# the tower door from the palace: a stone frame on the tower side
wbox(L, k['stone2'], TDX - TDW / 2 - 0.25, TDX - TDW / 2, 0, 3.25, IZ1 - 0.08, IZ1)
wbox(L, k['stone2'], TDX + TDW / 2, TDX + TDW / 2 + 0.25, 0, 3.25, IZ1 - 0.08, IZ1)
wbox(L, k['stone2'], TDX - TDW / 2 - 0.25, TDX + TDW / 2 + 0.25, 3.0, 3.3, IZ1 - 0.1, IZ1)

# floors (slabs with the stair well hole) and chequer marble on top
for i, fy in enumerate(F):
    if i > 0:
        wbox(L, k['stone2'], IX0, WX0, fy - SLAB, fy - 0.02, IZ0, IZ1)
        wbox(L, k['stone2'], WX0, IX1, fy - SLAB, fy - 0.02, SZF, IZ1)
    lift = 0.05 if i == 0 else 0.0   # the ground floor clear of the street plane (no flicker)
    if i == 0:
        wbox(L, k['stone2'], IX0, IX1, 0.0, 0.03, IZ0, IZ1)
    chequer(L, k, IX0, WX0, IZ0, IZ1, fy + lift, 1.0)
    chequer(L, k, WX0, IX1, SZF, IZ1, fy + lift, 1.06, False)
    if i == 0:
        # the ground under the stair core
        wbox(L, k['stone2'], WX0, IX1, 0, 0.05, IZ0, SZF)

# wall linings and beamed ceilings on every floor
for i, fy in enumerate(F):
    top = (F[i + 1] - SLAB) if i < 3 else TROOF - 0.02
    lining(L, k, 'x', IX0, IZ0, IZ1, 1, fy, min(top, fy + 4.2), doors=((BAL0, BAL1, fy + 3.6),) if i == 3 else ())
    lining(L, k, 'x', IX1, IZ0, IZ1, -1, fy, min(top, fy + 4.2))
    lining(L, k, 'z', IZ0, IX0, IX1, 1, fy, min(top, fy + 4.2))
    lining(L, k, 'z', IZ1, IX0, IX1, -1, fy, min(top, fy + 4.2), doors=((TDX - TDW / 2, TDX + TDW / 2, 3.0),) if i == 0 else ())
    if i < 3:
        beams(L, k, IX0, WX0, IZ0, IZ1, top - 0.03, 'x', 1.8)
        beams(L, k, WX0, IX1, SZF, IZ1, top - 0.03, 'x', 1.8)
    else:
        # the hall: a coffered ceiling over the whole room, open over the stair well too
        beams(L, k, IX0, IX1, IZ0, IZ1, TROOF - 0.05, 'x', 1.6)
        beams(L, k, IX0, IX1, IZ0, IZ1, TROOF - 0.05, 'z', 1.6)


def A_y(z, base):
    """flight A rises north: base at z = SZF, base + 2.25 at z = SZL"""
    t = (SZF - z) / (SZF - SZL)
    return base + 2.25 * max(0.0, min(1.0, t))


def B_y(z, base):
    """flight B rises south: base + 2.25 at z = SZL, base + 4.5 at z = SZF"""
    t = (z - SZL) / (SZF - SZL)
    return base + 2.25 + 2.25 * max(0.0, min(1.0, t))


def flight(x0, x1, z_lo, z_hi, y_lo, y_hi, solid_to):
    """a straight flight of marble steps from (z_lo, y_lo) to (z_hi, y_hi) (z_lo may be > z_hi); each step a solid
    tread with a nosing; below: masonry down to `solid_to` (ground floor) or a sloped soffit 0.4 thick"""
    run = (z_hi - z_lo) / STEPS
    rise = (y_hi - y_lo) / STEPS
    for s in range(STEPS):
        za, zb = z_lo + run * s, z_lo + run * (s + 1)
        ztop = y_lo + rise * (s + 1)
        zz0, zz1 = min(za, zb), max(za, zb)
        bottom = solid_to if solid_to is not None else ztop - 0.45
        wbox(L, k['marble3'], x0, x1, bottom, ztop - 0.05, zz0, zz1)
        # tread with a nosing that overhangs the riser below
        nose = 0.04 if zb > za else -0.04
        n0, n1 = (min(zz0, zz0 - nose), max(zz1, zz1)) if zb > za else (min(zz0, zz0), max(zz1, zz1 - nose))
        wbox(L, k['marble'], x0 - 0.01, x1 + 0.01, ztop - 0.05, ztop, n0, n1)
    if solid_to is None:
        # sloped soffit under the flight, plastered
        bm = L.bm(k['plaster'])
        p = [(z_lo, y_lo - 0.45), (z_hi, y_hi - 0.45), (z_hi, y_hi - 0.5), (z_lo, y_lo - 0.5)]
        f0 = [bm.verts.new((x0, -a, b)) for (a, b) in p]
        f1 = [bm.verts.new((x1, -a, b)) for (a, b) in p]
        bm.faces.new(f0)
        bm.faces.new(list(reversed(f1)))
        for i in range(4):
            j = (i + 1) % 4
            bm.faces.new((f0[i], f0[j], f1[j], f1[i]))


for i in range(3):
    base = F[i]
    ground = 0.0 if i == 0 else None
    # flight A along the east wall
    flight(WSP1, WX1, SZF, SZL, base, base + 2.25, ground)
    # the landing across the well at the north wall
    lb = 0.0 if i == 0 else base + 2.25 - 0.4
    wbox(L, k['marble3'], WX0, WX1, lb, base + 2.2, IZ0, SZL)
    chequer(L, k, WX0, WX1, IZ0, SZL, base + 2.25, 0.9, True)
    # flight B back south to the floor above
    flight(WX0, WSP0, SZL, SZF, base + 2.25, base + 4.5, ground)
    # the spine wall between the flights: from A's steps up to 1 m over B's, capped with a marble rail
    n = 9
    for s in range(n):
        za, zb = SZL + (SZF - SZL) * s / n, SZL + (SZF - SZL) * (s + 1) / n
        bot = 0.0 if i == 0 else A_y(zb, base) - 0.45
        topv = B_y(zb, base) + 1.0
        wbox(L, k['plaster'], WSP0, WSP1, bot, topv, za, zb)
        wbox(L, k['marble'], WSP0 - 0.05, WSP1 + 0.05, topv, topv + 0.08, za, zb)
    for (zz, s_) in ((SZF, 1),):
        wbox(L, k['marble'], WSP0 - 0.12, WSP1 + 0.12, A_y(zz, base), B_y(zz, base) + 1.2, zz - 0.12, zz + 0.12)
    # balustrade on B's open (west) side and along the landing's west edge
    balustrade(L, k, 'z', WX0 + 0.07, SZL, SZF, lambda c, b=base: B_y(c, b))
    balustrade(L, k, 'z', WX0 + 0.07, IZ0, SZL, lambda c, b=base: b + 2.25, posts=False)
    if i == 0:
        # the masonry under B and the landing on the ground floor faces the room: dressed stone with a dado
        wbox(L, k['stone2'], WX0 - 0.02, WX0, 0, 0.7, IZ0, SZF)
# rails round the well on the upper floors: along its west edge, and on the top floor also over flight A's foot
for i in (1, 2, 3):
    fy = F[i]
    balustrade(L, k, 'z', WX0 - 0.1, IZ0, SZF, lambda c, y=fy: y)
    if i == 3:
        balustrade(L, k, 'x', SZF + 0.08, WSP1, WX1, lambda c, y=fy: y)

# --- the balcony on the west side: a marble floor on four piers, a balustrade round three sides
BX0, BX1, BZ0, BZ1 = 84.4, TX0, -56.6, -45.4
wbox(L, k['stone2'], BX0, BX1, F[3] - 0.45, F[3] - 0.02, BZ0, BZ1)
chequer(L, k, BX0, BX1, BZ0, BZ1, F[3], 1.0)
wbox(L, k['stone2'], BX0 - 0.15, BX1, F[3] - 0.6, F[3] - 0.45, BZ0 - 0.15, BZ1 + 0.15)
for (px, pz) in ((85.0, -56.0), (85.0, -46.0), (87.6, -56.0), (87.6, -46.0)):
    wbox(L, k['stone'], px - 0.45, px + 0.45, 0, F[3] - 0.6, pz - 0.45, pz + 0.45)
    wbox(L, k['stone2'], px - 0.6, px + 0.6, 0, 0.6, pz - 0.6, pz + 0.6)
    wbox(L, k['stone2'], px - 0.6, px + 0.6, F[3] - 1.1, F[3] - 0.6, pz - 0.6, pz + 0.6)
    for y in (4.5, 9.0):
        wbox(L, k['stone2'], px - 0.52, px + 0.52, y, y + 0.2, pz - 0.52, pz + 0.52)
# beams under the balcony between the piers and into the tower wall
for pz in (-56.0, -46.0):
    wbox(L, k['stone2'], 84.6, TX0, F[3] - 1.1, F[3] - 0.6, pz - 0.35, pz + 0.35)
wbox(L, k['stone2'], 84.55, 85.45, F[3] - 1.1, F[3] - 0.6, -56.0, -46.0)
balustrade(L, k, 'z', BX0 + 0.2, BZ0 + 0.2, BZ1 - 0.2, lambda c: F[3])
balustrade(L, k, 'x', BZ0 + 0.2, BX0 + 0.2, BX1, lambda c: F[3])
balustrade(L, k, 'x', BZ1 - 0.2, BX0 + 0.2, BX1, lambda c: F[3])
# the balcony doorway: a marble frame with half columns
for zc in (BAL0 - 0.3, BAL1 + 0.3):
    wlathe(L, k['marble'], TX0 - 0.05, zc, F[3], [(0.3, 0), (0.3, 0.1), (0.24, 0.16), (0.22, 3.4), (0.3, 3.5), (0.0, 3.5)], 16)
wbox(L, k['marble'], TX0 - 0.35, TX0 + 0.05, F[3] + 3.5, F[3] + 3.9, BAL0 - 0.7, BAL1 + 0.7)

objs = L.build('tower')
export(OUT + '/tower_bldg.glb')
print('done')
