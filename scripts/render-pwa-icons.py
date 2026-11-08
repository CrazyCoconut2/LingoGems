#!/usr/bin/env python3
"""Rasterize the LingoGems mark into PWA icons."""

import math
from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[1] / "src" / "platforms" / "pwa" / "public"
BG = (11, 13, 30, 255)
STOPS = (
    (0.00, (247, 246, 255)),
    (0.30, (183, 178, 255)),
    (0.64, (108, 99, 255)),
    (1.00, (44, 39, 116)),
)
GEM = (
    (0.50, 0.00),
    (0.84, 0.16),
    (1.00, 0.46),
    (0.50, 1.00),
    (0.00, 0.46),
    (0.16, 0.16),
)
SIZES = (72, 96, 128, 144, 152, 192, 384, 512)


def mix(a, b, t):
    return tuple(round(a[i] + (b[i] - a[i]) * t) for i in range(len(a)))


def sample(t):
    t = max(0.0, min(1.0, t))
    for index in range(len(STOPS) - 1):
        start, color = STOPS[index]
        end, nxt = STOPS[index + 1]
        if t <= end:
            span = (t - start) / (end - start) if end > start else 0
            return mix(color, nxt, span)
    return STOPS[-1][1]


def direction(angle):
    theta = math.radians(angle)
    return math.sin(theta), -math.cos(theta)


def span(vx, vy, pad, inner):
    corners = (
        (pad, pad),
        (pad + inner, pad),
        (pad, pad + inner),
        (pad + inner, pad + inner),
    )
    values = [x * vx + y * vy for x, y in corners]
    low, high = min(values), max(values)
    return low, high if high > low else low + 1


def render(size, pad_ratio):
    scale = 2
    canvas = size * scale
    pad = canvas * pad_ratio
    inner = canvas - 2 * pad
    base_x, base_y = direction(145)
    sheen_x, sheen_y = direction(160)
    shade_x, shade_y = direction(200)
    base_span = span(base_x, base_y, pad, inner)
    sheen_span = span(sheen_x, sheen_y, pad, inner)
    shade_span = span(shade_x, shade_y, pad, inner)

    def along(x, y, vector, bounds):
        vx, vy = vector
        low, high = bounds
        return (x * vx + y * vy - low) / (high - low)

    gem = Image.new("RGBA", (canvas, canvas), (0, 0, 0, 0))
    pixels = []
    for y in range(canvas):
        for x in range(canvas):
            tone = sample(along(x, y, (base_x, base_y), base_span))
            sheen = along(x, y, (sheen_x, sheen_y), sheen_span)
            if sheen < 0.38:
                tone = mix(tone, (255, 255, 255), 0.92 * (1 - sheen / 0.38))
            shade = along(x, y, (shade_x, shade_y), shade_span)
            if shade > 0.46:
                tone = mix(tone, (18, 14, 64), 0.55 * (shade - 0.46) / 0.54)
            pixels.append((*tone, 255))
    gem.putdata(pixels)

    mask = Image.new("L", (canvas, canvas), 0)
    draw = ImageDraw.Draw(mask)
    draw.polygon(
        [(pad + fx * inner, pad + fy * inner) for fx, fy in GEM],
        fill=255,
    )
    plate = Image.new("RGBA", (canvas, canvas), BG)
    plate.paste(gem, (0, 0), mask)

    facet = ImageDraw.Draw(plate)
    box = (0.22, 0.18, 0.78, 0.38)

    def facet_point(px, py):
        return (
            pad + (box[0] + (box[2] - box[0]) * px) * inner,
            pad + (box[1] + (box[3] - box[1]) * py) * inner,
        )

    facet.polygon(
        [facet_point(0.12, 0), facet_point(0.88, 0), facet_point(0.68, 1), facet_point(0.32, 1)],
        fill=(255, 255, 255, 184),
    )
    return plate.resize((size, size), Image.Resampling.LANCZOS)


def main():
    icons = ROOT / "icons"
    icons.mkdir(parents=True, exist_ok=True)
    any_master = render(512, 0.1)
    mask_master = render(512, 0.22)
    for size in SIZES:
        any_master.resize((size, size), Image.Resampling.LANCZOS).save(
            icons / f"icon-{size}x{size}.png",
            optimize=True,
        )
        mask_master.resize((size, size), Image.Resampling.LANCZOS).save(
            icons / f"icon-{size}x{size}-maskable.png",
            optimize=True,
        )
    apple = any_master.resize((180, 180), Image.Resampling.LANCZOS)
    apple.save(icons / "apple-touch-icon.png", optimize=True)
    ico = [any_master.resize((size, size), Image.Resampling.LANCZOS) for size in (16, 32, 48)]
    ico[0].save(
        ROOT / "favicon.ico",
        format="ICO",
        sizes=[(16, 16), (32, 32), (48, 48)],
        append_images=ico[1:],
    )


if __name__ == "__main__":
    main()
