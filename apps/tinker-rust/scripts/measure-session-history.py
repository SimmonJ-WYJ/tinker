#!/usr/bin/env python3
"""离线合成测量，只写入指定测试目录，比较同一 release 读取器的两种输入策略。"""
import argparse
import datetime
import hashlib
import json
import pathlib
import platform
import re
import statistics
import subprocess
import sys

parser = argparse.ArgumentParser()
parser.add_argument('--binary', required=True, type=pathlib.Path)
parser.add_argument('--output', required=True, type=pathlib.Path)
parser.add_argument('--messages', type=int, default=100000)
parser.add_argument('--stop-at-utc', help='Optional ISO-8601 deadline for the scheduled task')
args = parser.parse_args()
if sys.platform != 'darwin':
    parser.error('This measurement uses macOS /usr/bin/time -l RSS bytes')
if not 100 <= args.messages <= 1000000:
    parser.error('messages must be 100..1000000')
deadline = datetime.datetime.fromisoformat(args.stop_at_utc) if args.stop_at_utc else None
if deadline is not None and deadline.utcoffset() is None:
    parser.error('stop-at-utc must include a timezone')
if deadline is not None and datetime.datetime.now(datetime.timezone.utc) >= deadline:
    raise SystemExit('Task cutoff reached')
args.output.mkdir(parents=True, exist_ok=False)
fixture = args.output / 'synthetic-history.jsonl'
with fixture.open('w', encoding='utf-8') as output:
    for i in range(args.messages):
        output.write(json.dumps({'id': f'fixture-{i}', 'role': 'assistant' if i % 2 else 'user', 'content': 'synthetic history only ' * 48, 'createdAt': 1700000000000+i, 'fixtureMetadata': {'source': 'generated offline', 'version': 1}}, ensure_ascii=False, separators=(',', ':')) + '\n')
rows = []
# 交替顺序降低缓存与温度偏差，不声称冷启动或用户使用场景。
for mode in ['streaming', 'buffered', 'buffered', 'streaming', 'streaming', 'buffered']:
    if deadline is not None and datetime.datetime.now(datetime.timezone.utc) >= deadline:
        raise SystemExit('Nightly task cutoff reached before starting a new measurement')
    result = subprocess.run(['/usr/bin/time', '-l', str(args.binary.resolve()), mode, str(fixture.resolve())], capture_output=True, text=True)
    if result.returncode:
        (args.output / f'failed-{mode}.stderr.txt').write_text(result.stderr)
        raise SystemExit(f'Measurement command failed with exit {result.returncode}, see output stderr log')
    data = json.loads(result.stdout)
    rss = re.search(r'(\d+)\s+maximum resident set size', result.stderr)
    if not rss:
        raise RuntimeError('Missing macOS peak RSS')
    data['maximumRssBytes'] = int(rss.group(1))
    data['trial'] = 1 + sum(row['mode'] == mode for row in rows)
    (args.output / f'{mode}-{data["trial"]}.time.txt').write_text(result.stderr)
    rows.append(data)
    print(json.dumps(data), flush=True)
if len({(row['digest'], row['messages'], row['firstLine'], row['nextBeforeLine'], row['incompleteTail']) for row in rows}) != 1:
    raise RuntimeError('The two input strategies produced different pages')
summary = {'platform': platform.system(), 'macOSVersion': platform.mac_ver()[0], 'machine': platform.machine(), 'rustcVersion': subprocess.check_output(['rustc', '--version'], text=True).strip(), 'binarySha256': hashlib.sha256(args.binary.read_bytes()).hexdigest(), 'buildProfile': 'release (caller-supplied binary)', 'pythonVersion': platform.python_version(), 'fixtureBytes': fixture.stat().st_size, 'fixtureSha256': hashlib.sha256(fixture.read_bytes()).hexdigest(), 'messages': args.messages, 'pageSize': 64, 'rows': rows, 'median': {mode: {'maximumRssBytes': statistics.median(row['maximumRssBytes'] for row in rows if row['mode'] == mode), 'elapsedMs': statistics.median(row['elapsedMs'] for row in rows if row['mode'] == mode)} for mode in ['streaming', 'buffered']}, 'scope': 'Same release Rust parser, whole-file buffer versus streaming. Not a measurement of Electron or Tauri application memory.'}
(args.output / 'results.json').write_text(json.dumps(summary, indent=2)+'\n')
print(json.dumps(summary['median'], indent=2))
