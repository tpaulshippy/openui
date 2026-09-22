"""Record the build-off video: click Build, capture both sides constructing the UI.

Requires the demo server running (`node live.mjs`), Playwright's Chromium,
and ffmpeg. Produces an H.264 MP4 ready for `gh pr create/edit --attach`.

Usage:
    python record/record.py [--url http://localhost:8123/live.html] [--out /tmp/jev-live-demo.mp4]
"""

import argparse
import glob
import os
import shutil
import subprocess
import tempfile

from playwright.sync_api import sync_playwright


def main() -> None:
    args = parse_args()
    out_dir = tempfile.mkdtemp(prefix="jev-video-")
    try:
        with sync_playwright() as p:
            browser = p.chromium.launch()
            ctx = browser.new_context(
                viewport={"width": 1280, "height": 720},
                record_video_dir=out_dir,
                record_video_size={"width": 1280, "height": 720},
            )
            page = ctx.new_page()
            page.goto(args.url, wait_until="networkidle")
            page.wait_for_selector("#build")
            page.wait_for_timeout(1000)
            page.click("#build")
            # Done when the badge names both sides (covers the faster
            # and the fallback outcomes).
            page.wait_for_function(
                "() => document.getElementById('badge')?.textContent?.includes('vs baseline') ?? false",
                timeout=120000,
            )
            print("BADGE:", page.locator("#badge").text_content())
            page.wait_for_timeout(1000)
            page.evaluate("window.scrollTo({top: document.body.scrollHeight, behavior: 'smooth'})")
            page.wait_for_timeout(2500)
            page.evaluate("window.scrollTo({top: 0, behavior: 'smooth'})")
            page.wait_for_timeout(1000)
            ctx.close()
            browser.close()

        webms = sorted(glob.glob(os.path.join(out_dir, "*.webm")))
        print("WEBM:", webms)
        subprocess.run(
            ["ffmpeg", "-y", "-i", webms[0], "-c:v", "libx264", "-pix_fmt", "yuv420p",
             "-crf", "23", "-movflags", "+faststart", args.out],
            check=True, capture_output=True,
        )
        print("MP4:", args.out, os.path.getsize(args.out), "bytes")
    finally:
        shutil.rmtree(out_dir, ignore_errors=True)


def parse_args():
    parser = argparse.ArgumentParser(description="Record the Jev build-off demo video.")
    parser.add_argument("--url", default="http://localhost:8123/live.html")
    parser.add_argument("--out", default="/tmp/jev-live-demo.mp4")
    return parser.parse_args()


if __name__ == "__main__":
    main()
