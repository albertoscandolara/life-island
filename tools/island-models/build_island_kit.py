"""
Builds the island kit: every landmark, prop and the peak of the 3D island hub,
modelled in Blender and exported to one glTF binary that the shell loads
(`apps/shell/public/island/island-kit.glb`).

Run it with Blender's Python module (`pip install bpy`, Python 3.13) or with
Blender itself:

    python3 tools/island-models/build_island_kit.py
    blender --background --python tools/island-models/build_island_kit.py

Conventions the shell relies on (island-scene.ts):

- One object per model, named `landmark-<landmark>` (modules.ts `landmark`),
  `plinth`, `peak`, or `prop-<kind>`. Its origin is where it stands.
- Blender's -Y is the model's front: it faces you when its zone does.
- Materials named after a palette slot are re-painted from the design
  system's tokens at runtime, so the island follows the theme and each zone
  takes its area's accent: `tint` (the area's accent), `foam`, `sand`,
  `grass`, `rock`, `trunk`, `leaves`, `water`, `window`. Any other material
  keeps the colour it has here (gold, flowers, tyres...).
- Everything is a few hundred faces: the whole kit stays well under 1 MB.
"""

import math
import os
import random

import bpy
import bmesh

random.seed(7)
OUT = os.path.join(
    os.path.dirname(os.path.abspath(__file__)),
    "..",
    "..",
    "apps",
    "shell",
    "public",
    "island",
    "island-kit.glb",
)

bpy.ops.wm.read_factory_settings(use_empty=True)

# ---- materials ---------------------------------------------------------------

# Slot materials: their colour here is only a preview; the shell repaints them.
PALETTE = {
    "tint": "#3a9d8f",
    "foam": "#f7f4ee",
    "sand": "#e3c99a",
    "grass": "#6db36d",
    "rock": "#8a8f98",
    "trunk": "#8a5a3b",
    "leaves": "#3f9a55",
    "water": "#5fa8d3",
    "window": "#bfe3f0",
}
# Fixed materials: the same in both themes.
FIXED = {
    "gold": "#f2c14e",
    "wood": "#a8754f",
    "dark": "#3b3f4a",
    "red": "#e0594b",
    "orange": "#f08a3c",
    "yellow": "#f6d55c",
    "pink": "#f3a6c0",
    "lilac": "#b49be0",
    "green-fruit": "#8cc152",
    "book-1": "#4f8fd6",
    "book-2": "#e07a5f",
    "book-3": "#81b29a",
    "snow": "#ffffff",
}
M = {}


def hex_rgba(value):
    value = value.lstrip("#")
    srgb = [int(value[i : i + 2], 16) / 255 for i in (0, 2, 4)]
    linear = [c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4 for c in srgb]
    return (*linear, 1.0)


for name, colour in {**PALETTE, **FIXED}.items():
    material = bpy.data.materials.new(name)
    material.use_nodes = True
    bsdf = material.node_tree.nodes["Principled BSDF"]
    bsdf.inputs["Base Color"].default_value = hex_rgba(colour)
    bsdf.inputs["Roughness"].default_value = 0.35 if name in ("gold", "window") else 0.8
    if name == "gold":
        bsdf.inputs["Metallic"].default_value = 0.6
    M[name] = material

# ---- building blocks ---------------------------------------------------------

parts = []


def _finish(obj, mat, smooth, bevel, segments=1):
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    if bevel:
        modifier = obj.modifiers.new("bevel", "BEVEL")
        modifier.width = bevel
        modifier.segments = segments
        modifier.limit_method = "ANGLE"
        bpy.ops.object.modifier_apply(modifier="bevel")
    obj.data.materials.clear()
    obj.data.materials.append(M[mat])
    if smooth:
        bpy.ops.object.shade_smooth()
    else:
        bpy.ops.object.shade_flat()
    parts.append(obj)
    return obj


def box(mat, size, loc, rot=(0, 0, 0), bevel=0.02, smooth=False):
    bpy.ops.mesh.primitive_cube_add(size=1, location=loc, rotation=rot)
    obj = bpy.context.active_object
    obj.scale = size
    return _finish(obj, mat, smooth, bevel)


def cyl(mat, radius, depth, loc, rot=(0, 0, 0), v=16, bevel=0.0, smooth=True, r2=None):
    if r2 is None:
        bpy.ops.mesh.primitive_cylinder_add(
            vertices=v, radius=radius, depth=depth, location=loc, rotation=rot
        )
    else:
        bpy.ops.mesh.primitive_cone_add(
            vertices=v, radius1=radius, radius2=r2, depth=depth, location=loc, rotation=rot
        )
    obj = bpy.context.active_object
    return _finish(obj, mat, smooth and v >= 8, bevel)


