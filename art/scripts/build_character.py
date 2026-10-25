# Builds art/character.blend and public/models/character.glb for Patch It Up.
# Run with Blender's Python:  python build_character.py  (bpy module)
#
# The character faces +Y in Blender, which is -Z (forward) in three.js.
# Feet stand on z = 0; the head centre is at eye height (1.5 m).
# Every body part is a separate mesh parented to a bone (no skin weights),
# so the rig is easy to read and pose by hand.

import bpy, math, os, sys
from mathutils import Vector, Quaternion, Matrix

OUT_BLEND = sys.argv[-2] if len(sys.argv) > 2 and sys.argv[-2].endswith('.blend') else '/home/claude/work/char/character.blend'
OUT_GLB = sys.argv[-1] if sys.argv[-1].endswith('.glb') else '/home/claude/work/char/character.glb'
FPS = 30

bpy.ops.wm.read_homefile(use_empty=True)
scene = bpy.context.scene
scene.render.fps = FPS

# ---------------------------------------------------------------- materials
def mat(name, color, rough=0.7, emit=None):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes['Principled BSDF']
    b.inputs['Base Color'].default_value = (*color, 1)
    b.inputs['Roughness'].default_value = rough
    m.diffuse_color = (*color, 1)
    return m

def srgb(h):
    h = h.lstrip('#')
    c = [int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)]
    return tuple(x / 12.92 if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4 for x in c)

M = {
    'shirt': mat('shirt', srgb('#d9d2c5')),       # recoloured per role in the game
    'pants': mat('pants', srgb('#3b3f58')),
    'skin': mat('skin', srgb('#f1c27d')),
    'boots': mat('boots', srgb('#4a2f1d')),
    'eyes': mat('eyes', srgb('#1a1a1a'), 0.3),
    'pack': mat('backpack', srgb('#8a5a36')),
    'belt': mat('belt', srgb('#2a1a10')),
    'brass': mat('brass', srgb('#c9973a'), 0.4),
    'iron': mat('iron', srgb('#6b7183'), 0.5),
    'wood': mat('handle_wood', srgb('#8a5a36')),
}

# ---------------------------------------------------------------- skeleton
BONES = [
    # name, head, tail, parent
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

arm_data = bpy.data.armatures.new('crew_rig')
rig = bpy.data.objects.new('crew', arm_data)
scene.collection.objects.link(rig)
bpy.context.view_layer.objects.active = rig
bpy.ops.object.mode_set(mode='EDIT')
for name, head, tail, parent in BONES:
    b = arm_data.edit_bones.new(name)
    b.head, b.tail = Vector(head), Vector(tail)
    b.roll = 0
    if parent:
        b.parent = arm_data.edit_bones[parent]
        b.use_connect = False
bpy.ops.object.mode_set(mode='OBJECT')
arm_data.display_type = 'STICK'
rig.show_in_front = True

# ---------------------------------------------------------------- body parts
def link(ob):
    scene.collection.objects.link(ob)
    return ob

def attach(ob, bone):
    bpy.context.view_layer.update()
    mw = ob.matrix_world.copy()
    ob.parent = rig
    ob.parent_type = 'BONE'
    ob.parent_bone = bone
    bpy.context.view_layer.update()
    ob.matrix_world = mw

def blob(name, bone, loc, scale, m, segs=16):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=segs, ring_count=segs // 2, radius=1, location=loc)
    ob = bpy.context.active_object
    ob.name = name
    ob.scale = scale
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    bpy.ops.object.shade_smooth()
    ob.data.materials.append(M[m])
    attach(ob, bone)
    return ob

def limb(name, bone, a, b, r, m, r2=None):
    a, b = Vector(a), Vector(b)
    mid, d = (a + b) / 2, (b - a)
    bpy.ops.mesh.primitive_cone_add(vertices=12, radius1=r, radius2=r2 or r, depth=d.length, location=mid)
    ob = bpy.context.active_object
    ob.name = name
    ob.rotation_mode = 'QUATERNION'
    ob.rotation_quaternion = Vector((0, 0, 1)).rotation_difference(d.normalized())
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=False)
    bpy.ops.object.shade_smooth()
    ob.data.materials.append(M[m])
    attach(ob, bone)
    return ob

