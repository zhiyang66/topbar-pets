#!/usr/bin/env python3
"""
Generate high-detail 48x48 16-bit shaded pixel-art sprite sheets
(12 rows x 4 columns = 192x576 PNG) for all 6 TopBar Pet species.

Rows (0-indexed, 4 frames each, facing RIGHT):
  0: idle    1: walk    2: run     3: sleep   4: happy
  5: drag    6: attack  7: sneak   8: cast    9: hurt
  10: crouch (low ducking under projectiles!)
  11: guard  (crossed arms / braced defensive shield stance!)
"""

import math
import os
from PIL import Image, ImageDraw

OUT_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', 'sprites'))
os.makedirs(OUT_DIR, exist_ok=True)

FW = 48
FH = 48
COLS = 4
ROWS = 12


def new_sheet():
    return Image.new('RGBA', (FW * COLS, FH * ROWS), (0, 0, 0, 0))


def ellipse_px(d, cx, cy, rx, ry, fill):
    if rx <= 0 or ry <= 0:
        return
    d.ellipse([cx - rx, cy - ry, cx + rx, cy + ry], fill=fill)


def rrect(d, x, y, w, h, r, fill):
    if w <= 0 or h <= 0:
        return
    d.rounded_rectangle([x, y, x + w - 1, y + h - 1], radius=r, fill=fill)


def poly(d, pts, fill):
    d.polygon(pts, fill=fill)


def add_ground_shadow(im, cx=24, y=44, rx=11, ry=2):
    sh = Image.new('RGBA', (FW, FH), (0, 0, 0, 0))
    sd = ImageDraw.Draw(sh)
    ellipse_px(sd, cx, y, rx, ry, (18, 16, 28, 95))
    return Image.alpha_composite(sh, im)


def smart_outline(im, dark=(30, 22, 38, 255)):
    """Crisp 1px pixel-art contour around opaque character pixels."""
    w, h = im.size
    src = im.load()
    out = im.copy()
    dst = out.load()
    for y in range(h):
        for x in range(w):
            if src[x, y][3] < 40:
                for dx, dy in ((-1, 0), (1, 0), (0, -1), (0, 1)):
                    nx, ny = x + dx, y + dy
                    if 0 <= nx < w and 0 <= ny < h and src[nx, ny][3] > 210:
                        dst[x, y] = dark
                        break
    return out


def draw_anime_eyes(d, lx, rx_eye, y, mode='normal', iris=(58, 42, 32, 255)):
    dark = (28, 22, 34, 255)
    white = (255, 255, 255, 255)
    blush = (255, 138, 162, 185)

    for ex in (lx, rx_eye):
        if mode == 'sleep':
            d.line([ex - 2, y + 1, ex + 2, y + 1], fill=dark, width=1)
            d.point((ex, y + 2), fill=dark)
        elif mode == 'happy':
            d.line([ex - 2, y + 1, ex, y - 1], fill=dark, width=1)
            d.line([ex, y - 1, ex + 2, y + 1], fill=dark, width=1)
        elif mode == 'hurt':
            d.line([ex - 2, y - 1, ex + 1, y + 1], fill=dark, width=1)
            d.line([ex - 2, y + 2, ex + 1, y], fill=dark, width=1)
        elif mode == 'blink':
            d.line([ex - 2, y + 1, ex + 2, y + 1], fill=dark, width=1)
        else:
            # Detailed 4x5 glossy pixel eye!
            rrect(d, ex - 2, y - 2, 4, 5, 1, dark)
            rrect(d, ex - 1, y - 1, 3, 4, 1, iris)
            d.rectangle([ex - 2, y - 2, ex - 1, y - 1], fill=white)  # top-left catchlight
            d.point((ex + 1, y + 2), fill=(255, 230, 190, 220))       # lower rim bounce light

    # Soft cheek blush
    d.rectangle([lx - 4, y + 3, lx - 2, y + 4], fill=blush)
    d.rectangle([rx_eye + 2, y + 3, rx_eye + 4, y + 4], fill=blush)


