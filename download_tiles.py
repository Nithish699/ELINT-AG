import os
import shutil
import urllib.request
import math
from concurrent.futures import ThreadPoolExecutor

# Light theme CartoDB tiles
URL_TEMPLATE = "https://a.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png"
OUTPUT_DIR = "tiles"

print("Removing old tiles...")
if os.path.exists(OUTPUT_DIR):
    shutil.rmtree(OUTPUT_DIR)

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

def get_xyz(lon_deg, lat_deg, zoom):
    lat_rad = math.radians(lat_deg)
    n = 2.0 ** zoom
    xtile = int((lon_deg + 180.0) / 360.0 * n)
    ytile = int((1.0 - math.asinh(math.tan(lat_rad)) / math.pi) / 2.0 * n)
    # Ensure tiles don't go out of bounds for the zoom level
    xtile = max(0, min(xtile, int(n) - 1))
    ytile = max(0, min(ytile, int(n) - 1))
    return (xtile, ytile)

# India / operations approximate bbox
# Covers ~62E to ~98E and ~6N to ~38N
MIN_LON = 62.0
MAX_LON = 98.0
MIN_LAT = 6.0
MAX_LAT = 38.0

# Minimal zoom for development (0 to 9) 
# Restricting every single zoom level ONLY to the bounding box around India!
for z in range(0, 10): 
    min_x, max_y = get_xyz(MIN_LON, MIN_LAT, z)
    max_x, min_y = get_xyz(MAX_LON, MAX_LAT, z)
    
    for x in range(min_x, max_x + 1):
        for y in range(min_y, max_y + 1):
            tasks.append((z, x, y))

print(f"Downloading {len(tasks)} light map tiles to '{OUTPUT_DIR}' (India specific)...")

with ThreadPoolExecutor(max_workers=50) as executor:
    list(executor.map(download_tile, tasks))

print("Done downloading offline map tiles!")