def cube(name, bone, loc, size, m, rot=(0, 0, 0)):
    bpy.ops.mesh.primitive_cube_add(size=1, location=loc, rotation=rot)
    ob = bpy.context.active_object
    ob.name = name
    ob.scale = size
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)
    bev = ob.modifiers.new('round', 'BEVEL')
    bev.width, bev.segments = min(size) * 0.25, 2
    ob.data.materials.append(M[m])
    attach(ob, bone)
    return ob

# torso: shorts on the hips, shirt on spine and chest, a belt, a backpack
blob('body_pelvis', 'hips', (0, 0, 0.8), (0.19, 0.15, 0.13), 'pants')
blob('body_belly', 'spine', (0, 0, 1.0), (0.2, 0.16, 0.16), 'shirt')
blob('body_chest', 'chest', (0, 0, 1.16), (0.21, 0.165, 0.15), 'shirt')
limb('body_belt', 'hips', (0, 0, 0.87), (0, 0, 0.91), 0.195, 'belt')
cube('body_buckle', 'hips', (0, 0.18, 0.89), (0.06, 0.02, 0.045), 'brass')
cube('pack', 'chest', (0, -0.2, 1.1), (0.26, 0.12, 0.3), 'pack')
cube('pack_flap', 'chest', (0, -0.22, 1.24), (0.27, 0.13, 0.06), 'belt')
for x in (-0.12, 0.12):
    limb(f'pack_strap_{x:+.2f}', 'chest', (x, 0.15, 1.24), (x, 0.17, 1.02), 0.018, 'belt')

# head: a big round head (chibi, like PEAK), two dot eyes, a little nose
blob('head_ball', 'head', (0, 0, 1.5), (0.22, 0.21, 0.22), 'skin', 20)
for x in (-0.075, 0.075):
    blob(f'head_eye_{x:+.3f}', 'head', (x, 0.19, 1.53), (0.028, 0.02, 0.04), 'eyes', 10)
blob('head_nose', 'head', (0, 0.215, 1.48), (0.035, 0.03, 0.03), 'skin', 10)
blob('neck_piece', 'neck', (0, 0, 1.31), (0.07, 0.07, 0.06), 'skin', 10)

# arms: shirt sleeves, mitten hands, ball joints at shoulder and elbow
for s, x in (('L', -1), ('R', 1)):
    blob(f'arm_shoulder.{s}', f'upperarm.{s}', (0.21 * x, 0, 1.23), (0.075, 0.075, 0.075), 'shirt', 12)
    limb(f'arm_upper.{s}', f'upperarm.{s}', (0.21 * x, 0, 1.23), (0.23 * x, 0, 0.98), 0.062, 'shirt', 0.055)
    blob(f'arm_elbow.{s}', f'forearm.{s}', (0.23 * x, 0, 0.98), (0.055, 0.055, 0.055), 'shirt', 12)
    limb(f'arm_fore.{s}', f'forearm.{s}', (0.23 * x, 0, 0.98), (0.24 * x, 0, 0.77), 0.052, 'skin', 0.045)
    blob(f'arm_hand.{s}', f'hand.{s}', (0.243 * x, 0.01, 0.72), (0.058, 0.05, 0.068), 'skin', 12)
    # legs: trousers, knee ball, chunky boots
    limb(f'leg_thigh.{s}', f'thigh.{s}', (0.11 * x, 0, 0.78), (0.11 * x, 0, 0.42), 0.078, 'pants', 0.065)
    blob(f'leg_knee.{s}', f'shin.{s}', (0.11 * x, 0, 0.42), (0.065, 0.065, 0.065), 'pants', 12)
    limb(f'leg_shin.{s}', f'shin.{s}', (0.11 * x, 0, 0.42), (0.11 * x, 0, 0.12), 0.062, 'pants', 0.055)
    cube(f'leg_boot.{s}', f'foot.{s}', (0.11 * x, 0.04, 0.055), (0.12, 0.24, 0.11), 'boots')

