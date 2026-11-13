import pathlib, json, tarfile, zipfile, io, hashlib, subprocess

ROOT = pathlib.Path(__file__).resolve().parent.parent
# Fail before writing any artifact if the client is absent/stale or a resource is missing.
subprocess.run(['node', str(ROOT / 'scripts' / 'check-package.mjs')], cwd=ROOT, check=True)
OUT = ROOT / 'deliverables'
OUT.mkdir(exist_ok=True)
pkg = json.loads((ROOT / 'package.json').read_text(encoding='utf-8'))

def pack(folder, target, files):
    with tarfile.open(target, 'w:gz', format=tarfile.PAX_FORMAT) as archive:
        for path in sorted(files):
            content = path.read_bytes()
            info = tarfile.TarInfo('package/' + path.relative_to(folder).as_posix())
            info.size, info.mode, info.mtime = len(content), 0o644, 0
            archive.addfile(info, io.BytesIO(content))
    return {'path': target.name, 'sha256': hashlib.sha256(target.read_bytes()).hexdigest(), 'bytes': target.stat().st_size}

def distributable(path):
    return (path.is_file()
            and not any(part in {'__pycache__', 'node_modules', '.git'} for part in path.parts)
            and path.name not in {'.npmrc', '.env'}
            and not path.name.startswith('.env.')
            and path.suffix not in {'.pyc', '.pyo', '.log', '.tgz', '.zip'})

files = [ROOT / 'package.json']
for name in pkg['files']:
    path = ROOT / name
    if path.is_dir():
        files.extend(p for p in path.rglob('*') if distributable(p))
    elif path.is_file():
        files.append(path)
    else:
        raise RuntimeError('Missing package file ' + str(path))
# Preserve published versions in place: never overwrite a release already referenced by Desktop.
main_path = OUT / f"{pkg['name']}-{pkg['version']}.tgz"
if main_path.exists():
    main_path = OUT / f"{pkg['name']}-{pkg['version']}-local.tgz"
main = pack(ROOT, main_path, files)
source_roots = ['src', 'vendor', 'lib', 'test', 'scripts', 'locale', 'docs', 'imgs', '.github']
source_files = [ROOT / 'icon.svg'] + [ROOT / name for name in ['package.json', 'README.md', 'README.zh.md', 'NOTICE.md', 'cordis.patch.yml']]
source_files += [ROOT / '.gitignore', ROOT / '.gitattributes', ROOT / 'LICENSE']
for name in source_roots:
    source_files.extend(p for p in (ROOT / name).rglob('*') if distributable(p))
with zipfile.ZipFile(OUT / 'dsh-auto-review-desktop-source.zip', 'w', compression=zipfile.ZIP_DEFLATED) as archive:
    for path in sorted(set(source_files)):
        archive.write(path, ROOT.name + '/' + path.relative_to(ROOT).as_posix())
(OUT / 'package-manifest.json').write_text(json.dumps(main, indent=2) + '\n', encoding='utf-8')
print(json.dumps(main, indent=2))
