"""Render a quick preview of a GLB (bpy 4.2, Cycles CPU) to check an asset before it goes into the game.

    python preview.py -- <model.glb> <out.png> [azimuth_deg] [elevation_deg] [size_px] [samples]

The model is framed automatically; a warm key light and a cool fill, neutral grey floor.
"""
import bpy, math, sys
from mathutils import Vector

args = sys.argv[sys.argv.index('--') + 1:]
src, out = args[0], args[1]
az = float(args[2]) if len(args) > 2 else 35.0
el = float(args[3]) if len(args) > 3 else 18.0
size = int(args[4]) if len(args) > 4 else 640
samples = int(args[5]) if len(args) > 5 else 24

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=src)
objs = [o for o in bpy.data.objects if o.type == 'MESH']
lo = Vector((1e9, 1e9, 1e9)); hi = Vector((-1e9, -1e9, -1e9))
for o in objs:
    for c in o.bound_box:
        w = o.matrix_world @ Vector(c)
        lo = Vector(map(min, lo, w)); hi = Vector(map(max, hi, w))
center = (lo + hi) / 2
radius = max((hi - lo).length / 2, 0.1)
print('bounds', [round(v, 2) for v in lo], [round(v, 2) for v in hi])

scene = bpy.context.scene
scene.render.engine = 'CYCLES'
scene.cycles.samples = samples
scene.cycles.use_denoising = False
scene.cycles.device = 'CPU'
scene.render.resolution_x = size
scene.render.resolution_y = int(size * 0.75)
scene.render.film_transparent = False
world = bpy.data.worlds.new('w'); scene.world = world; world.use_nodes = True
bg = world.node_tree.nodes['Background']; bg.inputs[0].default_value = (0.18, 0.2, 0.24, 1); bg.inputs[1].default_value = 0.6

# floor
bpy.ops.mesh.primitive_plane_add(size=radius * 12, location=(center.x, center.y, lo.z))
floor = bpy.context.object
fm = bpy.data.materials.new('floor'); fm.use_nodes = True
fm.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = (0.3, 0.29, 0.27, 1)
floor.data.materials.append(fm)

def light(name, kind, loc, energy, color, sz=1.0):
    l = bpy.data.lights.new(name, kind); l.energy = energy; l.color = color
    if kind == 'AREA': l.size = sz
    o = bpy.data.objects.new(name, l); scene.collection.objects.link(o); o.location = loc
    d = center - Vector(loc); o.rotation_euler = d.to_track_quat('-Z', 'Y').to_euler()
    return o

light('key', 'AREA', center + Vector((radius * 3, -radius * 3, radius * 3)), 2500 * radius ** 2 / 4, (1.0, 0.85, 0.65), radius * 2)
light('fill', 'AREA', center + Vector((-radius * 4, -radius * 2, radius * 1.5)), 600 * radius ** 2 / 4, (0.7, 0.8, 1.0), radius * 3)
light('rim', 'AREA', center + Vector((0, radius * 4, radius * 2.5)), 900 * radius ** 2 / 4, (1.0, 0.9, 0.8), radius * 2)

cam = bpy.data.cameras.new('cam'); cam.lens = 45
co = bpy.data.objects.new('cam', cam); scene.collection.objects.link(co); scene.camera = co
a, e = math.radians(az), math.radians(el)
dist = radius * 2.6
co.location = center + Vector((math.sin(a) * math.cos(e) * dist, -math.cos(a) * math.cos(e) * dist, math.sin(e) * dist))
co.rotation_euler = (center - co.location).to_track_quat('-Z', 'Y').to_euler()
scene.render.filepath = out
bpy.ops.render.render(write_still=True)
print('rendered', out)
