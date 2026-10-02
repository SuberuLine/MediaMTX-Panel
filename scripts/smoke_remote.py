"""Low-volume unauthenticated deployment checks. No real credentials required.

Usage: python scripts/smoke_remote.py --base-url http://host:port
Does not run load tests, scan other ports, or alter existing streams/sessions.
One synthetic invalid login may create a failure audit entry.
"""
import argparse
import datetime
import hashlib
import json
from pathlib import Path
import time
import urllib.error
import urllib.request
import uuid


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--base-url', required=True)
    parser.add_argument('--output', default='.cache/remote-smoke.json')
    args = parser.parse_args()
    base = args.base_url.rstrip('/')
    opener = urllib.request.build_opener(NoRedirect())
    results = []
    expected_headers = {
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
        'X-Frame-Options': 'DENY',
        'Referrer-Policy': 'no-referrer',
    }

    def check(name, path, status, method='GET', body=None, headers=None, code=None):
        headers = dict(headers or {})
        if body is not None:
            body = body.encode()
            headers.setdefault('Content-Type', 'application/json')
        req = urllib.request.Request(base + path, data=body, headers=headers, method=method)
        started = time.monotonic()
        result = {'name': name, 'method': method, 'path': path, 'expectedStatus': status}
        problems = []
        try:
            try:
                resp = opener.open(req, timeout=15)
            except urllib.error.HTTPError as exc:
                resp = exc
            with resp:
                data = resp.read(1 << 20)
                result.update(status=resp.status, ms=round((time.monotonic()-started)*1000), headers=dict(resp.headers))
                if resp.status != status:
                    problems.append(f'expected HTTP {status}, got {resp.status}')
                for header, value in expected_headers.items():
                    if resp.headers.get(header) != value:
                        problems.append(f'missing/unexpected {header}')
                if not resp.headers.get('Content-Security-Policy'):
                    problems.append('missing CSP')
                if path == '/openapi.yaml':
                    result['sha256'] = hashlib.sha256(data).hexdigest()
                    local = Path(__file__).resolve().parents[1] / 'docs/openapi.yaml'
                    same = data.replace(b'\r\n', b'\n') == local.read_bytes().replace(b'\r\n', b'\n')
                    result['matchesWorkspaceContract'] = same
                    if not same:
                        problems.append('deployed OpenAPI differs from workspace')
                    dest = Path(args.output).with_suffix('.openapi.yaml')
                    dest.parent.mkdir(parents=True, exist_ok=True)
                    dest.write_bytes(data)
                elif method == 'HEAD':
                    if data:
                        problems.append('HEAD returned a body')
                else:
                    result['body'] = json.loads(data)
                    if 'application/json' not in resp.headers.get('Content-Type', ''):
                        problems.append('wrong content type')
                    if code and result['body'].get('error', {}).get('code') != code:
                        problems.append('unexpected error code')
                    if path in ['/healthz', '/readyz'] and status == 200:
                        expected = 'ok' if path == '/healthz' else 'ready'
                        if result['body'].get('data', {}).get('status') != expected:
                            problems.append('unexpected health payload')
        except Exception as exc:
            problems.append(str(exc))
        result['problems'] = problems
        result['passed'] = not problems
        results.append(result)
        print(('PASS' if not problems else 'FAIL') + ': ' + name, flush=True)

    check('Backend liveness', '/healthz', 200)
    check('Database and upstream readiness', '/readyz', 200)
    check('HEAD liveness', '/healthz', 200, method='HEAD')
    check('Published API contract', '/openapi.yaml', 200)
    for path in ['auth/me', 'instance', 'dashboard', 'streams', 'streams/nonexistent_probe', 'connections', 'config/paths', 'metrics', 'audit-logs']:
        check('Anonymous read blocked: '+path, '/api/v1/'+path, 401, code='UNAUTHENTICATED')
    for method, path, body in [
        ('POST', 'streams', '{}'),
        ('PATCH', 'streams/nonexistent_probe', '{}'),
        ('DELETE', 'streams/nonexistent_probe', None),
        ('POST', 'config/paths', '{}'),
        ('PATCH', 'config/paths/nonexistent_probe', '{}'),
        ('DELETE', 'config/paths/nonexistent_probe', None),
        ('DELETE', 'connections/srt/00000000-0000-0000-0000-000000000000', None),
        ('POST', 'auth/logout', None),
    ]:
        check('Anonymous mutation blocked: '+method+' '+path, '/api/v1/'+path, 401, method, body, code='UNAUTHENTICATED')
    check('Forged session blocked', '/api/v1/auth/me', 401, headers={'Cookie':'mtxui_session='+'A'*43}, code='UNAUTHENTICATED')
    check('Cross-origin login blocked', '/api/v1/auth/login', 403, 'POST', '{}', {'Origin':'https://example.invalid'}, 'ORIGIN_REJECTED')
    check('Cross-site login blocked', '/api/v1/auth/login', 403, 'POST', '{}', {'Sec-Fetch-Site':'cross-site'}, 'ORIGIN_REJECTED')
    check('Unknown API returns JSON 404', '/api/v1/nonexistent_probe', 404, code='NOT_FOUND')
    check('Workspace environment file not served', '/.env', 404, code='NOT_FOUND')
    check('Unsupported login content type', '/api/v1/auth/login', 415, 'POST', '{}', {'Content-Type':'text/plain'}, 'UNSUPPORTED_MEDIA_TYPE')
    for name, body in [
        ('Malformed JSON', '{'),
        ('Duplicate JSON fields', '{"username":"test","username":"other","password":"test"}'),
        ('Case-mismatched JSON field', '{"Username":"test","password":"test"}'),
        ('Null JSON field', '{"username":null,"password":"test"}'),
    ]:
        check(name, '/api/v1/auth/login', 400, 'POST', body, code='VALIDATION_ERROR')
    check('Login body size limit', '/api/v1/auth/login', 413, 'POST', '{"username":"'+('x'*66000)+'"}', code='BODY_TOO_LARGE')
    check('Synthetic invalid credentials', '/api/v1/auth/login', 401, 'POST', json.dumps({'username':'probe_'+uuid.uuid4().hex[:16], 'password':uuid.uuid4().hex}), code='INVALID_CREDENTIALS')
    check('Liveness after probes', '/healthz', 200)
    check('Readiness after probes', '/readyz', 200)
    report = {'target':base, 'testedAt':datetime.datetime.now(datetime.timezone(datetime.timedelta(hours=8))).isoformat(), 'passed':sum(r['passed'] for r in results), 'total':len(results), 'results':results, 'limitations':['No panel account available: successful login, cookie flags, session CSRF, role boundaries and business actions not tested.', 'No load test or live-media session kick performed.']}
    output = Path(args.output)
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(report, ensure_ascii=False, indent=2)+'\n', encoding='utf-8')
    print(f"{report['passed']}/{report['total']} checks passed; report: {output}")
    return 0 if report['passed'] == report['total'] else 1


if __name__ == '__main__':
    raise SystemExit(main())
