"""
Builds the area kits: the Blender models the Cars garage, the Houses of Home
and the Dreams sky load in place of their primitives, one glTF binary each,
in the area's own public folder:

    apps/mfe-cars/public/garage/garage-kit.glb
    apps/mfe-home/public/houses/houses-kit.glb
    apps/mfe-dreams/public/dreams/dreams-kit.glb

Run it with Blender's Python module (`pip install bpy`, Python 3.13) or with
Blender itself:

    python3 tools/scene-models/build_area_kits.py
    blender --background --python tools/scene-models/build_area_kits.py

Conventions the scenes rely on (garage-scene.ts, houses-scene.ts,
dream-sky.ts): one object per model, its origin on the ground in the middle;
a car's nose points to +X, a house's front to -Y (+Z in three.js, towards the
camera). Materials named after a palette slot are repainted from the design
tokens at runtime: the car's `body`, a house's `roof`, the dream stone's
`stone`, and the shared slots each scene lists. Fixed materials keep their
colour in both themes.
"""

import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from kit import blob, box, cone, cyl, export, model, prism, profile, sphere, start, torus  # noqa: E402

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "apps")


# ---- Cars: a parking spot and a car per body type ---------------------------

def garage():
    start(
        {
            # Slots: repainted from --garage-* and the car's own colour.
            "body": "#d9534f",
            "asphalt": "#4a4f59",
            "line": "#f2f2f2",
            "glass": "#9fc9de",
            "tyre": "#2b2d33",
            "hub": "#c9ced6",
            "light": "#fff4c2",
        },
        {"dark": "#30333a", "red": "#d63b3b", "orange": "#f0a03c", "chrome": "#d7dbe0", "rock": "#9aa0a8"},
    )

    # The spot: a round tile with a kerb, a painted bay and a wheel stop.
    cyl("asphalt", 1.25, 0.16, (0, 0, -0.08), v=32, bevel=0.03, smooth=False, r2=1.31)
    torus("rock", 1.27, 0.035, (0, 0, 0.0), seg=40)
    box("line", (0.05, 1.7, 0.01), (-1.0, 0, 0.002), bevel=0.0)
    box("line", (0.05, 1.7, 0.01), (1.0, 0, 0.002), bevel=0.0)
    box("rock", (0.08, 0.5, 0.06), (-0.92, 0, 0.03), bevel=0.02)
    model("spot")

    def wheels(xs, half_track, r=0.2, width=0.15):
        for x in xs:
            for side in (-1, 1):
                y = side * half_track
                cyl("tyre", r, width, (x, y, r), rot=(math.pi / 2, 0, 0), v=20, bevel=0.03, smooth=True)
                cyl("hub", r * 0.52, width + 0.012, (x, y, r), rot=(math.pi / 2, 0, 0), v=10, bevel=0.01, smooth=False)
                cyl("dark", r * 0.16, width + 0.02, (x, y, r), rot=(math.pi / 2, 0, 0), v=6, smooth=False)

    def lights(nose, tail, z, half, h=0.07, front_w=0.06):
        for side in (-1, 1):
            box("light", (0.03, 0.17, h), (nose, side * half, z), bevel=0.012)
            box("red", (0.03, 0.15, h * 0.9), (tail, side * half, z), bevel=0.012)
        box("dark", (0.03, half * 1.1, 0.06), (nose + 0.004, 0, z - 0.09), bevel=0.01)

    def car(name, body, glass, length, width=0.8, wheelbase=None, r=0.2, roof_rails=False, ride=0.0):
        """`body` and `glass` are side silhouettes (x, z), nose at +X."""
        wb = wheelbase or length * 0.62
        profile("body", [(x, z + ride) for x, z in body], width, bevel=0.05, segments=3)
        profile("glass", [(x, z + ride) for x, z in glass], width * 0.86, bevel=0.02, segments=2)
        # Pillars: the body colour between the windows.
        xs = [p[0] for p in glass]
        front, back = max(xs), min(xs)
        mid = (front + back) / 2
        top = max(p[1] for p in glass) + ride
        base = min(p[1] for p in glass) + ride
        box("body", (0.06, width * 0.88, top - base), (mid - 0.02, 0, (top + base) / 2), bevel=0.012)
        # The roof: a body-coloured lid over the windows, from the top corners.
        tops = sorted(p[0] for p in glass if p[1] + ride >= top - 1e-6)
        box("body", (tops[-1] - tops[0] + 0.1, width * 0.9, 0.05), ((tops[-1] + tops[0]) / 2, 0, top + 0.015), bevel=0.02)
        if roof_rails:
            for side in (-1, 1):
                box("dark", (abs(front - back) * 0.7, 0.03, 0.03), (mid - 0.03, side * width * 0.36, top + 0.025), bevel=0.01)
        # Mirrors.
        for side in (-1, 1):
            box("body", (0.06, 0.08, 0.05), (front - 0.06, side * (width / 2 + 0.03), base + 0.03), bevel=0.012)
        wheels((wb / 2, -wb / 2), width / 2 - 0.045, r=r)
        nose = max(p[0] for p in body)
        tail = min(p[0] for p in body)
        lights(nose - 0.01, tail + 0.01, 0.42 + ride, width / 2 - 0.12)
        model(f"car-{name}")

    # A small hatchback, the default.
    car(
        "hatchback",
        [(-0.72, 0.16), (0.74, 0.16), (0.78, 0.3), (0.74, 0.5), (0.28, 0.58), (-0.68, 0.6), (-0.74, 0.46)],
        [(0.26, 0.56), (-0.0, 0.86), (-0.6, 0.86), (-0.7, 0.58)],
        1.5,
    )
    # A saloon: a long bonnet and a boot.
    car(
        "sedan",
        [(-0.84, 0.17), (0.86, 0.17), (0.9, 0.3), (0.86, 0.48), (0.34, 0.56), (-0.56, 0.58), (-0.86, 0.52), (-0.9, 0.34)],
        [(0.32, 0.55), (0.06, 0.84), (-0.36, 0.84), (-0.58, 0.57)],
        1.76,
    )
    # An estate: a sedan's nose and a long roof.
    car(
        "wagon",
        [(-0.86, 0.17), (0.86, 0.17), (0.9, 0.3), (0.86, 0.48), (0.34, 0.56), (-0.84, 0.6), (-0.9, 0.36)],
        [(0.32, 0.55), (0.08, 0.84), (-0.8, 0.84), (-0.84, 0.59)],
        1.76,
        roof_rails=True,
    )
    # An SUV: tall, square, on bigger wheels.
    car(
        "suv",
        [(-0.8, 0.2), (0.82, 0.2), (0.86, 0.36), (0.82, 0.6), (0.36, 0.66), (-0.78, 0.68), (-0.84, 0.42)],
        [(0.34, 0.65), (0.12, 0.98), (-0.72, 0.98), (-0.78, 0.67)],
        1.7,
        width=0.86,
        r=0.24,
        roof_rails=True,
    )
    # A people carrier: one long sweep from the nose to the roof.
    car(
        "mpv",
        [(-0.8, 0.17), (0.82, 0.17), (0.86, 0.3), (0.8, 0.5), (0.5, 0.58), (-0.76, 0.66), (-0.82, 0.4)],
        [(0.48, 0.57), (0.12, 0.96), (-0.72, 0.96), (-0.76, 0.65)],
        1.7,
        width=0.84,
    )
    # A coupé: low, with a fastback.
    car(
        "coupe",
        [(-0.8, 0.16), (0.84, 0.16), (0.88, 0.28), (0.84, 0.44), (0.3, 0.5), (-0.6, 0.54), (-0.84, 0.46)],
        [(0.28, 0.49), (0.0, 0.76), (-0.3, 0.76), (-0.66, 0.52)],
        1.7,
    )
    # A van: a short nose and a tall box.
    car(
        "van",
        [(-0.88, 0.2), (0.88, 0.2), (0.92, 0.34), (0.88, 0.56), (0.62, 0.64), (0.4, 1.06), (-0.86, 1.08), (-0.9, 0.4)],
        [(0.6, 0.63), (0.4, 1.04), (0.12, 1.04), (0.12, 0.63)],
        1.84,
        width=0.88,
        r=0.22,
    )

    # A motorbike, for category L vehicles.
    for x in (0.5, -0.5):
        cyl("tyre", 0.26, 0.1, (x, 0, 0.26), rot=(math.pi / 2, 0, 0), v=20, bevel=0.03, smooth=True)
        cyl("hub", 0.13, 0.11, (x, 0, 0.26), rot=(math.pi / 2, 0, 0), v=10, smooth=False)
    profile("body", [(-0.42, 0.42), (0.26, 0.42), (0.36, 0.62), (0.08, 0.66), (-0.3, 0.6)], 0.26, bevel=0.04, segments=2)
    profile("dark", [(-0.5, 0.6), (-0.06, 0.6), (-0.02, 0.68), (-0.46, 0.68)], 0.22, bevel=0.02)
    box("chrome", (0.5, 0.04, 0.04), (0.26, 0.0, 0.45), rot=(0, -1.05, 0), bevel=0.01)
    box("dark", (0.04, 0.5, 0.03), (0.4, 0, 0.82), bevel=0.01)
    box("light", (0.05, 0.1, 0.08), (0.44, 0, 0.72), bevel=0.02)
    box("chrome", (0.36, 0.05, 0.05), (-0.3, 0.1, 0.3), rot=(0, 0.2, 0), bevel=0.015)
    model("car-motorbike")

    export(os.path.join(ROOT, "mfe-cars", "public", "garage", "garage-kit.glb"))


