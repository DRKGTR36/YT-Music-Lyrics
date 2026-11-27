# YT Music Lyrics

Chrome extension (Manifest V3) that replaces YouTube Music's static lyrics tab with **synced lyrics** that follow playback, plus a fullscreen subtitle overlay for music videos.

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

## Features

- **Synced lyrics tab** — 7-line centered window that follows the audio timeline. Click a line to seek.
- **Manual offset per track** — `-0.5s` / `+0.5s` nudges, saved per song in `chrome.storage.local`. Click the value to reset.
- **Instrumental breaks** — gaps in the lyrics are marked with a note when the pause is long enough.
- **Duet styling** — detected speaker changes render left/right aligned so two singers stay distinguishable.
- **Fullscreen subtitle overlay** — two lines only: the previous line dimmed above, the active line bright below. Toggle it with the `Lirik: ON/OFF` pill in the corner.
- **Auto-hide player bar** — the YouTube Music controls fade out in fullscreen and return on hover.
- **Lyrics source** — [LRCLIB](https://lrclib.net) for synced and plain lyrics, with a fallback that reads YouTube Music's built-in lyrics from the DOM when LRCLIB has nothing for the track.
- **Source credits** — artist and album are shown when the lyric provider supplies them.

## Install (from source)

1. Clone this repository.
2. Open `chrome://extensions` in Chrome or Chromium.
3. Enable **Developer mode** (top-right toggle).
4. Click **Load unpacked** and select the repository folder.
5. Open <https://music.youtube.com> and play a track.

## Install from the Chrome Web Store

Not published yet. Follow this repository's releases for a packaged `.zip` you can drag into `chrome://extensions`.

## Usage

| Action | How |
| --- | --- |
| Show the lyrics tab | Open the **Lyrics** tab in YouTube Music, or let the extension select it automatically |
| Seek to a line | Click any lyric line |
| Adjust timing | Use the `-0.5s` / `+0.5s` buttons at the bottom of the lyrics pane |
| Reset timing | Click the current offset value |
| Toggle fullscreen lyrics | Use the `Lirik: ON/OFF` pill in the corner |
| Browse lyrics manually | Scroll the lyrics pane; auto-follow pauses for 4 seconds |

## Development

The extension is plain JavaScript with no build step and no runtime dependencies.

```text
yt-music-lyrics/
├── manifest.json   # Manifest V3 definition
├── background.js   # Service worker: LRCLIB API requests (bypasses page CORS)
├── content.js      # Core logic: DOM observer, LRC parser, timeline, sync, fullscreen UI
└── styles.css      # Lyrics tab, fullscreen overlay, transitions, hover nav
```

Load the folder as an unpacked extension and reload it after each change.

### Local checks

```bash
node --check content.js
node --check background.js
node -e "JSON.parse(require('fs').readFileSync('manifest.json','utf8'))"
```

The CI workflow runs the same checks on every pull request.

## Contributing

Contributions are welcome. See [CONTRIBUTING.md](CONTRIBUTING.md) for the workflow, and [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md) for community expectations.

Good first issues:

- Lyrics that are out of sync on specific tracks.
- YouTube Music DOM selectors that changed and broke the fallback reader.
- Styling or accessibility improvements in the lyrics pane or fullscreen overlay.

## Credits

- Lyrics data from [LRCLIB](https://lrclib.net).
- YouTube Music is a trademark of Google LLC. This project is not affiliated with or endorsed by Google.

## License

[MIT](LICENSE) — see the license file for details.
