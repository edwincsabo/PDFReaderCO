"""Resolve Poppler for optional independent PDF verification scripts."""
import os
from pathlib import Path
import shutil


def pdftoppm():
    configured = os.environ.get('PDFREADERCO_PDFTOPPM')
    executable = configured or shutil.which('pdftoppm')
    if not executable or not Path(executable).is_file():
        raise FileNotFoundError(
            'Install Poppler and add pdftoppm to PATH, or set '
            'PDFREADERCO_PDFTOPPM to the full executable path.'
        )
    return str(Path(executable).resolve())