# ---- Home: a lot and a building per property type ---------------------------

def houses():
    start(
        {
            "roof": "#c0504d",
            "grass": "#6db36d",
            "sand": "#e3c99a",
            "walls": "#f7f4ee",
            "door": "#8a5a3b",
            "window": "#bfe3f0",
            "trunk": "#8a5a3b",
            "leaves": "#3f9a55",
        },
        {"dark": "#3b3f4a", "wood": "#a8754f", "rock": "#9aa0a8", "red": "#e0594b", "yellow": "#f6d55c", "pink": "#f3a6c0", "lilac": "#b49be0", "soil": "#7a5638"},
    )
    G = 0.08  # the lot's grass

    # The lot: a sandy hexagon with grass, a path to the door, a few stones.
    cyl("sand", 1.2, 0.2, (0, 0, -0.03), v=6, bevel=0.03, smooth=False, r2=1.3)
    cyl("grass", 1.12, 0.06, (0, 0, 0.05), v=6, bevel=0.015, smooth=False)
    for i in range(4):
        box("rock", (0.16, 0.12, 0.02), (0.02 * (i % 2), -0.5 - i * 0.16, G + 0.005), rot=(0, 0, 0.2 * (i % 2)), bevel=0.01)
    model("lot")

    def windows_front(xs, zs, y, w=0.15, h=0.16):
        for x in xs:
            for z in zs:
                box("window", (w, 0.02, h), (x, y, z), bevel=0.006)
                box("walls", (w + 0.04, 0.03, 0.025), (x, y - 0.01, z - h / 2 - 0.012), bevel=0.006)

    def tree(x, y, size=1.0):
        cyl("trunk", 0.05 * size, 0.36 * size, (x, y, G + 0.18 * size), v=6, smooth=False, r2=0.035 * size)
        blob("leaves", 0.24 * size, (x, y, G + 0.5 * size), scale=(1, 1, 1.1), sub=2, jitter=0.1, smooth=True)
        blob("leaves", 0.17 * size, (x + 0.12 * size, y + 0.05, G + 0.66 * size), sub=2, jitter=0.1, smooth=True)

    def flowers(x, y, n=5):
        for i in range(n):
            a = i * 2.4
            px, py = x + math.cos(a) * 0.08 * (1 + i % 2), y + math.sin(a) * 0.06
            blob(("red", "yellow", "pink", "lilac")[i % 4], 0.03, (px, py, G + 0.04), sub=1)

    # A house: a cottage with a gable roof, a chimney, a porch and a fence.
    box("walls", (1.0, 0.76, 0.66), (0, 0.06, G + 0.33), bevel=0.03)
    prism("roof", 1.16, 0.9, 0.46, (0, 0.06, G + 0.64))
    box("rock", (0.13, 0.13, 0.38), (0.28, 0.22, G + 0.92), bevel=0.02)
    box("dark", (0.15, 0.15, 0.03), (0.28, 0.22, G + 1.12), bevel=0.01)
    box("door", (0.2, 0.03, 0.36), (-0.18, -0.33, G + 0.18), bevel=0.015)
    sphere("yellow", 0.015, (-0.12, -0.35, G + 0.18))
    prism("roof", 0.42, 0.22, 0.12, (-0.18, -0.4, G + 0.42))
    for x in (-0.36, 0.0):
        cyl("wood", 0.018, 0.4, (x, -0.48, G + 0.2), v=6, smooth=False)
    windows_front((0.2,), (G + 0.38,), -0.33)
    for x in (-0.51, 0.51):
        box("window", (0.02, 0.15, 0.16), (x, 0.06, G + 0.38), bevel=0.006)
    # A low fence along the front.
    for i in range(9):
        x = -0.98 + i * 0.12
        if -0.25 < x < 0.25:
            continue
        box("wood", (0.03, 0.03, 0.18), (x, -0.8, G + 0.09), bevel=0.006)
    for side in (-1, 1):
        box("wood", (0.66, 0.02, 0.03), (side * 0.6, -0.8, G + 0.12), bevel=0.006)
    tree(0.78, 0.38, 0.9)
    flowers(0.44, -0.5)
    model("property-house")

    # An apartment block: three floors, balconies, a flat roof.
    box("walls", (0.92, 0.72, 1.36), (0, 0.06, G + 0.68), bevel=0.03)
    box("roof", (0.98, 0.78, 0.06), (0, 0.06, G + 1.39), bevel=0.02)
    box("rock", (0.22, 0.18, 0.12), (0.22, 0.18, G + 1.48), bevel=0.02)
    for z in (G + 0.62, G + 1.04):
        box("roof", (0.34, 0.14, 0.03), (-0.2, -0.38, z - 0.12), bevel=0.01)
        box("dark", (0.34, 0.01, 0.1), (-0.2, -0.45, z - 0.06), bevel=0.0)
        windows_front((-0.2, 0.24), (z,), -0.31, w=0.17, h=0.2)
    box("door", (0.22, 0.03, 0.32), (-0.2, -0.31, G + 0.16), bevel=0.015)
    box("roof", (0.34, 0.12, 0.03), (-0.2, -0.37, G + 0.36), bevel=0.01)
    windows_front((0.24,), (G + 0.22,), -0.31, w=0.17, h=0.2)
    for x in (-0.47, 0.47):
        for z in (G + 0.22, G + 0.62, G + 1.04):
            box("window", (0.02, 0.15, 0.18), (x, 0.06, z), bevel=0.006)
    tree(0.78, 0.4, 0.8)
    flowers(0.62, -0.42, 4)
    model("property-apartment")

    # A garage: a box with an up-and-over door and a short driveway.
    box("walls", (0.9, 0.86, 0.56), (0, 0.1, G + 0.28), bevel=0.03)
    box("roof", (0.98, 0.94, 0.06), (0, 0.1, G + 0.59), rot=(0.06, 0, 0), bevel=0.02)
    box("roof", (0.66, 0.03, 0.4), (0, -0.33, G + 0.21), bevel=0.012)
    for i in range(4):
        box("dark", (0.64, 0.01, 0.01), (0, -0.35, G + 0.08 + i * 0.1), bevel=0.0)
    box("rock", (0.7, 0.42, 0.015), (0, -0.6, G + 0.008), bevel=0.0)
    tree(-0.8, 0.3, 0.8)
    model("property-garage")

    # Land: a field with rows of crops, a fence and a tree.
    box("soil", (1.3, 1.0, 0.04), (0, 0.05, G + 0.02), bevel=0.01)
    for i in range(6):
        y = -0.36 + i * 0.16
        box("leaves", (1.16, 0.06, 0.05), (0, y, G + 0.06), bevel=0.015)
    for i in range(12):
        a = i / 12 * math.tau
        box("wood", (0.03, 0.03, 0.16), (math.cos(a) * 0.95, math.sin(a) * 0.82, G + 0.08), bevel=0.005)
    tree(0.62, 0.6, 1.0)
    model("property-land")

    # Anything else: a little wooden shed.
    box("wood", (0.66, 0.56, 0.48), (0, 0.06, G + 0.24), bevel=0.02)
    prism("roof", 0.78, 0.68, 0.3, (0, 0.06, G + 0.48))
    box("door", (0.18, 0.03, 0.32), (0, -0.23, G + 0.16), bevel=0.012)
    tree(0.6, 0.4, 0.8)
    flowers(-0.5, -0.4, 4)
    model("property-other")

    export(os.path.join(ROOT, "mfe-home", "public", "houses", "houses-kit.glb"))