# props in the right hand, hidden until an animation needs them
ham_h = limb('prop_hammer_handle', 'hand.R', (0.245, 0.0, 0.70), (0.245, 0.0, 0.42), 0.016, 'wood')
ham_k = cube('prop_hammer_head', 'hand.R', (0.245, 0.0, 0.42), (0.06, 0.16, 0.06), 'iron')

# sockets the game uses: hats on the head, held items in front of the chest
def socket(name, bone, loc):
    e = bpy.data.objects.new(name, None)
    e.empty_display_size = 0.08
    e.location = loc
    link(e)
    attach(e, bone)
    return e

socket('socket_hat', 'head', (0, 0, 1.5))
socket('socket_hold', 'chest', (0, 0.36, 0.98))

# ---------------------------------------------------------------- posing
# Rotations are written about the armature's axes, as if the parent bones
# were still at rest:  X = pitch (+ swings a hanging limb forward),
# Y = roll (+ moves a hanging left arm outward), Z = yaw (+ turns left).
REST = {b.name: b.matrix_local.to_quaternion() for b in arm_data.bones}
REST_M = {b.name: b.matrix_local.to_3x3() for b in arm_data.bones}
AX = {'X': Vector((1, 0, 0)), 'Y': Vector((0, 1, 0)), 'Z': Vector((0, 0, 1))}

def local_q(bone, spec):
    q = Quaternion()
    for axis, deg in spec:
        q = Quaternion(AX[axis], math.radians(deg)) @ q
    r = REST[bone]
    return r.inverted() @ q @ r

def local_loc(bone, v):
    return REST_M[bone].inverted() @ Vector(v)

for pb in rig.pose.bones:
    pb.rotation_mode = 'QUATERNION'

ALL = [b[0] for b in BONES]

def M2(side, deg):
    """Mirror helper: degrees about Y/Z flip sign for the right side."""
    return deg if side == 'L' else -deg

def apply_pose(p):
    """p: {bone: [(axis, deg), ...] or {'rot': [...], 'loc': (x,y,z)}}"""
    for name in ALL:
        pb = rig.pose.bones[name]
        spec = p.get(name, [])
        loc = (0, 0, 0)
        if isinstance(spec, dict):
            loc = spec.get('loc', (0, 0, 0))
            spec = spec.get('rot', [])
        pb.rotation_quaternion = local_q(name, spec)
        pb.location = local_loc(name, loc)

def key_all(frame):
    for name in ALL:
        pb = rig.pose.bones[name]
        pb.keyframe_insert('rotation_quaternion', frame=frame)
        pb.keyframe_insert('location', frame=frame)

def new_action(name):
    act = bpy.data.actions.new(name)
    act.use_fake_user = True
    rig.animation_data_create()
    rig.animation_data.action = act
    return act

def build(name, keys, frames):
    """keys: list of (frame, pose dict). Last frame == first for loops."""
    act = new_action(name)
    for f, p in keys:
        apply_pose(p)
        key_all(f)
    act.frame_range = (0, frames)
    act.use_frame_range = True
    return act

def mirror(p):
    """Swap left/right of a pose, flipping roll and yaw."""
    out = {}
    for bone, spec in p.items():
        if bone.endswith('.L'):
            nb = bone[:-2] + '.R'
        elif bone.endswith('.R'):
            nb = bone[:-2] + '.L'
        else:
            nb = bone
        def flip(rs):
            return [(a, -d if a in 'YZ' else d) for a, d in rs]
        if isinstance(spec, dict):
            loc = spec.get('loc', (0, 0, 0))
            out[nb] = {'rot': flip(spec.get('rot', [])), 'loc': (-loc[0], loc[1], loc[2])}
        else:
            out[nb] = flip(spec)
    return out

