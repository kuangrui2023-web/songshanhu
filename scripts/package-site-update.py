"""Package working source changes over the deployed base archive; exclude secrets/build outputs."""
from pathlib import Path
import base64
import hashlib
import subprocess
import tarfile

root = Path(__file__).resolve().parents[1]
# The Edge Function imports the exact same arithmetic used by the public page.
fee_source = root / "public/experience/fees.js"
if fee_source.exists():
    (root / "supabase/functions/ai-search/fees.js").write_bytes(fee_source.read_bytes())
with tarfile.open(root / "site-source-v3.tar.gz", "r:gz") as source:
    original = {item.name: hashlib.sha256(source.extractfile(item).read()).digest()
                for item in source.getmembers() if item.isfile()}
names = set()
for options in (["--cached"], ["--others", "--exclude-standard"]):
    names.update(subprocess.check_output(["git", "ls-files", "-z", *options], cwd=root).decode().split("\0"))
changed = []
for name in sorted(names):
    path = root / name
    if not name or name in ("AGENTS.md", "CLAUDE.md") or not path.is_file() or name.endswith((".tar.gz", ".b64")) or name.startswith((".github/", ".env")):
        continue
    if hashlib.sha256(path.read_bytes()).digest() != original.get(name):
        changed.append(name)
archive = root.parent / "admin-workspace-update.tar.gz"
with tarfile.open(archive, "w:gz") as target:
    for name in changed:
        target.add(root / name, arcname=name)
output = root.parent / "site-update.tar.gz.b64"
output.write_text(base64.b64encode(archive.read_bytes()).decode() + "\n")
print({"files": len(changed), "bytes": archive.stat().st_size,
       "sha256": hashlib.sha256(archive.read_bytes()).hexdigest(), "output": str(output)})
