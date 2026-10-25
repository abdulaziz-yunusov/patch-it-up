# Builds art/sky_pirates.blend, public/models/pirates.glb and
# public/models/pirate_ship.glb for Patch It Up.
#
# The five pirates use the crew character's skeleton (same bone names,
# same proportions), so every animation in character.glb plays on them
# too. Like the crew, every body part is its own mesh parented to a bone.
# The pirate airship follows the game's ship convention: bow toward +X
# in the game (+X in Blender too), deck at height 0, centred on the origin.

import bpy, math, os, sys
from mathutils import Vector, Quaternion

HERE = os.path.dirname(os.path.abspath(__file__))
OUT_BLEND = os.path.join(HERE, 'sky_pirates.blend')
OUT_PIRATES = os.path.join(HERE, 'pirates.glb')
OUT_SHIP = os.path.join(HERE, 'pirate_ship.glb')
CREW_SCRIPT = os.path.join(HERE, 'build_character.py')

bpy.ops.wm.read_homefile(use_empty=True)
scene = bpy.context.scene
scene.render.fps = 30

# ---------------------------------------------------------------- materials
def srgb(h):
    h = h.lstrip('#')
    c = [int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)]
    return tuple(x / 12.92 if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4 for x in c)

MATS = {}
def mat(name, hexcolor, rough=0.7, emit=0.0, metal=0.0):
    if name in MATS:
        return MATS[name]
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes['Principled BSDF']
    c = srgb(hexcolor)
    b.inputs['Base Color'].default_value = (*c, 1)
    b.inputs['Roughness'].default_value = rough
    b.inputs['Metallic'].default_value = metal
    if emit:
        b.inputs['Emission Color'].default_value = (*c, 1)
        b.inputs['Emission Strength'].default_value = emit
    m.diffuse_color = (*c, 1)
    MATS[name] = m
    return m

PALETTE = {
    # people
    'skin_a': '#f1c27d', 'skin_b': '#e0ac69', 'skin_c': '#c68642', 'skin_d': '#8d5524',
    'eye': '#1a1a1a', 'brow': '#2a1a10', 'white': '#e8e2d0', 'black': '#1d1b22',
    'coat_red': '#8e2b2b', 'coat_dark': '#2a2433', 'vest_brown': '#5a3418', 'vest_green': '#3f5a2e',
    'jacket_purple': '#5b3a78', 'stripe_blue': '#2f4f8e', 'pants_dark': '#2b2b38', 'pants_tan': '#8a7350',
    'leather': '#5a3418', 'boot': '#2a1a10', 'gold': '#d6a640', 'brass': '#c9973a', 'iron': '#5b616f',
    'steel': '#aeb4c0', 'beard_red': '#b5482a', 'beard_grey': '#8a8580', 'bandana_red': '#c9443a',
    'bandana_teal': '#2f8e8a', 'scarf_yellow': '#e3b23c', 'mohawk': '#d9572b', 'feather': '#f2ede0',
    'glass': '#7fd4ff', 'fuse': '#ffb347', 'wood': '#8a5a36',
    # ship
    'hull_dark': '#3a2418', 'hull_mid': '#4e3020', 'hull_red': '#8e2b2b', 'deck': '#6b4a33',
    'balloon': '#25202b', 'patch_red': '#8e2b2b', 'patch_tan': '#9b7a52', 'patch_grey': '#4a4552',
    'rope': '#b89a6a', 'sail': '#6e2a2a', 'lamp_red': '#ff5a3a', 'window': '#ffc46b', 'bone': '#efe6cf',
}
M = {k: mat(k, v, 0.35 if k in ('gold', 'brass', 'steel', 'glass') else 0.7,
            emit=2.5 if k in ('lamp_red', 'window', 'fuse') else 0.0,
            metal=0.6 if k in ('gold', 'brass', 'steel', 'iron') else 0.0) for k, v in PALETTE.items()}

def coll(name, parent=None):
    c = bpy.data.collections.get(name) or bpy.data.collections.new(name)
    if c.name not in [x.name for x in (parent or scene.collection).children]:
        (parent or scene.collection).children.link(c)
    return c

# ---------------------------------------------------------------- skeleton (same as the crew)
BONES = [
    ('root', (0, 0, 0), (0, 0, 0.2), None),
    ('hips', (0, 0, 0.75), (0, 0, 0.92), 'root'),
    ('spine', (0, 0, 0.92), (0, 0, 1.1), 'hips'),
    ('chest', (0, 0, 1.1), (0, 0, 1.28), 'spine'),
    ('neck', (0, 0, 1.28), (0, 0, 1.36), 'chest'),
    ('head', (0, 0, 1.36), (0, 0, 1.72), 'neck'),
]
for s, x in (('L', -1), ('R', 1)):   # character's left is -X when facing +Y
    BONES += [
        (f'upperarm.{s}', (0.21 * x, 0, 1.24), (0.23 * x, 0, 0.98), 'chest'),
        (f'forearm.{s}', (0.23 * x, 0, 0.98), (0.24 * x, 0, 0.75), f'upperarm.{s}'),
        (f'hand.{s}', (0.24 * x, 0, 0.75), (0.245 * x, 0, 0.66), f'forearm.{s}'),
        (f'thigh.{s}', (0.11 * x, 0, 0.75), (0.11 * x, 0, 0.42), 'hips'),
        (f'shin.{s}', (0.11 * x, 0, 0.42), (0.11 * x, 0, 0.1), f'thigh.{s}'),
        (f'foot.{s}', (0.11 * x, 0, 0.1), (0.11 * x, 0.15, 0.03), f'shin.{s}'),
    ]

arm_data = bpy.data.armatures.new('crew_rig')   # one skeleton shared by every pirate
arm_data.display_type = 'STICK'
tmp = bpy.data.objects.new('_tmp_rig', arm_data)
scene.collection.objects.link(tmp)
bpy.context.view_layer.objects.active = tmp
bpy.ops.object.mode_set(mode='EDIT')
for name, head, tail, parent in BONES:
    b = arm_data.edit_bones.new(name)
    b.head, b.tail = Vector(head), Vector(tail)
    b.roll = 0
    if parent:
        b.parent = arm_data.edit_bones[parent]
        b.use_connect = False
bpy.ops.object.mode_set(mode='OBJECT')
bpy.data.objects.remove(tmp)

rig = None          # the pirate being built; the helpers below attach to it
target = None       # the collection new parts go into

def new_rig(name, collection):
    global rig, target
    target = collection
    rig = bpy.data.objects.new(name, arm_data)
    target.objects.link(rig)
    rig.show_in_front = True
    bpy.context.view_layer.update()  # the pose exists only after an update
    for pb in rig.pose.bones:
        pb.rotation_mode = 'QUATERNION'
    return rig

def place(ob):
    for c in list(ob.users_collection):
        c.objects.unlink(ob)
    target.objects.link(ob)

def attach(ob, bone):
    bpy.context.view_layer.update()
    mw = ob.matrix_world.copy()
    ob.parent = rig
    ob.parent_type = 'BONE'
    ob.parent_bone = bone
    bpy.context.view_layer.update()
    ob.matrix_world = mw

def finish(ob, name, m, bone, smooth=True):
    ob.name = f'{rig.name}_{name}' if bone else name
    if smooth:
        bpy.ops.object.shade_smooth()
    if m:
        ob.data.materials.append(M[m])
    place(ob)
    if bone:
        attach(ob, bone)
    return ob