def draw_combat_overlay(im, state, f, accent=(255, 190, 72, 225)):
    d = ImageDraw.Draw(im)
    white = (255, 255, 245, 240)
    if state == 'attack' and f > 0:
        # Crescent slash arc on the right!
        arc_x = 34 + f * 2
        poly(d, [(arc_x, 14), (arc_x + 7, 22), (arc_x + 5, 33), (arc_x - 1, 26)], accent)
        poly(d, [(arc_x + 2, 16), (arc_x + 6, 22), (arc_x + 4, 30), (arc_x + 1, 24)], white)
    elif state == 'cast':
        # Floating runic orb + sparkles
        r = [3, 5, 6, 4][f]
        ox, oy = 39, 22 - (2 if f in (1, 2) else 0)
        ellipse_px(d, ox, oy, r, r, accent)
        ellipse_px(d, ox, oy, max(1, r - 2), max(1, r - 2), white)
        d.line([9, 43, 37, 43], fill=accent, width=1)
        for sx, sy in ((11, 36 - f * 3), (34, 38 - f * 4), (20, 10 - f)):
            d.rectangle([sx, max(2, sy), sx + 1, max(3, sy + 1)], fill=white)
    elif state == 'hurt':
        star = (255, 232, 82, 245)
        for i in range(3):
            ang = (f * 0.8) + i * 2.1
            sx = int(22 + math.cos(ang) * 9)
            sy = int(9 + math.sin(ang) * 3)
            d.rectangle([sx, sy, sx + 2, sy + 2], fill=star)
    elif state == 'guard':
        # Crisp glowing energy buckler arc in front of the pet!
        sh_col = (112, 224, 255, 205 if f % 2 == 0 else 175)
        sh_hi = (235, 252, 255, 235)
        poly(d, [(34, 15), (38, 21), (38, 35), (34, 41), (32, 35), (32, 21)], sh_col)
        d.line([36, 18, 36, 37], fill=sh_hi, width=1)
    return im


