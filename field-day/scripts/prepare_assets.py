"""스캔 추출 PNG → 모바일용 JPEG 변환.

사용: python3 scripts/prepare_assets.py <원본 assets 폴더>
- 10_staff_schedule.png(내부 운영자료)는 절대 복사하지 않는다(허용 목록 방식).
- 원본 이미지를 다시 그리거나 생성하지 않고 크기·압축만 바꾼다.
"""
import sys
from pathlib import Path
from PIL import Image

ALLOW = {
    '01_event_cover.png': 1600,
    '02_bus_boarding_map.png': 1800,
    '03_venue_access_map.png': 1800,
    '04_team_seating.png': 1700,
    '05_activity_layout.png': 1700,
    '06_balloon_example.png': 1200,
    '07_jump_rope_example.png': 1200,
    '08_ball_bounce_example.png': 1200,
    '09_tube_relay_example.png': 1200,
}

def main():
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(1)
    src = Path(sys.argv[1])
    out = Path(__file__).resolve().parent.parent / 'public' / 'assets'
    out.mkdir(parents=True, exist_ok=True)
    for name, max_w in ALLOW.items():
        p = src / name
        if not p.exists():
            print('missing', name)
            continue
        im = Image.open(p).convert('RGB')
        if im.width > max_w:
            im = im.resize((max_w, round(im.height * max_w / im.width)), Image.LANCZOS)
        dst = out / (p.stem + '.jpg')
        im.save(dst, 'JPEG', quality=84, optimize=True, progressive=True)
        thumb = im.copy()
        thumb.thumbnail((640, 640), Image.LANCZOS)
        thumb.save(out / (p.stem + '_thumb.jpg'), 'JPEG', quality=78, optimize=True, progressive=True)
        print(f'{dst.name}: {im.width}x{im.height}, {dst.stat().st_size // 1024}KB')
    leaked = [f for f in out.iterdir() if '10_staff' in f.name]
    assert not leaked, 'staff schedule must not be public'

if __name__ == '__main__':
    main()
