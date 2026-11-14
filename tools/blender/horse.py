"""The wooden horse of Troy, built in Blender (bpy 4.2) from planks that follow lofted horse shapes.

    python horse.py -- <outdir>        → <outdir>/horse.glb

Coordinates are written in game space (x right, y up, z forward = the horse's nose) and converted to
Blender's Z-up on the way in; the GLB is exported Y-up, so the game sees the same numbers again.
The hatch, the rope and the colliders stay in src/world/horse.ts: the hull leaves the hatch opening
free (bottom of the belly, x ±0.62, z −0.4…1.2 — see createHorse).

Materials are plain colours named wood / darkwood / iron / bronze / rope; horse.ts swaps them for
the game's textured plank materials (UVs: u = metres / 2 along the grain, v = one of 8 plank rows).
"""
import bpy, bmesh, sys, math, random
from mathutils import Vector, Matrix

out_dir = sys.argv[sys.argv.index('--') + 1]
random.seed(7)
bpy.ops.wm.read_factory_settings(use_empty=True)

PLATFORM = 1.0
LEG_H = 4.4
BODY_Y = PLATFORM + LEG_H + 1.45  # 6.85, as in horse.ts


def G(x, y, z):
    """game space → Blender space"""
    return Vector((x, -z, y))


def mat(name, rgb, metallic=0.0, rough=0.8):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes['Principled BSDF']
    b.inputs['Base Color'].default_value = (*rgb, 1)
    b.inputs['Metallic'].default_value = metallic
    b.inputs['Roughness'].default_value = rough
    return m


MATS = {
    'wood': mat('wood', (0.45, 0.33, 0.22)),
    'darkwood': mat('darkwood', (0.26, 0.18, 0.12)),
    'iron': mat('iron', (0.12, 0.11, 0.10), 0.8, 0.5),
    'bronze': mat('bronze', (0.55, 0.38, 0.16), 0.9, 0.35),
    'rope': mat('rope', (0.55, 0.42, 0.26), 0.0, 0.95),
}

objects = []


def finish(bm, name, material, smooth_angle=None, bevel=None):
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    ob = bpy.data.objects.new(name, me)
    ob.data.materials.append(MATS[material])
    bpy.context.collection.objects.link(ob)
    if bevel:
        mod = ob.modifiers.new('bevel', 'BEVEL')
        mod.width = bevel
        mod.segments = 2
        mod.limit_method = 'ANGLE'
        mod.angle_limit = math.radians(40)
    if smooth_angle is not None:
        for p in me.polygons:
            p.use_smooth = True
        bpy.context.view_layer.objects.active = ob
        ob.select_set(True)
        bpy.ops.object.shade_smooth_by_angle(angle=math.radians(smooth_angle))
        ob.select_set(False)
    objects.append(ob)
    return ob


# ----------------------------------------------------------------------------------------------
# plank strips that follow a lofted shape
# ----------------------------------------------------------------------------------------------
def frame(points):
    """tangent / normal frames along a polyline of game-space points (parallel transport)"""
    n = len(points)
    tangents = []
    for i in range(n):
        a = points[max(0, i - 1)]
        b = points[min(n - 1, i + 1)]
        tangents.append((b - a).normalized())
    up = Vector((0, 1, 0))
    if abs(tangents[0].dot(up)) > 0.95:
        up = Vector((0, 0, 1))
    frames = []
    right = tangents[0].cross(up).normalized()
    for t in tangents:
        right = (right - t * right.dot(t)).normalized()
        upv = right.cross(t).normalized()
        frames.append((right, upv))
    return tangents, frames


