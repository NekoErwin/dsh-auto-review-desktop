"""Offline ASAR selection and extraction tests; run with python -B test/extract-runtime.test.py."""

import contextlib
import importlib.util
import io
import json
import os
import pathlib
import struct
import tempfile
import unittest
from unittest.mock import patch

ROOT = pathlib.Path(__file__).resolve().parent.parent
spec = importlib.util.spec_from_file_location('extract_runtime', ROOT / 'scripts' / 'extract-test-runtime.py')
extractor = importlib.util.module_from_spec(spec)
spec.loader.exec_module(extractor)


class RuntimeExtractionTests(unittest.TestCase):
    def setUp(self):
        temporary_root = ROOT / 'tmp'
        temporary_root.mkdir(exist_ok=True)
        self.temporary = tempfile.TemporaryDirectory(prefix='runtime-extractor-', dir=temporary_root)
        self.root = pathlib.Path(self.temporary.name).resolve()
        self.root.relative_to(temporary_root.resolve())
        self.addCleanup(self.temporary.cleanup)

    def archive(self, entries=None, data=b'export const value = 1;'):
        if entries is None:
            entries = {'index.js': {'offset': '0', 'size': len(data)}}
        header = {'files': {'dsh': {'files': {'node_modules': {'files': entries}}}}}
        raw = json.dumps(header).encode('utf-8')
        padding = b'\0' * (-len(raw) % 4)
        header_pickle = struct.pack('<II', len(raw) + len(padding) + 4, len(raw)) + raw + padding
        archive = self.root / 'app.asar'
        archive.write_bytes(struct.pack('<II', 4, len(header_pickle)) + header_pickle + data)
        return archive

    def test_explicit_archive_precedes_environment_and_main_extracts(self):
        archive = self.archive()
        with patch.dict(os.environ, {'DSH_DESKTOP_ASAR': str(self.root / 'wrong.asar')}), patch.object(extractor, 'ROOT', self.root):
            with contextlib.redirect_stdout(io.StringIO()) as output:
                extractor.main(['--archive', str(archive)])
        self.assertEqual((self.root / 'runtime-test' / 'dsh' / 'node_modules' / 'index.js').read_bytes(), b'export const value = 1;')
        self.assertIn('Extracted 1', output.getvalue())
        self.assertIn('Text-only cache', output.getvalue())

    def test_environment_archive_precedes_defaults(self):
        archive = self.archive()
        with patch.object(extractor, 'default_archives', side_effect=AssertionError('Do not inspect defaults')):
            self.assertEqual(extractor.find_archive(environ={'DSH_DESKTOP_ASAR': str(archive)}), archive.resolve())

    def test_missing_explicit_archive_fails_without_fallback(self):
        with patch.object(extractor, 'default_archives', side_effect=AssertionError('Do not fall back')):
            with self.assertRaisesRegex(ValueError, 'no fallback'):
                extractor.find_archive(str(self.root / 'missing.asar'), environ={})

    def test_default_candidates_are_finite_platform_paths(self):
        windows = extractor.default_archives('win32', {'LOCALAPPDATA': str(self.root / 'local'), 'ProgramFiles': str(self.root / 'programs')}, self.root)
        self.assertEqual(windows[0], self.root / 'local' / 'Programs' / 'DeepSeek Harness' / 'resources' / 'app.asar')
        self.assertEqual(len(windows), 3)
        mac = extractor.default_archives('darwin', {}, self.root)
        self.assertEqual(mac, [pathlib.Path('/Applications/DeepSeek Harness.app/Contents/Resources/app.asar'),
                              self.root / 'Applications/DeepSeek Harness.app/Contents/Resources/app.asar'])
        linux = extractor.default_archives('linux', {'APPDIR': str(self.root / 'appimage')}, self.root)
        self.assertEqual(linux[0], self.root / 'appimage' / 'resources' / 'app.asar')
        self.assertEqual(len(linux), 5)
        self.assertEqual(extractor.default_archives('other', {}, self.root), [])

    def test_missing_default_archive_explains_both_overrides(self):
        with self.assertRaisesRegex(ValueError, 'DSH_DESKTOP_ASAR.*DSH_TEST_RUNTIME'):
            extractor.find_archive(platform='other', environ={}, home=self.root)

    def test_default_search_selects_existing_candidate_without_scanning(self):
        archive = self.archive()
        with patch.object(extractor, 'default_archives', return_value=[self.root / 'missing.asar', archive]):
            self.assertEqual(extractor.find_archive(environ={}), archive.resolve())

    def test_only_packed_text_runtime_resources_are_extracted(self):
        archive = self.archive({'index.js': {'offset': '0', 'size': 2},
                                'native.node': {'offset': '2', 'size': 3},
                                'unpacked.js': {'unpacked': True, 'size': 3},
                                'linked.js': {'link': 'index.js'}}, b'jsbin')
        destination = self.root / 'output'
        self.assertEqual(extractor.extract_runtime(archive, destination), 1)
        self.assertEqual(list((destination / 'dsh' / 'node_modules').iterdir()), [destination / 'dsh' / 'node_modules' / 'index.js'])
        self.assertEqual((destination / 'dsh' / 'node_modules' / 'index.js').read_bytes(), b'js')

    def test_unsafe_names_are_rejected_before_any_output(self):
        for name in ('..', '../escape.js', '/escape.js', r'..\escape.js', 'C:escape.js', 'name. ', 'name.', 'bad\0.js'):
            with self.subTest(name=name):
                archive = self.archive({'good.js': {'offset': '0', 'size': 1}, name: {'offset': '0', 'size': 1}}, b'x')
                destination = self.root / 'output'
                with self.assertRaisesRegex(ValueError, 'Unsafe ASAR path'):
                    extractor.extract_runtime(archive, destination)
                self.assertFalse(destination.exists())

    def test_bad_offsets_and_sizes_are_rejected_before_any_output(self):
        for metadata in ({'offset': '-1', 'size': 1}, {'offset': '0', 'size': -1},
                         {'offset': '2', 'size': 2}, {'offset': '0', 'size': True},
                         {'offset': 0, 'size': 1}):
            with self.subTest(metadata=metadata):
                archive = self.archive({'index.js': metadata}, b'x')
                destination = self.root / 'output'
                with self.assertRaisesRegex(ValueError, 'ASAR file range'):
                    extractor.extract_runtime(archive, destination)
                self.assertFalse(destination.exists())

    def test_truncated_or_invalid_headers_fail_before_output(self):
        for content in (b'not asar', struct.pack('<IIII', 4, 8, 4, 100)):
            with self.subTest(content=content):
                archive = self.root / 'broken.asar'
                archive.write_bytes(content)
                destination = self.root / 'output'
                with self.assertRaisesRegex(ValueError, 'ASAR header'):
                    extractor.extract_runtime(archive, destination)
                self.assertFalse(destination.exists())

    def test_existing_hardlink_is_replaced_without_modifying_its_other_name(self):
        archive = self.archive(data=b'new')
        destination = self.root / 'output'
        target = destination / 'dsh' / 'node_modules' / 'index.js'
        target.parent.mkdir(parents=True)
        outside = self.root / 'original.txt'
        outside.write_bytes(b'original')
        try:
            os.link(outside, target)
        except (OSError, NotImplementedError) as error:
            self.skipTest(f'Filesystem does not support hard links: {error}')
        extractor.extract_runtime(archive, destination)
        self.assertEqual(outside.read_bytes(), b'original')
        self.assertEqual(target.read_bytes(), b'new')

    def test_existing_symlink_is_rejected_without_external_write(self):
        archive = self.archive()
        destination = self.root / 'output'
        external = self.root / 'external'
        destination.mkdir(); external.mkdir()
        try:
            (destination / 'dsh').symlink_to(external, target_is_directory=True)
        except (OSError, NotImplementedError) as error:
            self.skipTest(f'Host cannot create directory symlinks: {error}')
        with self.assertRaisesRegex(ValueError, 'escapes runtime directory|contains a link'):
            extractor.extract_runtime(archive, destination)
        self.assertEqual(list(external.iterdir()), [])


if __name__ == '__main__':
    unittest.main(verbosity=2)