def blob(name, bone, loc, scale, m, segs=16):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=segs, ring_count=max(6, segs // 2), radius=1, location=loc)
    ob = bpy.context.active_object
    ob.scale = scale
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    return finish(ob, name, m, bone)

def limb(name, bone, a, b, r, m, r2=None, verts=12):
    a, b = Vector(a), Vector(b)
    mid, d = (a + b) / 2, (b - a)
    bpy.ops.mesh.primitive_cone_add(vertices=verts, radius1=r, radius2=r if r2 is None else r2, depth=d.length, location=mid)
    ob = bpy.context.active_object
    ob.rotation_mode = 'QUATERNION'
    ob.rotation_quaternion = Vector((0, 0, 1)).rotation_difference(d.normalized())
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=False)
    return finish(ob, name, m, bone)

def cube(name, bone, loc, size, m, rot=(0, 0, 0), bevel=0.25):
    bpy.ops.mesh.primitive_cube_add(size=1, location=loc, rotation=[math.radians(r) for r in rot])
    ob = bpy.context.active_object
    ob.scale = size
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)
    if bevel:
        bev = ob.modifiers.new('round', 'BEVEL')
        bev.width, bev.segments = min(size) * bevel, 2
    return finish(ob, name, m, bone, smooth=False)

def ring(name, bone, loc, R, r, m, rot=(0, 0, 0), arc=None):
    bpy.ops.mesh.primitive_torus_add(major_radius=R, minor_radius=r, location=loc,
                                     rotation=[math.radians(v) for v in rot], major_segments=20, minor_segments=8)
    ob = bpy.context.active_object
    return finish(ob, name, m, bone)

def socket(name, bone, loc):
    e = bpy.data.objects.new(f'{rig.name}_{name}', None)
    e.empty_display_size = 0.08
    e.location = loc
    target.objects.link(e)
    attach(e, bone)
    return e

# ---------------------------------------------------------------- shared body
# A pirate is the crew body with different clothes, faces and gear.
def body(skin, shirt, pants, boots='boot', bulk=1.0, belly=1.0, sleeves=True, gloves=None):
    s = bulk
    blob('pelvis', 'hips', (0, 0, 0.8), (0.19 * s, 0.15 * s, 0.13), pants)
    blob('belly', 'spine', (0, 0, 1.0), (0.2 * s * belly, 0.16 * s * belly, 0.16), shirt)
    blob('chest', 'chest', (0, 0, 1.16), (0.21 * s, 0.165 * s, 0.15), shirt)
    blob('head', 'head', (0, 0, 1.5), (0.22, 0.21, 0.22), skin, 20)
    blob('nose', 'head', (0, 0.215, 1.48), (0.04, 0.035, 0.035), skin, 10)
    blob('neck', 'neck', (0, 0, 1.31), (0.075 * s, 0.075 * s, 0.06), skin, 10)
    for side, x in (('L', -1), ('R', 1)):
        sx = x * (1 + (s - 1) * 0.6)
        arm = shirt if sleeves else skin
        blob(f'shoulder.{side}', f'upperarm.{side}', (0.21 * sx, 0, 1.23), (0.075 * s,) * 3, arm, 12)
        limb(f'upperarm.{side}', f'upperarm.{side}', (0.21 * sx, 0, 1.23), (0.23 * sx, 0, 0.98), 0.062 * s, arm, 0.055 * s)
        blob(f'elbow.{side}', f'forearm.{side}', (0.23 * sx, 0, 0.98), (0.055 * s,) * 3, arm, 12)
        limb(f'forearm.{side}', f'forearm.{side}', (0.23 * sx, 0, 0.98), (0.24 * sx, 0, 0.77), 0.052 * s, skin, 0.045 * s)
        blob(f'hand.{side}', f'hand.{side}', (0.243 * sx, 0.01, 0.72), (0.058 * s, 0.05 * s, 0.068 * s), gloves or skin, 12)
        limb(f'thigh.{side}', f'thigh.{side}', (0.11 * x, 0, 0.78), (0.11 * x, 0, 0.42), 0.078 * s, pants, 0.065 * s)
        blob(f'knee.{side}', f'shin.{side}', (0.11 * x, 0, 0.42), (0.065 * s,) * 3, pants, 12)
        limb(f'shin.{side}', f'shin.{side}', (0.11 * x, 0, 0.42), (0.11 * x, 0, 0.12), 0.062 * s, pants, 0.055 * s)
        cube(f'boot.{side}', f'foot.{side}', (0.11 * x, 0.04, 0.055), (0.12, 0.24, 0.11), boots)
    socket('socket_hat', 'head', (0, 0, 1.5))
    socket('socket_hold', 'chest', (0, 0.36, 0.98))
    socket('socket_hand_R', 'hand.R', (0.245, 0.03, 0.70))

def face(eyes='both', brows=-18, brow_m='brow'):
    """Two dot eyes and angry eyebrows sloping down toward the nose."""
    for x in (-0.075, 0.075):
        if eyes == 'left_only' and x > 0:
            continue
        blob(f'eye_{"L" if x < 0 else "R"}', 'head', (x, 0.19, 1.53), (0.028, 0.02, 0.04), 'eye', 10)
    for x in (-0.075, 0.075):
        tilt = brows if x < 0 else -brows
        cube(f'brow_{"L" if x < 0 else "R"}', 'head', (x, 0.195, 1.585), (0.075, 0.02, 0.018), brow_m, rot=(0, tilt, 0), bevel=0.3)

def belt(m='leather', buckle='gold', z=0.89, r=0.195):
    limb('belt', 'hips', (0, 0, z - 0.02), (0, 0, z + 0.02), r, m)
    cube('buckle', 'hips', (0, r - 0.01, z), (0.07, 0.025, 0.055), buckle)

