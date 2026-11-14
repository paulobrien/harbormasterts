# Harbor Master TS

A browser-based recreation of Harbor Master HD's Treasure Island, written in TypeScript and designed for tablet touch controls. It supports an installable, full-screen PWA, sound, saved shifts and local high scores.

## Original game assets

**This repository contains no original game assets or IPA.** The game needs a separately supplied asset bundle to run with its original level, graphics and audio. The independently written source code is MIT licensed. Original Harbor Master game files belong to their respective rights holders and are not covered by that license.

The playable web distribution can include a bundle of the assets required by this game. Supplying or distributing those files is separate from licensing this source code. The bundle must not be committed to this repository: `/public/game/` and `*.ipa` are ignored.

## Requirements

- Node.js 20 or later and npm.
- Python 3 if creating the bundle from an IPA.
- For a playable build, a Harbor Master HD 2.0.1 IPA or an existing compatible asset-only bundle that you are authorized to use.

## Develop

```sh
npm ci
npm run typecheck
npm test
npm run build
npx playwright install chromium
npm run test:e2e
```

`npm test` runs the simulation and regression suites. `npm run test:e2e` builds the application and runs real Chromium browser tests with desktop, Android phone and Android tablet profiles. These are emulations, not a substitute for testing on a physical device. The default checks use synthetic data and need no original game files. To test against an original local IPA, set `HARBOR_HD_IPA` to its path before running the regression suites. `npm run build` builds the application shell even when assets have not been staged; the built game will need the asset bundle before it can play. CI runs the same checks on pushes and pull requests.

The project-local [Playwright best-practices skill](.agents/skills/playwright-best-practices/SKILL.md) is included to guide browser-test work. It comes from [currents-dev/playwright-best-practices-skill](https://github.com/currents-dev/playwright-best-practices-skill) at revision `0b75b5835a87de1fdd202ba965f3bc5a27738fdf`; its MIT licence is included with the skill.

To create the local bundle and start the development server:

```sh
python3 tools/build-game-bundle.py /path/to/Harbor-Master-HD.ipa
npm run dev
```

On Windows, replace `python3` with `python` if appropriate. The generator writes `public/game/harbor-hd-assets.zip` locally. It includes the Treasure Island map, sprites, music and sound effects, but excludes the original executable, IPA, signatures, credentials and unrelated assets. Those generated files remain ignored by Git.

Alternatively, `HARBOR_HD_IPA=/path/to/file.ipa npm run build:playable` both creates the bundle and builds the site. On Windows PowerShell, use `$env:HARBOR_HD_IPA = 'C:\path\to\file.ipa'` followed by `npm run build:playable`. Set `PYTHON` if a different Python executable is needed.

If a bundled game is unavailable, use **Add game files** to select a compatible IPA or asset bundle. Once a game is loaded, **Choose a different game file** lets you replace it. A file that cannot be opened or whose level has no usable docks is rejected before it replaces the existing stored game; the current game and saved shift remain available.

## CI and deployment

Keep the source repository free of original assets. Provide the asset-only ZIP separately to an authorized build environment and stage it at build time:

```sh
HARBOR_ASSET_BUNDLE_URL=https://your-authorized-host.example/harbor-hd-assets.zip npm run build:playable
```

The URL may point to an appropriately controlled private artifact service or an authorized, non-repository location. If that service uses bearer authentication, pass `HARBOR_ASSET_BUNDLE_TOKEN` as a protected environment variable; do not commit it. The URL must use HTTPS and resolve directly without an HTTP redirect. The staging step checks the bundle's required entries before writing it locally. Alternatively, provide `HARBOR_HD_IPA` to build from an IPA that is already present in the build environment. Do not commit or print the IPA, bundle credentials, or private asset URLs in CI logs.

`npm run build:playable` fails if a valid bundle cannot be staged, so it will not silently produce a deployment missing the game data. The build places the separately staged assets in `dist/`; anyone able to access a public deployment can access its bundled game data. Configure hosting access and distribution appropriately. After the initial online visit, the game stores its data locally for offline use, subject to browser storage availability.

Each production build versions its offline app shell from its contents. An update becomes active only after the new shell and its required assets have all been cached; an interrupted update leaves the previous offline shell available. Game bundles are stored separately and are not part of the shell cache or its version.

This checkout is independent of the existing published Site. Pushing to GitHub does not update that Site unless a deployment workflow or hosting integration is configured separately. Browser saves and installation are tied to the site's origin; a new domain has separate local saves.

## Playing

Open the playable site, tap Play, then draw each boat's route to a matching dock. Once it unloads, draw a route back out to sea. Avoid boat collisions. This recreation supports Treasure Island; see `docs/FIDELITY_AUDIT.md` for what was verified against the original app and what remains approximate.
