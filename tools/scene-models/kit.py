"""
Shared building blocks for the Blender kits (tools/island-models and
tools/scene-models): materials named after palette slots, a few low-poly
primitives, `model(name)` to join the parts made since the last call, and
`export(path)` to write one glTF binary.

    import kit
    kit.start({"tint": "#3a9d8f"}, {"gold": "#f2c14e"})
    kit.box("tint", (1, 1, 1), (0, 0, 0.5))
    kit.model("crate")
    kit.export("out.glb")

Conventions every scene relies on: one object per model, its origin where it
stands, Blender's -Y its front. Materials named after a palette slot are
repainted from the design tokens at runtime; any other keeps its colour.
"""

import os
import random

import bpy

M = {}
parts = []

# Materials with a little shine; everything else is matte.
SHINY = ("gold", "window", "glass", "chrome", "paint")


def hex_rgba(value):
    value = value.lstrip("#")
    srgb = [int(value[i : i + 2], 16) / 255 for i in (0, 2, 4)]
    linear = [c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4 for c in srgb]
    return (*linear, 1.0)


def start(palette, fixed, seed=7):
    """An empty Blender scene with one material per palette slot and fixed colour."""
    global parts
    random.seed(seed)
    bpy.ops.wm.read_factory_settings(use_empty=True)
    M.clear()
    parts = []
    for name, colour in {**palette, **fixed}.items():
        material = bpy.data.materials.new(name)
        material.use_nodes = True
        bsdf = material.node_tree.nodes["Principled BSDF"]
        bsdf.inputs["Base Color"].default_value = hex_rgba(colour)
        bsdf.inputs["Roughness"].default_value = 0.35 if name in SHINY else 0.8
        if name in ("gold", "chrome"):
            bsdf.inputs["Metallic"].default_value = 0.6
        M[name] = material


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


def profile(mat, points, width, y=0.0, bevel=0.03, segments=2, smooth=False):
    """A side silhouette: `points` (x, z) in order, extruded `width` along Y, centred on `y`."""
    mesh = bpy.data.meshes.new("profile")
    w = width / 2
    n = len(points)
    verts = [(x, y - w, z) for x, z in points] + [(x, y + w, z) for x, z in points]
    faces = [tuple(range(n))[::-1], tuple(range(n, 2 * n))]
    faces += [(i, (i + 1) % n, n + (i + 1) % n, n + i) for i in range(n)]
    mesh.from_pydata(verts, [], faces)
    mesh.update()
    obj = bpy.data.objects.new("profile", mesh)
    bpy.context.collection.objects.link(obj)
    bpy.context.view_layer.objects.active = obj
    for other in bpy.context.selected_objects:
        other.select_set(False)
    obj.select_set(True)
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.mesh.normals_make_consistent(inside=False)
    bpy.ops.object.mode_set(mode="OBJECT")
    return _finish(obj, mat, smooth, bevel, segments)


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



def export(path):
    """Writes every model in the scene to one glTF binary at `path`."""
    os.makedirs(os.path.dirname(path), exist_ok=True)
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.export_scene.gltf(
        filepath=path,
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
    print(f"kit: {path} ({os.path.getsize(path) // 1024} KB)")
