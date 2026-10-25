# Builds art/crew_roles.blend and public/models/crew_roles.glb for Patch It Up:
# the mechanic, the engineer and the pilot, on the crew skeleton (so every
# crew animation plays on them). The plain deckhand (no uniform yet) stays
# in character.glb.
#
# Each outfit's main colour is a material named 'shirt': the game recolours
# it from the role palette (including the colour-blind ones). Anything worn
# on the head has 'headgear' in its name, so the game can hide it when a hat
# from the dock mirror goes on instead.

import bpy, math, os
from mathutils import Vector

HERE = os.path.dirname(os.path.abspath(__file__))

# The pirate builder's helpers: materials, the shared skeleton, body parts.
src = open(os.path.join(HERE, 'build_pirates.py')).read()
exec(src[: src.index('# ---------------------------------------------------------------- 1. the captain')], globals())
CREW_SCRIPT = os.path.join(HERE, 'build_character.py')
# (set after the helpers: the pirate builder defines its own OUT_* names)
OUT_BLEND = os.path.join(HERE, 'crew_roles.blend')
OUT_GLB = os.path.join(HERE, 'crew_roles.glb')

ROLE = {'mechanic': '#e2574c', 'engineer': '#49b97a', 'pilot': '#4a86e8'}
EXTRA = {
    'undershirt': '#c9c3b6', 'cap_grey': '#4a4552', 'oil': '#2a2420', 'cheek': '#e8958a',
    'hardhat': '#f2c230', 'reflect': '#dfe6ee', 'rubber': '#e3b23c', 'fur': '#efe7d6',
    'scarf_white': '#f4efe4', 'jacket_brown': '#6b4228', 'denim': '#3a4f7a', 'mouth': '#7a3a2a',
}
for k, v in EXTRA.items():
    M[k] = mat(k, v, 0.35 if k == 'reflect' else 0.7, emit=0.6 if k == 'reflect' else 0.0)

def role_material(role):
    # One 'shirt' material per role file object; the game clones and recolours it.
    m = mat(f'shirt_{role}', ROLE[role])
    m.name = 'shirt' if 'shirt' not in bpy.data.materials or bpy.data.materials['shirt'] == m else m.name
    return m

def friendly_face(brow_m='brow'):
    """Dot eyes, relaxed eyebrows, rosy cheeks and a small smile."""
    for x in (-0.075, 0.075):
        side = 'L' if x < 0 else 'R'
        blob(f'eye_{side}', 'head', (x, 0.19, 1.53), (0.028, 0.02, 0.04), 'eye', 10)
        cube(f'brow_{side}', 'head', (x, 0.195, 1.59), (0.07, 0.02, 0.016), brow_m, rot=(0, 10 if x < 0 else -10, 0), bevel=0.3)
        blob(f'cheek_{side}', 'head', (x * 1.55, 0.17, 1.46), (0.035, 0.012, 0.025), 'cheek', 8)
    for k, (x, z, a) in enumerate([(-0.035, 1.41, -28), (0, 1.398, 0), (0.035, 1.41, 28)]):
        cube(f'smile_{k}', 'head', (x, 0.196, z), (0.035, 0.01, 0.01), 'mouth', rot=(0, a, 0), bevel=0.3)