# ---------------------------------------------------------------- 1. the captain
def captain():
    body('skin_b', 'coat_red', 'pants_dark', bulk=1.05, belly=1.12, gloves='black')
    face(eyes='left_only', brows=-22)
    # long red coat: white shirt front and a ruffle between gold lapels,
    # tails that swing with the hips
    cube('shirt_front', 'chest', (0, 0.17, 1.1), (0.11, 0.03, 0.3), 'white', bevel=0.3)
    for k, z in enumerate((1.25, 1.2, 1.15)):
        blob(f'ruffle_{k}', 'chest', (0, 0.19, z), (0.05, 0.03, 0.03), 'white', 8)
    for x in (-0.07, 0.07):
        cube(f'lapel_{x:+.2f}', 'chest', (x, 0.17, 1.16), (0.06, 0.03, 0.2), 'gold', rot=(0, -12 if x < 0 else 12, 0))
    for k, z in enumerate((1.18, 1.1, 1.02)):
        blob(f'button_{k}', 'chest', (0.11, 0.185, z), (0.018, 0.012, 0.018), 'gold', 8)
    for x in (-0.1, 0.1):
        cube(f'coat_tail_{x:+.1f}', 'hips', (x, -0.12, 0.62), (0.13, 0.04, 0.38), 'coat_red', rot=(-12, 0, 0))
    for side, x in (('L', -1), ('R', 1)):
        cube(f'epaulette.{side}', 'chest', (0.21 * x, 0, 1.29), (0.12, 0.12, 0.03), 'gold', bevel=0.4)
        for f in range(3):
            limb(f'fringe.{side}{f}', 'chest', (0.21 * x + (f - 1) * 0.035 * x, 0.04, 1.28), (0.21 * x + (f - 1) * 0.035 * x, 0.04, 1.24), 0.008, 'gold')
        ring(f'cuff.{side}', f'forearm.{side}', (0.235 * x, 0, 0.86), 0.06, 0.018, 'gold')
    belt('black', 'gold', z=0.9, r=0.215)
    # big red beard and moustache
    blob('beard', 'head', (0, 0.13, 1.38), (0.17, 0.11, 0.13), 'beard_red', 14)
    blob('beard_tip', 'head', (0, 0.17, 1.27), (0.08, 0.06, 0.08), 'beard_red', 10)
    for x in (-0.06, 0.06):
        blob(f'moustache_{x:+.2f}', 'head', (x, 0.205, 1.455), (0.07, 0.03, 0.025), 'beard_red', 10)
    # eye patch on the right eye with its strap
    cube('eyepatch', 'head', (0.075, 0.2, 1.535), (0.07, 0.02, 0.06), 'black', bevel=0.4)
    ring('eyepatch_strap', 'head', (0, 0, 1.56), 0.215, 0.008, 'black', rot=(0, -12, 0))
    # tricorn hat: a crown and three turned-up corners, gold trim, a feather
    limb('hat_crown', 'head', (0, 0, 1.64), (0, 0, 1.78), 0.17, 'black', 0.15, verts=16)
    for k in range(3):
        a = math.radians(90 + k * 120)
        # each side of the tricorn is a wall turned up and flared outward
        cube(f'hat_brim_{k}', 'head', (math.cos(a) * 0.19, math.sin(a) * 0.19, 1.72), (0.4, 0.04, 0.16), 'black',
             rot=(22, 0, math.degrees(a) + 90), bevel=0.3)
        cube(f'hat_trim_{k}', 'head', (math.cos(a) * 0.225, math.sin(a) * 0.225, 1.8), (0.4, 0.015, 0.02), 'gold',
             rot=(22, 0, math.degrees(a) + 90), bevel=0)
    limb('hat_feather', 'head', (-0.14, -0.08, 1.76), (-0.26, -0.24, 1.84), 0.04, 'feather', 0.02)
    limb('hat_feather_tip', 'head', (-0.26, -0.24, 1.84), (-0.3, -0.38, 1.8), 0.02, 'feather', 0.004)
    blob('hat_skull', 'head', (0, 0.2, 1.7), (0.035, 0.012, 0.035), 'bone', 8)
    # left hand: a hook instead of a hand
    for ob in [o for o in target.objects if o.name.endswith('_hand.L')]:
        bpy.data.objects.remove(ob)
    limb('hook_cuff', 'hand.L', (-0.245, 0, 0.76), (-0.245, 0, 0.7), 0.05, 'brass', 0.035)
    ring('hook', 'hand.L', (-0.245, 0.03, 0.63), 0.045, 0.012, 'steel', rot=(0, 90, 0))
    # cutlass in the right hand
    limb('cutlass_grip', 'hand.R', (0.245, 0.02, 0.76), (0.245, 0.02, 0.66), 0.018, 'leather')
    ring('cutlass_guard', 'hand.R', (0.245, 0.04, 0.69), 0.05, 0.01, 'gold', rot=(90, 0, 0))
    cube('cutlass_blade', 'hand.R', (0.245, 0.06, 0.42), (0.02, 0.06, 0.5), 'steel', rot=(8, 0, 0), bevel=0.2)
    cube('cutlass_tip', 'hand.R', (0.245, 0.11, 0.15), (0.018, 0.05, 0.1), 'steel', rot=(28, 0, 0), bevel=0.2)

# ---------------------------------------------------------------- 2. the bosun (the big one)
def bosun():
    body('skin_d', 'white', 'pants_tan', bulk=1.3, belly=1.2, sleeves=False)
    face(brows=-26)
    # striped shirt: blue bands round the belly and chest
    for k, z in enumerate((0.92, 1.0, 1.08, 1.16, 1.24)):
        r = 0.205 * 1.3 * (1.0 if z > 1.02 else 1.15)
        limb(f'stripe_{k}', 'spine' if z < 1.1 else 'chest', (0, 0, z - 0.018), (0, 0, z + 0.018), r * 0.95, 'stripe_blue', verts=16)
    # bald head, red bandana with a knot and tails, gold earring, stubble chin
    blob('bandana', 'head', (0, -0.01, 1.57), (0.225, 0.215, 0.17), 'bandana_red', 16)
    blob('bandana_knot', 'head', (0, -0.22, 1.56), (0.05, 0.04, 0.05), 'bandana_red', 10)
    for x in (-0.04, 0.04):
        cube(f'bandana_tail_{x:+.2f}', 'head', (x, -0.25, 1.47), (0.05, 0.02, 0.14), 'bandana_red', rot=(-15, x * 300, 0))
    ring('earring', 'head', (-0.215, 0, 1.45), 0.03, 0.007, 'gold', rot=(0, 90, 0))
    blob('stubble', 'head', (0, 0.12, 1.38), (0.15, 0.09, 0.08), 'beard_grey', 12)
    # big forearms (bare) with wrist bands, a wide leather belt
    for side, x in (('L', -1), ('R', 1)):
        blob(f'forearm_bulk.{side}', f'forearm.{side}', (0.29 * x, 0.01, 0.87), (0.075, 0.075, 0.11), 'skin_d', 12)
        limb(f'wristband.{side}', f'forearm.{side}', (0.3 * x, 0, 0.79), (0.3 * x, 0, 0.76), 0.06, 'leather')
    belt('leather', 'iron', z=0.88, r=0.27)
    # an anchor on a chain, held in the right hand
    limb('anchor_shank', 'hand.R', (0.3, 0.02, 0.74), (0.3, 0.02, 0.2), 0.03, 'iron')
    ring('anchor_eye', 'hand.R', (0.3, 0.02, 0.76), 0.04, 0.012, 'iron', rot=(0, 90, 0))
    limb('anchor_stock', 'hand.R', (0.3, -0.12, 0.66), (0.3, 0.16, 0.66), 0.018, 'iron')
    for y in (-1, 1):
        limb(f'anchor_arm_{y}', 'hand.R', (0.3, 0.02, 0.2), (0.3, 0.02 + y * 0.2, 0.33), 0.028, 'iron')
        cube(f'anchor_fluke_{y}', 'hand.R', (0.3, 0.02 + y * 0.21, 0.35), (0.03, 0.1, 0.07), 'iron', rot=(y * 35, 0, 0))

