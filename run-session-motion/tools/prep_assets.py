"""Build derived layers from the campaign assets.

photo_clean.jpg -> people.png (cutout), bg_plate.jpg (people removed)
logo images     -> vector SVGs (white + black) so they stay crisp at any size
"""
import os
import numpy as np
import cv2
import potrace
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
A = os.path.join(HERE, "..", "assets")
OUT = os.path.join(A, "gen")
os.makedirs(OUT, exist_ok=True)


def people_layers():
    from rembg import remove, new_session
    im = Image.open(os.path.join(A, "photo_clean.jpg")).convert("RGB")
    mask = np.array(remove(im, session=new_session("u2net_human_seg"), only_mask=True))
    # keep only the big blobs (drops stray specks near the sunglasses)
    n, lab, stats, _ = cv2.connectedComponentsWithStats((mask > 40).astype(np.uint8))
    keep = np.zeros_like(mask, bool)
    for i in range(1, n):
        if stats[i, cv2.CC_STAT_AREA] > 4000:
            keep |= lab == i
    mask = np.where(keep, mask, 0).astype(np.uint8)
    rgb = np.array(im)
    Image.fromarray(np.dstack([rgb, mask])).save(os.path.join(OUT, "people.png"))
    # split into the two runners so text can sit between them (left runner < text < right man)
    n, lab = cv2.connectedComponents((mask > 40).astype(np.uint8))
    right = lab == lab[900, 950]
    if right[400, 300]:  # blobs touch: fall back to a vertical cut
        right[:, :560] = False
    for name, sel in (("runner_left", ~right), ("runner_right", right)):
        Image.fromarray(np.dstack([rgb, np.where(sel, mask, 0).astype(np.uint8)])).save(os.path.join(OUT, name + ".png"))
    hole = cv2.dilate((mask > 20).astype(np.uint8) * 255, np.ones((25, 25), np.uint8))
    small = cv2.resize(rgb, None, fx=0.5, fy=0.5)
    hs = cv2.resize(hole, None, fx=0.5, fy=0.5)
    plate = cv2.inpaint(cv2.cvtColor(small, cv2.COLOR_RGB2BGR), hs, 12, cv2.INPAINT_TELEA)
    plate = cv2.resize(plate, (rgb.shape[1], rgb.shape[0]), interpolation=cv2.INTER_CUBIC)
    plate = cv2.cvtColor(plate, cv2.COLOR_BGR2RGB)
    a = cv2.GaussianBlur(hole, (31, 31), 0)[..., None] / 255.0
    out = (rgb * (1 - a) + plate * a).astype(np.uint8)
    Image.fromarray(out).save(os.path.join(OUT, "bg_plate.jpg"), quality=92)


def trace(ink, name, scale=4):
    """ink: bool array, True where the logo is."""
    ys, xs = np.where(ink)
    pad = 2
    ink = ink[max(ys.min() - pad, 0):ys.max() + pad + 1, max(xs.min() - pad, 0):xs.max() + pad + 1]
    big = cv2.resize(ink.astype(np.float32), None, fx=scale, fy=scale, interpolation=cv2.INTER_CUBIC)
    big = cv2.GaussianBlur(big, (0, 0), scale * 0.6) > 0.5
    plist = potrace.Bitmap(~big).trace(  # potracer fills dark (False) pixels
        turdsize=8 * scale, alphamax=1.0, opticurve=True, opttolerance=0.3)
    d = []
    for curve in plist:
        s = curve.start_point
        d.append(f"M{s.x / scale:.2f},{s.y / scale:.2f}")
        for seg in curve:
            e = seg.end_point
            if seg.is_corner:
                c = seg.c
                d.append(f"L{c.x / scale:.2f},{c.y / scale:.2f}L{e.x / scale:.2f},{e.y / scale:.2f}")
            else:
                a, b = seg.c1, seg.c2
                d.append(f"C{a.x / scale:.2f},{a.y / scale:.2f} {b.x / scale:.2f},{b.y / scale:.2f} {e.x / scale:.2f},{e.y / scale:.2f}")
        d.append("Z")
    h, w = ink.shape
    path = "".join(d)
    for col, tag in (("#fff", "w"), ("#000", "k")):
        with open(os.path.join(OUT, f"{name}_{tag}.svg"), "w") as f:
            f.write(f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {w} {h}" width="{w * 4}" height="{h * 4}">'
                    f'<path fill="{col}" fill-rule="evenodd" d="{path}"/></svg>')
    print(name, w, h, len(plist), "curves")


def logos():
    g = np.array(Image.open(os.path.join(A, "logo_freedom.jpg")).convert("L"))
    trace(g < 128, "freedom")
    g = np.array(Image.open(os.path.join(A, "logo_freedom_whatever.jpg")).convert("L"))
    trace(g > 128, "freedom_whatever")
    im = Image.open(os.path.join(A, "logo_gttend.png")).convert("RGBA")
    bg = Image.new("RGBA", im.size, (255, 255, 255, 255))
    g = np.array(Image.alpha_composite(bg, im).convert("L"))
    ink = g < 128
    ink[:15, :] = False   # thin frame lines along the top/bottom edges of the export
    ink[-15:, :] = False
    ink[:, :15] = False
    ink[:, -15:] = False
    trace(ink, "gttend")
    rows = np.where(ink.any(1))[0]
    gaps = np.where(np.diff(rows) > 10)[0]
    split = (rows[gaps[0]] + rows[gaps[0] + 1]) // 2
    stars, word = ink.copy(), ink.copy()
    stars[split:] = False
    word[:split] = False
    trace(stars, "gttend_stars")
    trace(word, "gttend_word")


def clips():
    """Higgsfield clips -> 30fps frame sequences the renderer reads (assets/gen/clips/<name>/)."""
    import subprocess, glob, json, imageio_ffmpeg
    for name, src in (("hero", "hero_kling.mp4"), ("legs", "legs_kling.mp4")):
        d = os.path.join(OUT, "clips", name)
        os.makedirs(d, exist_ok=True)
        for f in glob.glob(os.path.join(d, "*.jpg")):
            os.remove(f)
        subprocess.run([imageio_ffmpeg.get_ffmpeg_exe(), "-v", "error", "-i", os.path.join(A, "ai", src),
                        "-vf", "fps=30", "-q:v", "3", os.path.join(d, "%04d.jpg")], check=True)
        n = len(glob.glob(os.path.join(d, "*.jpg")))
        json.dump({"fps": 30, "frames": n}, open(os.path.join(d, "manifest.json"), "w"))
        print(name, n, "frames")


if __name__ == "__main__":
    import sys
    what = sys.argv[1:] or ["logos", "people", "clips"]
    if "logos" in what:
        logos()
    if "people" in what:
        people_layers()
    if "clips" in what:
        clips()