# ---------------------------------------------------------------- the mechanic
def mechanic():
    body('skin_b', 'undershirt', 'shirt', bulk=1.05, belly=1.05, gloves='leather')
    friendly_face()
    # overalls: a bib over the chest and straps, in the role colour
    cube('bib', 'chest', (0, 0.15, 1.08), (0.26, 0.06, 0.3), 'shirt', bevel=0.25)
    blob('overall_belly', 'spine', (0, 0.01, 0.98), (0.215, 0.175, 0.15), 'shirt')
    for x in (-0.11, 0.11):
        limb(f'strap_{x:+.2f}', 'chest', (x, 0.15, 1.22), (x, -0.13, 1.24), 0.022, 'shirt')
        blob(f'strap_button_{x:+.2f}', 'chest', (x, 0.185, 1.21), (0.018, 0.01, 0.018), 'brass', 8)
    cube('bib_pocket', 'chest', (0.05, 0.185, 1.1), (0.09, 0.015, 0.08), 'shirt', bevel=0.3)
    limb('pencil', 'chest', (0.03, 0.19, 1.12), (0.035, 0.19, 1.2), 0.008, 'hardhat')
    # rolled-up sleeves: a cuff at the elbow, bare forearms
    for side, x in (('L', -1), ('R', 1)):
        ring(f'sleeve_roll.{side}', f'upperarm.{side}', (0.23 * x * 1.03, 0, 1.0), 0.06, 0.02, 'undershirt', rot=(0, 0, 0))
    # tool belt with a wrench and a hammer
    belt('leather', 'iron', z=0.86, r=0.22)
    cube('belt_pouch_L', 'hips', (-0.17, 0.12, 0.8), (0.1, 0.06, 0.12), 'leather')
    limb('belt_wrench', 'hips', (0.2, 0.08, 0.86), (0.22, 0.1, 0.66), 0.014, 'iron')
    ring('belt_wrench_jaw', 'hips', (0.225, 0.1, 0.64), 0.03, 0.01, 'iron', rot=(90, 0, 0))
    limb('belt_hammer', 'hips', (-0.22, 0.02, 0.88), (-0.24, 0.05, 0.66), 0.014, 'wood')
    cube('belt_hammer_head', 'hips', (-0.24, 0.05, 0.66), (0.04, 0.1, 0.04), 'iron', bevel=0.2)
    # a backwards cap with goggles, a smudge of oil on the cheek
    blob('headgear_cap', 'head', (0, -0.005, 1.6), (0.225, 0.22, 0.13), 'cap_grey', 16)
    cube('headgear_cap_peak', 'head', (0, -0.22, 1.6), (0.18, 0.12, 0.02), 'cap_grey', rot=(-12, 0, 0), bevel=0.3)
    limb('headgear_goggle_strap', 'head', (0, 0, 1.61), (0, 0, 1.64), 0.228, 'black', verts=20)
    for x in (-0.065, 0.065):
        limb(f'headgear_goggle_{x:+.2f}', 'head', (x, 0.18, 1.635), (x, 0.24, 1.66), 0.05, 'brass', 0.046)
        blob(f'headgear_goggle_glass_{x:+.2f}', 'head', (x, 0.245, 1.662), (0.04, 0.01, 0.04), 'glass', 10)
    blob('oil_smudge', 'head', (0.12, 0.155, 1.44), (0.03, 0.01, 0.018), 'oil', 8)

# ---------------------------------------------------------------- the engineer
def engineer():
    body('skin_c', 'shirt', 'pants_dark', bulk=1.0, gloves='rubber')
    friendly_face()
    # a work jacket in the role colour with reflective safety bands
    for k, z in enumerate((1.17, 1.02)):
        limb(f'reflect_band_{k}', 'chest' if z > 1.1 else 'spine', (0, 0, z - 0.015), (0, 0, z + 0.015), 0.214, 'reflect', verts=16)
    for side, x in (('L', -1), ('R', 1)):
        limb(f'reflect_cuff.{side}', f'forearm.{side}', (0.235 * x, 0, 0.82), (0.237 * x, 0, 0.79), 0.054, 'reflect')
    # a lightning bolt on the chest: the engineer's symbol
    for k, (x, z, a) in enumerate([(-0.012, 1.16, 30), (0.012, 1.095, 30), (0.0, 1.128, -40)]):
        cube(f'bolt_{k}', 'chest', (x, 0.172, z), (0.03, 0.012, 0.075), 'hardhat', rot=(0, a, 0), bevel=0)
    belt('black', 'iron', z=0.88, r=0.2)
    # a multimeter on the belt, a coil of cable over the shoulder
    cube('meter', 'hips', (0.18, 0.1, 0.8), (0.08, 0.04, 0.12), 'hardhat', bevel=0.2)
    blob('meter_dial', 'hips', (0.18, 0.125, 0.82), (0.025, 0.006, 0.025), 'black', 8)
    ring('cable_coil', 'chest', (-0.16, -0.02, 1.16), 0.12, 0.022, 'black', rot=(0, 70, 25))
    ring('cable_coil_2', 'chest', (-0.16, -0.02, 1.16), 0.1, 0.02, 'shirt', rot=(0, 70, 25))
    # a hard hat with a little lamp, ear defenders
    blob('headgear_hardhat', 'head', (0, 0, 1.6), (0.235, 0.235, 0.16), 'hardhat', 18)
    limb('headgear_hardhat_brim', 'head', (0, 0.01, 1.585), (0, 0.01, 1.6), 0.27, 'hardhat', verts=20)
    limb('headgear_hardhat_ridge', 'head', (0, -0.18, 1.72), (0, 0.18, 1.72), 0.025, 'hardhat', verts=8)
    limb('headgear_lamp', 'head', (0, 0.2, 1.66), (0, 0.25, 1.67), 0.04, 'iron')
    blob('headgear_lamp_glass', 'head', (0, 0.255, 1.67), (0.034, 0.01, 0.034), 'window', 10)
    for x in (-0.225, 0.225):
        blob(f'ear_defender_{x:+.2f}', 'head', (x, 0, 1.5), (0.04, 0.07, 0.08), 'black', 12)

