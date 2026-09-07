#!/usr/bin/env python3
"""Create a self-contained HTML edition; canonical development sources remain ES modules."""
from pathlib import Path
import base64,re
ROOT=Path(__file__).resolve().parents[1]
html=(ROOT/'index.html').read_text()
css=(ROOT/'styles.css').read_text()
modules=['core','text','renderer','demo','icons','io','app']
source='\n'.join(re.sub(r'^import .*?;\s*$', '', (ROOT/'src'/f'{m}.js').read_text(),flags=re.M) for m in modules)
source=re.sub(r'\bexport (?=(?:const|class|function|async function)\b)','',source)
for asset in ['architecture.webp','detail.webp']:
    data='data:image/webp;base64,'+base64.b64encode((ROOT/'assets'/asset).read_bytes()).decode()
    source=source.replace('./assets/'+asset,data)
html=html.replace('<link rel="stylesheet" href="./styles.css">','<style>'+css+'</style>')
html=html.replace('<script type="module" src="./src/app.js"></script>','<script type="module">\n'+source+'\n</script>')
output=ROOT/'FolioForge.html'
output.write_text(html)
print(f'{output}: {output.stat().st_size:,} bytes')
