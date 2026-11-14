#!/usr/bin/env python3
"""Create the minimal deployable HD game-data archive from an original IPA.

Usage: python3 tools/build-game-bundle.py /path/to/original.ipa
The resulting bundle contains only the map, sprites, soundtrack and CAF effects
used by the browser importer. It never includes the iOS executable, a signing
identity, entitlements, or other IPA files. Repeated runs are byte-identical.
The original game's assets remain subject to their respective rights.
"""
from __future__ import annotations

import hashlib
import sys
from pathlib import Path
from zipfile import BadZipFile, ZIP_DEFLATED, ZipFile, ZipInfo

ASSET_ROOT = 'Payload/HarborMasterHD.app/'
REQUIRED = {
    'hmhd0001-texture.png',
    'spritesTexture.png',
    'hmhd0001.lvl',
    'HarborMasterSeagulls.mp3',
}
OUTPUT = Path(__file__).resolve().parents[1] / 'public/game/harbor-hd-assets.zip'


def build(source: Path, output: Path = OUTPUT) -> None:
    with ZipFile(source) as archive:
        names = set(archive.namelist())
        missing = sorted(ASSET_ROOT + name for name in REQUIRED if ASSET_ROOT + name not in names)
        if missing:
            raise ValueError('Not a supported Harbor Master HD IPA; missing: ' + ', '.join(missing))
        effects = sorted(name for name in names if name.startswith(ASSET_ROOT)
                         and '/' not in name[len(ASSET_ROOT):] and name.lower().endswith('.caf'))
        if not effects:
            raise ValueError('The supplied IPA does not contain sound effects.')
        selected = sorted([ASSET_ROOT + name for name in REQUIRED] + effects)
        output.parent.mkdir(parents=True, exist_ok=True)
        temporary = output.with_suffix('.tmp')
        try:
            with ZipFile(temporary, 'w', compression=ZIP_DEFLATED, compresslevel=9) as result:
                for name in selected:
                    entry = ZipInfo(name, date_time=(1980, 1, 1, 0, 0, 0))
                    entry.compress_type = ZIP_DEFLATED
                    entry.create_system = 3
                    entry.external_attr = 0o644 << 16
                    result.writestr(entry, archive.read(name), compress_type=ZIP_DEFLATED, compresslevel=9)
            temporary.replace(output)
        finally:
            temporary.unlink(missing_ok=True)
    digest = hashlib.sha256(output.read_bytes()).hexdigest()
    print(f'Created {output}: {len(selected)} asset files, {output.stat().st_size} bytes, SHA-256 {digest}')


if __name__ == '__main__':
    if len(sys.argv) != 2:
        raise SystemExit('Usage: python3 tools/build-game-bundle.py /path/to/Harbor-Master-HD.ipa')
    try:
        build(Path(sys.argv[1]))
    except (FileNotFoundError, BadZipFile, ValueError) as error:
        raise SystemExit(f'Could not create game bundle: {error}') from error