def merge(*ps):
    out = {}
    for p in ps:
        out.update(p)
    return out

ARMS_DOWN = {
    'upperarm.L': [('Y', 6)], 'upperarm.R': [('Y', -6)],
    'forearm.L': [('X', 12)], 'forearm.R': [('X', 12)],
}

# ---------------------------------------------------------------- Idle (2.4 s)
idle_a = merge(ARMS_DOWN, {
    'hips': {'loc': (0, 0, 0)},
    'thigh.L': [('X', 3)], 'shin.L': [('X', -5)], 'foot.L': [('X', 2)],
    'thigh.R': [('X', 3)], 'shin.R': [('X', -5)], 'foot.R': [('X', 2)],
})
idle_b = merge(idle_a, {
    'hips': {'loc': (0, 0, -0.012)},
    'thigh.L': [('X', 6)], 'shin.L': [('X', -11)], 'foot.L': [('X', 5)],
    'thigh.R': [('X', 6)], 'shin.R': [('X', -11)], 'foot.R': [('X', 5)],
    'spine': [('X', 2)], 'chest': [('X', -3)],
    'head': [('X', 3), ('Z', 4)],
    'upperarm.L': [('Y', 9), ('X', 3)], 'upperarm.R': [('Y', -9), ('X', -2)],
    'forearm.L': [('X', 16)], 'forearm.R': [('X', 16)],
})
build('Idle', [(0, idle_a), (36, idle_b), (72, idle_a)], 72)

# ---------------------------------------------------------------- Walk (1.0 s, 2 steps)
# Native speed: ~1.3 m/s. Phase 0 = left heel strikes in front.
walk_contact = merge({
    'hips': {'rot': [('Z', -5)], 'loc': (0, 0, -0.02)},
    'spine': [('Z', 3)], 'chest': [('Z', 4), ('X', -2)],
    'thigh.L': [('X', 26)], 'shin.L': [('X', -4)], 'foot.L': [('X', 14)],
    'thigh.R': [('X', -20)], 'shin.R': [('X', -14)], 'foot.R': [('X', -18)],
    'upperarm.L': [('X', -20), ('Y', 6)], 'upperarm.R': [('X', 22), ('Y', -6)],
    'forearm.L': [('X', 12)], 'forearm.R': [('X', 26)],
    'head': [('Z', 2)],
})
walk_pass = merge({
    'hips': {'rot': [('Z', 0)], 'loc': (0, 0, 0.012)},
    'chest': [('X', -2)],
    'thigh.L': [('X', -2)], 'shin.L': [('X', -6)], 'foot.L': [('X', 4)],
    'thigh.R': [('X', 14)], 'shin.R': [('X', -48)], 'foot.R': [('X', 12)],
    'upperarm.L': [('X', -2), ('Y', 6)], 'upperarm.R': [('X', 4), ('Y', -6)],
    'forearm.L': [('X', 14)], 'forearm.R': [('X', 18)],
})
build('Walk', [(0, walk_contact), (8, walk_pass), (15, mirror(walk_contact)), (23, mirror(walk_pass)), (30, walk_contact)], 30)

