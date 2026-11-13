"""Verify a packed plugin without extracting or executing it."""
import argparse
import fnmatch
import json
import posixpath
import re
import tarfile
from pathlib import Path
from urllib.parse import unquote, urlsplit


def verify_archive(path):
    with tarfile.open(path, 'r:gz') as archive:
        members = archive.getmembers()
        files = {}
        for member in members:
            if member.isdir():
                continue
            assert member.isfile() and member.name.startswith('package/'), f'Unexpected member type/path: {member.name}'
            name = member.name[len('package/'):]
            assert not name.startswith('/') and '..' not in name.split('/') and '\\' not in name, f'Unsafe member: {name}'
            assert name not in files, f'Duplicate member: {name}'
            files[name] = archive.extractfile(member).read()
    pkg = json.loads(files['package.json'])
    for target in pkg['exports'].values():
        pattern = target.removeprefix('./')
        assert any(fnmatch.fnmatchcase(name, pattern) for name in files), f'Missing export {target}'
    assert files['src/client.js'] == files['lib/client.js'], 'Stale client'
    assert pkg['dsh']['bundle']['patch'].removeprefix('./') in files
    for language in ['en', 'zh']:
        assert json.loads(files[f'locale/{language}.json'])['meta']['detail'] in files
    for lifecycle in ['install', 'preinstall', 'postinstall', 'prepare', 'prepack', 'postpack']:
        assert lifecycle not in pkg.get('scripts', {}), f'Unexpected lifecycle: {lifecycle}'
    for name, data in files.items():
        assert not name.startswith(('tmp/', 'runtime-test/', 'node_modules/', '.git/')), f'Private directory: {name}'
        assert Path(name).name not in ('.env', '.npmrc', 'credentials.json'), f'Private configuration: {name}'
        if name.endswith('.md'):
            for href in re.findall(r'\]\(([^)]+)\)', data.decode('utf-8')):
                href = href.strip().strip('<>')
                parsed = urlsplit(href)
                if parsed.scheme or parsed.netloc or not parsed.path:
                    continue
                target = posixpath.normpath(posixpath.join(posixpath.dirname(name), unquote(parsed.path)))
                assert target in files, f'Broken Markdown link: {name} -> {target}'
        if name.endswith(('.js', '.mjs')):
            for target in re.findall(r'(?:from\s*|import\s*)[\'\"](\.[^\'\"]+)[\'\"]', data.decode('utf-8')):
                resolved = posixpath.normpath(posixpath.join(posixpath.dirname(name), target))
                assert resolved in files, f'Missing relative JS import: {name} -> {target}'
    print(f"Verified {pkg['name']}@{pkg['version']}: {len(files)} files, exports, client, details, links and relative imports")
    return pkg, files


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('archive', type=Path, nargs='?')
    args = parser.parse_args()
    path = args.archive
    if path is None:
        output = Path(__file__).resolve().parent.parent / 'deliverables'
        path = output / json.loads((output / 'package-manifest.json').read_text(encoding='utf-8'))['path']
    verify_archive(path)
