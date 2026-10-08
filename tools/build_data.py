#!/usr/bin/env python3
"""Build the static data files for the Physical AI concept map.

usage: python3 tools/build_data.py          (run from the repository root)

input : src/tree.json   — the full concept tree (single source of truth)
        src/paths.json  — learning paths (steps reference nodes by a name-path suffix)
output: data/skeleton.json   names + flags + tree structure (loaded first)
        data/d/<chunk>.json  per-area detail text, loaded on demand
        data/glossary.json   abbreviation index
        data/paths.json      learning paths resolved to node ids
        data/version.json    content hash (cache busting)
        tools/.diagrams.json Mermaid sources for tools/render_diagrams.js
"""
import json, re, hashlib, os, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
P = lambda *a: os.path.join(ROOT, *a)
tree = json.load(open(P('src', 'tree.json'), encoding='utf-8'))
paths_src = json.load(open(P('src', 'paths.json'), encoding='utf-8'))

CAT_CHUNK = {'기본 개념': 'basics', '인식 (Perception)': 'perception', '세계 이해 · 추론': 'world', '계획 · 제어': 'planning',
             '학습 기반 정책': 'learning', '로봇 파운데이션 모델': 'foundation', '데이터 · 시뮬레이션': 'data',
             '하드웨어 · 플랫폼': 'hw', '안전 · 평가 · 운영': 'safety'}
AV_GROUP = {'자율주행 레벨': 'av1', '센서 · 하드웨어': 'av1', '인지': 'av1',
            '측위 · 지도': 'av2', '예측 · 판단': 'av2', '차량 제어': 'av2', 'End-to-End 주행': 'av2',
            '데이터 · 검증': 'av3', '안전 · 규제': 'av3', '서비스 · 사업': 'av3', '오픈소스 자율주행 스택': 'av3'}

# ---- assign ids (DFS, root = 0) and chunks ----
nodes = []
def walk(n, parent, chunk, path):
    n['_id'] = len(nodes); n['_parent'] = parent; n['_path'] = path + [n['n']]
    if parent is None: chunk = 'root'
    elif parent['_parent'] is None: chunk = CAT_CHUNK[n['n']]
    elif parent['n'] == 'Autonomous Vehicle': chunk = AV_GROUP.get(n['n'], 'av3')
    elif n['n'] == 'Autonomous Vehicle': chunk = 'av1'
    n['_chunk'] = chunk; nodes.append(n)
    for c in n.get('c', []): walk(c, n, chunk, n['_path'])
walk(tree, None, 'root', [])
by_path = {tuple(n['_path']): n for n in nodes}

def resolve_path(p):
    n = by_path.get(tuple(p))
    if n: return n
    cands = [m for m in nodes if m['n'] == p[-1]]
    if len(cands) == 1: return cands[0]
    if cands: return max(cands, key=lambda m: len(set(m['_path']) & set(p)))
    return None

# ---- skeleton ----
def skel(n):
    o = {'n': n['n']}
    if n.get('av'): o['a'] = 1
    if n.get('swl'): o['s'] = 1
    if n.get('tool'): o['t'] = 1
    if n.get('dg'): o['g'] = 1
    if n['_parent'] is None or n['_chunk'] != n['_parent']['_chunk']: o['k'] = n['_chunk']
    if n.get('c'): o['c'] = [skel(c) for c in n['c']]
    return o
skeleton = skel(tree)

# ---- detail chunks ----
chunks = {}
missing_rel = 0
for n in nodes:
    d = {k: n[k] for k in ('d', 'sw', 'tech', 'issue', 'feat', 'url', 'src') if n.get(k)}
    rel = []
    for p in n.get('rel', []):
        m = resolve_path(p)
        if m is None: missing_rel += 1; continue
        if m['_id'] != n['_id'] and m['_id'] not in rel: rel.append(m['_id'])
    if rel: d['rel'] = rel
    chunks.setdefault(n['_chunk'], {})[str(n['_id'])] = d

# ---- glossary ----
ab_re = re.compile(r'(?<![A-Za-z0-9])([A-Z][A-Za-z0-9\-/]{1,14})\(([A-Za-z][^()]{2,90}?)\)')
gloss = {}
for n in nodes:
    for k in ('d', 'sw', 'tech', 'issue'):
        for m in ab_re.finditer(n.get(k) or ''):
            ab, ex = m.group(1), m.group(2).split(',')[0].strip()
            if not re.search(r'[A-Z].*[A-Z]|[A-Z][0-9]', ab) or len(ex) < 4: continue
            g = gloss.setdefault(ab, {'a': ab, 'e': ex, 'i': []})
            if n['_id'] not in g['i'] and len(g['i']) < 5: g['i'].append(n['_id'])
glossary = sorted(gloss.values(), key=lambda g: g['a'].lower())

# ---- learning paths ----
def resolve_suffix(spec):
    parts = [s.strip() for s in spec.split('>')]
    cands = [n for n in nodes if n['_path'][-len(parts):] == parts]
    return cands
out_paths, errors = [], []
for p in paths_src:
    steps = []
    for spec, note in p['steps']:
        c = resolve_suffix(spec)
        if len(c) != 1: errors.append(f"{p['id']}: '{spec}' → {len(c)} matches"); continue
        steps.append({'i': c[0]['_id'], 'note': note})
    out_paths.append({k: p[k] for k in ('id', 'title', 'who', 'goal')} | {'steps': steps})
if errors:
    print('PATH ERRORS:\n  ' + '\n  '.join(errors)); sys.exit(1)

# ---- write ----
os.makedirs(P('data', 'd'), exist_ok=True)
dump = lambda obj, path: open(path, 'w', encoding='utf-8').write(json.dumps(obj, ensure_ascii=False, separators=(',', ':')))
dump(skeleton, P('data', 'skeleton.json'))
for k, v in chunks.items(): dump(v, P('data', 'd', f'{k}.json'))
dump(glossary, P('data', 'glossary.json'))
dump(out_paths, P('data', 'paths.json'))
h = hashlib.sha1()
for f in sorted(['skeleton.json', 'glossary.json', 'paths.json'] + [f'd/{k}.json' for k in chunks]):
    h.update(open(P('data', f), 'rb').read())
dgs = [{'id': n['_id'], 'code': n['dg']} for n in nodes if n.get('dg')]
h.update(json.dumps(dgs, ensure_ascii=False).encode())
version = h.hexdigest()[:10]
dump({'v': version, 'nodes': len(nodes), 'chunks': sorted(chunks)}, P('data', 'version.json'))
json.dump(dgs, open(P('tools', '.diagrams.json'), 'w', encoding='utf-8'), ensure_ascii=False)
print(f"nodes {len(nodes)} · chunks {len(chunks)} · glossary {len(glossary)} · paths {len(out_paths)} · diagrams {len(dgs)} · unresolved rel {missing_rel} · version {version}")
