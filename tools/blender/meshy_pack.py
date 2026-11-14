"""Pack a Meshy rigged character for the game.

    python meshy_pack.py -- <Character.glb> <out-model.glb> [<texSize>]      model + skin, textures shrunk
    python meshy_pack.py -- <Animation_withSkin.glb> <out-anim.glb> anim      animation only (bones of the model)

Meshy ships 4096² textures (≈48 MB per file) and a stray "Icosphere"; the game wants ≈1024² and no helpers.
"""
import bpy, sys

args = sys.argv[sys.argv.index('--') + 1:]
src, out = args[0], args[1]
mode = args[2] if len(args) > 2 else '1024'

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=src)
for o in [o for o in bpy.data.objects if o.type == 'MESH' and o.name.startswith('Icosphere')]:
    bpy.data.objects.remove(o, do_unlink=True)
arm = next(o for o in bpy.data.objects if o.type == 'ARMATURE')
if arm.animation_data and arm.animation_data.action:
    a = arm.animation_data.action
    bpy.context.scene.frame_start, bpy.context.scene.frame_end = int(a.frame_range[0]), int(a.frame_range[1])
bpy.context.scene.render.fps = 30

if mode == 'anim':
    for o in [o for o in bpy.data.objects if o.type == 'MESH']:
        bpy.data.objects.remove(o, do_unlink=True)
    bpy.ops.object.select_all(action='DESELECT')
    arm.select_set(True)
    bpy.context.view_layer.objects.active = arm
    bpy.ops.export_scene.gltf(filepath=out, export_format='GLB', export_animations=True, export_skins=False,
                              export_materials='NONE', export_yup=True, export_apply=False, use_selection=True,
                              export_force_sampling=True, export_frame_range=True, export_anim_single_armature=True,
                              export_optimize_animation_size=True)
else:
    size = int(mode)
    for im in bpy.data.images:
        # base colour full size, normal / metallic-roughness half
        want = size if im.name.startswith('texture_0') and 'metallic' not in im.name else size // 2
        if im.size[0] > want:
            im.scale(want, want)
    bpy.ops.export_scene.gltf(filepath=out, export_format='GLB', export_animations=True, export_yup=True,
                              export_apply=False, export_image_format='AUTO', export_jpeg_quality=85,
                              export_image_quality=85, export_force_sampling=True, export_frame_range=True)
print('DONE', out)
