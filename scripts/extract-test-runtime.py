import json,struct,pathlib
ROOT=pathlib.Path(__file__).resolve().parent.parent
archive=pathlib.Path(r'C:\Applications\DeepSeek Harness\resources\app.asar')
with archive.open('rb') as f:
    lead=f.read(16); size=struct.unpack_from('<I',lead,4)[0]; n=struct.unpack_from('<I',lead,12)[0]; header=json.loads(f.read(n)); count=0
    def walk(node,prefix=''):
        global count
        for name,meta in node.get('files',{}).items():
            p=prefix+name
            if 'files' in meta: walk(meta,p+'/'); continue
            if not p.startswith('dsh/node_modules/') or meta.get('unpacked') or 'offset' not in meta: continue
            if not p.endswith(('.js','.mjs','.cjs','.json','.yml','.yaml','.md','.css','.html','.svg')): continue
            out=ROOT/'runtime-test'/p; out.parent.mkdir(parents=True,exist_ok=True)
            f.seek(8+size+int(meta['offset']));out.write_bytes(f.read(meta['size']));count+=1
    walk(header)
    print(f'Extracted {count} text/runtime resources for offline tests')
