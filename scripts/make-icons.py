#!/usr/bin/env python3
"""
T-202: every icon of the site and the app, made from the owner's drawing brand/qolumns-letter.png.

    python3 scripts/make-icons.py                       write the icons
    python3 scripts/make-icons.py --compare OUT [REV]   also draw old (git REV, default HEAD) beside new

Needs Python 3 with Pillow (`pip3 install pillow`). Nothing else reads the drawing: the site and the
app use the files this writes, so run it again whenever the drawing changes, and build the apps again
(an app's icon reaches a phone only in a new build).

The drawing is a square: the mark (cream) on the brand's dark green, the mark about 86% of its width.

  site      apps/web/src/app/icon.png (512), apple-icon.png (180), favicon.ico (16, 32, 48)
            the whole drawing, made smaller
  iPhone    apps/mobile/assets/icon.png (1024, no transparency)
            the drawing at 840 px inside 1024, so the Q's tail clears the rounded corners (T-190)
  Play      Docs/store/google-play/icon-512.png (512, no transparency): the iPhone icon at 512
  Android   apps/mobile/assets/adaptive-icon.png (1024): the foreground. Android shows the middle
            two thirds of it through a mask of the phone maker's choosing, the round one being the
            tightest, and promises only a circle 66/108 of the canvas across. The mark is sized so
            that all of its ink is inside that circle with room to spare (87% of its radius).
            apps/mobile/assets/adaptive-icon-monochrome.png: the same, the mark alone in white
            (Android tints it for themed icons)
            apps/mobile/assets/notification-icon.png (96): the mark alone in white, for the status bar
  The background colour of the Android icon is set in apps/mobile/app.json (#192822, this drawing's green).

It also writes brand/icons-made.json (the drawing's fingerprint and each icon's), which a unit test
(apps/mobile/src/__tests__/icons-t202.test.ts) reads.
"""
import hashlib
import io
import json
import math
import subprocess
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent.parent
SOURCE = ROOT / 'brand/qolumns-letter.png'
RECORD = ROOT / 'brand/icons-made.json'
GREEN = (25, 40, 34)  # #192822, the drawing's own background
CREAM = (247, 235, 199)

IOS_INSET = 840 / 1024  # T-190
SAFE_CIRCLE = 66 / 108  # Android's promise for an adaptive icon
SAFE_SPARE = 0.87  # the ink stops at 87% of that circle's radius: the room the icon had before (T-200)
NOTIFICATION_FILL = 88 / 96  # the mark's width in the status-bar icon, as before

OUT = {
    'web_icon': 'apps/web/src/app/icon.png',
    'web_apple': 'apps/web/src/app/apple-icon.png',
    'web_favicon': 'apps/web/src/app/favicon.ico',
    'ios': 'apps/mobile/assets/icon.png',
    'play': 'Docs/store/google-play/icon-512.png',
    'android': 'apps/mobile/assets/adaptive-icon.png',
    'android_mono': 'apps/mobile/assets/adaptive-icon-monochrome.png',
    'notification': 'apps/mobile/assets/notification-icon.png',
}


def load_drawing():
    """The drawing with no transparency (its corners are a little see-through), and the mark's ink as a mask."""
    raw = Image.open(SOURCE).convert('RGBA')
    if raw.width != raw.height:
        sys.exit(f'{SOURCE} must be square, it is {raw.size}')
    flat = Image.new('RGB', raw.size, GREEN)
    flat.paste(raw, mask=raw.getchannel('A'))
    # how far each pixel is from the green towards the cream: 0 = background, 255 = ink
    red = flat.getchannel('R')
    ink = red.point(lambda v: max(0, min(255, round((v - GREEN[0]) * 255 / (CREAM[0] - GREEN[0])))))
    return flat, ink


def placed(image, canvas, size, fill):
    """`image` made `size` px, in the middle of a square `canvas` filled with `fill`."""
    mode = 'RGBA' if len(fill) == 4 else 'RGB'
    out = Image.new(mode, (canvas, canvas), fill)
    small = image.resize((size, size), Image.LANCZOS)
    at = (canvas - size) // 2
    out.paste(small, (at, at))
    return out