# ---------------------------------------------------------------- 3. the lookout (tall and thin)
def lookout():
    body('skin_a', 'vest_green', 'pants_dark', bulk=0.85, belly=0.9, gloves='leather')
    face(brows=-12)
    # aviator cap with ear flaps and brass goggles pushed up
    blob('cap', 'head', (0, -0.01, 1.56), (0.23, 0.225, 0.17), 'leather', 16)
    for x in (-0.2, 0.2):
        cube(f'ear_flap_{x:+.1f}', 'head', (x, -0.01, 1.43), (0.04, 0.12, 0.14), 'leather', bevel=0.4)
    limb('goggle_strap', 'head', (0, 0, 1.6), (0, 0, 1.63), 0.232, 'black', verts=20)
    for x in (-0.07, 0.07):
        limb(f'goggle_{x:+.2f}', 'head', (x, 0.17, 1.65), (x, 0.24, 1.69), 0.055, 'brass', 0.05)
        blob(f'goggle_glass_{x:+.2f}', 'head', (x, 0.245, 1.693), (0.042, 0.01, 0.042), 'glass', 10)
    # a long yellow scarf that trails behind
    limb('scarf_wrap', 'neck', (0, 0, 1.27), (0, 0, 1.33), 0.11, 'scarf_yellow', 0.1)
    for k in range(4):
        cube(f'scarf_end_{k}', 'chest', (0.07 + k * 0.012, -0.19 - k * 0.025, 1.22 - k * 0.11), (0.1, 0.03, 0.13), 'scarf_yellow',
             rot=(-12 - k * 3, 0, 6 * k), bevel=0.3)
    belt('leather', 'brass', z=0.88, r=0.17)
    # a spyglass in the right hand, a satchel on the hip
    limb('spyglass', 'hand.R', (0.25, -0.02, 0.62), (0.25, 0.08, 0.98), 0.03, 'brass', 0.042)
    ring('spyglass_band', 'hand.R', (0.25, 0.04, 0.84), 0.04, 0.008, 'leather', rot=(-15, 0, 0))
    cube('satchel', 'hips', (-0.2, 0.0, 0.76), (0.08, 0.2, 0.16), 'leather')
    limb('satchel_strap', 'chest', (-0.18, 0.16, 1.24), (0.16, 0.16, 0.92), 0.015, 'leather')

# ---------------------------------------------------------------- 4. the gunner
def gunner():
    body('skin_c', 'vest_brown', 'pants_dark', bulk=1.12, belly=1.05, gloves='black')
    face(brows=-30)
    # orange mohawk and a monocle on the right eye
    for k in range(6):
        y = 0.12 - k * 0.06
        limb(f'mohawk_{k}', 'head', (0, y, 1.66 - abs(k - 2) * 0.01), (0, y - 0.03, 1.82 - abs(k - 2.5) * 0.02), 0.04, 'mohawk', 0.005, verts=8)
    ring('monocle', 'head', (0.075, 0.2, 1.53), 0.04, 0.008, 'brass', rot=(90, 0, 0))
    blob('monocle_glass', 'head', (0.075, 0.205, 1.53), (0.035, 0.005, 0.035), 'glass', 10)
    limb('monocle_chain', 'head', (0.11, 0.19, 1.5), (0.17, 0.12, 1.38), 0.005, 'brass')
    # bandolier of little bombs across the chest
    limb('bandolier', 'chest', (-0.2, 0.18, 1.26), (0.2, 0.18, 0.96), 0.03, 'leather')
    for k in range(4):
        t = (k + 0.5) / 4
        p = Vector((-0.2, 0.2, 1.26)).lerp(Vector((0.2, 0.2, 0.96)), t)
        blob(f'bomb_{k}', 'chest', tuple(p + Vector((0, 0.03, 0))), (0.045, 0.045, 0.045), 'black', 10)
        limb(f'bomb_fuse_{k}', 'chest', tuple(p + Vector((0, 0.04, 0.04))), tuple(p + Vector((0.01, 0.05, 0.08))), 0.006, 'fuse')
    belt('leather', 'brass', z=0.88, r=0.23)
    # blunderbuss with a flared brass muzzle, held in the right hand
    cube('gun_stock', 'hand.R', (0.25, -0.12, 0.74), (0.06, 0.26, 0.09), 'wood', rot=(-10, 0, 0))
    limb('gun_barrel', 'hand.R', (0.25, 0.0, 0.76), (0.25, 0.42, 0.8), 0.03, 'brass', 0.035)
    limb('gun_muzzle', 'hand.R', (0.25, 0.42, 0.8), (0.25, 0.5, 0.81), 0.035, 'brass', 0.07)
    # powder horn on the hip
    limb('powder_horn', 'hips', (0.22, -0.05, 0.86), (0.25, 0.08, 0.7), 0.045, 'bone', 0.015)

# ---------------------------------------------------------------- 5. the deckhand with a propeller pack
def deckhand():
    body('skin_b', 'jacket_purple', 'pants_tan', bulk=0.95, belly=0.95, gloves='leather')
    face(brows=-15)
    # bandana mask over the nose and mouth, messy hair
    cube('mask', 'head', (0, 0.17, 1.43), (0.3, 0.12, 0.12), 'bandana_teal', rot=(0, 0, 0), bevel=0.4)
    cube('mask_point', 'head', (0, 0.2, 1.36), (0.1, 0.04, 0.08), 'bandana_teal', rot=(0, 45, 0), bevel=0.3)
    for k in range(5):
        a = math.radians(-60 + k * 30)
        limb(f'hair_{k}', 'head', (math.sin(a) * 0.1, -0.05, 1.68), (math.sin(a) * 0.2, -0.14, 1.74), 0.05, 'brow', 0.01, verts=8)
    # propeller backpack: a tank, a mast and two blades that can spin
    cube('pack', 'chest', (0, -0.21, 1.1), (0.24, 0.12, 0.3), 'iron')
    limb('pack_tank', 'chest', (0, -0.29, 0.98), (0, -0.29, 1.22), 0.06, 'brass')
    limb('pack_mast', 'chest', (0, -0.24, 1.25), (0, -0.24, 1.72), 0.015, 'iron')
    prop = socket('spin_pack_prop', 'chest', (0, -0.24, 1.74))
    for k in range(2):
        b = cube(f'pack_blade_{k}', None, (0, -0.24, 1.74), (0.5, 0.06, 0.012), 'wood', rot=(0, 0, k * 90), bevel=0.3)
        b.name = f'{rig.name}_pack_blade_{k}'
        b.parent = prop
        b.matrix_parent_inverse = prop.matrix_world.inverted()
    blob('pack_hub', 'chest', (0, -0.24, 1.74), (0.03, 0.03, 0.025), 'brass', 8)
    for x in (-0.12, 0.12):
        limb(f'pack_strap_{x:+.2f}', 'chest', (x, 0.15, 1.24), (x, 0.17, 1.02), 0.018, 'leather')
    # knee pads, a coiled grappling line and hook on the belt
    for side, x in (('L', -1), ('R', 1)):
        blob(f'kneepad.{side}', f'shin.{side}', (0.11 * x, 0.05, 0.42), (0.07, 0.04, 0.07), 'iron', 10)
    belt('leather', 'brass', z=0.88, r=0.19)
    ring('grapple_rope', 'hips', (0.2, 0.0, 0.8), 0.08, 0.02, 'rope', rot=(0, 90, 0))
    limb('grapple_shank', 'hips', (0.22, 0.06, 0.84), (0.22, 0.06, 0.66), 0.012, 'iron')
    for k in range(3):
        a = math.radians(k * 120)
        limb(f'grapple_tine_{k}', 'hips', (0.22, 0.06, 0.66), (0.22 + math.cos(a) * 0.05, 0.06 + math.sin(a) * 0.05, 0.62), 0.008, 'iron')

PIRATES = [
    ('pirate_captain', 'Captain', captain, 1.0),
    ('pirate_bosun', 'Bosun', bosun, 1.08),
    ('pirate_lookout', 'Lookout', lookout, 1.06),
    ('pirate_gunner', 'Gunner', gunner, 1.0),
    ('pirate_deckhand', 'Deckhand', deckhand, 0.88),
]

pirates_coll = coll('Pirates')
rigs = []
for i, (name, label, build_fn, scale) in enumerate(PIRATES):
    c = coll(label, pirates_coll)
    r = new_rig(name, c)
    build_fn()
    r.scale = (scale,) * 3
    r.location = ((i - 2) * 1.3, 0, 0)
    r['pirate'] = label.lower()
    rigs.append(r)

