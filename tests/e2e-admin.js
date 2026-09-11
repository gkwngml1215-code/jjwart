// 관리 도구 v2.1 실제 화면 검증 (크롬을 화면 없이 띄워 버튼을 직접 누릅니다)
// GitHub 는 가짜(메모리 저장소)로 바꿔 끼우므로 실제 홈페이지는 건드리지 않습니다.
// 지점 값(저장소·키 이름)은 site-config.js 에서 읽으므로 전주점·강남점이 같은 파일을 씁니다.
//
// 실행: node tests/e2e-admin.js <홈페이지 저장소 폴더> <chrome.exe 경로> <임시 프로필 폴더>
const http = require('http');
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const {spawn, execSync} = require('child_process');
const C = require('../columns-core.js');

const ADMIN = path.resolve(__dirname, '..');
const [SITE_DIR, CHROME, PROFILE] = process.argv.slice(2);
const PORT = 8765, DEBUG_PORT = 9333;
const REPO_PATH = `/repos/${C.SITE.github.owner}/${C.SITE.github.repo}`;
const API = 'https://api.github.com' + REPO_PATH;
const TOKEN_KEY = C.SITE.tokenKey;
const LEGACY_KEY = C.SITE.storagePrefix + '_admin_state_v1';
const DRAFT_PREFIX = C.SITE.storagePrefix + '_admin_draft_v2:';
const sleep = ms => new Promise(r => setTimeout(r, ms));

/* ---------- 홈페이지 저장소 내용 (git 에 올라간 파일 기준) ---------- */
function siteFiles(){
  const out = {};
  execSync('git ls-files -z', {cwd: SITE_DIR}).toString('utf8').split('\0').filter(Boolean).forEach(rel => {
    out[rel] = /\.(jpe?g|png|gif|webp|svg|ico)$/i.test(rel) ? 'BINARY' : fs.readFileSync(path.join(SITE_DIR, rel), 'utf8').replace(/\r\n/g, '\n');
  });
  return out;
}