def white_mark(ink, canvas, size, offset=(0, 0)):
    """The mark alone, white on nothing."""
    out = Image.new('RGBA', (canvas, canvas), (255, 255, 255, 0))
    small = ink.resize((size, size), Image.LANCZOS)
    at = (canvas - size) // 2
    layer = Image.new('RGBA', (size, size), (255, 255, 255, 255))
    layer.putalpha(small)
    out.paste(layer, (at + offset[0], at + offset[1]), layer)
    return out


def ink_reach(ink):
    """The farthest ink from the middle of the drawing, as a share of the drawing's width."""
    size = ink.width
    middle = (size - 1) / 2
    solid = ink.point(lambda v: 255 if v > 128 else 0)
    farthest = 0.0
    pixels = solid.load()
    for y in range(0, size, 2):
        for x in range(0, size, 2):
            if pixels[x, y]:
                farthest = max(farthest, math.hypot(x - middle, y - middle))
    return farthest / size


def make():
    flat, ink = load_drawing()
    made = {}

    # the site: the whole drawing
    made['web_icon'] = flat.resize((512, 512), Image.LANCZOS)
    made['web_apple'] = flat.resize((180, 180), Image.LANCZOS)
    made['web_favicon'] = flat.resize((256, 256), Image.LANCZOS)  # saved at 16, 32 and 48 below

    # the iPhone and the Play listing
    made['ios'] = placed(flat, 1024, round(1024 * IOS_INSET), GREEN)
    made['play'] = made['ios'].resize((512, 512), Image.LANCZOS)

    # Android: the drawing sized so its ink stays inside the promised circle
    reach = ink_reach(ink)
    size = int(1024 * (SAFE_CIRCLE / 2) * SAFE_SPARE / reach)
    size -= size % 2
    made['android'] = placed(flat, 1024, size, GREEN)
    made['android_mono'] = white_mark(ink, 1024, size)

    # the status bar: the mark alone, as wide as before, in the middle of 96 px
    box = ink.point(lambda v: 255 if v > 128 else 0).getbbox()
    mark = ink.crop(box)
    width = round(96 * NOTIFICATION_FILL)
    height = round(width * mark.height / mark.width)
    small = mark.resize((width, height), Image.LANCZOS)
    note = Image.new('RGBA', (96, 96), (255, 255, 255, 0))
    layer = Image.new('RGBA', (width, height), (255, 255, 255, 255))
    layer.putalpha(small)
    note.paste(layer, ((96 - width) // 2, (96 - height) // 2), layer)
    made['notification'] = note

    return made, {'ink_reach': reach, 'android_drawing_px': size}


def save(made):
    for key, image in made.items():
        path = ROOT / OUT[key]
        if key == 'web_favicon':
            image.save(path, format='ICO', sizes=[(16, 16), (32, 32), (48, 48)])
        else:
            image.save(path, format='PNG', optimize=True)
        print(f'wrote {OUT[key]}')
    # which drawing these were made from, and what was written: a unit test reads this, so a changed
    # drawing (or an icon changed by hand) fails until this script is run again
    digest = lambda path: hashlib.sha256(path.read_bytes()).hexdigest()
    record = {'source': str(SOURCE.relative_to(ROOT)), 'sourceSha256': digest(SOURCE), 'files': {OUT[key]: digest(ROOT / OUT[key]) for key in made}}
    RECORD.write_text(json.dumps(record, indent=2) + '\n')
    print(f'wrote {RECORD.relative_to(ROOT)}')


# ---------- the comparison picture ----------

def old_file(rev, path):
    data = subprocess.run(['git', 'show', f'{rev}:{path}'], cwd=ROOT, capture_output=True, check=True).stdout
    return Image.open(io.BytesIO(data))


def masked(image, shape, size):
    """How a launcher shows an icon: cut to a circle or to rounded corners, on the sheet's grey."""
    icon = image.convert('RGBA').resize((size, size), Image.LANCZOS)
    mask = Image.new('L', (size * 4, size * 4), 0)
    draw = ImageDraw.Draw(mask)
    if shape == 'circle':
        draw.ellipse((0, 0, size * 4 - 1, size * 4 - 1), fill=255)
    else:
        draw.rounded_rectangle((0, 0, size * 4 - 1, size * 4 - 1), radius=int(size * 4 * 0.225), fill=255)
    icon.putalpha(mask.resize((size, size), Image.LANCZOS))
    return icon


def android_view(foreground):
    """The middle two thirds of an adaptive icon's foreground, which is what a launcher shows."""
    edge = foreground.width
    cut = round(edge * (1 - 72 / 108) / 2)
    return foreground.convert('RGB').crop((cut, cut, edge - cut, edge - cut))


def on_colour(image, colour, size):
    out = Image.new('RGB', (size, size), colour)
    small = image.convert('RGBA').resize((size, size), Image.LANCZOS)
    out.paste(small, mask=small.getchannel('A'))
    return out


def favicon_at(ico, px, shown):
    ico.size = (px, px)
    return ico.convert('RGB').resize((shown, shown), Image.NEAREST)


def compare(made, out_path, rev):
    old = {key: old_file(rev, path) for key, path in OUT.items()}
    tile = 220
    rows = [
        ('iPhone app icon (rounded corners as on the home screen)', lambda s: masked(s['ios'], 'rounded', tile)),
        ('Android icon, round mask', lambda s: masked(android_view(s['android']), 'circle', tile)),
        ('Android icon, rounded-square mask', lambda s: masked(android_view(s['android']), 'rounded', tile)),
        ('Android themed icon (the phone tints the mark)', lambda s: masked(android_view(on_colour(s['android_mono'], (58, 74, 92), 1024)), 'circle', tile)),
        ('Android notification icon (white, in the status bar)', lambda s: on_colour(s['notification'], (40, 40, 40), tile)),
        ('Google Play listing icon, 512 px', lambda s: s['play'].convert('RGB').resize((tile, tile), Image.LANCZOS)),
        ('Site: apple-touch-icon, 180 px', lambda s: s['web_apple'].convert('RGB').resize((tile, tile), Image.LANCZOS)),
        ('Site: icon.png, 512 px', lambda s: s['web_icon'].convert('RGB').resize((tile, tile), Image.LANCZOS)),
    ]
    font = ImageFont.load_default(size=20)
    bold = ImageFont.load_default(size=26)
    left, gap, top = 40, 40, 110
    row_height = tile + 64
    width = left * 2 + tile * 2 + gap + 520
    height = top + row_height * len(rows) + 310
    sheet = Image.new('RGB', (width, height), (232, 232, 228))
    draw = ImageDraw.Draw(sheet)
    draw.text((left, 24), 'T-202 icons: old (left) and new (right)', fill=(20, 20, 20), font=bold)
    draw.text((left, 70), 'OLD', fill=(90, 90, 90), font=font)
    draw.text((left + tile + gap, 70), 'NEW', fill=(90, 90, 90), font=font)
    y = top
    for label, view in rows:
        for column, source in enumerate((old, made)):
            picture = view(source)
            at = (left + column * (tile + gap), y)
            if picture.mode == 'RGBA':
                sheet.paste(picture, at, picture)
            else:
                sheet.paste(picture, at)
        draw.text((left + tile * 2 + gap + 30, y + tile // 2 - 12), label, fill=(20, 20, 20), font=font)
        y += row_height

    # the favicon at its real sizes, and each size enlarged
    draw.text((left, y), 'Site: favicon.ico at 16, 32 and 48 px (real size, then enlarged)', fill=(20, 20, 20), font=font)
    y += 36
    new_ico = io.BytesIO()
    made['web_favicon'].save(new_ico, format='ICO', sizes=[(16, 16), (32, 32), (48, 48)])
    for row, name in enumerate(('OLD', 'NEW')):
        x = left
        draw.text((x, y + 44), name, fill=(90, 90, 90), font=font)
        x += 70
        for shown in (None, 112):
            for px in (16, 32, 48):
                ico = old_file(rev, OUT['web_favicon']) if row == 0 else Image.open(io.BytesIO(new_ico.getvalue()))
                size = shown or px
                sheet.paste(favicon_at(ico, px, size), (x, y + 56 - size // 2))
                x += size + 14
            x += 20
        y += 126
    out = Path(out_path)
    out.parent.mkdir(parents=True, exist_ok=True)
    sheet.save(out)
    print(f'wrote {out}')


if __name__ == '__main__':
    made, facts = make()
    print(facts)
    if len(sys.argv) > 1 and sys.argv[1] == '--compare':
        compare(made, sys.argv[2], sys.argv[3] if len(sys.argv) > 3 else 'HEAD')
    save(made)
