#!/usr/bin/env python3
"""Bake the viewer's theming into standalone SVG copies for a private mount.

The SVGs d2 writes next to each .d2 file are not what the viewer shows. The
browser applies two things on top of them:
  1. src/lib/svgTheme.ts rescopes d2's `@media (prefers-color-scheme:dark)`
     block to `[data-diagram-theme="dark"] …`, so the app's toggle drives it.
  2. src/diagramSemanticThemes.css adds the per-class light/dark colors, keyed
     off `[data-diagram-theme="…"]` on the panel that wraps the SVG.

This script builds the same result into each SVG for one fixed theme, using
only plain CSS. It unwraps (dark) or drops (light) d2's @media block, and
embeds the matching half of diagramSemanticThemes.css with the
`[data-diagram-theme="…"]` prefix removed. See bake() for why the attribute
selectors can't be kept.

  usage: bake_svgs.py <mount_dir> <theme: dark|light> <out_dir> [png_scale]
  png_scale > 0 also renders <layer>.png next to each baked SVG with headless
  Chrome at that multiple of the SVG's size. Drive's SVG preview is a blurry
  low-res raster that can't be configured, so the cloud gets PNGs instead.
  output: <out_dir>/<diagram>/<layer>.svg  (or <diagram>.svg). These are the
          same relative paths as the raw files in <mount_dir>, so the copy
          uploaded to the cloud has the same layout as the local folder.
          <out_dir> is a cache outside the mount; nothing is written to
          <mount_dir>.

Only diagrams with a <name>.d2 source are baked, so hand-placed SVGs are left
alone. A file is rewritten only when its content changes, so the sync doesn't
re-upload everything on each run. Baked files whose source has gone are
removed.
"""
import pathlib
import re
import shutil
import subprocess
import sys
import tempfile

REPO = pathlib.Path(__file__).resolve().parents[2]
CSS = (REPO / "src" / "diagramSemanticThemes.css").read_text(encoding="utf-8")
DARK_MEDIA_OPEN = re.compile(r"@media screen and \(prefers-color-scheme:dark\)\{")
ROOT_SVG = re.compile(r"<svg\b")


def _dark_media_block(svg: str) -> tuple[int, int, int] | None:
    """(start, body_start, end) of d2's dark-palette @media block, or None."""
    m = DARK_MEDIA_OPEN.search(svg)
    if not m:
        return None
    depth, i = 1, m.end()
    while i < len(svg) and depth > 0:
        if svg[i] == "{":
            depth += 1
        elif svg[i] == "}":
            depth -= 1
        i += 1
    return m.start(), m.end(), i


def fix_d2_palette(svg: str, theme: str) -> str:
    """Pick d2's palette unconditionally instead of by OS preference.

    dark: unwrap the @media block so its rules always apply. They come after
          the light rules with the same specificity, so they win, which is
          what the viewer's `[data-diagram-theme="dark"]` rescoping achieves.
    light: drop the block.
    """
    block = _dark_media_block(svg)
    if not block:
        return svg
    start, body_start, end = block
    keep = svg[body_start:end - 1] if theme == "dark" else ""
    return svg[:start] + keep + svg[end:]


def semantic_css(theme: str) -> str:
    """diagramSemanticThemes.css reduced to one theme, with the attribute prefix removed.

    The viewer scopes every rule to `[data-diagram-theme="…"] …`. Here the
    prefix is stripped and the other theme's selectors are dropped. Stripping
    one attribute selector from every rule, and from d2's rules via
    fix_d2_palette, keeps all relative specificities the same.
    """
    prefix = f'[data-diagram-theme="{theme}"]'
    css = re.sub(r"/\*.*?\*/", "", CSS, flags=re.S)
    out = []
    for selectors, decls in re.findall(r"([^{}]+)\{([^{}]*)\}", css):
        kept = [sel.strip()[len(prefix):].strip()
                for sel in selectors.split(",") if sel.strip().startswith(prefix)]
        if kept:
            out.append(f"{','.join(kept)}{{{' '.join(decls.split())}}}")
    return "\n".join(out)