/* ---------- 가짜 GitHub API (페이지보다 먼저 실행되어 fetch 를 바꿔 끼운다) ---------- */
function mockSource(files, seed){
  return `(() => {
  if (window.top !== window) return;   // 미리보기 iframe(잠긴 창) 안에서는 실행하지 않는다
  localStorage.setItem(${JSON.stringify(TOKEN_KEY)}, 'test-token');
  ${Object.entries(seed || {}).map(([k, v]) => `localStorage.setItem(${JSON.stringify(k)}, ${JSON.stringify(JSON.stringify(v))});`).join('\n')}
  const API = ${JSON.stringify(API)};
  const REPO_PATH = ${JSON.stringify(REPO_PATH)};
  const enc = s => { const b = new TextEncoder().encode(s); let bin = ''; for (const x of b) bin += String.fromCharCode(x); return btoa(bin); };
  const hash = s => { let h = 5381; for (let i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0; return 'b' + h.toString(16) + '-' + s.length; };
  const R = {trees: {}, commits: {}, blobs: {}, head: null, n: 0, raceOnce: false, dropAfterPatch: false, other: [], patches: 0};
  const putTree = f => { const id = 't' + (R.n++); R.trees[id] = f; Object.values(f).forEach(c => { R.blobs[hash(c)] = c; }); return id; };
  const putCommit = (tree, parent, message) => { const id = 'c' + (R.n++); R.commits[id] = {tree, parent, message}; return id; };
  R.head = putCommit(putTree(${JSON.stringify(files)}), null, 'init');
  R.files = () => R.trees[R.commits[R.head].tree];
  R.external = () => { const f = Object.assign({}, R.files(), {'external.txt': 'x' + R.n}); R.head = putCommit(putTree(f), R.head, 'external'); };
  window.__repo = R;
  const json = (status, body) => Promise.resolve(new Response(JSON.stringify(body), {status, headers: {'Content-Type': 'application/json'}}));
  const realFetch = window.fetch.bind(window);
  window.fetch = async (url, opts) => {
    url = String(url); opts = opts || {};
    if (url.indexOf('https://api.github.com/') === 0 && !url.startsWith(API)) { R.other.push(url); return json(404, {}); }   // 다른 저장소로 새는 요청 감시
    if (!url.startsWith(API)) return realFetch(url, opts);
    const method = (opts.method || 'GET').toUpperCase();
    const p = new URL(url).pathname.replace(REPO_PATH, '');
    const body = opts.body ? JSON.parse(opts.body) : null;
    let m;
    if (p === '' && method === 'GET') return json(200, {full_name: 'mock'});
    if (p === '/git/ref/heads/main' && method === 'GET') return json(200, {object: {sha: R.head}});
    if ((m = /^\\/git\\/commits\\/(.+)$/.exec(p))) { const c = R.commits[m[1]]; return c ? json(200, {tree: {sha: c.tree}, committer: {date: new Date().toISOString()}}) : json(404, {}); }
    if ((m = /^\\/git\\/trees\\/(.+)$/.exec(p)) && method === 'GET') return json(200, {truncated: false, tree: Object.entries(R.trees[m[1]]).map(([path, c]) => ({path, type: 'blob', sha: hash(c)}))});
    if ((m = /^\\/git\\/blobs\\/(.+)$/.exec(p))) { const c = R.blobs[m[1]]; return c == null ? json(404, {}) : json(200, {content: enc(c)}); }
    if (p === '/git/trees' && method === 'POST') {
      const f = Object.assign({}, R.trees[body.base_tree]);
      for (const e of body.tree) {
        if (e.sha === null) { if (!(e.path in f)) return json(422, {message: 'delete of missing path'}); delete f[e.path]; }
        else f[e.path] = e.content;
      }
      return json(201, {sha: putTree(f)});
    }
    if (p === '/git/commits' && method === 'POST') return json(201, {sha: putCommit(body.tree, body.parents[0], body.message)});
    if (p === '/git/refs/heads/main' && method === 'PATCH') {
      R.patches++;
      if (R.raceOnce) { R.raceOnce = false; R.external(); }   // 확인하는 사이 다른 곳에서 발행된 상황
      if (body.force || R.commits[body.sha].parent !== R.head) return json(422, {message: 'Update is not a fast forward'});
      R.head = body.sha;
      if (R.dropAfterPatch) { R.dropAfterPatch = false; throw new TypeError('Failed to fetch'); }   // 올라간 뒤 응답을 못 받은 상황
      return json(200, {object: {sha: R.head}});
    }
    if (p === '/contents/assets/images') return json(200, Object.keys(R.files()).filter(k => k.startsWith('assets/images/')).map(k => ({type: 'file', name: k.slice(14)})));
    if ((m = /^\\/contents\\/(.+)$/.exec(p)) && method === 'GET') { const fp = decodeURIComponent(m[1]); return fp in R.files() ? json(200, {sha: hash(R.files()[fp])}) : json(404, {}); }
    return json(500, {message: 'mock: ' + method + ' ' + p});
  };
})();`;
}

/* ---------- 크롬 원격 조종 (DevTools 프로토콜) ---------- */
let ws, msgId = 0;
const pending = new Map(), listeners = [];
function send(method, params, sessionId){
  return new Promise((res, rej) => {
    const id = ++msgId;
    pending.set(id, {res, rej});
    ws.send(JSON.stringify({id, method, params: params || {}, sessionId}));
  });
}