def cone(mat, radius, depth, loc, rot=(0, 0, 0), v=16, smooth=False, scale=(1, 1, 1)):
    bpy.ops.mesh.primitive_cone_add(
        vertices=v, radius1=radius, radius2=0, depth=depth, location=loc, rotation=rot
    )
    obj = bpy.context.active_object
    obj.scale = scale
    return _finish(obj, mat, smooth, 0)


def sphere(mat, radius, loc, scale=(1, 1, 1), seg=16, rings=10, rot=(0, 0, 0)):
    bpy.ops.mesh.primitive_uv_sphere_add(
        segments=seg, ring_count=rings, radius=radius, location=loc, rotation=rot
    )
    obj = bpy.context.active_object
    obj.scale = scale
    return _finish(obj, mat, True, 0)


def blob(mat, radius, loc, scale=(1, 1, 1), sub=1, jitter=0.0, smooth=False):
    bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=sub, radius=radius, location=loc)
    obj = bpy.context.active_object
    obj.scale = scale
    if jitter:
        for vertex in obj.data.vertices:
            vertex.co *= 1 + random.uniform(-jitter, jitter)
    return _finish(obj, mat, smooth, 0)


def torus(mat, major, minor, loc, rot=(0, 0, 0), seg=24, scale=(1, 1, 1)):
    bpy.ops.mesh.primitive_torus_add(
        major_radius=major,
        minor_radius=minor,
        major_segments=seg,
        minor_segments=8,
        location=loc,
        rotation=rot,
    )
    obj = bpy.context.active_object
    obj.scale = scale
    return _finish(obj, mat, True, 0)


def prism(mat, width, depth, height, loc, bevel=0.02):
    """A gable roof: a triangle `width` wide and `height` tall, `depth` long (along Y)."""
    mesh = bpy.data.meshes.new("prism")
    w, d, h = width / 2, depth / 2, height
    verts = [(-w, -d, 0), (w, -d, 0), (0, -d, h), (-w, d, 0), (w, d, 0), (0, d, h)]
    faces = [(0, 1, 2), (5, 4, 3), (0, 3, 4, 1), (1, 4, 5, 2), (0, 2, 5, 3)]
    mesh.from_pydata(verts, [], faces)
    obj = bpy.data.objects.new("prism", mesh)
    bpy.context.collection.objects.link(obj)
    obj.location = loc
    bpy.context.view_layer.objects.active = obj
    for other in bpy.context.selected_objects:
        other.select_set(False)
    obj.select_set(True)
    return _finish(obj, mat, False, bevel)


def model(name):
    """Joins the parts made since the last call into one object called `name`."""
    global parts
    for obj in bpy.context.selected_objects:
        obj.select_set(False)
    for obj in parts:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = parts[0]
    bpy.ops.object.join()
    joined = bpy.context.active_object
    joined.name = name
    joined.data.name = name
    # The model stands on the world origin, whichever part was joined into.
    bpy.context.scene.cursor.location = (0, 0, 0)
    bpy.ops.object.origin_set(type="ORIGIN_CURSOR")
    parts = []
    return joined


def flowers(spots, colours=("red", "yellow", "pink", "lilac")):
    for i, (x, y) in enumerate(spots):
        cyl("leaves", 0.012, 0.08, (x, y, 0.2), v=4, smooth=False)
        blob(colours[i % len(colours)], 0.035, (x, y, 0.25), sub=1)


def bush(x, y, size=0.12, z=0.17):
    blob("leaves", size, (x, y, z + size * 0.5), scale=(1, 1, 0.85), sub=2, jitter=0.08, smooth=True)
    blob("leaves", size * 0.75, (x + size * 0.7, y + size * 0.2, z + size * 0.4), sub=2, jitter=0.08, smooth=True)


def window(x, y, z, w=0.12, h=0.14, facing="front", frame=True):
    if facing == "front":
        box("window", (w, 0.02, h), (x, y, z), bevel=0.005)
        if frame:
            box("foam", (w + 0.03, 0.012, 0.025), (x, y - 0.012, z - h / 2 - 0.01), bevel=0.004)
    else:  # on a side wall (x)
        box("window", (0.02, w, h), (x, y, z), bevel=0.005)


# ---- the plinth every zone stands on ----------------------------------------

cyl("sand", 1.12, 0.2, (0, 0, 0), v=6, bevel=0.035, smooth=False)
cyl("tint", 1.0, 0.07, (0, 0, 0.125), v=6, bevel=0.02, smooth=False)
cyl("grass", 0.9, 0.04, (0, 0, 0.15), v=6, bevel=0.0, smooth=False)
for i in range(6):
    a = math.radians(i * 60 + 30)
    blob("rock", 0.045, (math.cos(a) * 1.05, math.sin(a) * 1.05, 0.12), sub=1, jitter=0.2)
model("plinth")

# ---- landmarks (zone ground at z = 0.17, front = -Y) -------------------------

G = 0.17  # top of the plinth's grass