def loft_planks(name, points, section, n_planks, thick=0.09, material='wood', gap=0.025,
                skip=None, phase=0.0, bevel=0.012, smooth=True, closed=True, arc=(0, 2 * math.pi)):
    """
    points: game-space centres along the part; section(t, angle) → (rx, ry) radii at parameter t∈[0,1].
    Each plank is a strip over an angular slice, thick inward. `skip(t, angle, point)` → True leaves
    the strip out there (hatch). arc limits the covered angle range (open troughs).
    """
    bm = bmesh.new()
    uv_layer = bm.loops.layers.uv.new('UVMap')
    tangents, frames = frame(points)
    m = len(points)
    a0_full, a1_full = arc
    span = (a1_full - a0_full) / n_planks
    for i in range(n_planks):
        a0 = a0_full + i * span + phase + gap / 2
        a1 = a0 + span - gap
        row = random.randrange(8)
        u_off = random.random() * 3
        seg_pts = []  # [(outer0, outer1, inner0, inner1)] per sample
        valid = []
        for j in range(m):
            t = j / (m - 1)
            rx, ry = section(t, (a0 + a1) / 2)
            c = points[j]
            r, u = frames[j]
            quad = []
            for a in (a0, a1):
                ox, oy = math.cos(a) * rx, math.sin(a) * ry
                # ellipse normal
                nx, ny = math.cos(a) / max(rx, 1e-3), math.sin(a) / max(ry, 1e-3)
                nl = math.hypot(nx, ny)
                nx, ny = nx / nl, ny / nl
                outer = c + r * ox + u * oy
                inner = outer - (r * nx + u * ny) * thick
                quad.append((outer, inner))
            seg_pts.append(quad)
            valid.append(not (skip and skip(t, (a0 + a1) / 2, c + r * math.cos((a0 + a1) / 2) * rx + u * math.sin((a0 + a1) / 2) * ry)))
        # split into runs of valid samples and build a closed strip for each
        j = 0
        while j < m:
            if not valid[j]:
                j += 1
                continue
            k = j
            while k + 1 < m and valid[k + 1]:
                k += 1
            if k > j:
                verts = []
                length = 0.0
                prev = None
                for s in range(j, k + 1):
                    q = seg_pts[s]
                    o0, i0 = q[0]
                    o1, i1 = q[1]
                    vs = [bm.verts.new(G(*o0)), bm.verts.new(G(*o1)), bm.verts.new(G(*i1)), bm.verts.new(G(*i0))]
                    mid = (o0 + o1) / 2
                    if prev is not None:
                        length += (mid - prev).length
                    prev = mid
                    verts.append((vs, length))
                faces = []
                for s in range(len(verts) - 1):
                    a, la = verts[s]
                    b, lb = verts[s + 1]
                    for f_idx in range(4):
                        g_idx = (f_idx + 1) % 4
                        f = bm.faces.new((a[f_idx], b[f_idx], b[g_idx], a[g_idx]))
                        faces.append((f, la, lb, f_idx))
                cap0 = bm.faces.new(tuple(reversed(verts[0][0])))
                cap1 = bm.faces.new(tuple(verts[-1][0]))
                # UVs: u along the plank, v inside one plank row
                for f, la, lb, side in faces:
                    for loop in f.loops:
                        s_idx = next(s for s in range(len(verts)) if loop.vert in verts[s][0])
                        u = verts[s_idx][1] / 2 + u_off
                        idx = verts[s_idx][0].index(loop.vert)
                        # outer / inner faces span the row, the plank's thin edges sit mid-row
                        across = 0.5 if side in (1, 3) else (0.0 if idx in (0, 3) else 1.0)
                        loop[uv_layer].uv = (u, row * 0.125 + 0.006 + across * 0.11)
                for cap in (cap0, cap1):
                    for loop in cap.loops:
                        loop[uv_layer].uv = (u_off, row * 0.125 + 0.05)
            j = k + 1
    bm.verts.ensure_lookup_table()
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return finish(bm, name, material, smooth_angle=35 if smooth else None, bevel=bevel)