// ctx 를 주면 같은 브라우저 창(같은 저장 공간)에 탭을 하나 더 연다
async function openBrowser(files, seed, ctx){
  const browserContextId = ctx || (await send('Target.createBrowserContext')).browserContextId;   // 새 시크릿 창과 같다
  const {targetId} = await send('Target.createTarget', {url: 'about:blank', browserContextId});
  const {sessionId} = await send('Target.attachToTarget', {targetId, flatten: true});
  const s = {dialogs: [], errors: [], ctx: browserContextId};
  listeners.push(msg => {
    if (msg.sessionId !== sessionId) return;
    if (msg.method === 'Page.javascriptDialogOpening') {
      s.dialogs.push(msg.params.message);
      send('Page.handleJavaScriptDialog', {accept: true, promptText: ''}, sessionId);
    }
    if (msg.method === 'Runtime.exceptionThrown') {
      const d = msg.params.exceptionDetails;
      s.errors.push((d.exception && d.exception.description) || d.text);
    }
  });
  await send('Page.enable', {}, sessionId);
  await send('Runtime.enable', {}, sessionId);
  await send('Page.addScriptToEvaluateOnNewDocument', {source: mockSource(files, seed)}, sessionId);
  await send('Page.navigate', {url: `http://127.0.0.1:${PORT}/index.html`}, sessionId);

  s.eval = async expr => {
    const r = await send('Runtime.evaluate', {expression: expr, awaitPromise: true, returnByValue: true}, sessionId);
    if (r.exceptionDetails) throw new Error('eval 실패: ' + JSON.stringify(r.exceptionDetails).slice(0, 300));
    return r.result.value;
  };
  s.until = async (expr, what) => {
    const t0 = Date.now();
    while (Date.now() - t0 < 10000) {
      try { const v = await s.eval(expr); if (v) return v; } catch (e) { /* 페이지 로딩 중 */ }
      await sleep(100);
    }
    throw new Error('시간 초과: ' + what);
  };
  s.click = sel => s.eval(`(() => { document.querySelector(${JSON.stringify(sel)}).click(); return true; })()`);
  s.fieldValue = key => s.eval(`(document.querySelector('#columnFields [data-field="${key}"]') || {}).value`);
  s.field = (key, value) => s.eval(`(() => {
    const el = document.querySelector('#columnFields [data-field="${key}"]');
    el.value = ${JSON.stringify(value)};
    el.dispatchEvent(new Event('input', {bubbles: true}));
    return el.value;
  })()`);
  s.select = key => s.eval(`(() => { const el = document.getElementById('columnSelect'); el.value = ${JSON.stringify(key)}; el.dispatchEvent(new Event('change')); return el.value; })()`);
  s.options = () => s.eval(`Array.from(document.querySelectorAll('#columnSelect option')).map(o => o.textContent)`);
  s.modalText = () => s.eval(`document.getElementById('modalRoot').innerText`);
  s.waitModal = () => s.until(`!!document.querySelector('#modalRoot [data-act="ok"]')`, '발행 전 확인 화면');
  s.untilDialog = async re => {
    const t0 = Date.now();
    while (Date.now() - t0 < 10000) {
      if (s.dialogs.some(d => re.test(d))) return;
      await sleep(100);
    }
    throw new Error('알림창을 기다리다 시간 초과: ' + re + ' / 받은 알림: ' + JSON.stringify(s.dialogs));
  };
  s.repo = async () => JSON.parse(await s.eval('JSON.stringify(window.__repo.files())'));
  s.patches = () => s.eval('window.__repo.patches');
  s.otherRepoCalls = () => s.eval('window.__repo.other.length');
  s.ready = () => s.until(`/컬럼 \\d+개/.test(document.getElementById('deployedState').textContent)`, '홈페이지 목록 불러오기');
  // 글을 고르고, 그 글의 입력칸이 뜰 때까지 기다린다 (제목은 앞 단계에서 바뀌었을 수 있어 파일명으로 확인)
  s.loadPost = post => s.select('slug:' + post.slug).then(() => s.until(`(document.querySelector('#columnFields [data-field="slug"]') || {}).value === ${JSON.stringify(post.slug)} && !!document.querySelector('#columnFields [data-field="title"]')`, post.slug + ' 불러오기'));
  s.reload = async () => {
    try { await s.eval('window.__oldPage = true; location.reload(); true'); } catch (e) { /* 새로고침 중 */ }
    await s.until('!window.__oldPage', '새로고침');   // 새 문서에는 표시가 없다
    await s.ready();
  };
  s.closeTab = () => send('Target.closeTarget', {targetId});
  s.close = () => send('Target.disposeBrowserContext', {browserContextId});
  return s;
}

