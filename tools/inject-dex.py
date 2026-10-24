# inject-dex.py - add classes.dex into an aapt2-linked APK (deflated entry is fine).
# Usage: python inject-dex.py <base.apk> <classes.dex>
import sys, zipfile, shutil

src, dex = sys.argv[1], sys.argv[2]
tmp = src + '.tmp'
with zipfile.ZipFile(src, 'r') as zin, zipfile.ZipFile(tmp, 'w', zipfile.ZIP_DEFLATED) as zout:
    for item in zin.infolist():
        # resources.arsc must stay STORED (uncompressed) for API 30+; keep its method
        data = zin.read(item.filename)
        zi = zipfile.ZipInfo(item.filename, date_time=item.date_time)
        zi.compress_type = item.compress_type
        zi.external_attr = item.external_attr
        zout.writestr(zi, data)
    with open(dex, 'rb') as f:
        zout.writestr('classes.dex', f.read())
shutil.move(tmp, src)
print('dex injected:', src)