def box(name, size, matrix, material='darkwood', bevel=0.02, uv_scale=1.0):
    """a beveled board; `matrix` is a Blender-space matrix applied to a unit box of `size` (game axes)"""
    bm = bmesh.new()
    uv_layer = bm.loops.layers.uv.new('UVMap')
    w, h, d = size
    bmesh.ops.create_cube(bm, size=1.0)
    bmesh.ops.scale(bm, vec=(w, d, h), verts=bm.verts)  # game (w,h,d) → Blender (x, y=-z, z=y)
    row = random.randrange(8)
    u_off = random.random() * 3
    # u along the longest axis
    dims = {0: w, 1: d, 2: h}
    long_axis = max(dims, key=dims.get)
    for f in bm.faces:
        for loop in f.loops:
            co = loop.vert.co
            axes = [k for k in range(3) if abs(f.normal[k]) < 0.5]
            a = long_axis if long_axis in axes else axes[0]
            b = [k for k in axes if k != a][0] if len(axes) > 1 else a
            u = co[a] / 2 * uv_scale + u_off
            v = (co[b] / max(dims[b], 1e-3) + 0.5) * 0.11 + 0.006 + row * 0.125
            loop[uv_layer].uv = (u, v)
    bmesh.ops.transform(bm, matrix=matrix, verts=bm.verts)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return finish(bm, name, material, bevel=bevel)


# change of basis game → Blender (columns are the game axes in Blender space)
C = Matrix(((1, 0, 0, 0), (0, 0, -1, 0), (0, 1, 0, 0), (0, 0, 0, 1)))
C_INV = C.inverted()


def place(x, y, z, rx=0, ry=0, rz=0):
    """Blender matrix for a game-space position and a game-space rotation (rx about X, ry about Y, rz about Z,
    applied z, x, y); primitives are built so that game Y is their axis / normal"""
    t = Matrix.Translation(G(x, y, z))
    r = Matrix.Rotation(ry, 4, 'Y') @ Matrix.Rotation(rx, 4, 'X') @ Matrix.Rotation(rz, 4, 'Z')
    return t @ C @ r @ C_INV


def torus(name, major, minor, matrix, material='iron', scale=(1, 1, 1), segments=48):
    bm = bmesh.new()  # ring in the game's XZ plane (normal Y); the first scale axis is game X, the second game Z
    verts_ring = []
    for i in range(segments):
        a = i / segments * 2 * math.pi
        ring = []
        for k in range(8):
            b = k / 8 * 2 * math.pi
            rr = major + math.cos(b) * minor
            ring.append(bm.verts.new((math.cos(a) * rr * scale[0], math.sin(a) * rr * scale[1], math.sin(b) * minor * scale[2])))
        verts_ring.append(ring)
    for i in range(segments):
        for k in range(8):
            a, b = verts_ring[i], verts_ring[(i + 1) % segments]
            bm.faces.new((a[k], b[k], b[(k + 1) % 8], a[(k + 1) % 8]))
    bmesh.ops.transform(bm, matrix=matrix, verts=bm.verts)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return finish(bm, name, material, smooth_angle=40, bevel=None)


def sphere(name, r, matrix, material='iron', seg=12):
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=seg, v_segments=seg // 2, radius=r)
    bmesh.ops.transform(bm, matrix=matrix, verts=bm.verts)
    return finish(bm, name, material, smooth_angle=60, bevel=None)


def cylinder(name, r0, r1, length, matrix, material='wood', seg=12):
    """along game +Y before `matrix` (a leg post, a spoke, a rope strand)"""
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, segments=seg, radius1=r0, radius2=r1, depth=length)
    # cone is along Blender Z = game Y already
    bmesh.ops.transform(bm, matrix=matrix, verts=bm.verts)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return finish(bm, name, material, smooth_angle=40, bevel=None)


def bezier(p0, p1, p2, p3, n):
    pts = []
    for i in range(n):
        t = i / (n - 1)
        pts.append(p0 * (1 - t) ** 3 + p1 * 3 * t * (1 - t) ** 2 + p2 * 3 * t * t * (1 - t) + p3 * t ** 3)
    return pts


# ----------------------------------------------------------------------------------------------
# the horse
# ----------------------------------------------------------------------------------------------
V = Vector

# --- torso: a deep barrel chest, slightly sagging belly, rounded rump, 26 planks ---------------
torso_pts = [V((0, BODY_Y - 0.08 * math.sin(math.pi * t) + 0.25 * (1 - t) ** 3 * 0, -3.9 + 7.8 * t)) for t in [i / 24 for i in range(25)]]