# ---------------------------------------------------------------- animations (the crew's, for previewing)
# Run the crew script's posing section on the first pirate, then share the
# actions. In the game the pirates use character.glb's clips instead.
src = open(CREW_SCRIPT).read()
start = src.index('# ---------------------------------------------------------------- posing')
end = src.index('# ---------------------------------------------------------------- finish')
rig = rigs[0]
exec(src[start:end], globals())
idle = bpy.data.actions['Idle']
for k, r in enumerate(rigs):
    r.animation_data_create()
    r.animation_data.action = idle
    if hasattr(r.animation_data, 'action_slot') and idle.slots:
        try:
            r.animation_data.action_slot = idle.slots[0]
        except Exception as err:
            print('slot', r.name, err)

# ---------------------------------------------------------------- the pirate airship
ship_coll = coll('Pirate_Ship')
SC = {n: coll(n, ship_coll) for n in ('Hull', 'Deck', 'Balloon', 'Weapons', 'Rigging', 'Details')}
rig = None

def sobj(ob, name, m, c):
    ob.name = name
    if m:
        if ob.data.materials:
            ob.data.materials[0] = M[m]
        else:
            ob.data.materials.append(M[m])
    for cc in list(ob.users_collection):
        cc.objects.unlink(ob)
    SC[c].objects.link(ob)
    return ob

def sbox(name, loc, size, m, c, rot=(0, 0, 0), bevel=0.15):
    bpy.ops.mesh.primitive_cube_add(size=1, location=loc, rotation=[math.radians(r) for r in rot])
    ob = bpy.context.active_object
    ob.scale = size
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)
    if bevel:
        bev = ob.modifiers.new('round', 'BEVEL')
        bev.width, bev.segments = min(size) * bevel, 1
    return sobj(ob, name, m, c)

def scyl(name, a, b, r, m, c, r2=None, verts=12, smooth=True):
    a, b = Vector(a), Vector(b)
    mid, d = (a + b) / 2, (b - a)
    bpy.ops.mesh.primitive_cone_add(vertices=verts, radius1=r, radius2=r if r2 is None else r2, depth=d.length, location=mid)
    ob = bpy.context.active_object
    ob.rotation_mode = 'QUATERNION'
    ob.rotation_quaternion = Vector((0, 0, 1)).rotation_difference(d.normalized())
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=False)
    if smooth:
        bpy.ops.object.shade_smooth()
    return sobj(ob, name, m, c)

def sball(name, loc, scale, m, c, segs=20):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=segs, ring_count=segs // 2, radius=1, location=loc)
    ob = bpy.context.active_object
    ob.scale = scale
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    bpy.ops.object.shade_smooth()
    return sobj(ob, name, m, c)

def sring(name, loc, R, r, m, c, rot=(0, 0, 0), seg=24):
    bpy.ops.mesh.primitive_torus_add(major_radius=R, minor_radius=r, location=loc,
                                     rotation=[math.radians(v) for v in rot], major_segments=seg, minor_segments=8)
    ob = bpy.context.active_object
    bpy.ops.object.shade_smooth()
    return sobj(ob, name, m, c)

def sempty(name, loc, c, **props):
    e = bpy.data.objects.new(name, None)
    e.location = loc
    e.empty_display_size = 0.4
    SC[c].objects.link(e)
    for k, v in props.items():
        e[k] = v
    return e

# --- hull: lofted from cross-sections; bow at +X, deck at z = 0 -----------
L = 17.0          # length
HALF = L / 2
def half_width(x):
    t = x / HALF
    if t > 0:                     # bow narrows to a point
        return 2.6 * max(0.0, 1 - t ** 1.8) ** 0.7
    return 2.6 * (1 - 0.35 * (-t) ** 3)   # stern stays wide and square
def depth(x):
    t = x / HALF
    return 2.1 * (1 - 0.55 * t * t) + (0.35 if t < -0.85 else 0)