# ---------------------------------------------------------------- Run (0.6 s, 2 steps)
# Native speed: 4 m/s (the game's normal speed). Leaning in, elbows bent.
run_contact = {
    'hips': {'rot': [('Z', -8), ('X', -4)], 'loc': (0, 0, -0.05)},
    'spine': [('X', -9), ('Z', 5)], 'chest': [('X', -4), ('Z', 6)], 'head': [('X', 9), ('Z', 3)],
    'thigh.L': [('X', 36)], 'shin.L': [('X', -16)], 'foot.L': [('X', 8)],
    'thigh.R': [('X', -30)], 'shin.R': [('X', -42)], 'foot.R': [('X', -26)],
    'upperarm.L': [('X', -38), ('Y', 10)], 'upperarm.R': [('X', 42), ('Y', -10)],
    'forearm.L': [('X', 70)], 'forearm.R': [('X', 92)],
}
run_float = {
    'hips': {'rot': [('Z', -2), ('X', -4)], 'loc': (0, 0, 0.035)},
    'spine': [('X', -9)], 'chest': [('X', -4)], 'head': [('X', 9)],
    'thigh.L': [('X', -12)], 'shin.L': [('X', -28)], 'foot.L': [('X', -14)],
    'thigh.R': [('X', 34)], 'shin.R': [('X', -104)], 'foot.R': [('X', 14)],
    'upperarm.L': [('X', -8), ('Y', 10)], 'upperarm.R': [('X', 12), ('Y', -10)],
    'forearm.L': [('X', 80)], 'forearm.R': [('X', 84)],
}
build('Run', [(0, run_contact), (5, run_float), (9, mirror(run_contact)), (14, mirror(run_float)), (18, run_contact)], 18)

# ---------------------------------------------------------------- Jump (rising, held)
jump_a = {
    'hips': {'rot': [('X', 4)], 'loc': (0, 0, 0.02)},
    'spine': [('X', -4)], 'head': [('X', -6)],
    'thigh.L': [('X', 44)], 'shin.L': [('X', -78)], 'foot.L': [('X', 16)],
    'thigh.R': [('X', 22)], 'shin.R': [('X', -52)], 'foot.R': [('X', 10)],
    'upperarm.L': [('X', 120), ('Y', 24)], 'upperarm.R': [('X', 112), ('Y', -24)],
    'forearm.L': [('X', 20)], 'forearm.R': [('X', 26)],
}
jump_b = merge(jump_a, {
    'thigh.L': [('X', 48)], 'shin.L': [('X', -84)],
    'upperarm.L': [('X', 126), ('Y', 28)], 'upperarm.R': [('X', 120), ('Y', -28)],
})
build('Jump', [(0, jump_a), (6, jump_b), (12, jump_a)], 12)

# ---------------------------------------------------------------- Fall (falling, flailing)
fall_a = {
    'hips': {'rot': [('X', 6)]},
    'spine': [('X', 4)], 'head': [('X', -10)],
    'thigh.L': [('X', 22)], 'shin.L': [('X', -40)], 'foot.L': [('X', -10)],
    'thigh.R': [('X', -4)], 'shin.R': [('X', -22)], 'foot.R': [('X', -16)],
    'upperarm.L': [('Y', 72), ('X', 10)], 'upperarm.R': [('Y', -60), ('X', -6)],
    'forearm.L': [('X', 30)], 'forearm.R': [('X', 22)],
}
fall_b = merge(mirror(fall_a), {
    'upperarm.L': [('Y', 60), ('X', -6)], 'upperarm.R': [('Y', -72), ('X', 10)],
})
build('Fall', [(0, fall_a), (12, fall_b), (24, fall_a)], 24)

# ---------------------------------------------------------------- Land (0.4 s, one-shot)
land_low = {
    'hips': {'rot': [('X', 8)], 'loc': (0, 0, -0.2)},
    'spine': [('X', -16)], 'chest': [('X', -6)], 'head': [('X', 14)],
    'thigh.L': [('X', 58)], 'shin.L': [('X', -98)], 'foot.L': [('X', 40)],
    'thigh.R': [('X', 52)], 'shin.R': [('X', -94)], 'foot.R': [('X', 42)],
    'upperarm.L': [('X', 34), ('Y', 26)], 'upperarm.R': [('X', 30), ('Y', -26)],
    'forearm.L': [('X', 40)], 'forearm.R': [('X', 40)],
}
land_mid = merge(land_low, {'hips': {'rot': [('X', 4)], 'loc': (0, 0, -0.09)},
                            'thigh.L': [('X', 30)], 'shin.L': [('X', -52)], 'foot.L': [('X', 22)],
                            'thigh.R': [('X', 28)], 'shin.R': [('X', -50)], 'foot.R': [('X', 22)],
                            'spine': [('X', -6)]})