def torso_section(t, a):
    taper = 1 - 0.42 * abs(2 * t - 1) ** 3.2
    chest = 1 + 0.07 * max(0, t - 0.6) / 0.4  # the chest is a little deeper than the rump
    rx = 1.62 * taper * chest
    ry = 1.78 * taper * chest * (1.04 if math.sin(a) < 0 else 1.0)  # belly a touch deeper than the back
    return rx, ry


def hatch_skip(t, a, p):
    return p.y < BODY_Y - 1.2 and abs(p.x) < 0.75 and -0.55 < p.z < 1.35


loft_planks('torso', torso_pts, torso_section, 26, thick=0.1, skip=hatch_skip)
# inner hull (dark) so the gaps between planks don't show the sky
loft_planks('torso_inner', torso_pts, lambda t, a: tuple(v - 0.11 for v in torso_section(t, a)), 1, thick=0.05,
            material='darkwood', gap=0.0, skip=hatch_skip, bevel=None)
# hatch frame: a dark rim around the opening
for (x, z, w, d) in [(-0.7, 0.4, 0.12, 1.75), (0.7, 0.4, 0.12, 1.75), (0, -0.46, 1.5, 0.12), (0, 1.26, 1.5, 0.12)]:
    box('hatch_frame', (w, 0.14, d), place(x, BODY_Y - 1.74, z), 'darkwood')

# chest and rump caps: vertical boards clipped to the ellipse
for z_end, s in [(-3.86, -1), (3.86, 1)]:
    for i in range(-6, 7):
        x = i * 0.26
        hh = 2 * 1.02 * math.sqrt(max(0.0, 1 - (x / 0.98) ** 2))
        if hh < 0.25:
            continue
        box('cap', (0.27, hh, 0.12), place(x, BODY_Y, z_end), 'darkwood')
# iron bands with rivets
for z in [-3.1, -1.2, 1.0, 2.9]:
    t = (z + 3.9) / 7.8
    rx, ry = torso_section(t, 0)
    torus('band', 1.0, 0.045, place(0, BODY_Y, z, math.pi / 2), 'iron', scale=(rx + 0.04, ry + 0.04, 1))
    for k in range(18):
        a = k / 18 * 2 * math.pi
        if math.sin(a) < -0.9 and abs(math.cos(a)) < 0.3 and -0.6 < z < 1.3:
            continue
        sphere('rivet', 0.045, place(math.cos(a) * (rx + 0.06), BODY_Y + math.sin(a) * (ry + 0.06), z), 'iron', 8)

# --- neck: an arched neck rising from the withers, 16 planks ---------------------------------
neck_pts = bezier(V((0, BODY_Y + 0.9, 3.0)), V((0, BODY_Y + 2.4, 3.6)), V((0, BODY_Y + 3.6, 4.1)), V((0, BODY_Y + 4.1, 5.1)), 14)


def neck_section(t, a):
    k = 1 - 0.38 * t
    return 0.92 * k, 1.25 * k * (1.12 if math.sin(a) > 0 else 1.0)  # a crest on top


loft_planks('neck', neck_pts, neck_section, 16, thick=0.09)
loft_planks('neck_inner', neck_pts, lambda t, a: tuple(v - 0.1 for v in neck_section(t, a)), 1, thick=0.05, material='darkwood', gap=0, bevel=None)
# throat latch: a bronze band at the base of the neck and one below the head
for t_band in (0.12, 0.88):
    i = int(t_band * (len(neck_pts) - 1))
    p = neck_pts[i]
    nxt = neck_pts[min(i + 1, len(neck_pts) - 1)]
    pitch = math.atan2(nxt.y - p.y, nxt.z - p.z)
    rx, ry = neck_section(t_band, 0)
    torus('neckband', 1.0, 0.04, place(p.x, p.y, p.z, math.pi / 2 - pitch), 'bronze', scale=(rx + 0.03, ry + 0.03, 1))

