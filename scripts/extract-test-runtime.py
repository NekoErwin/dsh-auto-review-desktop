"""Extract text-only offline test dependencies from a local Desktop ASAR."""

import argparse
import json
import os
import pathlib
import struct
import sys
import tempfile

ROOT = pathlib.Path(__file__).resolve().parent.parent
TEXT_SUFFIXES = {'.js', '.mjs', '.cjs', '.json', '.yml', '.yaml', '.md', '.css', '.html', '.svg'}
MAX_HEADER_BYTES = 128 * 1024 * 1024


def default_archives(platform=None, environ=None, home=None):
    """Check a finite list of conventional locations, never scan install trees."""
    platform = sys.platform if platform is None else platform
    environ = os.environ if environ is None else environ
    home = pathlib.Path.home() if home is None else pathlib.Path(home)
    candidates = []
    if platform == 'win32':
        for key in ('LOCALAPPDATA', 'ProgramFiles', 'ProgramFiles(x86)'):
            if environ.get(key):
                base = pathlib.Path(environ[key])
                if key == 'LOCALAPPDATA':
                    base /= 'Programs'
                candidates.append(base / 'DeepSeek Harness' / 'resources' / 'app.asar')
        candidates.append(pathlib.Path(r'C:\Applications\DeepSeek Harness\resources\app.asar'))
    elif platform == 'darwin':
        for base in (pathlib.Path('/Applications'), home / 'Applications'):
            candidates.append(base / 'DeepSeek Harness.app' / 'Contents' / 'Resources' / 'app.asar')
    elif platform.startswith('linux'):
        if environ.get('APPDIR'):
            candidates.append(pathlib.Path(environ['APPDIR']) / 'resources' / 'app.asar')
        for base in ('/opt/DeepSeek Harness', '/opt/deepseek-harness',
                     '/usr/lib/DeepSeek Harness', '/usr/lib/deepseek-harness'):
            candidates.append(pathlib.Path(base) / 'resources' / 'app.asar')
    return list(dict.fromkeys(candidates))


def find_archive(explicit=None, *, platform=None, environ=None, home=None):
    environ = os.environ if environ is None else environ
    selected = explicit if explicit is not None else environ.get('DSH_DESKTOP_ASAR')
    if selected is not None:
        archive = pathlib.Path(selected).expanduser()
        if archive.is_file():
            return archive.resolve()
        raise ValueError(f'Explicit Desktop ASAR does not exist: {archive}. '
                         'Use --archive PATH or DSH_DESKTOP_ASAR; no fallback was attempted.')
    candidates = default_archives(platform, environ, home)
    for archive in candidates:
        if archive.is_file():
            return archive.resolve()
    checked = '\n  '.join(str(path) for path in candidates) or '(no defaults for this platform)'
    raise ValueError('Desktop ASAR not found. Pass --archive PATH or set DSH_DESKTOP_ASAR. '
                     'For an already prepared same-version dsh directory, set DSH_TEST_RUNTIME '
                     'when running tests instead. Checked only:\n  ' + checked)


def runtime_entries(header, data_bytes):
    """Validate archive names and offsets before creating any output files."""
    entries = []

    def walk(node, parts=()):
        if not isinstance(node, dict) or not isinstance(node.get('files'), dict):
            raise ValueError('Invalid ASAR directory metadata')
        for name, meta in node['files'].items():
            # ASAR names are individual portable components, not host paths.
            if (not isinstance(name, str) or not name or name in ('.', '..')
                    or any(char in name for char in '/\\:\0')
                    or name.endswith(('.', ' '))):
                raise ValueError(f'Unsafe ASAR path component: {name!r}')
            if not isinstance(meta, dict):
                raise ValueError('Invalid ASAR file metadata')
            path = parts + (name,)
            if 'files' in meta:
                walk(meta, path)
                continue
            if path[:2] != ('dsh', 'node_modules') or meta.get('unpacked') or 'offset' not in meta:
                continue
            if pathlib.PurePosixPath(*path).suffix not in TEXT_SUFFIXES:
                continue
            raw_offset = meta['offset']
            size = meta.get('size')
            if (not isinstance(raw_offset, str) or not raw_offset.isascii() or not raw_offset.isdecimal()
                    or type(size) is not int or size < 0):
                raise ValueError(f'Invalid ASAR file range: {"/".join(path)}')
            offset = int(raw_offset)
            if offset + size > data_bytes:
                raise ValueError(f'ASAR file range exceeds archive: {"/".join(path)}')
            entries.append((path, offset, size))

    walk(header)
    if not entries:
        raise ValueError('ASAR contains no packed dsh/node_modules text resources')
    return entries


def safe_target(destination, parts):
    target = destination.joinpath(*parts)
    try:
        target.resolve().relative_to(destination.resolve())
    except ValueError as error:
        raise ValueError(f'Extraction target escapes runtime directory: {target}') from error
    current = destination
    for part in (None, *parts):
        if part is not None:
            current /= part
        if current.is_symlink() or getattr(current, 'is_junction', lambda: False)():
            raise ValueError(f'Extraction target contains a link: {current}')
    return target


def extract_runtime(archive, destination):
    destination = pathlib.Path(destination)
    with pathlib.Path(archive).open('rb') as source:
        archive_bytes = source.seek(0, 2)
        source.seek(0)
        lead = source.read(16)
        if len(lead) != 16:
            raise ValueError('Truncated ASAR header')
        size, header_bytes = struct.unpack_from('<I', lead, 4)[0], struct.unpack_from('<I', lead, 12)[0]
        data_start = 8 + size
        if not 0 < header_bytes <= MAX_HEADER_BYTES or header_bytes > size - 8 or data_start > archive_bytes:
            raise ValueError('Invalid ASAR header size')
        header = json.loads(source.read(header_bytes))
        entries = runtime_entries(header, archive_bytes - data_start)
        # Validate every destination before the first write; links are never followed.
        for parts, _, _ in entries:
            safe_target(destination, parts)
        for parts, offset, length in entries:
            target = safe_target(destination, parts)
            target.parent.mkdir(parents=True, exist_ok=True)
            source.seek(data_start + offset)
            content = source.read(length)
            if len(content) != length:
                raise ValueError(f'Truncated ASAR resource: {"/".join(parts)}')
            # Replace atomically rather than writing through an existing hard link.
            temporary = None
            try:
                with tempfile.NamedTemporaryFile(dir=target.parent, prefix='.runtime-', delete=False) as output:
                    temporary = pathlib.Path(output.name)
                    output.write(content)
                temporary.replace(target)
            finally:
                if temporary is not None:
                    temporary.unlink(missing_ok=True)
        return len(entries)


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--archive', help='Exact Desktop app.asar path (overrides DSH_DESKTOP_ASAR)')
    args = parser.parse_args(argv)
    try:
        archive = find_archive(args.archive)
        destination = ROOT / 'runtime-test'
        destination.resolve().relative_to(ROOT)
        count = extract_runtime(archive, destination)
    except (OSError, ValueError, OverflowError) as error:
        parser.exit(1, f'Runtime extraction failed: {error}\n')
    print(f'Extracted {count} text/runtime resources from {archive}')
    print('Text-only cache: native binaries and unpacked ASAR files are not extracted. '
          'Use DSH_TEST_RUNTIME with a complete same-version runtime for tests that need them.')


if __name__ == '__main__':
    main()