# Houses: a cottage with a chimney, a fence and a flower bed.
box("foam", (0.72, 0.56, 0.46), (0, 0.05, G + 0.23), bevel=0.025)
prism("tint", 0.86, 0.68, 0.34, (0, 0.05, G + 0.46))
box("rock", (0.11, 0.11, 0.3), (0.2, 0.18, G + 0.68), bevel=0.015)
box("dark", (0.13, 0.13, 0.03), (0.2, 0.18, G + 0.84), bevel=0.01)
box("wood", (0.14, 0.03, 0.26), (-0.12, -0.235, G + 0.13), bevel=0.01)
sphere("gold", 0.012, (-0.07, -0.255, G + 0.13))
window(0.16, -0.235, G + 0.27)
window(0.37, 0.05, G + 0.27, facing="side")
window(-0.37, 0.05, G + 0.27, facing="side")
for i in range(9):
    x = -0.64 + i * 0.16
    box("foam", (0.025, 0.025, 0.14), (x, -0.62, G + 0.07), bevel=0.006)
box("foam", (1.3, 0.018, 0.022), (0, -0.62, G + 0.1), bevel=0.004)
for x in (-0.38, -0.22, -0.06, 0.06):
    box("sand", (0.09, 0.09, 0.012), (x * 0.4 - 0.1, -0.35 + x * 0.3 - 0.12, G + 0.005), bevel=0.01)
flowers([(0.18, -0.4), (0.3, -0.42), (0.42, -0.38), (-0.45, -0.38), (-0.55, -0.3)])
bush(0.55, 0.45)
bush(-0.55, 0.4, 0.1)
model("landmark-house")

# Agenda: a clock tower.
box("foam", (0.62, 0.62, 0.18), (0, 0, G + 0.09), bevel=0.03)
box("foam", (0.44, 0.44, 1.05), (0, 0, G + 0.7), bevel=0.025)
box("tint", (0.5, 0.5, 0.06), (0, 0, G + 1.24), bevel=0.015)
cone("tint", 0.38, 0.42, (0, 0, G + 1.48), rot=(0, 0, math.pi / 4), v=4)
sphere("gold", 0.04, (0, 0, G + 1.71))
cyl("foam", 0.17, 0.03, (0, -0.225, G + 0.98), rot=(math.pi / 2, 0, 0), v=24)
torus("tint", 0.17, 0.018, (0, -0.24, G + 0.98), rot=(math.pi / 2, 0, 0))
box("dark", (0.02, 0.01, 0.12), (0, -0.25, G + 1.02), bevel=0.0)
box("dark", (0.09, 0.01, 0.02), (0.035, -0.25, G + 0.98), bevel=0.0)
for z in (0.42, 0.66):
    window(0, -0.225, G + z, w=0.1, h=0.16)
box("wood", (0.16, 0.03, 0.24), (0, -0.315, G + 0.2), bevel=0.01)
bush(0.45, -0.3, 0.1)
flowers([(-0.4, -0.35), (-0.5, -0.25), (0.35, 0.4)])
model("landmark-clock")

# 730 & taxes: a little treasury temple.
box("foam", (0.98, 0.72, 0.06), (0, 0, G + 0.03), bevel=0.01)
box("foam", (0.9, 0.64, 0.06), (0, 0, G + 0.09), bevel=0.01)
box("foam", (0.7, 0.4, 0.5), (0, 0.08, G + 0.37), bevel=0.02)
for x in (-0.33, -0.11, 0.11, 0.33):
    cyl("foam", 0.045, 0.5, (x, -0.22, G + 0.37), v=12)
    box("foam", (0.11, 0.11, 0.03), (x, -0.22, G + 0.635), bevel=0.008)
box("tint", (0.86, 0.62, 0.07), (0, 0, G + 0.68), bevel=0.015)
bpy.ops.object.select_all(action="DESELECT")
prism("tint", 0.88, 0.64, 0.22, (0, 0, G + 0.715))
cyl("gold", 0.075, 0.025, (0, -0.33, G + 0.79), rot=(math.pi / 2, 0, 0), v=20)
box("wood", (0.16, 0.02, 0.28), (0, -0.125, G + 0.26), bevel=0.01)
for i in range(3):
    cyl("gold", 0.07, 0.03, (0.42, -0.38, G + 0.015 + i * 0.032), v=16)
for i in range(2):
    cyl("gold", 0.07, 0.03, (0.55, -0.28, G + 0.015 + i * 0.032), v=16)
box("foam", (0.16, 0.12, 0.01), (-0.45, -0.4, G + 0.005), rot=(0, 0, 0.3), bevel=0.0)
bush(-0.55, 0.35, 0.1)
model("landmark-vault")

# Groceries: a market stall with a striped awning and crates of fruit.
box("wood", (0.9, 0.36, 0.3), (0, 0.05, G + 0.15), bevel=0.02)
for x in (-0.42, 0.42):
    for y in (-0.12, 0.22):
        cyl("wood", 0.025, 0.8, (x, y, G + 0.4), v=8)
