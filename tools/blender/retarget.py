"""Retarget a Mixamo FBX clip onto the Meshy-rigged Odysseus skeleton and export it as a tiny GLB
(animation only, bone names of models/odysseus.glb).

    python retarget.py -- <odysseus.glb> <clip.fbx> <out.glb> <clipName>

Method: for every mapped bone the source's world-space rotation delta against its rest pose is
applied to the target's rest pose, after first aligning the target's rest bone direction with the
source's (so an A-pose rig follows a T-pose clip without the arms hanging low). Rotations only;
the hips keep the position the game's locomotion gives them.
"""
import bpy, sys
from mathutils import Matrix, Vector, Quaternion

args = sys.argv[sys.argv.index('--') + 1:]
tgt_path, src_path, out_path, clip_name = args

RENAME = {'Spine1': 'Spine01', 'Spine2': 'Spine02', 'Neck': 'neck'}
BONES = ['Hips', 'Spine', 'Spine01', 'Spine02', 'neck', 'Head', 'LeftShoulder', 'LeftArm', 'LeftForeArm', 'LeftHand',
         'RightShoulder', 'RightArm', 'RightForeArm', 'RightHand', 'LeftUpLeg', 'LeftLeg', 'LeftFoot', 'LeftToeBase',
         'RightUpLeg', 'RightLeg', 'RightFoot', 'RightToeBase']

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=tgt_path)
tgt = next(o for o in bpy.data.objects if o.type == 'ARMATURE')
tgt.name = 'Odysseus'
for o in [o for o in bpy.data.objects if o.type != 'ARMATURE']:
    bpy.data.objects.remove(o, do_unlink=True)
if tgt.animation_data:
    tgt.animation_data_clear()

bpy.ops.import_scene.fbx(filepath=src_path, ignore_leaf_bones=True, automatic_bone_orientation=False)
src = next(o for o in bpy.data.objects if o.type == 'ARMATURE' and o is not tgt)
for o in [o for o in bpy.data.objects if o.type == 'MESH']:
    bpy.data.objects.remove(o, do_unlink=True)
for b in src.data.bones:
    n = b.name.split(':', 1)[-1]
    b.name = RENAME.get(n, n)
src_act = src.animation_data.action
f0, f1 = int(src_act.frame_range[0]), int(src_act.frame_range[1])

scene = bpy.context.scene
scene.frame_start, scene.frame_end = f0, f1
scene.render.fps = 30

Y = Vector((0, 1, 0))
tw = tgt.matrix_world
sw = src.matrix_world
order = [b.name for b in tgt.data.bones if b.name in BONES and b.name in src.data.bones]
# parents first
def depth(n):
    b = tgt.data.bones[n]; d = 0
    while b.parent:
        b = b.parent; d += 1
    return d
order.sort(key=depth)

rest_s = {n: (sw @ src.data.bones[n].matrix_local).to_3x3() for n in order}
# hips height: the vertical hip motion of the clip (crouching, jumping) is carried over, scaled by leg length
hips_rest_s = (sw @ src.data.bones['Hips'].matrix_local).translation
hips_rest_t = (tw @ tgt.data.bones['Hips'].matrix_local).translation
hip_ratio = hips_rest_t.z / max(1e-6, hips_rest_s.z)
rest_t = {n: (tw @ tgt.data.bones[n].matrix_local).to_3x3() for n in order}
align = {}
for n in order:
    ds = (rest_s[n] @ Y).normalized()
    dt = (rest_t[n] @ Y).normalized()
    align[n] = dt.rotation_difference(ds).to_matrix()

act = bpy.data.actions.new(clip_name)
tgt.animation_data_create()
tgt.animation_data.action = act
for n in order:
    tgt.pose.bones[n].rotation_mode = 'QUATERNION'

for f in range(f0, f1 + 1):
    scene.frame_set(f)
    for n in order:
        ps = src.pose.bones[n]
        ws = (sw @ ps.matrix).to_3x3()
        delta = ws @ rest_s[n].inverted()
        wt = delta @ align[n] @ rest_t[n]
        pt = tgt.pose.bones[n]
        m = (tw.to_3x3().inverted() @ wt).to_4x4()
        if n == 'Hips':
            dz = ((sw @ ps.matrix).translation.z - hips_rest_s.z) * hip_ratio
            world = Vector((hips_rest_t.x, hips_rest_t.y, hips_rest_t.z + dz))
            m.translation = (tw.inverted() @ world)
        else:
            m.translation = pt.matrix.translation
        pt.matrix = m
        bpy.context.view_layer.update()
        pt.keyframe_insert('rotation_quaternion', frame=f)
        if n == 'Hips':
            pt.keyframe_insert('location', frame=f)

bpy.data.objects.remove(src, do_unlink=True)
bpy.data.actions.remove(src_act)  # otherwise the exporter writes the source clip too
bpy.ops.object.select_all(action='DESELECT')
tgt.select_set(True)
bpy.context.view_layer.objects.active = tgt
bpy.ops.export_scene.gltf(filepath=out_path, export_format='GLB', export_animations=True, export_skins=False,
                          export_materials='NONE', export_yup=True, export_apply=False, use_selection=True,
                          export_force_sampling=True, export_frame_range=True, export_anim_single_armature=True,
                          export_optimize_animation_size=True)
print('DONE', clip_name, f0, f1)