build('Land', [(0, land_mid), (3, land_low), (8, land_mid), (12, idle_a)], 12)

# ---------------------------------------------------------------- TurnStep (shuffle when turning on the spot)
step_l = merge(idle_a, {'hips': {'loc': (0, 0, 0.01)}, 'thigh.L': [('X', 22)], 'shin.L': [('X', -42)], 'foot.L': [('X', 12)]})
build('TurnStep', [(0, idle_a), (3, step_l), (6, idle_a), (9, mirror(step_l)), (12, idle_a)], 12)

# ---------------------------------------------------------------- Steer (hands on the wheel)
steer_a = merge(idle_a, {
    'spine': [('X', -4)], 'chest': [('X', -2)],
    'upperarm.L': [('X', 58), ('Y', 14), ('Z', -12)], 'upperarm.R': [('X', 58), ('Y', -14), ('Z', 12)],
    'forearm.L': [('X', 38)], 'forearm.R': [('X', 38)],
    'hand.L': [('X', -10)], 'hand.R': [('X', -10)],
})
steer_b = merge(steer_a, {'chest': [('X', -3), ('Z', 3)], 'upperarm.L': [('X', 62), ('Y', 14), ('Z', -12)]})
build('Steer', [(0, steer_a), (24, steer_b), (48, steer_a)], 48)

# ---------------------------------------------------------------- Carry (arms round a box)
carry_a = merge(idle_a, {
    'chest': [('X', 3)],
    'upperarm.L': [('X', 38), ('Y', 16), ('Z', -18)], 'upperarm.R': [('X', 38), ('Y', -16), ('Z', 18)],
    'forearm.L': [('X', 62)], 'forearm.R': [('X', 62)],
    'hand.L': [('Y', 20)], 'hand.R': [('Y', -20)],
})
carry_b = merge(carry_a, {'upperarm.L': [('X', 41), ('Y', 16), ('Z', -18)], 'upperarm.R': [('X', 41), ('Y', -16), ('Z', 18)]})
build('Carry', [(0, carry_a), (15, carry_b), (30, carry_a)], 30)

# ---------------------------------------------------------------- Hammer (kneel and hammer a patch)
hammer_up = {
    'hips': {'rot': [('X', 10)], 'loc': (0, -0.05, -0.3)},
    'spine': [('X', -26)], 'chest': [('X', -10)], 'head': [('X', 22)],
    'thigh.L': [('X', 84)], 'shin.L': [('X', -88)], 'foot.L': [('X', 4)],
    'thigh.R': [('X', 12)], 'shin.R': [('X', -118)], 'foot.R': [('X', -30)],
    'upperarm.L': [('X', 64), ('Y', 12)], 'forearm.L': [('X', 22)],
    'upperarm.R': [('X', 148), ('Y', -18)], 'forearm.R': [('X', 62)], 'hand.R': [('X', 30)],
}
hammer_hit = merge(hammer_up, {
    'spine': [('X', -30)],
    'upperarm.R': [('X', 64), ('Y', -12)], 'forearm.R': [('X', 4)], 'hand.R': [('X', -20)],
})
build('Hammer', [(0, hammer_up), (7, hammer_hit), (9, hammer_hit), (15, hammer_up)], 15)

# ---------------------------------------------------------------- Reach (pull a lever / press a button)
reach = merge(idle_a, {
    'spine': [('X', -6), ('Z', 6)], 'chest': [('Z', 6)],
    'upperarm.R': [('X', 82), ('Y', -6)], 'forearm.R': [('X', 6)], 'hand.R': [('X', -12)],
})
pull = merge(reach, {'upperarm.R': [('X', 58), ('Y', -6)], 'forearm.R': [('X', 34)], 'spine': [('X', -2), ('Z', 4)]})
build('Reach', [(0, idle_a), (5, reach), (9, pull), (16, idle_a)], 16)

