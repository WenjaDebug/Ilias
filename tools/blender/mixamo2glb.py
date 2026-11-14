"""Convert a Mixamo FBX clip into a small GLB holding only the animation, with bone names
matching the Meshy-rigged Odysseus (models/odysseus.glb), so the clip can be played on him directly.

    python mixamo2glb.py -- <in.fbx> <out.glb> [clipName]
"""
import bpy, sys

args = sys.argv[sys.argv.index('--') + 1:]
src, dst = args[0], args[1]
clip = args[2] if len(args) > 2 else 'clip'

RENAME = {'Spine1': 'Spine01', 'Spine2': 'Spine02', 'Neck': 'neck'}

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.fbx(filepath=src, ignore_leaf_bones=True, automatic_bone_orientation=False)
arm = next(o for o in bpy.data.objects if o.type == 'ARMATURE')
# drop the Mixamo mannequin meshes: only the skeleton and its action are exported
for o in [o for o in bpy.data.objects if o.type != 'ARMATURE']:
    bpy.data.objects.remove(o, do_unlink=True)
for b in arm.data.bones:
    n = b.name.split(':', 1)[-1]
    b.name = RENAME.get(n, n)
act = arm.animation_data.action
act.name = clip
# keep only the bones the Odysseus rig has (fingers etc. would bloat the file)
KEEP = {'Hips', 'Spine', 'Spine01', 'Spine02', 'neck', 'Head', 'LeftShoulder', 'LeftArm', 'LeftForeArm', 'LeftHand',
        'RightShoulder', 'RightArm', 'RightForeArm', 'RightHand', 'LeftUpLeg', 'LeftLeg', 'LeftFoot', 'LeftToeBase',
        'RightUpLeg', 'RightLeg', 'RightFoot', 'RightToeBase'}
for fc in list(act.fcurves):
    if fc.data_path.startswith('pose.bones["'):
        bone = fc.data_path.split('"')[1]
        if bone not in KEEP:
            act.fcurves.remove(fc)
arm.name = 'Armature'
bpy.ops.object.select_all(action='SELECT')
bpy.ops.export_scene.gltf(filepath=dst, export_format='GLB', export_animations=True, export_skins=True,
                          export_materials='NONE', export_yup=True, export_apply=False, use_selection=True,
                          export_force_sampling=True, export_frame_range=False, export_anim_single_armature=True,
                          export_optimize_animation_size=True)
print('DONE', clip, act.frame_range[:])
