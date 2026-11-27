# Contributing to YT Music Lyrics

Thanks for helping out. This is a small Chrome extension with no build step, so contributions stay lightweight.

## Getting set up

1. Fork and clone the repository.
2. Open `chrome://extensions`, enable **Developer mode**, and use **Load unpacked** on the repository folder.
3. Make your change, then reload the extension from `chrome://extensions`.
4. Test on <https://music.youtube.com> with at least one track that has synced lyrics and one that does not.

## Workflow

1. Create a branch from `main`: `git checkout -b feature/short-description`.
2. Keep commits focused and write clear commit messages.
3. Run the local checks (see below) before opening a pull request.
4. Open a pull request describing what changed and how you verified it.
5. Keep pull requests small. A focused change is easier to review than a large one.

## Local checks

```bash
node --check content.js
node --check background.js
node -e "JSON.parse(require('fs').readFileSync('manifest.json','utf8'))"
```

## Code style

- Plain JavaScript, ES2020 or newer, no framework and no dependencies.
- 2-space indentation, double quotes, semicolons.
- Match the surrounding code style; do not reformat unrelated lines.
- Keep DOM selectors centralized where they already are, and update the fallback selectors if YouTube Music changes its markup.

## Reporting bugs

Open an issue with:

- Chrome version and operating system.
- The track (title and artist) that misbehaves.
- What you expected and what happened instead.
- A screenshot or console log when the problem is visual.

## Code of conduct

By participating you agree to follow [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md).

## License

Contributions are licensed under the [MIT License](LICENSE).