# --- head: skull down-forward from the neck top, long muzzle, 12 planks -----------------------
head_pts = bezier(V((0, BODY_Y + 4.25, 4.9)), V((0, BODY_Y + 4.0, 5.9)), V((0, BODY_Y + 3.4, 6.5)), V((0, BODY_Y + 2.55, 7.25)), 10)


def head_section(t, a):
    k = 1 - 0.45 * t
    jaw = 1.15 if (math.sin(a) < -0.3 and t < 0.45) else 1.0  # a deep jaw at the back
    return 0.6 * k, 0.82 * k * jaw


loft_planks('head', head_pts, head_section, 12, thick=0.08)
loft_planks('head_inner', head_pts, lambda t, a: tuple(v - 0.09 for v in head_section(t, a)), 1, thick=0.05, material='darkwood', gap=0, bevel=None)
# muzzle cap and nostrils, brow plate
mz = head_pts[-1]
box('muzzle', (0.62, 0.86, 0.12), place(mz.x, mz.y, mz.z, 0.85), 'darkwood')
for x in (-0.16, 0.16):
    sphere('nostril', 0.07, place(x, mz.y + 0.1, mz.z + 0.02), 'iron', 8)
brow = head_pts[2]
box('brow', (0.9, 0.5, 0.06), place(0, brow.y + 0.66, brow.z - 0.05, -0.9), 'bronze', bevel=0.01)
# eyes: bronze rings with a dark iron pupil
eye = head_pts[2]
for x in (-0.62, 0.62):
    torus('eye_ring', 0.15, 0.03, place(x * 1.0, eye.y + 0.2, eye.z + 0.05, 0, 0, math.pi / 2), 'bronze', segments=24)
    sphere('eye', 0.12, place(x * 0.98, eye.y + 0.2, eye.z + 0.05), 'iron', 12)
# ears: two wedge boards
for x in (-0.36, 0.36):
    e = head_pts[1]
    box('ear', (0.2, 0.8, 0.12), place(x, e.y + 0.95, e.z - 0.15, -0.35, 0, -x * 0.5), 'darkwood')

# --- mane: upright split boards along the crest ------------------------------------------------
for i in range(11):
    t = 0.06 + 0.9 * i / 10
    idx = min(len(neck_pts) - 2, int(t * (len(neck_pts) - 1)))
    p = neck_pts[idx]
    nxt = neck_pts[idx + 1]
    pitch = math.atan2(nxt.y - p.y, nxt.z - p.z)
    rx, ry = neck_section(t, math.pi / 2)
    top = p + V((0, ry, 0))
    box('mane', (0.07, 0.75 + random.random() * 0.3, 0.42), place(top.x, top.y + 0.25, top.z, -pitch - 0.2 - random.random() * 0.15), 'darkwood')

# --- legs: lofted posts with a knee, hoof blocks and iron bands -------------------------------
for lx, lz, front in [(-1.05, 2.6, True), (1.05, 2.6, True), (-1.05, -2.7, False), (1.05, -2.7, False)]:
    knee_dz = 0.14 if front else -0.18
    pts = [V((lx, PLATFORM + 0.35, lz)), V((lx, PLATFORM + 1.3, lz + knee_dz * 0.6)), V((lx, PLATFORM + 2.0, lz + knee_dz)),
           V((lx, PLATFORM + 2.9, lz + knee_dz * 0.4)), V((lx * 1.02, PLATFORM + LEG_H + 0.9, lz * 0.97))]
    # resample smoothly
    smooth = []
    for i in range(13):
        t = i / 12
        f = t * (len(pts) - 1)
        k = min(len(pts) - 2, int(f))
        smooth.append(pts[k].lerp(pts[k + 1], f - k))

    def leg_section(t, a, front=front):
        r = 0.27 + 0.22 * max(0, t - 0.55) / 0.45 + 0.05 * math.exp(-((t - 0.38) / 0.08) ** 2)  # knee bulge, thigh widening
        return r, r * 1.08

    loft_planks('leg', smooth, leg_section, 8, thick=0.07, gap=0.02)
    loft_planks('leg_inner', smooth, lambda t, a: tuple(v - 0.08 for v in leg_section(t, a)), 1, thick=0.05, material='darkwood', gap=0, bevel=None)
    box('hoof', (0.8, 0.48, 0.9), place(lx, PLATFORM + 0.24, lz + 0.05), 'darkwood', bevel=0.04)
    torus('hoofband', 0.44, 0.03, place(lx, PLATFORM + 0.5, lz + 0.05), 'iron', segments=24)
    torus('kneeband', 0.33, 0.03, place(lx, PLATFORM + 2.0, lz + knee_dz), 'iron', segments=24)
    torus('thighband', 0.42, 0.03, place(lx, PLATFORM + 3.9, lz + knee_dz * 0.1), 'iron', segments=24)

