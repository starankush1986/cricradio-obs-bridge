"""Generate field-map.json from CricRadio frontend chunk."""
import json
import re
from pathlib import Path

d = Path(__file__).resolve().parent.parent.parent / "tools" / "2725-eee7ee117cfa8409.js"
text = d.read_text(encoding="utf-8", errors="ignore")
start = text.find("Object.fromEntries(Object.entries({")
chunk = text[start:]
depth = 0
end = 0
for i, c in enumerate(chunk):
    if c == "{":
        depth += 1
    elif c == "}":
        depth -= 1
        if depth == 0:
            end = i + 1
            break

mapping_src = chunk[:end]
# Extract key:value pairs
pairs = re.findall(r'([A-Za-z0-9_]+):"([^"]+)"', mapping_src)
# Invert: short -> long
field_map = {short: long for long, short in pairs}
out = Path(__file__).resolve().parent.parent / "lib" / "field-map.json"  # obs-bridge/lib
out.parent.mkdir(parents=True, exist_ok=True)
out.write_text(json.dumps(field_map, indent=2), encoding="utf-8")
print(f"Wrote {len(field_map)} entries to {out}")