# ==============================================================================
# 1. GINGER TABBY CAT (精致橘虎斑灵猫)
# ==============================================================================
def make_cat(state, f):
    im = Image.new('RGBA', (FW, FH), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)

    fur_hi = (255, 186, 92, 255)
    fur = (244, 148, 54, 255)
    fur_sh = (198, 98, 28, 255)
    stripe = (168, 72, 20, 255)
    cream = (255, 244, 224, 255)
    pink = (255, 152, 174, 255)
    scarf = (228, 62, 74, 255)
    bell = (255, 218, 78, 255)

    if state == 'sleep':
        breath = 1 if f in (1, 2) else 0
        ellipse_px(d, 23, 36 + breath, 13, 7 - breath // 2, fur)
        ellipse_px(d, 23, 34 + breath, 11, 5, fur_hi)
        # Curled striped tail in front
        rrect(d, 10, 38, 14, 5, 2, fur_sh)
        rrect(d, 21, 38, 4, 5, 2, cream)
        # Tucked head
        ellipse_px(d, 30, 32 + breath, 8, 7, fur)
        poly(d, [(24, 27), (26, 21), (29, 26)], fur)
        poly(d, [(32, 26), (36, 21), (37, 28)], fur)
        draw_anime_eyes(d, 28, 34, 33 + breath, 'sleep')
        return add_ground_shadow(smart_outline(im), 23, 43, 14, 2)

    bob = 0
    if state == 'idle':
        bob = 1 if f == 2 else 0
    elif state in ('walk', 'run'):
        bob = -2 if f in (1, 3) else 0
    elif state in ('happy', 'cast'):
        bob = [0, -4, -5, -2][f]
    elif state == 'sneak':
        bob = 4
    elif state == 'crouch':
        bob = 7
    elif state == 'guard':
        bob = 2
    elif state == 'drag':
        bob = -5

    bx = 21 + (-3 if state == 'hurt' else (2 if state == 'attack' and f > 0 else 0))
    by = 31 + bob

    # Fluffy S-curve striped tail!
    tail_lift = [-2, -4, -2, 0][f]
    poly(d, [(bx - 8, by + 3), (bx - 15, by - 4 + tail_lift), (bx - 12, by - 8 + tail_lift), (bx - 6, by)], fur)
    d.line([bx - 13, by - 5 + tail_lift, bx - 11, by - 3 + tail_lift], fill=stripe, width=2)
    ellipse_px(d, bx - 13, by - 7 + tail_lift, 2, 2, cream)

    # Rounded torso with warm shading & cream belly
    rx_b, ry_b = (8, 10) if state == 'drag' else ((11, 6) if state == 'sneak' else (9, 7))
    ellipse_px(d, bx, by + 2, rx_b, ry_b, fur_sh)
    ellipse_px(d, bx, by + 1, rx_b - 1, ry_b - 1, fur)
    ellipse_px(d, bx + 2, by + 3, rx_b - 3, ry_b - 2, cream)
    # Back stripes
    d.line([bx - 4, by - 4, bx - 3, by - 1], fill=stripe, width=2)
    d.line([bx, by - 4, bx + 1, by - 1], fill=stripe, width=2)

    # Paws / Legs (white socks!)
    ly = by + ry_b - 1
    for i, lx in enumerate((bx - 6, bx - 2, bx + 3, bx + 6)):
        step = (((i + f) % 2) * 2) if state in ('walk', 'run', 'sneak') else 0
        rrect(d, lx - 2, ly - step, 4, 6 - step // 2, 1, fur if i in (0, 3) else fur_sh)
        rrect(d, lx - 2, ly + 3 - step, 4, 3, 1, cream)

    # Red adventurer scarf + golden bell!
    hx = bx + (5 if state == 'sneak' else 4)
    hy = by - (6 if state == 'sneak' else 9)
    rrect(d, hx - 7, hy + 6, 14, 3, 1, scarf)
    poly(d, [(hx - 6, hy + 7), (hx - 11, hy + 9 + (f % 2)), (hx - 8, hy + 11)], scarf)
    ellipse_px(d, hx + 3, hy + 8, 2, 2, bell)

    # Big expressive cat head with cheek tufts!
    ellipse_px(d, hx, hy, 9, 8, fur_sh)
    ellipse_px(d, hx, hy - 1, 9, 7, fur)
    ellipse_px(d, hx - 1, hy - 3, 6, 4, fur_hi)
    # Cheek fur tufts
    poly(d, [(hx - 8, hy + 1), (hx - 11, hy + 3), (hx - 7, hy + 5)], fur)
    poly(d, [(hx + 8, hy + 1), (hx + 11, hy + 3), (hx + 7, hy + 5)], fur_hi)
    # Forehead 'M' tabby markings
    d.line([hx - 1, hy - 6, hx - 1, hy - 3], fill=stripe, width=1)
    d.line([hx + 2, hy - 6, hx + 2, hy - 3], fill=stripe, width=1)
    d.line([hx - 2, hy - 4, hx + 3, hy - 4], fill=stripe, width=1)

    # Pointed ears with pink inner ear
    poly(d, [(hx - 8, hy - 4), (hx - 6, hy - 12), (hx - 1, hy - 6)], fur)
    poly(d, [(hx - 7, hy - 5), (hx - 6, hy - 10), (hx - 3, hy - 6)], pink)
    poly(d, [(hx + 2, hy - 6), (hx + 7, hy - 12), (hx + 9, hy - 4)], fur)
    poly(d, [(hx + 4, hy - 6), (hx + 7, hy - 10), (hx + 8, hy - 5)], pink)

    # Cream muzzle + pink nose
    ellipse_px(d, hx + 2, hy + 3, 4, 3, cream)
    d.rectangle([hx + 2, hy + 1, hx + 3, hy + 2], fill=pink)

    eye_mode = 'hurt' if state == 'hurt' else ('happy' if state == 'happy' else ('blink' if state == 'idle' and f == 3 else 'normal'))
    iris = (92, 232, 255, 255) if state == 'cast' else (112, 68, 24, 255)
    draw_anime_eyes(d, hx - 2, hx + 5, hy, eye_mode, iris)

    # Raised boxing/casting paw
    if state in ('attack', 'cast') and f > 0:
        rrect(d, hx + 6, by - 2, 7, 4, 2, cream)

    im = smart_outline(im)
    im = draw_combat_overlay(im, state, f, (255, 178, 66, 235))
    return add_ground_shadow(im, bx, 44, 11, 2)


# ==============================================================================
# 2. SHIBA INU SAMURAI (精致赤柴犬)
# ==============================================================================
def make_shiba(state, f):
    im = Image.new('RGBA', (FW, FH), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)

    tan_hi = (248, 192, 110, 255)
    tan = (230, 154, 68, 255)
    tan_sh = (188, 112, 42, 255)
    cream = (254, 248, 238, 255)
    bandana = (48, 134, 232, 255)
    pink = (255, 134, 156, 255)

    if state == 'sleep':
        breath = 1 if f in (1, 2) else 0
        ellipse_px(d, 23, 36 + breath, 13, 7, tan)
        ellipse_px(d, 24, 38 + breath, 10, 4, cream)
        ellipse_px(d, 11, 32, 4, 4, tan)
        ellipse_px(d, 11, 31, 2, 2, cream)
        ellipse_px(d, 31, 32 + breath, 8, 7, tan)
        ellipse_px(d, 33, 34 + breath, 6, 4, cream)
        draw_anime_eyes(d, 29, 35, 32 + breath, 'sleep')
        return add_ground_shadow(smart_outline(im), 23, 43, 14, 2)

    bob = -2 if (state in ('walk', 'run') and f in (1, 3)) else (-4 if state in ('happy', 'cast') and f in (1, 2) else (7 if state == 'crouch' else (3 if state in ('sneak', 'guard') else 0)))
    bx = 21 + (-3 if state == 'hurt' else (2 if state == 'attack' and f > 0 else 0))
    by = 31 + bob

    # Fluffy curled donut tail!
    ellipse_px(d, bx - 10, by - 4 + (f % 2), 5, 5, tan)
    ellipse_px(d, bx - 11, by - 5 + (f % 2), 3, 3, cream)

    ellipse_px(d, bx, by + 2, 10, 7, tan_sh)
    ellipse_px(d, bx, by + 1, 9, 6, tan)
    ellipse_px(d, bx + 3, by + 3, 6, 5, cream)

    ly = by + 6
    for i, lx in enumerate((bx - 6, bx - 2, bx + 3, bx + 6)):
        step = (((i + f) % 2) * 2) if state in ('walk', 'run', 'sneak') else 0
        rrect(d, lx - 2, ly - step, 4, 6, 1, tan if i in (0, 3) else tan_sh)
        rrect(d, lx - 2, ly + 4 - step, 4, 2, 1, cream)

    hx, hy = bx + 4, by - 9
    # Blue neckerchief
    poly(d, [(hx - 6, hy + 6), (hx + 6, hy + 6), (hx + 2, hy + 11)], bandana)

    # Plump Shiba head with classic Urajiro white cheeks & eyebrow beans!
    ellipse_px(d, hx, hy, 9, 8, tan)
    ellipse_px(d, hx - 1, hy - 3, 6, 4, tan_hi)
    ellipse_px(d, hx - 2, hy + 3, 5, 4, cream)
    ellipse_px(d, hx + 4, hy + 3, 5, 4, cream)
    # Triangular plush Shiba ears
    poly(d, [(hx - 8, hy - 4), (hx - 6, hy - 12), (hx - 1, hy - 6)], tan)
    poly(d, [(hx - 6, hy - 5), (hx - 5, hy - 9), (hx - 3, hy - 6)], cream)
    poly(d, [(hx + 2, hy - 6), (hx + 7, hy - 12), (hx + 9, hy - 4)], tan)
    poly(d, [(hx + 4, hy - 6), (hx + 7, hy - 9), (hx + 7, hy - 5)], cream)
    # Eyebrow beans!
    d.rectangle([hx - 3, hy - 4, hx - 2, hy - 3], fill=cream)
    d.rectangle([hx + 4, hy - 4, hx + 5, hy - 3], fill=cream)
    # Black button nose + happy pink tongue
    d.rectangle([hx + 3, hy + 1, hx + 5, hy + 2], fill=(32, 26, 34, 255))
    if state in ('happy', 'run', 'idle') and f in (1, 2):
        rrect(d, hx + 2, hy + 4, 3, 3, 1, pink)

    eye_mode = 'hurt' if state == 'hurt' else ('happy' if state == 'happy' else ('blink' if state == 'idle' and f == 3 else 'normal'))
    draw_anime_eyes(d, hx - 2, hx + 5, hy, eye_mode, (52, 34, 24, 255))

    im = smart_outline(im)
    im = draw_combat_overlay(im, state, f, (255, 118, 64, 235))
    return add_ground_shadow(im, bx, 44, 11, 2)


# ==============================================================================
# 3. KING STAR-SLIME (星露皇冠史莱姆)
# ==============================================================================
def make_slime(state, f):
    im = Image.new('RGBA', (FW, FH), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)

    outer = (56, 172, 248, 245)
    mid = (96, 212, 255, 255)
    core = (176, 242, 255, 255)
    deep = (34, 118, 208, 255)
    gold = (255, 214, 68, 255)
    gem = (255, 78, 122, 255)

    squish = [(0, 0), (-2, 3), (-1, 2), (2, -2)][f] if state in ('walk', 'run', 'happy', 'cast') else [(0, 0), (1, -1), (0, 0), (-1, 1)][f]
    if state in ('sleep', 'sneak'):
        squish = (4, -4)
    elif state == 'crouch':
        squish = (6, -6)
    elif state == 'guard':
        squish = (-1, 2)
    jump = -4 if (state in ('run', 'happy', 'cast') and f in (1, 2)) else 0

    cx = 23 + (-3 if state == 'hurt' else 0)
    cy = 33 - squish[1] // 2 + jump
    rx = 13 + squish[0]
    ry = 10 + squish[1]

    # Translucent layered jelly body
    ellipse_px(d, cx, cy + 1, rx, ry, deep)
    ellipse_px(d, cx, cy, rx, ry - 1, outer)
    ellipse_px(d, cx - 1, cy - 1, rx - 2, ry - 2, mid)
    ellipse_px(d, cx - 4, cy - 4, 4, 3, core)  # Specular jelly shine
    # Floating tiny star bubbles inside jelly!
    d.rectangle([cx - 6, cy + 2, cx - 5, cy + 3], fill=core)
    d.rectangle([cx + 6, cy - 2, cx + 7, cy - 1], fill=core)

    # Cute Golden Mini-Crown on top!
    ky = cy - ry - 3
    poly(d, [(cx - 5, ky + 5), (cx - 6, ky), (cx - 2, ky + 3), (cx, ky - 1), (cx + 2, ky + 3), (cx + 6, ky), (cx + 5, ky + 5)], gold)
    d.rectangle([cx - 1, ky + 2, cx + 1, ky + 3], fill=gem)

    eye_mode = 'sleep' if state == 'sleep' else ('hurt' if state == 'hurt' else ('happy' if state == 'happy' else 'normal'))
    draw_anime_eyes(d, cx - 2, cx + 5, cy, eye_mode, (24, 52, 112, 255))

    im = smart_outline(im, (22, 48, 92, 255))
    im = draw_combat_overlay(im, state, f, (112, 232, 255, 235))
    return add_ground_shadow(im, cx, 44, rx - 1, 2)


# ==============================================================================
# 4. CYBER MECHA-BOT (流线型赛博小机甲)
# ==============================================================================
def make_robot(state, f):
    im = Image.new('RGBA', (FW, FH), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)

    armor_hi = (244, 248, 255, 255)
    armor = (204, 216, 234, 255)
    armor_sh = (132, 148, 176, 255)
    visor = (24, 32, 48, 255)
    cyan = (72, 248, 214, 255)
    amber = (255, 196, 64, 255)
    thruster = (255, 102, 68, 255)

    hover = [-1, -3, -2, 0][f] + (-3 if state in ('run', 'happy', 'cast') else (7 if state == 'crouch' else (3 if state in ('sleep', 'guard') else 0)))
    cx = 23 + (-3 if state == 'hurt' else 0)
    hy = 18 + hover

    # Glowing winglet boosters on back
    poly(d, [(cx - 8, hy + 10), (cx - 15, hy + 7), (cx - 13, hy + 14), (cx - 8, hy + 15)], cyan if state != 'sleep' else armor_sh)

    # Torso + core reactor
    rrect(d, cx - 7, hy + 10, 14, 10, 3, armor_sh)
    rrect(d, cx - 6, hy + 10, 12, 9, 3, armor)
    ellipse_px(d, cx + 1, hy + 14, 3, 3, visor)
    ellipse_px(d, cx + 1, hy + 14, 2, 2, amber if state in ('attack', 'cast') else cyan)

    # Jet thruster flames underneath!
    if state != 'sleep':
        flen = 5 if (f % 2 == 0 or state in ('run', 'cast')) else 3
        poly(d, [(cx - 4, hy + 20), (cx - 2, hy + 20 + flen), (cx, hy + 20)], thruster)
        poly(d, [(cx + 2, hy + 20), (cx + 4, hy + 20 + flen), (cx + 6, hy + 20)], cyan)

    # Sleek rounded helmet + panoramic dark visor + ear headphones!
    rrect(d, cx - 10, hy - 6, 20, 16, 6, armor_sh)
    rrect(d, cx - 10, hy - 7, 19, 15, 6, armor)
    rrect(d, cx - 7, hy - 6, 12, 5, 2, armor_hi)
    # Headphones + antenna
    rrect(d, cx - 12, hy - 1, 3, 7, 1, cyan)
    d.line([cx, hy - 12, cx, hy - 7], fill=armor_sh, width=2)
    ellipse_px(d, cx, hy - 13, 2, 2, amber if f % 2 == 0 else cyan)

    # Panoramic LED Visor
    rrect(d, cx - 5, hy - 2, 14, 9, 3, visor)
    led = amber if state in ('attack', 'cast', 'hurt') else cyan
    if state == 'sleep':
        d.line([cx - 2, hy + 2, cx + 1, hy + 2], fill=armor_sh, width=1)
        d.line([cx + 4, hy + 2, cx + 7, hy + 2], fill=armor_sh, width=1)
    elif state in ('happy', 'cast'):
        d.line([cx - 2, hy + 3, cx, hy + 1], fill=led, width=2)
        d.line([cx + 4, hy + 3, cx + 6, hy + 1], fill=led, width=2)
    else:
        eh = 1 if (state == 'idle' and f == 3) else 4
        rrect(d, cx - 2, hy + 1, 3, eh, 1, led)
        rrect(d, cx + 4, hy + 1, 3, eh, 1, led)

    im = smart_outline(im)
    im = draw_combat_overlay(im, state, f, (72, 248, 214, 235))
    return add_ground_shadow(im, cx, 44, 9, 2)


# ==============================================================================
# 5. CRIMSON BABY DRAGON (绯红幼龙)
# ==============================================================================
def make_dragon(state, f):
    im = Image.new('RGBA', (FW, FH), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)

    red_hi = (255, 116, 96, 255)
    red = (228, 68, 66, 255)
    red_sh = (168, 38, 48, 255)
    gold = (255, 222, 112, 255)
    horn = (255, 246, 220, 255)
    wing_mem = (255, 152, 72, 255)

    bob = -3 if (state in ('run', 'happy', 'cast') and f in (1, 2)) else (7 if state == 'crouch' else (3 if state in ('sleep', 'sneak', 'guard') else 0))
    bx = 21 + (-3 if state == 'hurt' else 0)
    by = 31 + bob

    # Flame-tipped tail!
    poly(d, [(bx - 6, by + 4), (bx - 15, by + 2), (bx - 12, by + 7)], red)
    ellipse_px(d, bx - 16, by + 1 - (f % 2), 3, 4, wing_mem)
    ellipse_px(d, bx - 16, by + 1 - (f % 2), 2, 2, gold)

    # Bat-like baby dragon wings flapping!
    wy = -5 if f in (1, 2) else 0
    poly(d, [(bx - 3, by - 2), (bx - 13, by - 10 + wy), (bx - 5, by - 11 + wy), (bx - 2, by - 5)], red_sh)
    poly(d, [(bx - 4, by - 3), (bx - 11, by - 8 + wy), (bx - 5, by - 8 + wy)], wing_mem)

    # Plump dragon body + golden scaled belly
    ellipse_px(d, bx, by + 2, 9, 8, red_sh)
    ellipse_px(d, bx, by + 1, 8, 7, red)
    ellipse_px(d, bx + 3, by + 2, 5, 6, gold)
    d.line([bx + 1, by + 1, bx + 6, by + 1], fill=wing_mem, width=1)
    d.line([bx + 1, by + 4, bx + 6, by + 4], fill=wing_mem, width=1)

    for i, lx in enumerate((bx - 4, bx + 3)):
        step = ((i + f) % 2) * 2 if state in ('walk', 'run') else 0
        rrect(d, lx - 2, by + 7 - step, 5, 5, 1, red if i == 1 else red_sh)

    # Cute snouted dragon head + curved ivory horns!
    hx, hy = bx + 4, by - 8
    ellipse_px(d, hx, hy, 8, 7, red)
    ellipse_px(d, hx + 5, hy + 2, 5, 4, red)
    ellipse_px(d, hx - 1, hy - 3, 5, 3, red_hi)
    poly(d, [(hx - 5, hy - 5), (hx - 9, hy - 13), (hx - 2, hy - 7)], horn)
    poly(d, [(hx + 1, hy - 6), (hx - 1, hy - 13), (hx + 4, hy - 6)], horn)
    # Nostril puff
    d.point((hx + 8, hy + 1), fill=red_sh)

    eye_mode = 'sleep' if state == 'sleep' else ('hurt' if state == 'hurt' else ('happy' if state == 'happy' else 'normal'))
    draw_anime_eyes(d, hx - 1, hx + 5, hy, eye_mode, (235, 168, 32, 255))

    im = smart_outline(im)
    im = draw_combat_overlay(im, state, f, (255, 124, 52, 240))
    return add_ground_shadow(im, bx, 44, 10, 2)


# ==============================================================================
# 6. ASTRAL WITCH-GHOST (星界巫师帽小幽灵)
# ==============================================================================
def make_ghost(state, f):
    im = Image.new('RGBA', (FW, FH), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)

    soul_hi = (245, 240, 255, 255)
    soul = (218, 205, 255, 255)
    soul_sh = (162, 138, 232, 255)
    hat = (72, 48, 148, 255)
    hat_hi = (108, 78, 198, 255)
    gold = (255, 224, 96, 255)
    wisp = (132, 242, 255, 235)

    hover = [-1, -3, -2, 0][f] + (8 if state == 'crouch' else (3 if state in ('sleep', 'guard') else 0))
    cx = 22 + (-3 if state == 'hurt' else 0)
    cy = 26 + hover

    # Ghostly wavy cloak body
    ellipse_px(d, cx, cy, 9, 9, soul)
    rrect(d, cx - 9, cy, 18, 11, 3, soul)
    ellipse_px(d, cx - 2, cy - 2, 6, 5, soul_hi)
    for wx in range(4):
        wy = (wx + f) % 2 * 2
        ellipse_px(d, cx - 7 + wx * 5, cy + 11 + wy, 3, 3, soul_sh)

    # Big crooked star-wizard hat!
    hy = cy - 7
    ellipse_px(d, cx, hy + 2, 13, 3, hat)
    poly(d, [(cx - 8, hy + 1), (cx - 3, hy - 11), (cx - 9, hy - 13), (cx + 4, hy - 6), (cx + 8, hy + 1)], hat)
    poly(d, [(cx - 5, hy), (cx - 2, hy - 8), (cx + 3, hy)], hat_hi)
    d.line([cx - 7, hy + 1, cx + 7, hy + 1], fill=gold, width=2)  # golden hat ribbon

    # Floating cyan soul-lantern beside the ghost!
    lx = cx + 13
    ly = cy + 2 - (f % 2) * 2
    ellipse_px(d, lx, ly, 3, 4, wisp)
    ellipse_px(d, lx, ly, 1, 2, soul_hi)

    eye_mode = 'sleep' if state == 'sleep' else ('hurt' if state == 'hurt' else ('happy' if state == 'happy' else 'normal'))
    draw_anime_eyes(d, cx - 2, cx + 5, cy + 1, eye_mode, (118, 56, 212, 255))

    im = smart_outline(im, (34, 22, 62, 255))
    im = draw_combat_overlay(im, state, f, (192, 132, 255, 235))
    return add_ground_shadow(im, cx, 44, 8, 2)


def build_all_sheets():
    states = [
        'idle', 'walk', 'run', 'sleep', 'happy',
        'drag', 'attack', 'sneak', 'cast', 'hurt',
        'crouch', 'guard',
    ]
    makers = {
        'pixel-cat.png': make_cat,
        'pixel-shiba.png': make_shiba,
        'pixel-slime.png': make_slime,
        'pixel-robot.png': make_robot,
        'pixel-dragon.png': make_dragon,
        'pixel-ghost.png': make_ghost,
    }
    for filename, fn in makers.items():
        sheet = new_sheet()
        for r, st in enumerate(states):
            for c in range(COLS):
                sheet.paste(fn(st, c), (c * FW, r * FH))
        out_path = os.path.join(OUT_DIR, filename)
        sheet.save(out_path)
        print(f'Generated {out_path} ({sheet.size[0]}x{sheet.size[1]})')


if __name__ == '__main__':
    build_all_sheets()
