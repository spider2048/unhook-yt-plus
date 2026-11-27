#!/usr/bin/env python3
"""Render the extension icons. Run from the project root: python3 scripts/make-icons.py"""

from pathlib import Path

from PIL import Image, ImageDraw

OUT = Path(__file__).resolve().parent.parent / "src" / "icons"
SIZES = (16, 32, 48, 128)
MASTER = 512


def rounded(draw, box, radius, **kwargs):
    draw.rounded_rectangle(box, radius=radius, **kwargs)


def render() -> Image.Image:
    img = Image.new("RGBA", (MASTER, MASTER), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)

    pad = 18
    rounded(draw, (pad, pad, MASTER - pad, MASTER - pad), radius=110, fill=(20, 23, 29, 255))
    rounded(
        draw,
        (pad, pad, MASTER - pad, MASTER - pad),
        radius=110,
        outline=(70, 80, 95, 255),
        width=6,
    )

    # Play triangle
    draw.polygon([(206, 160), (206, 352), (360, 256)], fill=(233, 236, 241, 255))

    # Blocked slash
    draw.line([(128, 384), (384, 128)], fill=(255, 110, 110, 255), width=46)
    for x, y in ((128, 384), (384, 128)):
        draw.ellipse((x - 23, y - 23, x + 23, y + 23), fill=(255, 110, 110, 255))

    return img


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    master = render()
    for size in SIZES:
        master.resize((size, size), Image.LANCZOS).save(OUT / f"icon{size}.png")
    print("wrote", ", ".join(f"icon{s}.png" for s in SIZES), "to", OUT)


if __name__ == "__main__":
    main()