def bake(svg: str, theme: str) -> str:
    """Standalone SVG that looks like the viewer in `theme`, using only plain CSS.

    Drive's previewer rejects SVGs whose CSS uses `[data-diagram-theme]`
    attribute selectors. Tested on 2026-11-08: raw d2 output previewed, but the
    attribute-scoped version didn't. So nothing here uses them.
    """
    svg = fix_d2_palette(svg, theme)
    root = ROOT_SVG.search(svg)
    if not root:
        return svg
    # First child of the outermost <svg>: before d2's own <style> blocks, as
    # the viewer's stylesheet is before the inlined SVG, so ties go the same way.
    open_end = svg.index(">", root.end())
    style = f'<style type="text/css"><![CDATA[\n{semantic_css(theme)}\n]]></style>'
    return svg[:open_end + 1] + style + svg[open_end + 1:]


VIEWBOX = re.compile(r'viewBox="([-\d.]+) ([-\d.]+) ([\d.]+) ([\d.]+)"')
MAX_SIDE = 8192          # px, longest edge of a rendered PNG
MAX_PIXELS = 40_000_000  # px, total area of a rendered PNG
CHROME_CANDIDATES = ("google-chrome", "google-chrome-stable", "chromium", "chromium-browser")


def find_chrome() -> str:
    for name in CHROME_CANDIDATES:
        path = shutil.which(name)
        if path:
            return path
    sys.exit("no Chrome/Chromium found for PNG rendering (set FORMAT=svg to skip)")


def render_png(chrome: str, svg_path: pathlib.Path, png_path: pathlib.Path, scale: float) -> None:
    """Rasterize with headless Chrome, the viewer's engine, at `scale`x the SVG's size."""
    m = VIEWBOX.search(svg_path.read_text(encoding="utf-8"))
    if not m:
        raise RuntimeError(f"{svg_path}: no viewBox")
    w, h = (max(1, round(float(v))) for v in m.group(3, 4))
    # Some layers are already huge at 1x (e.g. 10546x5513). Cap the output so
    # Drive can still preview it and Chrome stays under its texture limits.
    scale = min(scale, MAX_SIDE / max(w, h), (MAX_PIXELS / (w * h)) ** 0.5)
    # Own throwaway profile, so it never touches (or locks) the user's Chrome.
    with tempfile.TemporaryDirectory(prefix="bake-chrome-") as profile:
        subprocess.run(
            [chrome, "--headless=new", "--disable-gpu", "--no-sandbox", "--hide-scrollbars",
             f"--user-data-dir={profile}", f"--force-device-scale-factor={scale}",
             f"--window-size={w},{h}", f"--screenshot={png_path}", svg_path.as_uri()],
            check=True, timeout=120, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
        )


def main() -> None:
    mount, theme, out_root = pathlib.Path(sys.argv[1]), sys.argv[2], pathlib.Path(sys.argv[3])
    png_scale = float(sys.argv[4]) if len(sys.argv) > 4 else 0  # 0 = SVG only
    if theme not in ("dark", "light"):
        sys.exit(f"theme must be dark or light, got {theme!r}")
    chrome = find_chrome() if png_scale else ""
    wanted: set[pathlib.Path] = set()

    for d2 in sorted(mount.glob("*.d2")):
        name = d2.stem
        layer_dir, single = mount / name, mount / f"{name}.svg"
        sources = sorted(layer_dir.glob("*.svg")) if layer_dir.is_dir() else []
        if not sources and single.is_file():
            sources = [single]
        for src in sources:
            dest = out_root / src.relative_to(mount)
            png = dest.with_suffix(".png")
            wanted.add(dest)
            if png_scale:
                wanted.add(png)
            baked = bake(src.read_text(encoding="utf-8"), theme)
            if not (dest.is_file() and dest.read_text(encoding="utf-8") == baked):
                dest.parent.mkdir(parents=True, exist_ok=True)
                dest.write_text(baked, encoding="utf-8")
                print(f"baked {dest.relative_to(out_root)}")
            # Re-render only when the baked SVG is newer than its PNG.
            if png_scale and (not png.is_file() or png.stat().st_mtime < dest.stat().st_mtime):
                render_png(chrome, dest, png, png_scale)
                print(f"rendered {png.relative_to(out_root)}")

    if out_root.is_dir():
        for stale in sorted(p for p in out_root.rglob("*") if p.is_file()):
            if stale not in wanted:
                stale.unlink()
                print(f"removed {stale.relative_to(out_root)}")
        for d in sorted(out_root.rglob("*"), reverse=True):
            if d.is_dir() and not any(d.iterdir()):
                d.rmdir()


if __name__ == "__main__":
    main()