import bmesh
def loft(name, theta0, theta1, m, inset=0.0, rise=0.0, c='Hull', steps_x=34, steps_t=8):
    me = bpy.data.meshes.new(name)
    bm = bmesh.new()
    grid = []
    for i in range(steps_x + 1):
        x = -HALF + L * i / steps_x
        w = max(0.02, half_width(x) - inset)
        d = max(0.05, depth(x) - inset)
        row = []
        for j in range(steps_t + 1):
            th = theta0 + (theta1 - theta0) * j / steps_t
            # th: 0 = deck edge port, pi/2 = keel, pi = deck edge starboard
            y = w * math.cos(th)
            z = -d * math.sin(th) + rise
            row.append(bm.verts.new((x, y, z)))
        grid.append(row)
    for i in range(steps_x):
        for j in range(steps_t):
            bm.faces.new((grid[i][j], grid[i + 1][j], grid[i + 1][j + 1], grid[i][j + 1]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(me)
    bm.free()
    ob = bpy.data.objects.new(name, me)
    scene.collection.objects.link(ob)
    for p in me.polygons:
        p.use_smooth = True
    return sobj(ob, name, m, c)

loft('hull_lower', math.radians(38), math.radians(142), 'hull_dark', steps_t=10)
for side, (a, b) in (('port', (0, 38)), ('starboard', (142, 180))):
    loft(f'hull_upper_{side}', math.radians(a + 12), math.radians(b - 12 if b == 38 else b), 'hull_mid')
    loft(f'hull_band_{side}', math.radians(a if a == 0 else a), math.radians(a + 12 if a == 0 else a + 12), 'hull_red')
# fix the two upper pieces so they meet the band and the lower hull properly
for side, (a, b) in (('port', (12, 38)), ('starboard', (142, 168))):
    bpy.data.objects.remove(bpy.data.objects[f'hull_upper_{side}'])
    loft(f'hull_upper_{side}', math.radians(a), math.radians(b), 'hull_mid')
for side, (a, b) in (('port', (0, 12)), ('starboard', (168, 180))):
    bpy.data.objects.remove(bpy.data.objects[f'hull_band_{side}'])
    loft(f'hull_band_{side}', math.radians(a), math.radians(b), 'hull_red')
# the stern is a flat transom
sbox('hull_transom', (-HALF - 0.05, 0, -depth(-HALF) / 2), (0.25, 2 * half_width(-HALF), depth(-HALF)), 'hull_dark', 'Hull', bevel=0.05)
sbox('hull_transom_band', (-HALF - 0.12, 0, -0.15), (0.12, 3.5, 0.3), 'hull_red', 'Hull', bevel=0.05)
# keel and a ram at the bow
for k in range(8):
    x0 = -HALF + 0.7 + k * (L - 2.4) / 8
    x1 = -HALF + 0.7 + (k + 1) * (L - 2.4) / 8
    scyl(f'hull_keel_{k}', (x0, 0, -depth(x0) - 0.05), (x1, 0, -depth(x1) - 0.05), 0.12, 'iron', 'Hull', verts=6, smooth=False)
scyl('ram', (HALF - 0.6, 0, -0.5), (HALF + 1.8, 0, -0.65), 0.35, 'iron', 'Hull', r2=0.0, verts=6, smooth=False)
for k, x in enumerate((-5, -1.5, 2.0)):
    for y in (-1, 1):
        sball(f'porthole_{k}_{"P" if y < 0 else "S"}', (x, y * (half_width(x) - 0.02), -0.8), (0.22, 0.04, 0.22), 'window', 'Hull', segs=12)
        sring(f'porthole_rim_{k}_{"P" if y < 0 else "S"}', (x, y * (half_width(x) + 0.0), -0.8), 0.24, 0.05, 'brass', 'Hull', rot=(90, 0, 0), seg=16)

# --- deck: planks, rails, cabin --------------------------------------------
deck_me = bpy.data.meshes.new('deck')
bm = bmesh.new()
pts_p, pts_s = [], []
for i in range(41):
    x = -HALF + L * i / 40
    w = half_width(x) - 0.05
    pts_p.append(bm.verts.new((x, -w, 0)))
    pts_s.append(bm.verts.new((x, w, 0)))
for i in range(40):
    bm.faces.new((pts_p[i], pts_p[i + 1], pts_s[i + 1], pts_s[i]))
bm.to_mesh(deck_me)
bm.free()
deck = bpy.data.objects.new('deck', deck_me)
scene.collection.objects.link(deck)
sobj(deck, 'deck', 'deck', 'Deck')
for k in range(-7, 8):
    sbox(f'deck_seam_{k}', (0, k * 0.34, 0.005), (L - 2.5 - abs(k) * 0.35, 0.02, 0.01), 'hull_dark', 'Deck', bevel=0)
# rails: posts and a top rail along both sides
for side in (-1, 1):
    prev = None
    for i in range(18):
        x = -HALF + 0.4 + i * (L - 1.6) / 17
        y = side * (half_width(x) - 0.08)
        scyl(f'rail_post_{"P" if side < 0 else "S"}{i}', (x, y, 0), (x, y, 0.9), 0.05, 'hull_mid', 'Deck', verts=6, smooth=False)
        if prev:
            scyl(f'rail_{"P" if side < 0 else "S"}{i}', (prev[0], prev[1], 0.92), (x, y, 0.92), 0.06, 'hull_red', 'Deck', verts=6, smooth=False)
        prev = (x, y)
# captain's cabin at the stern with glowing windows
sbox('cabin', (-6.4, 0, 1.0), (3.2, 3.6, 2.0), 'hull_mid', 'Deck', bevel=0.05)
sbox('cabin_roof', (-6.4, 0, 2.12), (3.5, 3.9, 0.24), 'hull_red', 'Deck', bevel=0.1)
sbox('cabin_door', (-4.79, 0, 0.75), (0.08, 0.9, 1.5), 'hull_dark', 'Deck', bevel=0.1)
blob_door = sball('cabin_door_knob', (-4.73, 0.3, 0.75), (0.05, 0.05, 0.05), 'brass', 'Deck', segs=8)
for y in (-1.1, 1.1):
    sbox(f'cabin_window_{y:+.1f}', (-4.78, y, 1.25), (0.06, 0.6, 0.45), 'window', 'Deck', bevel=0)
    sbox(f'cabin_window_frame_{y:+.1f}', (-4.76, y, 1.25), (0.05, 0.7, 0.55), 'hull_dark', 'Deck', bevel=0)
# the wheel on the cabin roof
sempty('spin_wheel', (-5.3, 0, 2.9), 'Deck')
sring('wheel_rim', (-5.3, 0, 2.9), 0.45, 0.04, 'wood', 'Deck', rot=(0, 90, 0))
for k in range(4):
    sbox(f'wheel_spoke_{k}', (-5.3, 0, 2.9), (0.04, 1.1, 0.04), 'wood', 'Deck', rot=(k * 45, 0, 0), bevel=0)
scyl('wheel_post', (-5.3, 0, 2.24), (-5.3, 0, 2.9), 0.08, 'hull_dark', 'Deck')
for ob in [bpy.data.objects[n] for n in ('wheel_rim', 'wheel_spoke_0', 'wheel_spoke_1', 'wheel_spoke_2', 'wheel_spoke_3')]:
    ob.parent = bpy.data.objects['spin_wheel']
    ob.matrix_parent_inverse = bpy.data.objects['spin_wheel'].matrix_world.inverted()

# --- mast, crow's nest, flag -------------------------------------------------
scyl('mast', (1.5, 0, 0), (1.5, 0, 6.2), 0.16, 'wood', 'Rigging', r2=0.12)
scyl('crows_nest', (1.5, 0, 3.6), (1.5, 0, 4.2), 0.6, 'hull_mid', 'Rigging', r2=0.7, verts=12)
sring('crows_nest_rim', (1.5, 0, 4.2), 0.7, 0.05, 'hull_red', 'Rigging')
scyl('flag_pole', (-7.8, 0, 2.24), (-7.8, 0, 4.4), 0.04, 'iron', 'Rigging')
flag = sbox('flag_cloth', (-8.5, 0, 4.05), (1.3, 0.03, 0.8), 'black', 'Rigging', bevel=0)
sball('flag_skull', (-8.5, -0.03, 4.12), (0.17, 0.02, 0.17), 'bone', 'Rigging', segs=12)
for k, a in enumerate((35, -35)):
    sbox(f'flag_bone_{k}', (-8.5, -0.03, 3.88), (0.5, 0.02, 0.07), 'bone', 'Rigging', rot=(0, a, 0), bevel=0)
for x in (-0.06, 0.06):
    sball(f'flag_eye_{x:+.2f}', (-8.5 + x, -0.05, 4.13), (0.04, 0.01, 0.05), 'black', 'Rigging', segs=8)

# --- the balloon: black, patched, a skull on each side -----------------------
BZ = 8.4
sball('balloon', (0.5, 0, BZ), (9.5, 3.4, 3.4), 'balloon', 'Balloon', segs=32)
for k, x in enumerate((-6.5, -3.2, 0.5, 4.2, 7.4)):
    r = 3.4 * math.sqrt(max(0.05, 1 - ((x - 0.5) / 9.5) ** 2)) + 0.03
    sring(f'balloon_net_{k}', (x, 0, BZ), r, 0.05, 'rope', 'Balloon', rot=(0, 90, 0), seg=32)
sbox('balloon_spine', (0.5, 0, BZ + 3.35), (16, 0.12, 0.1), 'rope', 'Balloon', bevel=0)
# patches stitched on (flattened boxes pressed onto the surface)
import random
random.seed(4)
patch_mats = ['patch_red', 'patch_tan', 'patch_grey']
for k in range(10):
    x = random.uniform(-4.5, 5.5)
    ang = random.uniform(-55, 55) + (180 if k % 2 else 0)
    rr = 3.4 * math.sqrt(max(0.05, 1 - ((x - 0.5) / 9.5) ** 2))
    a = math.radians(ang)
    loc = (x, rr * math.sin(a), BZ + rr * math.cos(a) * 0.98)
    p = sbox(f'balloon_patch_{k}', loc, (random.uniform(0.8, 1.5), 0.06, random.uniform(0.6, 1.1)), patch_mats[k % 3], 'Balloon',
             rot=(math.degrees(-a) + 90, 0, 0), bevel=0.2)
    for s in range(3):
        sbox(f'balloon_stitch_{k}_{s}', loc, (0.04, 0.08, 0.18), 'rope', 'Balloon', rot=(math.degrees(-a) + 90, 0, 0), bevel=0)
        bpy.data.objects[f'balloon_stitch_{k}_{s}'].location.x += (s - 1) * 0.3
# big skull emblem on both sides
for side in (-1, 1):
    y = side * 3.38
    tag = 'P' if side < 0 else 'S'
    sball(f'skull_{tag}', (1.0, y, BZ + 0.3), (1.15, 0.1, 1.0), 'bone', 'Balloon')
    sbox(f'skull_jaw_{tag}', (1.0, y, BZ - 0.75), (1.1, 0.1, 0.5), 'bone', 'Balloon', bevel=0.3)
    for x in (0.55, 1.45):
        sball(f'skull_eye_{tag}_{x}', (x, y + side * 0.06, BZ + 0.35), (0.28, 0.05, 0.32), 'black', 'Balloon', segs=12)
    sball(f'skull_nose_{tag}', (1.0, y + side * 0.06, BZ - 0.2), (0.1, 0.05, 0.14), 'black', 'Balloon', segs=8)
    for t in range(4):
        sbox(f'skull_tooth_{tag}_{t}', (0.6 + t * 0.27, y + side * 0.06, BZ - 0.75), (0.05, 0.04, 0.4), 'black', 'Balloon', bevel=0)
    for k, a in enumerate((32, -32)):
        sbox(f'skull_bone_{tag}_{k}', (1.0, y, BZ - 0.2), (3.6, 0.08, 0.3), 'bone', 'Balloon', rot=(0, a, 0), bevel=0.4)
# tattered tail fins
for k, (rx, ry, rz, size) in enumerate([(0, 0, 0, (2.4, 0.08, 1.8)), (90, 0, 0, (2.4, 0.08, 1.8))]):
    for sgn in (-1, 1):
        f = sbox(f'tail_fin_{k}_{sgn}', (-8.2, 0, BZ), size, 'sail', 'Balloon', rot=(rx, 0, 0), bevel=0)
        f.location += Vector((0, 0, sgn * 1.9)) if k == 0 else Vector((0, sgn * 1.9, 0))
        f.rotation_euler[1] = math.radians(sgn * 8)
        sbox(f'tail_fin_tear_{k}_{sgn}', f.location + Vector((-0.9, 0, 0)), (0.5, 0.1, 0.35), 'balloon', 'Balloon',
             rot=(rx, 30, 0), bevel=0)
# ropes from the balloon down to the rails
for side in (-1, 1):
    for x in (-5.5, -2.0, 2.0, 5.0):
        w = half_width(x) - 0.1
        rr = 3.4 * math.sqrt(max(0.05, 1 - ((x - 0.5) / 9.5) ** 2))
        scyl(f'rope_{x}_{side}', (x, side * w, 0.92), (x, side * rr * 0.75, BZ - rr * 0.66), 0.025, 'rope', 'Rigging', verts=5, smooth=False)

# --- propellers on outriggers at the stern -----------------------------------
for side in (-1, 1):
    tag = 'P' if side < 0 else 'S'
    y = side * 3.5
    scyl(f'outrigger_{tag}', (-6.0, side * 1.6, 0.5), (-7.0, y, 1.2), 0.12, 'iron', 'Details', verts=8)
    scyl(f'engine_{tag}', (-6.3, y, 1.2), (-7.6, y, 1.2), 0.4, 'iron', 'Details', r2=0.32)
    sring(f'engine_band_{tag}', (-6.9, y, 1.2), 0.41, 0.04, 'brass', 'Details', rot=(0, 90, 0))
    scyl(f'exhaust_{tag}', (-6.6, y + side * 0.25, 1.5), (-6.4, y + side * 0.25, 2.3), 0.07, 'iron', 'Details', r2=0.1)
    prop = sempty(f'spin_prop_{tag}', (-7.75, y, 1.2), 'Details', drive='propeller')
    for k in range(3):
        b = sbox(f'prop_blade_{tag}_{k}', (-7.75, y, 1.2 + 0.55), (0.06, 0.28, 1.1), 'wood', 'Details', bevel=0.3)
        b.rotation_euler = (math.radians(k * 120), math.radians(12), 0)
        # rotate the blade about the hub
        b.location = Vector((-7.75, y, 1.2)) + Quaternion((1, 0, 0), math.radians(k * 120)) @ Vector((0, 0, 0.55))
        b.parent = prop
        b.matrix_parent_inverse = prop.matrix_world.inverted()
    sball(f'prop_hub_{tag}', (-7.8, y, 1.2), (0.16, 0.16, 0.16), 'brass', 'Details', segs=10)

# --- weapons: three cannons a side, a harpoon gun at the bow ------------------
for side in (-1, 1):
    tag = 'P' if side < 0 else 'S'
    for k, x in enumerate((-3.0, -0.4, 3.6)):
        w = half_width(x) - 0.35
        sbox(f'cannon_carriage_{tag}{k}', (x, side * (w - 0.25), 0.18), (0.6, 0.7, 0.3), 'wood', 'Weapons', bevel=0.1)
        for dx in (-0.25, 0.25):
            sring(f'cannon_wheel_{tag}{k}_{dx}', (x + dx, side * (w - 0.25), 0.15), 0.14, 0.04, 'hull_dark', 'Weapons', rot=(90, 0, 0), seg=12)
        scyl(f'cannon_{tag}{k}', (x, side * (w - 0.6), 0.42), (x, side * (w + 0.55), 0.48), 0.16, 'black', 'Weapons', r2=0.13, verts=14)
        sring(f'cannon_muzzle_{tag}{k}', (x, side * (w + 0.55), 0.48), 0.15, 0.04, 'black', 'Weapons', rot=(90, 0, 0), seg=14)
# harpoon gun on a swivel at the bow, with a coil of rope
sempty('harpoon_gun', (6.2, 0, 0.9), 'Weapons', drive='aim')
scyl('harpoon_base', (6.2, 0, 0), (6.2, 0, 0.8), 0.2, 'iron', 'Weapons')
sbox('harpoon_body', (6.35, 0, 0.95), (1.1, 0.35, 0.3), 'iron', 'Weapons', bevel=0.2)
scyl('harpoon_barrel', (6.8, 0, 0.98), (7.6, 0, 1.05), 0.08, 'black', 'Weapons')
scyl('harpoon_shaft', (7.0, 0, 1.06), (8.1, 0, 1.12), 0.03, 'wood', 'Weapons')
scyl('harpoon_tip', (8.1, 0, 1.12), (8.45, 0, 1.14), 0.09, 'steel', 'Weapons', r2=0.0, verts=4, smooth=False)
for k in range(2):
    sbox(f'harpoon_barb_{k}', (8.15, (k - 0.5) * 0.14, 1.12), (0.18, 0.04, 0.03), 'steel', 'Weapons', rot=(0, 0, (k - 0.5) * 60), bevel=0)
sring('harpoon_rope_coil', (5.6, 0.7, 0.12), 0.28, 0.07, 'rope', 'Weapons')
sring('harpoon_rope_coil_2', (5.6, 0.7, 0.24), 0.25, 0.07, 'rope', 'Weapons')
for ob_name in ('harpoon_base', 'harpoon_body', 'harpoon_barrel', 'harpoon_shaft', 'harpoon_tip', 'harpoon_barb_0', 'harpoon_barb_1'):
    ob = bpy.data.objects[ob_name]
    if ob_name != 'harpoon_base':
        ob.parent = bpy.data.objects['harpoon_gun']
        ob.matrix_parent_inverse = bpy.data.objects['harpoon_gun'].matrix_world.inverted()

# --- details: red lanterns, grappling hooks, a boarding plank, barrels --------
for k, (x, side) in enumerate([(-4.2, -1), (-4.2, 1), (4.8, -1), (4.8, 1)]):
    y = side * (half_width(x) - 0.08)
    scyl(f'lantern_post_{k}', (x, y, 0.92), (x, y, 1.5), 0.03, 'iron', 'Details', verts=6, smooth=False)
    sbox(f'lamp_red_{k}', (x, y, 1.62), (0.18, 0.18, 0.24), 'lamp_red', 'Details', bevel=0.2)
    sbox(f'lantern_cap_{k}', (x, y, 1.78), (0.24, 0.24, 0.06), 'iron', 'Details', bevel=0)
    sempty(f'light_red_{k}', (x, y, 1.62), 'Details', light_color='#ff5a3a', light_intensity=3, light_distance=6)
for k, x in enumerate((-2.0, 1.0, 4.0)):
    for side in (-1, 1):
        y = side * (half_width(x) + 0.05)
        scyl(f'grapple_line_{k}{side}', (x, y, 0.92), (x, y, -0.3), 0.02, 'rope', 'Details', verts=5, smooth=False)
        scyl(f'grapple_shank_{k}{side}', (x, y, -0.3), (x, y, -0.6), 0.03, 'iron', 'Details', verts=6, smooth=False)
        for t in range(3):
            a = math.radians(t * 120)
            scyl(f'grapple_tine_{k}{side}{t}', (x, y, -0.6), (x + math.cos(a) * 0.15, y + math.sin(a) * 0.15, -0.5), 0.02, 'iron', 'Details', verts=5, smooth=False)
# boarding plank, folded up against the starboard rail (swing it down in the game)
sempty('boarding_plank', (0.0, half_width(0) - 0.1, 0.1), 'Details', drive='plank')
plank = sbox('boarding_plank_board', (0.0, half_width(0) + 0.0, 1.3), (1.0, 0.1, 2.4), 'wood', 'Details', bevel=0.1)
plank.parent = bpy.data.objects['boarding_plank']
plank.matrix_parent_inverse = bpy.data.objects['boarding_plank'].matrix_world.inverted()
for k, (x, y) in enumerate([(-3.8, -1.4), (-3.4, -1.7), (5.0, 1.3)]):
    scyl(f'barrel_{k}', (x, y, 0), (x, y, 0.75), 0.3, 'wood', 'Details', verts=12)
    for z in (0.12, 0.62):
        sring(f'barrel_hoop_{k}_{z}', (x, y, z), 0.31, 0.02, 'iron', 'Details', seg=16)
sbox('powder_crate', (-3.6, 1.5, 0.3), (0.7, 0.6, 0.6), 'hull_mid', 'Details', bevel=0.1)
sbox('powder_crate_mark', (-3.6, 1.81, 0.3), (0.3, 0.02, 0.3), 'hull_red', 'Details', bevel=0)
for k in range(5):
    sball(f'cannonball_{k}', (-2.3 + (k % 3) * 0.24, 1.75 - (k // 3) * 0.24, 0.12 + (k // 3) * 0.1), (0.12, 0.12, 0.12), 'black', 'Details', segs=8)

# Place the ship next to the pirates in the file (the export resets it).
SHIP_OFFSET = Vector((0, 14, 0))
ship_roots = [o for o in bpy.data.objects if any(c.name in SC for c in o.users_collection) and o.parent is None]
for o in ship_roots:
    o.location += SHIP_OFFSET

# ---------------------------------------------------------------- preview niceties and notes
cam = bpy.data.cameras.new('preview_camera')
cam_ob = bpy.data.objects.new('preview_camera', cam)
scene.collection.objects.link(cam_ob)
scene.camera = cam_ob
sun = bpy.data.lights.new('preview_sun', 'SUN')
sun.energy = 3
sun_ob = bpy.data.objects.new('preview_sun', sun)
sun_ob.rotation_euler = (math.radians(50), 0, math.radians(30))
scene.collection.objects.link(sun_ob)
scene.frame_start, scene.frame_end = 0, 72

readme = bpy.data.texts.new('README')
readme.write("""Patch It Up - sky pirates

Pirates (collection 'Pirates'): Captain, Bosun, Lookout, Gunner, Deckhand.
* Each uses the crew skeleton (same bone names), so character.glb's
  animations play on them in the game. They share the crew's actions here
  for previewing: pick an action for a rig in Dope Sheet > Action Editor.
* Faces +Y here = forward in the game. Feet on z = 0.
* socket_hat / socket_hold / socket_hand_R are attachment points.
* The deckhand's 'spin_pack_prop' empty spins the backpack propeller.

Pirate ship (collection 'Pirate_Ship'):
* Bow toward +X, deck at height 0 (in the file it sits 14 m to the side;
  the export puts it back on the origin). 17 m long, balloon on top.
* Named parts for the game: spin_prop_P / spin_prop_S (propellers),
  spin_wheel, harpoon_gun (swivel), boarding_plank (hinge at the rail),
  cannon_P0..2 / cannon_S0..2, flag_cloth, lamp_red_* with light_red_*.

Export: run 'export_to_game.py' (Alt+P). It writes public/models/pirates.glb
(all five, no animations) and public/models/pirate_ship.glb.
""")

EXPORT = r'''# Export the pirates and their ship to the game. Text Editor > Run Script (Alt+P).
import bpy, os
from mathutils import Vector
blend = bpy.data.filepath
models = os.path.join(os.path.dirname(os.path.dirname(blend)), 'public', 'models')
OFFSET = Vector((0, 14, 0))
bpy.ops.wm.save_mainfile()

def objects_in(coll):
    out = set(coll.objects)
    for c in coll.children:
        out |= objects_in(c)
    return out

def export(path, objs, anims):
    bpy.ops.object.select_all(action='DESELECT')
    for o in objs:
        o.select_set(True)
    bpy.ops.export_scene.gltf(filepath=path, export_format='GLB', use_selection=True,
        export_extras=True, export_yup=True, export_apply=True, export_cameras=False,
        export_lights=False, export_animations=anims, export_skins=True)

pirates = objects_in(bpy.data.collections['Pirates'])
export(os.path.join(models, 'pirates.glb'), pirates, False)
ship = objects_in(bpy.data.collections['Pirate_Ship'])
roots = [o for o in ship if o.parent is None]
for o in roots: o.location -= OFFSET
export(os.path.join(models, 'pirate_ship.glb'), ship, False)
for o in roots: o.location += OFFSET
print('Exported pirates.glb and pirate_ship.glb to', models)
'''
bpy.data.texts.new('export_to_game.py').write(EXPORT)

bpy.ops.wm.save_as_mainfile(filepath=OUT_BLEND)

# ---------------------------------------------------------------- export here too
def objects_in(c):
    out = set(c.objects)
    for ch in c.children:
        out |= objects_in(ch)
    return out
def export(path, objs):
    bpy.ops.object.select_all(action='DESELECT')
    for o in objs:
        o.select_set(True)
    bpy.ops.export_scene.gltf(filepath=path, export_format='GLB', use_selection=True,
        export_extras=True, export_yup=True, export_apply=True, export_cameras=False,
        export_lights=False, export_animations=False, export_skins=True)
# pirates: put each back on the origin for the export? Keep their line-up spacing;
# the game places each one where it wants.
export(OUT_PIRATES, objects_in(bpy.data.collections['Pirates']))
for o in ship_roots:
    o.location -= SHIP_OFFSET
export(OUT_SHIP, objects_in(bpy.data.collections['Pirate_Ship']))
for o in ship_roots:
    o.location += SHIP_OFFSET
print('saved', OUT_BLEND, os.path.getsize(OUT_PIRATES), os.path.getsize(OUT_SHIP))
