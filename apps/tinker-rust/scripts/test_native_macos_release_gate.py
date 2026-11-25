"""Exercise the release gate's local bundle boundary without launching an app."""
from pathlib import Path
from runpy import run_path
from tempfile import TemporaryDirectory
import unittest

check_bundle = run_path(str(Path(__file__).with_name("native-macos-release-gate.py")))["check_bundle"]


class BundleBoundary(unittest.TestCase):
    def test_refuses_bundle_outside_owned_staging(self):
        with TemporaryDirectory() as directory:
            bundle = Path(directory) / "Tinker Channels Preview.app"
            bundle.mkdir()
            with self.assertRaisesRegex(ValueError, "outside dedicated temporary staging"):
                check_bundle(bundle, "preview")

    def test_refuses_symlink_even_inside_temporary_directory(self):
        with TemporaryDirectory(dir="/private/tmp") as directory:
            root = Path(directory)
            real = root / "real.app"
            real.mkdir()
            alias = root / "Tinker Channels Native QA.app"
            alias.symlink_to(real, target_is_directory=True)
            with self.assertRaisesRegex(ValueError, "not a symlink"):
                check_bundle(alias, "qa")


if __name__ == "__main__":
    unittest.main()