# ---------------------------------------------------------------- the pilot
def pilot():
    body('skin_a', 'shirt', 'pants_tan', bulk=1.0, gloves='leather')
    friendly_face()
    # flight jacket in the role colour with a fur collar and a zip
    ring('fur_collar', 'chest', (0, 0, 1.26), 0.15, 0.05, 'fur', rot=(0, 0, 0))
    limb('jacket_zip', 'chest', (0, 0.17, 0.98), (0, 0.17, 1.24), 0.008, 'brass')
    for side, x in (('L', -1), ('R', 1)):
        ring(f'jacket_cuff.{side}', f'forearm.{side}', (0.237 * x, 0, 0.8), 0.055, 0.02, 'fur', rot=(0, 0, 0))
    # gold wings on the chest
    for x, a in ((-0.06, 15), (0.06, -15)):
        cube(f'wings_{x:+.2f}', 'chest', (0.07 + x * 0.6, 0.175, 1.17), (0.07, 0.01, 0.025), 'gold', rot=(0, a, 0), bevel=0)
    blob('wings_centre', 'chest', (0.07, 0.178, 1.17), (0.018, 0.01, 0.018), 'gold', 8)
    belt('leather', 'gold', z=0.88, r=0.2)
    # tall boots
    for side, x in (('L', -1), ('R', 1)):
        limb(f'boot_top.{side}', f'shin.{side}', (0.11 * x, 0, 0.12), (0.11 * x, 0, 0.32), 0.07, 'boot', 0.072)
    # a white scarf that streams behind
    limb('scarf_wrap', 'neck', (0, 0, 1.27), (0, 0, 1.33), 0.105, 'scarf_white', 0.095)
    for k in range(4):
        cube(f'scarf_tail_{k}', 'chest', (-0.06 - k * 0.015, -0.19 - k * 0.05, 1.24 - k * 0.07), (0.09, 0.025, 0.12), 'scarf_white',
             rot=(-35 + k * 6, 0, -10 - k * 5), bevel=0.3)
    # leather flying helmet with ear flaps and goggles pushed up
    blob('headgear_helmet', 'head', (0, -0.01, 1.56), (0.232, 0.228, 0.175), 'jacket_brown', 18)
    for x in (-0.205, 0.205):
        cube(f'headgear_flap_{x:+.2f}', 'head', (x, 0.0, 1.43), (0.045, 0.12, 0.15), 'jacket_brown', bevel=0.4)
    limb('headgear_chin_strap', 'head', (-0.19, 0.06, 1.37), (0.19, 0.06, 1.37), 0.01, 'jacket_brown')
    limb('headgear_goggle_strap', 'head', (0, 0, 1.6), (0, 0, 1.63), 0.236, 'black', verts=20)
    for x in (-0.07, 0.07):
        limb(f'headgear_goggle_{x:+.2f}', 'head', (x, 0.17, 1.65), (x, 0.24, 1.69), 0.055, 'brass', 0.05)
        blob(f'headgear_goggle_glass_{x:+.2f}', 'head', (x, 0.245, 1.693), (0.042, 0.01, 0.042), 'glass', 10)

