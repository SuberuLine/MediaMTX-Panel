"""Authenticated remote smoke test with an isolated, automatically removed path.

Set MTXUI_TEST_PASSWORD in the environment, or enter it at the hidden prompt.
No existing stream is modified and no active connection is kicked.
"""
import argparse
import datetime
import getpass
import http.cookiejar
import json
import os
from pathlib import Path
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--base-url', required=True)
    parser.add_argument('--username', default='admin')
    parser.add_argument('--output', default='.cache/remote-auth-smoke.json')
    args = parser.parse_args()
    base = args.base_url.rstrip('/')
    password = os.environ.pop('MTXUI_TEST_PASSWORD', '') or getpass.getpass('Panel password: ')
    jar = http.cookiejar.CookieJar()
    browser = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar))
    results, observations = [], {}
    csrf = None
    cookies = None
    created = False
    name = 'mtxui-test-' + uuid.uuid4().hex[:12] + '/camera'
    encoded = urllib.parse.quote(name, safe='')

    def check(label, method, path, expected=200, body=None, headers=None, check_data=None, use_csrf=True):
        request_headers = dict(headers or {})
        if cookies:
            request_headers.setdefault('Cookie', cookies)
        if method not in ('GET', 'HEAD') and csrf and use_csrf:
            request_headers.setdefault('X-CSRF-Token', csrf)
        if body is not None:
            body = json.dumps(body).encode()
            request_headers['Content-Type'] = 'application/json'
        start = time.monotonic()
        entry = {'name': label, 'method': method, 'path': path, 'expectedStatus': expected}
        data = {}
        try:
            req = urllib.request.Request(base + path, data=body, headers=request_headers, method=method)
            try:
                response = browser.open(req, timeout=20)
            except urllib.error.HTTPError as exc:
                response = exc
            with response:
                data = json.load(response)
                entry['status'] = response.status
                entry['ms'] = round((time.monotonic()-start)*1000)
                if response.status != expected:
                    entry['problem'] = f'Expected {expected}; got {response.status}: '+data.get('error', {}).get('code', 'unknown')
                elif check_data:
                    problem = check_data(data)
                    if problem:
                        entry['problem'] = problem
                if data.get('error'):
                    entry['errorCode'] = data['error']['code']
        except Exception as exc:
            entry['problem'] = str(exc)
        entry['passed'] = 'problem' not in entry
        results.append(entry)
        print(('PASS' if entry['passed'] else 'FAIL')+': '+label+(' — '+entry.get('problem', '') if not entry['passed'] else ''), flush=True)
        return data

    def expect_equal(actual, expected, label):
        return None if actual == expected else label

    def login(label):
        nonlocal csrf
        data = check(label, 'POST', '/api/v1/auth/login', body={'username':args.username, 'password':password}, headers={'Origin':base})
        csrf = data.get('data', {}).get('csrfToken')
        if not csrf:
            raise RuntimeError('Login failed; authenticated checks cannot continue')
        return data

    try:
        account = login('Valid panel login with same-origin header')
        user = account['data']['user']
        observations['role'] = user['role']
        current = next(c for c in jar if c.name == 'mtxui_session')
        observations['cookie'] = {'secure':current.secure,'httpOnly':current.has_nonstandard_attr('HttpOnly'),'sameSite':current.get_nonstandard_attr('SameSite'),'path':current.path}
        check('Cookie-jar session works on supplied URL', 'GET', '/api/v1/auth/me', check_data=lambda d: expect_equal(d.get('data', {}).get('user', {}).get('id'), user['id'], 'Wrong authenticated user'))
        if current.secure and base.startswith('http://'):
            observations['browserBlocker'] = 'Secure cookie will not be sent over this non-local HTTP URL. Remaining server-side tests explicitly supply the cookie.'
            cookies = current.name+'='+current.value
        if not current.has_nonstandard_attr('HttpOnly') or current.get_nonstandard_attr('SameSite') != 'Strict':
            observations['cookieIssue'] = 'Missing HttpOnly or expected SameSite=Strict'
        for path in ['instance','dashboard','streams','connections','config/paths','metrics','audit-logs']:
            data = check('Authenticated '+path, 'GET', '/api/v1/'+path, check_data=lambda d: None if 'data' in d else 'Missing data envelope')
            if path == 'instance':
                observations['instance'] = data.get('data')
            if path == 'metrics':
                observations['metrics'] = data.get('data')
            if path in ('streams', 'connections', 'config/paths'):
                observations[path] = {'pagination':data.get('pagination'), 'meta':data.get('meta')}
            if path == 'dashboard':
                observations['dashboard'] = data.get('data')
        for protocol in ['srt','hls','webrtc','rtsp','rtsps','rtmp','rtmps']:
            check('Filter '+protocol+' connections', 'GET', '/api/v1/connections?protocol='+protocol, check_data=lambda d,p=protocol: None if all(v['protocol']==p for v in d.get('data', [])) else 'Protocol filter mismatch')
        check('Reject invalid page size', 'GET', '/api/v1/streams?pageSize=201', 400)
        check('Reject unsupported protocol', 'GET', '/api/v1/connections?protocol=invalid', 400)
        check('Pagination response', 'GET', '/api/v1/streams?page=1&pageSize=1', check_data=lambda d: None if len(d.get('data', []))<=1 and d.get('pagination', {}).get('pageSize')==1 else 'Pagination mismatch')
        check('Temporary path absent before test', 'GET', '/api/v1/config/paths/'+encoded, 404)
        namespace_absent = results[-1]['passed']
        check('Reject mutation without CSRF', 'POST', '/api/v1/streams', 403, {'name':name}, use_csrf=False)
        check('Reject mutation with wrong CSRF', 'POST', '/api/v1/streams', 403, {'name':name}, headers={'X-CSRF-Token':'invalid'})
        check('Reject cross-origin authenticated mutation', 'POST', '/api/v1/streams', 403, {'name':name}, headers={'Origin':'https://example.invalid'})
        check('Reject command hook configuration', 'POST', '/api/v1/streams', 400, {'name':name,'runOnReady':'echo unsupported'})
        check('Reject invalid source configuration', 'POST', '/api/v1/streams', 400, {'name':name,'source':'file:///invalid'})
        if not namespace_absent:
            raise RuntimeError('Temporary namespace is not confirmed absent')
        # The upstream may commit even if the response is lost. Always attempt
        # cleanup of our confirmed-absent namespace after submitting creation.
        created = True
        data = check('Create isolated nested path', 'POST', '/api/v1/streams', 201, {'name':name,'source':'publisher','maxReaders':3,'record':False})
        if results[-1].get('status') != 201:
            raise RuntimeError('Temporary path creation failed')
        check('Read created offline stream', 'GET', '/api/v1/streams/'+encoded, check_data=lambda d: None if d.get('data',{}).get('name')==name and not d['data']['online'] else 'Created stream state mismatch')
        check('Read created path configuration', 'GET', '/api/v1/config/paths/'+encoded, check_data=lambda d: expect_equal(d.get('data',{}).get('maxReaders'),3,'Initial maxReaders mismatch'))
        check('Patch explicit zero/false values', 'PATCH', '/api/v1/config/paths/'+encoded, body={'maxReaders':0,'overridePublisher':False})
        check('Verify partial patch persisted and source retained', 'GET', '/api/v1/config/paths/'+encoded, check_data=lambda d: None if d.get('data',{}).get('maxReaders')==0 and d['data']['overridePublisher'] is False and d['data']['source']=='publisher' else 'Partial patch mismatch')
        check('Reject empty PATCH', 'PATCH', '/api/v1/streams/'+encoded, 400, {})
        check('Reject negative maxReaders', 'PATCH', '/api/v1/streams/'+encoded, 400, {'maxReaders':-1})
        check('Reject null PATCH field', 'PATCH', '/api/v1/streams/'+encoded, 400, {'record':None})
        check('Empty exact-path connection filter', 'GET', '/api/v1/connections?path='+encoded, check_data=lambda d: expect_equal(d.get('data'),[],'Unexpected connections on isolated offline stream'))
        for protocol in ['srt','hls','webrtc','rtsp','rtmp']:
            check('Missing '+protocol+' session kick', 'DELETE', '/api/v1/connections/'+protocol+'/00000000-0000-0000-0000-000000000000', 404)
        check('Delete isolated test path', 'DELETE', '/api/v1/config/paths/'+encoded)
        if results[-1]['passed']:
            created = False
        check('Path removed from configuration', 'GET', '/api/v1/config/paths/'+encoded, 404)
        check('Path removed from stream detail', 'GET', '/api/v1/streams/'+encoded, 404)
        audits = check('Audit entries persisted', 'GET', '/api/v1/audit-logs?pageSize=100')
        actions = {v['action'] for v in audits.get('data',[]) if v.get('resource')==name and v.get('outcome')=='success'}
        results.append({'name':'Path create/update/delete audited successfully','passed':{'stream.create','stream.update','stream.delete'} <= actions,'observedActions':sorted(actions)})
        old_cookie = current.name+'='+current.value
        old_csrf = csrf
        login('Re-login rotates existing session')
        if cookies:
            new_cookie = next(c for c in jar if c.name=='mtxui_session')
            cookies = new_cookie.name+'='+new_cookie.value
        check('Old session revoked after rotation', 'GET', '/api/v1/auth/me', 401, headers={'Cookie':old_cookie})
        check('Old CSRF rejected by new session', 'POST', '/api/v1/streams', 403, {'name':name}, headers={'X-CSRF-Token':old_csrf})
        check('CSRF-protected logout', 'POST', '/api/v1/auth/logout')
        check('Session revoked after logout', 'GET', '/api/v1/auth/me', 401)
    except Exception as exc:
        results.append({'name':'Test execution','passed':False,'problem':str(exc)})
        print('STOP: '+str(exc), flush=True)
    finally:
        if created:
            check('Finally cleanup isolated path', 'DELETE', '/api/v1/config/paths/'+encoded)
            created = not results[-1]['passed']
        if csrf:
            # Idempotent best-effort revocation if an earlier test interrupted logout.
            try:
                headers={'X-CSRF-Token':csrf}
                if cookies: headers['Cookie']=cookies
                with browser.open(urllib.request.Request(base+'/api/v1/auth/logout',method='POST',headers=headers),timeout=10):
                    pass
            except (OSError,urllib.error.HTTPError):
                pass
        observations['temporaryPath'] = name
        observations['cleanupComplete'] = not created
        report={'target':base,'testedAt':datetime.datetime.now(datetime.timezone(datetime.timedelta(hours=8))).isoformat(),'passed':sum(v['passed'] for v in results),'total':len(results),'observations':observations,'results':results,'limitations':['Only supplied admin role tested; operator/viewer accounts unavailable.','No real media publisher/viewer provided; kick tested only against a nonexistent UUID.','No load testing, restart persistence test, or upstream disruption performed.']}
        output=Path(args.output)
        output.parent.mkdir(parents=True,exist_ok=True)
        output.write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
        print(f"{report['passed']}/{report['total']} checks passed; cleanup={not created}; report: {output}")
    return 0 if report['passed']==report['total'] and not created else 1


if __name__ == '__main__':
    raise SystemExit(main())
