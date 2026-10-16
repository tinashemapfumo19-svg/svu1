"""Internal stdout transport to the cutover process; contains private source data."""
import json
import pathlib
import runpy
import sys

reader = runpy.run_path(str(pathlib.Path(__file__).with_name('legacy-identity-match.py')))
source = pathlib.Path(sys.argv[1]).read_bytes().decode('utf-8', errors='strict')
sys.stdout.reconfigure(encoding='utf-8')
json.dump(reader['read_rows'](source, None), sys.stdout, ensure_ascii=False)