# ---- Dreams: a floating stone for the path ----------------------------------

def dreams():
    # One slot: `stone` takes the step's colour (lit, glowing or faint).
    start({"stone": "#e08a7a"}, {}, seed=11)
    # A flat top with a soft rim...
    cyl("stone", 0.5, 0.12, (0, 0, 0.0), v=9, bevel=0.04, smooth=False, r2=0.46)
    # ...over a rocky underside that tapers to a point, with a few loose bits.
    blob("stone", 0.36, (0, 0, -0.2), scale=(1.15, 1.15, 0.75), sub=1, jitter=0.18)
    cone("stone", 0.24, 0.42, (0.04, -0.03, -0.42), v=7, rot=(math.pi, 0, 0.3))
    blob("stone", 0.07, (0.22, 0.1, -0.5), sub=1, jitter=0.2)
    blob("stone", 0.05, (-0.18, -0.16, -0.58), sub=1, jitter=0.2)
    # A tuft on top: two little crystals, so a stone reads as a place.
    cone("stone", 0.06, 0.2, (0.22, 0.12, 0.15), v=5, rot=(0.15, 0.1, 0))
    cone("stone", 0.04, 0.13, (0.3, 0.04, 0.12), v=5, rot=(-0.2, 0.25, 0))
    model("stone")
    export(os.path.join(ROOT, "mfe-dreams", "public", "dreams", "dreams-kit.glb"))


if __name__ == "__main__":
    which = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else sys.argv[1:]
    builders = {"garage": garage, "houses": houses, "dreams": dreams}
    for name in which or builders:
        builders[name]()