# ---------------------------------------------------------------- Wave (hello!)
wave_up = merge(idle_a, {
    'chest': [('Z', -4)], 'head': [('Z', -6), ('X', -4)],
    'upperarm.R': [('Y', -152), ('X', 10)], 'forearm.R': [('X', 30)], 'hand.R': [('X', -10)],
})
wave_l = merge(wave_up, {'forearm.R': [('X', 30), ('Y', 28)]})
wave_r = merge(wave_up, {'forearm.R': [('X', 30), ('Y', -24)]})
build('Wave', [(0, idle_a), (7, wave_up), (12, wave_l), (18, wave_r), (24, wave_l), (30, wave_r), (35, wave_up), (44, idle_a)], 44)

# ---------------------------------------------------------------- FlyHover (floating in place)
# Legs dangle and kick a little, arms out to the sides paddle the air.
hover_a = {
    'hips': {'loc': (0, 0, 0.02)},
    'spine': [('X', 3)], 'head': [('X', -4)],
    'thigh.L': [('X', 12)], 'shin.L': [('X', -28)], 'foot.L': [('X', -22)],
    'thigh.R': [('X', 2)], 'shin.R': [('X', -14)], 'foot.R': [('X', -28)],
    'upperarm.L': [('Y', 58), ('X', 14)], 'upperarm.R': [('Y', -58), ('X', 14)],
    'forearm.L': [('X', 24)], 'forearm.R': [('X', 24)],
    'hand.L': [('X', -10)], 'hand.R': [('X', -10)],
}
hover_b = merge(mirror(hover_a), {
    'hips': {'loc': (0, 0, -0.02)},
    'upperarm.L': [('Y', 46), ('X', 30)], 'upperarm.R': [('Y', -46), ('X', 30)],
    'forearm.L': [('X', 34)], 'forearm.R': [('X', 34)],
    'hand.L': [('X', 10)], 'hand.R': [('X', 10)],
})
build('FlyHover', [(0, hover_a), (24, hover_b), (48, hover_a)], 48)

# ---------------------------------------------------------------- FlyForward (swooping ahead)
# The game tips the whole body forward with speed; this clip keeps the arms
# swept back, the legs trailing together with pointed toes, and the chest
# arched so the head stays up. A gentle flutter keeps it alive.
swoop_a = {
    'hips': {'loc': (0, 0, 0)},
    'spine': [('X', 10)], 'chest': [('X', 8)], 'head': [('X', 12)],
    'thigh.L': [('X', -12), ('Y', 3)], 'shin.L': [('X', -14)], 'foot.L': [('X', -45)],
    'thigh.R': [('X', -4), ('Y', -3)], 'shin.R': [('X', -8)], 'foot.R': [('X', -45)],
    'upperarm.L': [('X', -38), ('Y', 26)], 'upperarm.R': [('X', -38), ('Y', -26)],
    'forearm.L': [('X', 8)], 'forearm.R': [('X', 8)],
    'hand.L': [('X', -20)], 'hand.R': [('X', -20)],
}
swoop_b = merge(swoop_a, {
    'thigh.L': [('X', -4), ('Y', 3)], 'shin.L': [('X', -8)],
    'thigh.R': [('X', -12), ('Y', -3)], 'shin.R': [('X', -14)],
    'upperarm.L': [('X', -44), ('Y', 30)], 'upperarm.R': [('X', -44), ('Y', -30)],
})
build('FlyForward', [(0, swoop_a), (18, swoop_b), (36, swoop_a)], 36)

# ---------------------------------------------------------------- finish
rig.animation_data.action = bpy.data.actions['Idle']
apply_pose(idle_a)
for ob in (ham_h, ham_k):
    ob['prop'] = 'hammer'