for i in range(6):
    stripe = "tint" if i % 2 == 0 else "foam"
    box(stripe, (0.16, 0.5, 0.03), (-0.4 + i * 0.16, 0.0, G + 0.83), rot=(0.32, 0, 0), bevel=0.008)
for i in range(6):
    stripe = "tint" if i % 2 == 0 else "foam"
    box(stripe, (0.16, 0.025, 0.08), (-0.4 + i * 0.16, -0.245, G + 0.73), bevel=0.006)
for cx, fruit in ((-0.28, "red"), (0.0, "orange"), (0.28, "green-fruit")):
    box("wood", (0.24, 0.2, 0.08), (cx, -0.02, G + 0.34), bevel=0.01)
    for i in range(5):
        sphere(fruit, 0.04, (cx - 0.07 + (i % 3) * 0.07, -0.05 + (i // 3) * 0.07, G + 0.41), seg=10, rings=6)
box("wood", (0.22, 0.18, 0.14), (0.55, -0.35, G + 0.07), rot=(0, 0, 0.3), bevel=0.012)
for i in range(4):
    sphere("yellow", 0.035, (0.5 + (i % 2) * 0.08, -0.36 + (i // 2) * 0.05, G + 0.16), scale=(1.6, 0.8, 0.8), seg=10, rings=6)
box("wood", (0.2, 0.16, 0.12), (-0.55, -0.3, G + 0.06), rot=(0, 0, -0.2), bevel=0.012)
for i in range(3):
    sphere("green-fruit", 0.05, (-0.6 + i * 0.06, -0.3, G + 0.15), seg=10, rings=6)
model("landmark-market")

# Health: a cottage clinic with a rounded roof and a cross sign.
box("foam", (0.74, 0.5, 0.44), (0, 0.05, G + 0.22), bevel=0.03)
cyl("tint", 0.28, 0.8, (0, 0.05, G + 0.44), rot=(0, math.pi / 2, 0), v=20)
box("foam", (0.78, 0.6, 0.02), (0, 0.05, G + 0.44), bevel=0.0)
box("foam", (0.26, 0.04, 0.26), (0, -0.21, G + 0.62), bevel=0.02)
box("red", (0.17, 0.02, 0.055), (0, -0.235, G + 0.62), bevel=0.006)
box("red", (0.055, 0.02, 0.17), (0, -0.235, G + 0.62), bevel=0.006)
box("wood", (0.15, 0.03, 0.26), (0, -0.21, G + 0.13), bevel=0.01)
cyl("window", 0.065, 0.02, (-0.22, -0.205, G + 0.27), rot=(math.pi / 2, 0, 0), v=16)
cyl("window", 0.065, 0.02, (0.22, -0.205, G + 0.27), rot=(math.pi / 2, 0, 0), v=16)
for x in (-0.45, 0.45):
    cyl("orange", 0.06, 0.1, (x, -0.35, G + 0.05), v=10, r2=0.045)
    blob("leaves", 0.08, (x, -0.35, G + 0.15), sub=2, jitter=0.1, smooth=True)
flowers([(-0.3, -0.5), (0.3, -0.5), (0.0, -0.55)])
model("landmark-clinic")

# Work: an office tower with a lower wing and a water tank.
box("foam", (0.5, 0.5, 1.35), (-0.12, 0.05, G + 0.675), bevel=0.02)
for row in range(5):
    for col in range(2):
        window(-0.22 + col * 0.2, -0.205, G + 0.25 + row * 0.23, w=0.12, h=0.13, frame=False)
box("tint", (0.42, 0.44, 0.62), (0.35, 0.08, G + 0.31), bevel=0.02)
for row in range(2):
    window(0.35, -0.145, G + 0.2 + row * 0.24, w=0.24, h=0.13, frame=False)
box("tint", (0.54, 0.54, 0.05), (-0.12, 0.05, G + 1.37), bevel=0.012)
cyl("rock", 0.07, 0.12, (-0.2, 0.12, G + 1.46), v=12)
cyl("dark", 0.008, 0.3, (0.0, 0.0, G + 1.55), v=4, smooth=False)
sphere("red", 0.02, (0.0, 0.0, G + 1.71))
box("window", (0.18, 0.03, 0.22), (-0.12, -0.205, G + 0.11), bevel=0.005)
for x in (-0.5, 0.6):
    cyl("trunk", 0.025, 0.25, (x, -0.4, G + 0.125), v=6)
    blob("leaves", 0.12, (x, -0.4, G + 0.32), sub=2, jitter=0.08, smooth=True)
model("landmark-office")

# Studies: a domed library with a stack of books.
box("foam", (0.8, 0.5, 0.45), (0, 0.06, G + 0.225), bevel=0.02)
for x in (-0.28, -0.1, 0.1, 0.28):
    cyl("foam", 0.035, 0.42, (x, -0.22, G + 0.21), v=10)
box("foam", (0.84, 0.16, 0.05), (0, -0.16, G + 0.45), bevel=0.01)
cyl("foam", 0.24, 0.12, (0, 0.06, G + 0.51), v=20)
sphere("tint", 0.24, (0, 0.06, G + 0.57), scale=(1, 1, 0.85), seg=20, rings=10)
sphere("gold", 0.03, (0, 0.06, G + 0.79))
box("wood", (0.14, 0.02, 0.24), (0, -0.19, G + 0.12), bevel=0.01)
for i, colour in enumerate(("book-1", "book-2", "book-3", "book-1", "book-2")):
    box(colour, (0.22, 0.16, 0.045), (0.5, -0.35, G + 0.025 + i * 0.047), rot=(0, 0, 0.12 * (i % 3 - 1)), bevel=0.008)
box("book-3", (0.2, 0.15, 0.04), (-0.48, -0.38, G + 0.02), rot=(0, 0, 0.4), bevel=0.008)
cyl("trunk", 0.03, 0.35, (-0.55, 0.3, G + 0.175), v=6)
blob("leaves", 0.17, (-0.55, 0.3, G + 0.45), sub=2, jitter=0.08, smooth=True)
model("landmark-library")

# People & IDs: a gate with a big ID card.
for x in (-0.36, 0.36):
    box("foam", (0.16, 0.2, 0.82), (x, 0.1, G + 0.41), bevel=0.02)
    box("tint", (0.2, 0.24, 0.06), (x, 0.1, G + 0.03), bevel=0.01)
box("tint", (0.94, 0.26, 0.14), (0, 0.1, G + 0.88), bevel=0.025)
box("foam", (0.5, 0.04, 0.34), (0, -0.28, G + 0.3), rot=(0.12, 0, 0.18), bevel=0.02)
box("tint", (0.5, 0.045, 0.07), (0, -0.282, G + 0.43), rot=(0.12, 0, 0.18), bevel=0.0)
box("rock", (0.12, 0.05, 0.14), (-0.13, -0.3, G + 0.27), rot=(0.12, 0, 0.18), bevel=0.01)
for i in range(3):
    box("rock", (0.18 - i * 0.04, 0.05, 0.022), (0.08, -0.305 + i * 0.0, G + 0.3 - i * 0.05), rot=(0.12, 0, 0.18), bevel=0.0)
box("wood", (0.06, 0.06, 0.2), (0.02, -0.18, G + 0.1), bevel=0.01)
flowers([(-0.55, -0.35), (0.55, -0.3), (0.5, -0.45)])
bush(-0.6, 0.35, 0.1)
model("landmark-gate")

# Cars: a cute rounded car in front of its garage.
box("foam", (0.7, 0.5, 0.46), (0, 0.3, G + 0.23), bevel=0.03)
prism("tint", 0.78, 0.58, 0.18, (0, 0.3, G + 0.46))
for i in range(4):
    box("rock", (0.46, 0.02, 0.06), (0, 0.045, G + 0.07 + i * 0.075), bevel=0.006)
box("tint", (0.62, 0.34, 0.18), (0, -0.28, G + 0.15), bevel=0.07, smooth=True)
box("window", (0.34, 0.3, 0.14), (-0.03, -0.28, G + 0.28), bevel=0.05, smooth=True)
box("tint", (0.36, 0.32, 0.03), (-0.03, -0.28, G + 0.355), bevel=0.012)
for x in (-0.2, 0.2):
    for y in (-0.44, -0.12):
        cyl("dark", 0.07, 0.06, (x, y, G + 0.07), rot=(math.pi / 2, 0, 0), v=16)
        cyl("foam", 0.03, 0.065, (x, y, G + 0.07), rot=(math.pi / 2, 0, 0), v=10)
for y in (-0.38, -0.18):
    sphere("yellow", 0.025, (0.31, y, G + 0.17), seg=10, rings=6)
bush(0.55, 0.0, 0.1)
model("landmark-garage")

# Money: a treasure chest spilling coins, with stacks beside it.
box("wood", (0.46, 0.3, 0.24), (0, 0, G + 0.12), bevel=0.02)
cyl("tint", 0.15, 0.48, (0, 0.13, G + 0.27), rot=(0, math.pi / 2, 0), v=16)
for x in (-0.18, 0.18):
    box("gold", (0.03, 0.32, 0.26), (x, 0, G + 0.13), bevel=0.006)
box("gold", (0.06, 0.03, 0.08), (0, -0.155, G + 0.2), bevel=0.006)
for i in range(9):
    sphere("gold", 0.04, (-0.15 + (i % 5) * 0.075, -0.05 + (i // 5) * 0.06, G + 0.25), scale=(1, 1, 0.35), seg=12, rings=6)
for x, y, n in ((-0.45, -0.3, 5), (0.42, -0.28, 3), (0.55, 0.1, 4), (-0.5, 0.15, 2)):
    for i in range(n):
        cyl("gold", 0.075, 0.032, (x, y, G + 0.016 + i * 0.034), v=16)
for x, y in ((-0.2, -0.4), (0.15, -0.45), (0.05, -0.32)):
    cyl("gold", 0.06, 0.02, (x, y, G + 0.01), rot=(0.2, 0.1, 0), v=14)
model("landmark-coins")

# Contracts & subscriptions: a kiosk with a satellite dish and a screen.
box("foam", (0.6, 0.48, 0.48), (0, 0.05, G + 0.24), bevel=0.03)
box("tint", (0.68, 0.56, 0.06), (0, 0.05, G + 0.5), bevel=0.015)
box("dark", (0.36, 0.03, 0.2), (0, -0.2, G + 0.28), bevel=0.012)
box("window", (0.32, 0.01, 0.16), (0, -0.218, G + 0.28), bevel=0.0)
cyl("rock", 0.025, 0.24, (0.15, 0.1, G + 0.64), v=8)
sphere("foam", 0.2, (0.15, 0.04, G + 0.82), scale=(1, 0.35, 1), rot=(0.5, 0, 0), seg=20, rings=10)
cyl("dark", 0.01, 0.18, (0.15, -0.04, G + 0.82), rot=(0.9, 0, 0), v=4, smooth=False)
sphere("tint", 0.025, (0.15, -0.11, G + 0.88))
for i in range(3):
    box("tint", (0.08, 0.06, 0.1), (-0.45 + i * 0.09, -0.35, G + 0.05), rot=(0, 0, 0.1 * i), bevel=0.01)
flowers([(0.5, -0.35), (0.42, -0.45)])
model("landmark-antenna")

# Fitness: a running track round a field, with a finish arch and cones.
box("grass", (0.92, 0.6, 0.02), (0, 0, G + 0.01), bevel=0.0)
torus("tint", 0.48, 0.07, (0, 0, G + 0.02), scale=(1.15, 0.75, 0.2), seg=32)
for x in (-0.18, 0.18):
    box("foam", (0.04, 0.04, 0.5), (x, -0.42, G + 0.25), bevel=0.008)
box("tint", (0.42, 0.05, 0.08), (0, -0.42, G + 0.5), bevel=0.012)
box("foam", (0.03, 0.4, 0.008), (0, 0, G + 0.025), bevel=0.0)
for x, y in ((-0.6, -0.4), (0.62, -0.35), (0.6, 0.38)):
    cone("orange", 0.045, 0.12, (x, y, G + 0.06), v=10)
for x in (-0.3, 0.3):
    box("foam", (0.03, 0.18, 0.12), (x, 0.0, G + 0.08), bevel=0.006)
model("landmark-track")

# Goals: a small summit with a path and a flag on top.
blob("rock", 0.5, (0, 0.05, G + 0.12), scale=(1.0, 0.9, 0.85), sub=2, jitter=0.12)
blob("grass", 0.36, (0.05, 0.0, G + 0.32), scale=(1, 0.9, 0.7), sub=2, jitter=0.1)
blob("snow", 0.16, (0.0, 0.05, G + 0.5), scale=(1, 1, 0.6), sub=2, jitter=0.1, smooth=True)
cyl("foam", 0.012, 0.6, (0.0, 0.05, G + 0.82), v=6)
for i in range(3):
    box("tint", (0.11, 0.012, 0.16), (0.06 + i * 0.1, 0.05, G + 1.04 - i * 0.012), rot=(0, 0, 0.18 * (1 - i)), bevel=0.0)
for i in range(4):
    box("sand", (0.1, 0.06, 0.02), (-0.28 + i * 0.07, -0.42 + i * 0.07, G + 0.03 + i * 0.07), rot=(0, 0, 0.7), bevel=0.008)
flowers([(0.5, -0.4), (-0.55, -0.3)])
model("landmark-flag")

# Dreams: a striped hot-air balloon with a cloud beside it.
bpy.ops.mesh.primitive_uv_sphere_add(segments=16, ring_count=12, radius=0.36, location=(0, 0, G + 1.05))
balloon = bpy.context.active_object
balloon.scale = (1, 1, 1.15)
bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
balloon.data.materials.append(M["tint"])
balloon.data.materials.append(M["foam"])
for face in balloon.data.polygons:
    centre = face.center
    sector = int(((math.atan2(centre.y, centre.x) + math.pi) / (2 * math.pi)) * 8)
    face.material_index = sector % 2
bpy.ops.object.shade_smooth()
parts.append(balloon)
cone("tint", 0.17, 0.2, (0, 0, G + 0.6), rot=(math.pi, 0, 0), v=16, smooth=True)
box("wood", (0.24, 0.24, 0.17), (0, 0, G + 0.33), bevel=0.03)
for x in (-0.09, 0.09):
    for y in (-0.09, 0.09):
        cyl("dark", 0.006, 0.26, (x * 1.1, y * 1.1, G + 0.53), v=4, smooth=False)
for dx, dz, r in ((0.5, 0.75, 0.13), (0.62, 0.74, 0.1), (0.42, 0.7, 0.09)):
    blob("snow", r, (dx, -0.2, G + dz), scale=(1.2, 0.9, 0.8), sub=2, smooth=True)
cyl("rock", 0.02, 0.15, (0.0, -0.35, G + 0.075), v=6)
box("wood", (0.05, 0.05, 0.05), (0.06, -0.33, G + 0.025), bevel=0.01)
flowers([(-0.45, -0.35), (-0.55, -0.2), (0.45, -0.45)], colours=("pink", "lilac", "yellow"))
model("landmark-balloon")

# Travel: a little pier with a sailboat in its own pool of sea.
cyl("water", 0.55, 0.03, (0.15, -0.2, G + 0.0), v=24, smooth=False)
for i in range(5):
    box("wood", (0.12, 0.42, 0.03), (-0.42 + i * 0.13, 0.25, G + 0.08), bevel=0.006)
for x in (-0.45, 0.07):
    cyl("wood", 0.025, 0.16, (x, 0.05, G + 0.05), v=8)
sphere("tint", 0.32, (0.15, -0.25, G + 0.05), scale=(1.1, 0.45, 0.35), seg=16, rings=8)
box("foam", (0.62, 0.24, 0.03), (0.15, -0.25, G + 0.13), bevel=0.01)
cyl("trunk", 0.015, 0.75, (0.15, -0.25, G + 0.5), v=6)
cone("foam", 0.28, 0.6, (0.28, -0.25, G + 0.52), v=3, scale=(0.6, 0.06, 1))
cone("tint", 0.2, 0.42, (0.03, -0.25, G + 0.42), v=3, scale=(0.45, 0.06, 1))
box("red", (0.1, 0.01, 0.05), (0.2, -0.25, G + 0.88), bevel=0.0)
box("wood", (0.16, 0.12, 0.12), (-0.3, 0.3, G + 0.16), bevel=0.012)
box("tint", (0.14, 0.1, 0.1), (-0.15, 0.32, G + 0.15), bevel=0.012)
model("landmark-boat")

# Settings: a striped lighthouse on its rocks, its lamp lit.
for i in range(6):
    z0 = G + 0.12 + i * 0.16
    r0 = 0.27 - i * 0.022
    cyl("tint" if i % 2 == 0 else "foam", r0, 0.16, (0, 0, z0 + 0.08), v=20, r2=r0 - 0.022)
torus("dark", 0.17, 0.018, (0, 0, G + 1.1), seg=20)
cyl("window", 0.11, 0.18, (0, 0, G + 1.2), v=12)
cone("tint", 0.15, 0.18, (0, 0, G + 1.38), v=12, smooth=True)
sphere("gold", 0.025, (0, 0, G + 1.48))
box("wood", (0.1, 0.03, 0.18), (0, -0.255, G + 0.21), bevel=0.01)
for x, y, r in ((-0.38, -0.25, 0.16), (0.35, -0.3, 0.13), (0.4, 0.25, 0.15), (-0.3, 0.32, 0.12)):
    blob("rock", r, (x, y, G + r * 0.4), scale=(1, 1, 0.7), sub=1, jitter=0.15)
model("landmark-lighthouse")

# ---- the peak and the props ----------------------------------------------------

bpy.ops.mesh.primitive_cone_add(vertices=11, radius1=1.35, radius2=0.08, depth=2.3, location=(0, 0, 1.15))
peak = bpy.context.active_object
bpy.ops.object.mode_set(mode="EDIT")
bpy.ops.mesh.subdivide(number_cuts=3)
bpy.ops.object.mode_set(mode="OBJECT")
for vertex in peak.data.vertices:
    if 0.05 < vertex.co.z < 2.2:
        vertex.co.x *= 1 + random.uniform(-0.12, 0.12)
        vertex.co.y *= 1 + random.uniform(-0.12, 0.12)
        vertex.co.z += random.uniform(-0.06, 0.06)
peak.data.materials.append(M["rock"])
peak.data.materials.append(M["snow"])
peak.data.materials.append(M["grass"])
for face in peak.data.polygons:
    face.material_index = 1 if face.center.z > 1.55 else (2 if face.center.z < 0.35 else 0)
bpy.ops.object.shade_flat()
parts.append(peak)
# A waterfall down the front and a pool at its foot.
box("water", (0.12, 0.05, 0.9), (0.12, -0.6, 0.75), rot=(0.42, 0, 0), bevel=0.02)
cyl("water", 0.32, 0.04, (0.12, -1.0, 0.27), v=16, smooth=False)
for a in range(0, 360, 45):
    rad = math.radians(a)
    blob("rock", 0.06, (0.12 + math.cos(rad) * 0.34, -1.0 + math.sin(rad) * 0.34, 0.28), sub=1, jitter=0.2)
model("peak")

# A palm leaning a little, with drooping fronds and coconuts.
x = y = 0.0
z = 0.0
for i in range(6):
    cyl("trunk", 0.075 - i * 0.007, 0.22, (x, y, z + 0.11), rot=(0, 0.06 * i, 0), v=7, smooth=False)
    x += 0.02 + i * 0.008
    z += 0.21
for i in range(7):
    a = i * (2 * math.pi / 7)
    leaf = cone(
        "leaves",
        0.11,
        0.75,
        (x + math.cos(a) * 0.3, y + math.sin(a) * 0.3, z - 0.02),
        rot=(0, math.pi / 2 + 0.35, a),
        v=4,
        scale=(1, 0.35, 1),
    )
for i in range(3):
    a = i * 2.1
    sphere("trunk", 0.045, (x + math.cos(a) * 0.06, y + math.sin(a) * 0.06, z - 0.07), seg=8, rings=6)
model("prop-palm")

# A round tree.
cyl("trunk", 0.05, 0.4, (0, 0, 0.2), v=7, smooth=False)
blob("leaves", 0.28, (0, 0, 0.55), sub=2, jitter=0.1, smooth=True)
blob("leaves", 0.2, (0.15, 0.08, 0.42), sub=2, jitter=0.1, smooth=True)
blob("leaves", 0.18, (-0.12, -0.1, 0.45), sub=2, jitter=0.1, smooth=True)
model("prop-tree")

# A pine.
cyl("trunk", 0.04, 0.2, (0, 0, 0.1), v=6, smooth=False)
for i, (r, h) in enumerate(((0.28, 0.4), (0.22, 0.35), (0.15, 0.3))):
    cone("leaves", r, h, (0, 0, 0.32 + i * 0.2), v=8)
model("prop-pine")

# A bush with berries.
bush(0, 0, 0.14, 0.0)
for i in range(4):
    a = i * 1.6
    sphere("red", 0.025, (math.cos(a) * 0.12, math.sin(a) * 0.12, 0.15), seg=8, rings=5)
model("prop-bush")

# A cluster of rocks.
blob("rock", 0.18, (0, 0, 0.06), scale=(1.2, 1, 0.7), sub=1, jitter=0.2)
blob("rock", 0.1, (0.2, 0.08, 0.03), sub=1, jitter=0.2)
blob("rock", 0.07, (-0.16, -0.12, 0.02), sub=1, jitter=0.2)
model("prop-rocks")

# Flowers in the grass.
for i in range(6):
    a = i * 1.05
    r = 0.06 + (i % 3) * 0.05
    cyl("leaves", 0.01, 0.1, (math.cos(a) * r, math.sin(a) * r, 0.05), v=4, smooth=False)
    blob(("red", "yellow", "pink", "lilac", "snow", "orange")[i], 0.03, (math.cos(a) * r, math.sin(a) * r, 0.11), sub=1)
model("prop-flowers")

# A cloud.
for dx, dz, r in ((0, 0, 0.42), (0.42, -0.05, 0.32), (-0.4, -0.06, 0.3), (0.15, 0.2, 0.3)):
    blob("snow", r, (dx, 0, dz), scale=(1.2, 0.9, 0.8), sub=2, smooth=True)
model("prop-cloud")

# A small sailboat out at sea.
sphere("foam", 0.3, (0, 0, 0.0), scale=(1.1, 0.4, 0.3), seg=14, rings=8)
cyl("trunk", 0.012, 0.6, (0, 0, 0.32), v=5, smooth=False)
cone("foam", 0.24, 0.5, (0.11, 0, 0.36), v=3, scale=(0.6, 0.06, 1))
box("red", (0.08, 0.01, 0.04), (0.04, 0, 0.64), bevel=0.0)
model("prop-sailboat")

# A beach umbrella with a towel.
cyl("foam", 0.012, 0.5, (0, 0, 0.25), v=5, smooth=False)
cyl("red", 0.3, 0.12, (0, 0, 0.52), v=8, r2=0.02, smooth=False)
box("yellow", (0.18, 0.34, 0.01), (0.2, 0.05, 0.005), rot=(0, 0, 0.3), bevel=0.0)
model("prop-umbrella")

# ---- export ------------------------------------------------------------------

os.makedirs(os.path.dirname(OUT), exist_ok=True)
bpy.ops.object.select_all(action="SELECT")
bpy.ops.export_scene.gltf(
    filepath=OUT,
    export_format="GLB",
    use_selection=True,
    export_apply=True,
    export_yup=True,
    export_texcoords=False,
    export_normals=True,
    export_materials="EXPORT",
    export_cameras=False,
    export_lights=False,
)
print(f"island kit: {OUT} ({os.path.getsize(OUT) // 1024} KB)")