# --- tail: a carved wooden tail, planks over a curved loft, swinging down and a little aside ------
tail_pts = bezier(V((0, BODY_Y + 0.55, -3.75)), V((0.1, BODY_Y + 0.4, -4.9)), V((0.25, BODY_Y - 1.0, -5.1)), V((0.35, BODY_Y - 2.3, -4.7)), 12)


def tail_section(t, a):
    r = 0.34 * (1 - 0.8 * t) + 0.04
    return r, r * 1.15


loft_planks('tail', tail_pts, tail_section, 8, thick=0.06, gap=0.02)
loft_planks('tail_inner', tail_pts, lambda t, a: tuple(v - 0.07 for v in tail_section(t, a)), 1, thick=0.04, material='darkwood', gap=0, bevel=None)
torus('tailband', 1.0, 0.03, place(tail_pts[1].x, tail_pts[1].y, tail_pts[1].z, math.pi / 2 + 0.3), 'bronze', scale=(0.36, 0.4, 1), segments=24)

# --- the sledge: beams, deck boards, spoked wheels --------------------------------------------
for i in range(11):
    box('deck', (4.6, 0.2, 0.92), place(0, PLATFORM - 0.1, -5 + i * 1.0), 'darkwood')
for x in (-2.1, 2.1):
    box('beam', (0.4, 0.6, 11.2), place(x, 0.55, 0), 'darkwood', bevel=0.03)
for z in (-3.8, 3.8):
    box('axle', (5.1, 0.18, 0.18), place(0, 0.62, z), 'iron', bevel=0.01)
for x in (-2.5, 2.5):
    for z in (-3.8, 3.8):
        torus('tyre', 0.6, 0.07, place(x, 0.62, z, 0, 0, math.pi / 2), 'iron', segments=40)
        torus('rim', 0.56, 0.06, place(x, 0.62, z, 0, 0, math.pi / 2), 'darkwood', segments=40)
        for k in range(8):
            a = k / 8 * math.pi
            cylinder('spoke', 0.035, 0.035, 1.1, place(x, 0.62, z, a), 'darkwood', 6)
        sphere('hub', 0.12, place(x + math.copysign(0.18, x), 0.62, z), 'iron', 10)

# ----------------------------------------------------------------------------------------------
# join per material and export
# ----------------------------------------------------------------------------------------------
bpy.ops.object.select_all(action='DESELECT')
for ob in objects:
    bpy.context.view_layer.objects.active = ob
    ob.select_set(True)
    for mod in list(ob.modifiers):
        bpy.ops.object.modifier_apply(modifier=mod.name)
    ob.select_set(False)
by_mat = {}
for ob in objects:
    by_mat.setdefault(ob.data.materials[0].name, []).append(ob)
joined = []
for name, obs in by_mat.items():
    bpy.ops.object.select_all(action='DESELECT')
    for ob in obs:
        ob.select_set(True)
    bpy.context.view_layer.objects.active = obs[0]
    bpy.ops.object.join()
    obs[0].name = name
    joined.append(obs[0])
bpy.ops.object.select_all(action='DESELECT')
for ob in joined:
    ob.select_set(True)
tri = sum(len(o.data.polygons) for o in joined)
bpy.ops.export_scene.gltf(filepath=f'{out_dir}/horse.glb', export_format='GLB', use_selection=True, export_apply=True,
                          export_yup=True, export_materials='EXPORT', export_image_format='NONE', export_animations=False)
print('DONE horse.glb polys', tri)