scene.frame_start, scene.frame_end = 0, 72

# A floor and a light so the file looks right when opened.
bpy.ops.mesh.primitive_plane_add(size=6, location=(0, 0, 0))
floor = bpy.context.active_object
floor.name = 'preview_floor'
floor.data.materials.append(mat('preview_floor', srgb('#2f6e4f')))
floor.hide_render = False
floor['preview_only'] = True
sun = bpy.data.lights.new('preview_sun', 'SUN')
sun.energy = 3
sun_ob = bpy.data.objects.new('preview_sun', sun)
sun_ob.rotation_euler = (math.radians(50), 0, math.radians(30))
link(sun_ob)
cam = bpy.data.cameras.new('preview_camera')
cam_ob = bpy.data.objects.new('preview_camera', cam)
cam_ob.location = (2.6, 3.2, 1.6)
link(cam_ob)
con = cam_ob.constraints.new('TRACK_TO')
con.target = rig
scene.camera = cam_ob

# Notes inside the file for whoever opens it.
txt = bpy.data.texts.new('README')
txt.write("""Patch It Up - crew character

* The character faces +Y here (that is forward / -Z in the game).
* Every body part is its own mesh parented to a bone: select the rig 'crew',
  go to Pose Mode and rotate bones to pose it. No weight painting needed.
* Animations are Actions: Idle, Walk, Run, Jump, Fall, Land, TurnStep, Steer,
  Carry, Hammer, Reach, Wave, FlyHover, FlyForward. Pick one in the Dope Sheet > Action Editor.
  Walk and Run are stride-locked in the game: keep 2 steps per loop and the
  left heel striking on frame 0, or feet will slide.
* 'shirt' is recoloured per role in the game. socket_hat and socket_hold are
  where hats and carried things go. prop_hammer_* only shows while hammering.
* Export: run the 'export_to_game.py' text (Alt+P) - it writes
  public/models/character.glb with every action, skipping preview_* objects.
""")

exp = bpy.data.texts.new('export_to_game.py')
exp.write(r'''# Export the character to the game. Text Editor > Run Script (Alt+P).
import bpy, os
blend = bpy.data.filepath
project = os.path.dirname(os.path.dirname(blend))
out = os.path.join(project, 'public', 'models', 'character.glb')
bpy.ops.wm.save_mainfile()
hidden = []
for ob in bpy.data.objects:
    if ob.get('preview_only') or ob.name.startswith('preview_'):
        hidden.append((ob, ob.hide_get()))
        ob.hide_set(True)
bpy.ops.export_scene.gltf(
    filepath=out, export_format='GLB', use_visible=True,
    export_extras=True, export_yup=True, export_apply=True,
    export_cameras=False, export_lights=False,
    export_animations=True, export_animation_mode='ACTIONS',
    export_force_sampling=True, export_frame_range=False,
    export_skins=True, export_def_bones=False,
)
for ob, was in hidden:
    ob.hide_set(was)
print('Exported', out)
''')

os.makedirs(os.path.dirname(OUT_BLEND), exist_ok=True)
bpy.ops.wm.save_as_mainfile(filepath=OUT_BLEND)

# Export (preview objects hidden)
for ob in (floor, sun_ob, cam_ob):
    ob.hide_set(True)
bpy.ops.export_scene.gltf(
    filepath=OUT_GLB, export_format='GLB', use_visible=True,
    export_extras=True, export_yup=True, export_apply=True,
    export_cameras=False, export_lights=False,
    export_animations=True, export_animation_mode='ACTIONS',
    export_force_sampling=True, export_frame_range=False,
    export_skins=True, export_def_bones=False,
)
for ob in (floor, sun_ob, cam_ob):
    ob.hide_set(False)
print('actions', [a.name for a in bpy.data.actions])
print('saved', OUT_BLEND, OUT_GLB, os.path.getsize(OUT_GLB))