# The role colour must be a material literally named 'shirt' in the file.
shirt = M['shirt'] = mat('shirt', ROLE['mechanic'])

ROLES = [('crew_mechanic', 'Mechanic', mechanic), ('crew_engineer', 'Engineer', engineer), ('crew_pilot', 'Pilot', pilot)]
roles_coll = coll('Crew_Roles')
rigs = []
for i, (name, label, fn) in enumerate(ROLES):
    c = coll(label, roles_coll)
    r = new_rig(name, c)
    fn()
    r.location = ((i - 1) * 1.3, 0, 0)
    r['role'] = label.lower()
    rigs.append(r)
# In the file, show each outfit in its own colour (the game recolours anyway).
for r, (name, label, fn) in zip(rigs, ROLES):
    role = label.lower()
    m = shirt.copy()
    m.name = f'shirt_preview_{role}'
    c = srgb(ROLE[role])
    m.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = (*c, 1)
    m.diffuse_color = (*c, 1)
    for ob in bpy.data.objects:
        if ob.parent == r and ob.type == 'MESH':
            for slot in ob.material_slots:
                if slot.material == shirt:
                    slot.material = m

# The crew's animations, for previewing in Blender.
src2 = open(CREW_SCRIPT).read()
rig = rigs[0]
exec(src2[src2.index('# ---------------------------------------------------------------- posing'):
          src2.index('# ---------------------------------------------------------------- finish')], globals())
idle = bpy.data.actions['Idle']
for r in rigs:
    r.animation_data_create()
    r.animation_data.action = idle
    if idle.slots:
        try:
            r.animation_data.action_slot = idle.slots[0]
        except Exception:
            pass

cam = bpy.data.cameras.new('preview_camera')
cam_ob = bpy.data.objects.new('preview_camera', cam)
scene.collection.objects.link(cam_ob)
scene.camera = cam_ob
scene.frame_start, scene.frame_end = 0, 72
bpy.data.texts.new('README').write("""Patch It Up - crew roles: mechanic, engineer, pilot
* Built on the crew skeleton: every crew animation plays on them.
* In the file each outfit shows its role colour through 'shirt_preview_*'
  materials. The export puts the shared 'shirt' material back, which the
  game recolours from the role palette (including colour-blind palettes).
* Parts named *headgear* hide in the game when a hat from the mirror is worn.
* Export: run export_to_game.py (Alt+P) -> public/models/crew_roles.glb
""")
EXPORT = r'''# Export the three crew roles to the game. Text Editor > Run Script (Alt+P).
import bpy, os
blend = bpy.data.filepath
out = os.path.join(os.path.dirname(os.path.dirname(blend)), 'public', 'models', 'crew_roles.glb')
bpy.ops.wm.save_mainfile()
shirt = bpy.data.materials['shirt']
swapped = []
def objects_in(c):
    s = set(c.objects)
    for ch in c.children: s |= objects_in(ch)
    return s
objs = objects_in(bpy.data.collections['Crew_Roles'])
for ob in objs:
    if ob.type == 'MESH':
        for slot in ob.material_slots:
            if slot.material and slot.material.name.startswith('shirt_preview_'):
                swapped.append((slot, slot.material)); slot.material = shirt
bpy.ops.object.select_all(action='DESELECT')
for ob in objs: ob.select_set(True)
bpy.ops.export_scene.gltf(filepath=out, export_format='GLB', use_selection=True, export_extras=True,
    export_yup=True, export_apply=True, export_cameras=False, export_lights=False,
    export_animations=False, export_skins=True)
for slot, m in swapped: slot.material = m
print('Exported', out)
'''
bpy.data.texts.new('export_to_game.py').write(EXPORT)
bpy.ops.wm.save_as_mainfile(filepath=OUT_BLEND)
exec(EXPORT.replace("os.path.join(os.path.dirname(os.path.dirname(blend)), 'public', 'models', 'crew_roles.glb')", repr(OUT_GLB)).replace('bpy.ops.wm.save_mainfile()', ''), globals())
print('saved', OUT_BLEND, os.path.getsize(OUT_GLB))
