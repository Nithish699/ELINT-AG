import os
import urllib.request
import math
from concurrent.futures import ThreadPoolExecutor

URL_TEMPLATE = "https://a.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png"
OUTPUT_DIR = "tiles"

def download_tile(task):
    z, x, y = task
    dir_path = os.path.join(OUTPUT_DIR, str(z), str(x))
    os.makedirs(dir_path, exist_ok=True)
    file_path = os.path.join(dir_path, f"{y}.png")
    
    if os.path.exists(file_path):
        return
        
    url = URL_TEMPLATE.format(z=z, x=x, y=y)
    req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
    try:
        with urllib.request.urlopen(req, timeout=10) as response, open(file_path, 'wb') as out_file:
            out_file.write(response.read())
    except Exception as e:
        print(f"Failed {url}: {e}")

tasks = []

# Z8: x: 172-201 (30), y: 96-125 (30) -> 900 tiles
for x in range(172, 202):
    for y in range(96, 126):
        tasks.append((8, x, y))

# Z9: x: 344-403 (60), y: 192-251 (60) -> 3600 tiles
for x in range(344, 404):
    for y in range(192, 252):
        tasks.append((9, x, y))

# Z10: x: 688-807 (120), y: 384-503 (120) -> 14400 tiles
for x in range(688, 808):
    for y in range(384, 504):
        tasks.append((10, x, y))

print(f"Downloading {len(tasks)} additional tiles to '{OUTPUT_DIR}'...")

with ThreadPoolExecutor(max_workers=50) as executor:
    list(executor.map(download_tile, tasks))

print("Done downloading offline map tiles!")