/* ---------- 검증 도우미 ---------- */
const index = files => JSON.parse(files['columns/index.json']).columns;
const indexSlugs = files => index(files).map(c => c.slug);
const cardSlugs = files => [...files['columns.html'].matchAll(/href="columns\/([^"]+)\.html"/g)].map(m => m[1]);
const sitemapSlugs = files => [...files['sitemap.xml'].matchAll(/\/columns\/([^/<]+)\.html</g)].map(m => m[1]);
const pagesOf = files => Object.keys(files).filter(p => /^columns\/[^/]+\.html$/.test(p));
const VALID_BODY = '<p>테스트 본문 첫 문단</p>\n<h2>소제목</h2>\n<p>둘째 문단</p>';

let failed = 0;
async function step(name, fn){
  try { await fn(); console.log('  ✓ ' + name); }
  catch (e) { failed++; console.error('  ✗ ' + name + '\n      ' + e.message); }
}

(async () => {
  const server = http.createServer((req, res) => {
    const rel = decodeURIComponent(req.url.split('?')[0]).replace(/^\/+/, '') || 'index.html';
    fs.readFile(path.join(ADMIN, rel), (err, data) => {
      if (err) { res.writeHead(404); res.end(); return; }
      res.writeHead(200, {'Content-Type': rel.endsWith('.js') ? 'text/javascript; charset=utf-8' : 'text/html; charset=utf-8'});
      res.end(data);
    });
  }).listen(PORT);

  const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${DEBUG_PORT}`, `--user-data-dir=${PROFILE}`,
    '--no-first-run', '--no-default-browser-check', 'about:blank'], {stdio: 'ignore'});
  let wsUrl;
  for (let i = 0; i < 60 && !wsUrl; i++) {
    try { wsUrl = (await (await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/version`)).json()).webSocketDebuggerUrl; }
    catch (e) { await sleep(250); }
  }
  ws = new WebSocket(wsUrl);
  await new Promise(r => { ws.onopen = r; });
  ws.onmessage = ev => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
      const {res, rej} = pending.get(msg.id);
      pending.delete(msg.id);
      msg.error ? rej(new Error(JSON.stringify(msg.error))) : res(msg.result);
    } else listeners.forEach(l => l(msg));
  };

  const initial = siteFiles();
  const start = index(initial);
  const startSlugs = start.map(c => c.slug);
  const N = start.length;
  const taken = C.collectSlugs(Object.keys(initial), start);
  const next1 = C.nextSlug(taken); taken.add(next1);
  const next2 = C.nextSlug(taken);
  const collide = startSlugs[3], editTarget = start[3], raceTarget = start[4], tabTarget = start[1];
  let files = initial;
  console.log(`\n[${C.SITE.bizName} · ${C.VERSION}] 시작 상태: 컬럼 ${N}개 (${startSlugs.join(', ')}) · 저장소 ${C.SITE.github.repo}\n`);

  console.log('— 발행 규칙 —');

  await step(`새 브라우저에서 새 글 발행: 파일명 ${next1}, 기존 ${N}개 유지, 확인 화면 ${N + 1}개 표시`, async () => {
    const b = await openBrowser(files);
    await b.ready();
    await b.click('#addColumnBtn');
    assert.strictEqual(await b.fieldValue('slug'), next1);
    await b.field('title', '테스트 새 글');
    await b.field('cardSummary', '테스트 요약');
    await b.field('description', '테스트 설명');
    await b.field('body', VALID_BODY);
    assert.match(await b.eval(`document.getElementById('bodyCheck').textContent`), /이상 없음/);
    await b.click('#barPublishBtn');
    await b.waitModal();
    const text = await b.modalText();
    assert.match(text, new RegExp(`발행 후 홈페이지 컬럼 목록: ${N + 1}개`));
    assert.match(text, new RegExp(`지금 ${N}개`));
    assert.match(text, /1\s*추가/); assert.match(text, new RegExp(`${N}\\s*유지`)); assert.match(text, /0\s*삭제/);
    await b.click('#modalRoot [data-act="ok"]');
    await b.untilDialog(/발행이 끝났습니다/);
    files = await b.repo();
    assert.deepStrictEqual(indexSlugs(files), startSlugs.concat(next1));
    assert.deepStrictEqual(cardSlugs(files), indexSlugs(files));
    assert.deepStrictEqual(sitemapSlugs(files).sort(), indexSlugs(files).slice().sort());
    pagesOf(initial).forEach(p => assert.strictEqual(files[p], initial[p], p + ' 가 바뀌면 안 됨'));
    const page = files[C.PATHS.page(next1)];
    assert.ok(page.includes('테스트 본문 첫 문단'));
    assert.ok(page.includes(C.SITE.domain.replace(/\/$/, '') + '/columns/' + next1 + '.html'), '페이지 주소가 이 지점 도메인이어야 함');
    assert.ok(page.includes(C.SITE.phone) && page.includes(C.SITE.kakaoUrl), '이 지점 전화·카카오가 들어가야 함');
    assert.ok(files['llms.txt'].includes('columns/' + next1 + '.html'));
    assert.strictEqual(await b.otherRepoCalls(), 0, '다른 저장소로 요청이 가면 안 됨');
    assert.deepStrictEqual(b.errors, []);
    await b.close();
  });

  await step(`옛 v1 저장값이 남은 브라우저 + 이미 있는 파일명(${collide}) 입력 → ${next2} 로 바꿔 올리고 ${collide} 는 그대로`, async () => {
    const legacy = {[LEGACY_KEY]: {columns: startSlugs.slice(0, 3).map(slug => ({slug}))}};
    const b = await openBrowser(files, legacy);
    await b.ready();
    assert.strictEqual(await b.eval(`document.querySelectorAll('#columnSelect option[value^="slug:"]').length`), N + 1);
    await b.click('#addColumnBtn');
    assert.strictEqual(await b.fieldValue('slug'), next2);
    await b.field('slug', collide);
    await b.field('title', '겹치는 파일명 테스트');
    await b.field('body', '<p>본문</p>');
    await b.click('#barPublishBtn');
    await b.waitModal();
    const text = await b.modalText();
    assert.ok(text.includes(`${collide} 은(는) 이미 홈페이지에 있어서`), '파일명 변경 안내가 보여야 함');
    assert.match(text, new RegExp(`발행 후 홈페이지 컬럼 목록: ${N + 2}개`));
    await b.click('#modalRoot [data-act="ok"]');
    await b.untilDialog(/발행이 끝났습니다/);
    const before = files;
    files = await b.repo();
    assert.strictEqual(files[C.PATHS.page(collide)], before[C.PATHS.page(collide)], collide + ' 를 덮어쓰면 안 됨');
    assert.ok(files[C.PATHS.page(next2)].includes('겹치는 파일명 테스트'));
    assert.strictEqual(indexSlugs(files).length, N + 2);
    assert.deepStrictEqual(b.errors, []);
    await b.close();
  });

  await step(`기존 글(${editTarget.slug}) 수정: 수정 1 · 유지 ${N + 1}, 다른 글 페이지는 그대로`, async () => {
    const b = await openBrowser(files);
    await b.ready();
    await b.loadPost(editTarget);
    assert.strictEqual(await b.eval(`document.querySelector('#columnFields [data-field="slug"]').readOnly`), true);
    await b.field('title', editTarget.title + ' (수정됨)');
    await b.click('#barPublishBtn');
    await b.waitModal();
    const text = await b.modalText();
    assert.match(text, /글 1개를 수정합니다/);
    assert.match(text, /1\s*수정/); assert.match(text, new RegExp(`${N + 1}\\s*유지`));
    await b.click('#modalRoot [data-act="ok"]');
    await b.untilDialog(/발행이 끝났습니다/);
    const before = files;
    files = await b.repo();
    assert.strictEqual(index(files).find(c => c.slug === editTarget.slug).title, editTarget.title + ' (수정됨)');
    pagesOf(before).filter(p => p !== C.PATHS.page(editTarget.slug)).forEach(p => assert.strictEqual(files[p], before[p], p + ' 가 바뀌면 안 됨'));
    assert.strictEqual(indexSlugs(files).length, N + 2);
    await b.close();
  });

  await step('동시 발행: 확인 중 다른 곳에서 발행되면 거절되고, 최신본 기준으로 다시 확인받은 뒤 둘 다 남는다', async () => {
    const b = await openBrowser(files);
    await b.ready();
    await b.loadPost(raceTarget);
    await b.field('cardSummary', '동시 발행 테스트 요약');
    await b.click('#barPublishBtn');
    await b.waitModal();
    await b.eval('window.__repo.raceOnce = true');
    await b.click('#modalRoot [data-act="ok"]');
    await b.until(`/다른 곳에서 홈페이지가 바뀌었습니다/.test(document.getElementById('modalRoot').innerText)`, '다시 확인 화면');
    await b.click('#modalRoot [data-act="ok"]');
    await b.untilDialog(/발행이 끝났습니다/);
    files = await b.repo();
    assert.ok('external.txt' in files, '다른 곳에서 올린 파일이 남아 있어야 함');
    assert.strictEqual(index(files).find(c => c.slug === raceTarget.slug).cardSummary, '동시 발행 테스트 요약');
    assert.strictEqual(indexSlugs(files).length, N + 2);
    await b.close();
  });

  await step('확인 화면에서 [취소] → 홈페이지 그대로. 제목 없이 발행 → 확인 화면 전에 막힘', async () => {
    const b = await openBrowser(files);
    await b.ready();
    await b.click('#addColumnBtn');
    await b.field('body', '<p>본문</p>');
    await b.click('#barPublishBtn');
    await b.untilDialog(/제목을 입력해 주세요/);
    assert.strictEqual(await b.eval(`!!document.querySelector('#modalRoot [data-act="ok"]')`), false);
    await b.field('title', '취소될 글');
    await b.click('#barPublishBtn');
    await b.waitModal();
    await b.click('#modalRoot [data-act="cancel"]');
    await sleep(300);
    assert.deepStrictEqual(await b.repo(), files);
    await b.close();
  });

  await step(`삭제: [이 글 삭제] → 확인창 → 확인 화면(삭제 1) → ${next2} 파일만 지워지고 ${N + 1}개`, async () => {
    const b = await openBrowser(files);
    await b.ready();
    await b.select('slug:' + next2);
    await b.until(`(document.querySelector('#columnFields [data-field="slug"]') || {}).value === ${JSON.stringify(next2)}`, next2 + ' 불러오기');
    await b.click('#delColumnBtn');
    await b.untilDialog(/삭제할까요/);
    await b.waitModal();
    const text = await b.modalText();
    assert.match(text, /1\s*삭제/); assert.match(text, new RegExp(`발행 후 홈페이지 컬럼 목록: ${N + 1}개`));
    await b.click('#modalRoot [data-act="ok"]');
    await b.untilDialog(/발행이 끝났습니다/);
    files = await b.repo();
    assert.ok(!(C.PATHS.page(next2) in files) && !(C.PATHS.data(next2) in files));
    assert.deepStrictEqual(indexSlugs(files), startSlugs.concat(next1));
    assert.deepStrictEqual(cardSlugs(files), indexSlugs(files));
    await b.close();
  });

  console.log('\n— v2.1 보강 —');

  await step('올린 직후 연결이 끊겨도 결과를 확인해 "발행 완료"로 처리하고, 같은 글이 두 번 올라가지 않는다', async () => {
    const b = await openBrowser(files);
    await b.ready();
    await b.loadPost(editTarget);
    await b.field('cardSummary', '연결 끊김 테스트 요약');
    await b.click('#barPublishBtn');
    await b.waitModal();
    await b.eval('window.__repo.dropAfterPatch = true');
    await b.click('#modalRoot [data-act="ok"]');
    await b.untilDialog(/발행이 끝났습니다/);
    files = await b.repo();
    assert.strictEqual(await b.patches(), 1, '한 번만 올라가야 함');
    assert.strictEqual(index(files).find(c => c.slug === editTarget.slug).cardSummary, '연결 끊김 테스트 요약');
    assert.strictEqual(indexSlugs(files).length, N + 1);
    assert.strictEqual(await b.eval(`document.getElementById('draftBar').classList.contains('hidden')`), true, '임시저장본이 정리되어야 함');
    await b.close();
  });

  await step('이미 있는 글과 같은 제목의 새 글 → 체크해야만 [발행하기]가 열린다', async () => {
    const b = await openBrowser(files);
    await b.ready();
    await b.click('#addColumnBtn');
    await b.field('title', start[0].title);
    await b.field('body', '<p>본문</p>');
    await b.click('#barPublishBtn');
    await b.waitModal();
    assert.match(await b.modalText(), /같은 제목의 글이 이미 홈페이지에 있습니다/);
    assert.strictEqual(await b.eval(`document.querySelector('#modalRoot [data-act="ok"]').disabled`), true);
    await b.eval(`(() => { const a = document.querySelector('#modalRoot .ack'); a.checked = true; a.dispatchEvent(new Event('change')); return true; })()`);
    assert.strictEqual(await b.eval(`document.querySelector('#modalRoot [data-act="ok"]').disabled`), false);
    await b.click('#modalRoot [data-act="cancel"]');
    assert.deepStrictEqual(await b.repo(), files);
    await b.close();
  });

  await step('홈페이지에 없는 사진 경로 → 확인 화면 전에 막히고 어떤 사진인지 알려 준다', async () => {
    const b = await openBrowser(files);
    await b.ready();
    await b.click('#addColumnBtn');
    await b.field('title', '사진 없는 글');
    await b.field('body', '<p>본문</p>');
    await b.field('image', 'assets/images/nope-photo.jpg');
    await b.click('#barPublishBtn');
    await b.untilDialog(/홈페이지에 없는 사진[\s\S]*nope-photo\.jpg/);
    assert.strictEqual(await b.eval(`!!document.querySelector('#modalRoot [data-act="ok"]')`), false);
    assert.deepStrictEqual(await b.repo(), files);
    await b.close();
  });

  await step('[본문 자동 정리]: 메모장 글·마크다운 → 문단/소제목/목록 HTML, 검사 통과. 깨진 본문은 발행 전에 막힘', async () => {
    const b = await openBrowser(files);
    await b.ready();
    await b.click('#addColumnBtn');
    await b.field('title', '정리 테스트');
    await b.field('body', '```html\n안녕하세요.\n둘째 줄\n\n## 왜 생길까요\n- 하나\n- 둘\n```');
    assert.match(await b.eval(`document.getElementById('bodyCheck').textContent`), /```/);
    await b.click('#tidyBodyBtn');
    const body = await b.fieldValue('body');
    assert.ok(body.includes('<h2>왜 생길까요</h2>') && body.includes('<ul>') && body.includes('<p>안녕하세요.<br>'), '정리된 본문: ' + body);
    assert.ok(!body.includes('```'));
    assert.match(await b.eval(`document.getElementById('bodyCheck').textContent`), /이상 없음/);
    await b.field('body', '<p>글</p></div>');
    assert.match(await b.eval(`document.getElementById('bodyCheck').textContent`), /여는 태그 없이/);
    await b.click('#barPublishBtn');
    await b.untilDialog(/여는 태그 없이/);
    assert.strictEqual(await b.eval(`!!document.querySelector('#modalRoot [data-act="ok"]')`), false);
    await b.close();
  });

  await step('빈 새 글은 임시저장되지 않는다 ([+ 새 컬럼]만 누르고 새로고침 → 목록에 남지 않음)', async () => {
    const b = await openBrowser(files);
    await b.ready();
    await b.click('#addColumnBtn');
    await b.click('#addColumnBtn');
    assert.strictEqual(await b.eval(`Object.keys(localStorage).filter(k => k.indexOf(${JSON.stringify(DRAFT_PREFIX)}) === 0).length`), 0);
    await b.reload();
    const opts = await b.options();
    // 임시저장 항목은 "새 글 · …" 로 표시된다 (발행된 글 제목에 "새 글"이 들어가도 무관)
    assert.ok(!opts.some(t => /^새 글 ·/.test(t)), '빈 새 글이 목록에 남아 있음: ' + JSON.stringify(opts) +
      ' / 저장 키: ' + JSON.stringify(await b.eval('Object.keys(localStorage)')));
    await b.click('#addColumnBtn');
    await b.field('title', '제목만 쓴 글');
    await b.reload();
    assert.ok((await b.options()).some(t => /새 글 · 제목만 쓴 글/.test(t)), '쓰던 새 글은 남아야 함');
    await b.close();
  });

  await step('탭 두 개: 각 탭의 임시저장본이 서로를 덮어쓰지 않고, 같은 글을 고치면 알려 준다', async () => {
    const a = await openBrowser(files);
    await a.ready();
    await a.loadPost(tabTarget);
    await a.field('title', tabTarget.title + ' (A탭)');
    const b = await openBrowser(files, null, a.ctx);   // 같은 브라우저의 두 번째 탭
    await b.ready();
    assert.ok((await b.options()).some(t => t.includes(tabTarget.title) && t.includes('고친 내용 있음')), 'B탭에 A탭의 임시저장 표시가 보여야 함');
    await b.loadPost(editTarget);
    await b.field('title', editTarget.title + ' (B탭)');
    await sleep(300);
    const keys = await a.eval(`Object.keys(localStorage).filter(k => k.indexOf(${JSON.stringify(DRAFT_PREFIX)}) === 0).sort()`);
    assert.deepStrictEqual(keys, [DRAFT_PREFIX + 'slug:' + editTarget.slug, DRAFT_PREFIX + 'slug:' + tabTarget.slug].sort(), '두 글의 임시저장본이 모두 남아야 함');
    assert.strictEqual(await a.fieldValue('title'), tabTarget.title + ' (A탭)', 'A탭 내용이 그대로여야 함');
    // 같은 글을 B탭에서도 고치면 A탭에 알림
    await b.loadPost({slug: tabTarget.slug, title: tabTarget.title + ' (A탭)'});
    await b.field('title', tabTarget.title + ' (B탭이 고침)');
    await a.until(`/다른 탭\\(창\\)에서도 이 글을 고치고 있습니다/.test(document.getElementById('draftBarText').textContent)`, 'A탭의 다른 탭 알림');
    assert.strictEqual(await a.fieldValue('title'), tabTarget.title + ' (A탭)', '알림만 하고 A탭 내용은 바꾸지 않아야 함');
    await a.click('#loadOtherTabBtn');
    assert.strictEqual(await a.fieldValue('title'), tabTarget.title + ' (B탭이 고침)');
    await b.closeTab();
    await a.close();
  });

  await step('[미리보기] 탭에 편집 중인 글이 실제 페이지 모양으로 뜬다', async () => {
    const b = await openBrowser(files);
    await b.ready();
    await b.loadPost(editTarget);
    await b.field('title', '미리보기 확인용 제목');
    await b.until(`(document.getElementById('previewFrame').getAttribute('srcdoc') || '').includes('미리보기 확인용 제목')`, '미리보기 갱신');
    const doc = await b.eval(`document.getElementById('previewFrame').getAttribute('srcdoc')`);
    assert.ok(doc.includes('<base href="https://raw.githubusercontent.com/' + C.SITE.github.owner + '/' + C.SITE.github.repo + '/'), '사진을 저장소에서 읽는 기준 주소가 있어야 함');
    assert.ok(doc.includes('class="article-body'));
    await b.close();
  });

  console.log(failed ? `\n실패 ${failed}건\n` : '\n화면 검증 모두 통과\n');
  ws.close(); chrome.kill(); server.close();
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
