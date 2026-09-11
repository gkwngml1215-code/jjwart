// 관리 도구 v2 실제 화면 검증 (크롬을 화면 없이 띄워 버튼을 직접 누릅니다)
// GitHub 는 가짜(메모리 저장소)로 바꿔 끼우므로 실제 홈페이지는 건드리지 않습니다.
//
// 실행: node tests/e2e-admin.js <홈페이지 저장소 폴더> <chrome.exe 경로> <임시 프로필 폴더>
const http = require('http');
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const {spawn, execSync} = require('child_process');

const ADMIN = path.resolve(__dirname, '..');
const [SITE, CHROME, PROFILE] = process.argv.slice(2);
const PORT = 8765, DEBUG_PORT = 9333;
const sleep = ms => new Promise(r => setTimeout(r, ms));

/* ---------- 홈페이지 저장소 내용 (git 에 올라간 파일 기준) ---------- */
function siteFiles(){
  const out = {};
  execSync('git ls-files -z', {cwd: SITE}).toString('utf8').split('\0').filter(Boolean).forEach(rel => {
    out[rel] = /\.(jpe?g|png|gif|webp|svg|ico)$/i.test(rel) ? 'BINARY' : fs.readFileSync(path.join(SITE, rel), 'utf8').replace(/\r\n/g, '\n');
  });
  return out;
}

/* ---------- 가짜 GitHub API (페이지보다 먼저 실행되어 fetch 를 바꿔 끼운다) ---------- */
function mockSource(files, seed){
  return `(() => {
  localStorage.setItem('hoo-admin-gh-token', 'test-token');
  ${Object.entries(seed || {}).map(([k, v]) => `localStorage.setItem(${JSON.stringify(k)}, ${JSON.stringify(JSON.stringify(v))});`).join('\n')}
  const API = 'https://api.github.com/repos/gkwngml1215-code/jjwart';
  const enc = s => { const b = new TextEncoder().encode(s); let bin = ''; for (const x of b) bin += String.fromCharCode(x); return btoa(bin); };
  const hash = s => { let h = 5381; for (let i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0; return 'b' + h.toString(16) + '-' + s.length; };
  const R = {trees: {}, commits: {}, blobs: {}, head: null, n: 0, raceOnce: false, patches: 0};
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
    if (!url.startsWith(API)) return realFetch(url, opts);
    const method = (opts.method || 'GET').toUpperCase();
    const p = new URL(url).pathname.replace('/repos/gkwngml1215-code/jjwart', '');
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

async function openBrowser(files, seed){
  const {browserContextId} = await send('Target.createBrowserContext');   // 매번 새 시크릿 창과 같다
  const {targetId} = await send('Target.createTarget', {url: 'about:blank', browserContextId});
  const {sessionId} = await send('Target.attachToTarget', {targetId, flatten: true});
  const s = {dialogs: [], errors: [], accept: true};
  listeners.push(msg => {
    if (msg.sessionId !== sessionId) return;
    if (msg.method === 'Page.javascriptDialogOpening') {
      s.dialogs.push(msg.params.message);
      send('Page.handleJavaScriptDialog', {accept: s.accept, promptText: ''}, sessionId);
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
  s.until = async (expr, what, ms) => {
    const t0 = Date.now();
    while (Date.now() - t0 < (ms || 10000)) {
      try { const v = await s.eval(expr); if (v) return v; } catch (e) { /* 페이지 로딩 중 */ }
      await sleep(100);
    }
    throw new Error('시간 초과: ' + what);
  };
  s.click = sel => s.eval(`(() => { document.querySelector(${JSON.stringify(sel)}).click(); return true; })()`);
  s.field = (key, value) => s.eval(`(() => {
    const el = document.querySelector('#columnFields [data-field="${key}"]');
    el.value = ${JSON.stringify(value)};
    el.dispatchEvent(new Event('input', {bubbles: true}));
    return el.value;
  })()`);
  s.select = key => s.eval(`(() => { const el = document.getElementById('columnSelect'); el.value = ${JSON.stringify(key)}; el.dispatchEvent(new Event('change')); return el.value; })()`);
  s.modalText = () => s.eval(`document.getElementById('modalRoot').innerText`);
  s.waitModal = () => s.until(`!!document.querySelector('#modalRoot [data-act="ok"]')`, '발행 전 확인 화면');
  s.waitDone = n => s.until(`${JSON.stringify(s.dialogs)}.length >= 0 && true`, '').then(() => s.untilDialog(/발행이 끝났습니다/, n));
  s.untilDialog = async (re, count) => {
    const t0 = Date.now();
    while (Date.now() - t0 < 10000) {
      if (s.dialogs.filter(d => re.test(d)).length >= (count || 1)) return;
      await sleep(100);
    }
    throw new Error('알림창을 기다리다 시간 초과: ' + re + ' / 받은 알림: ' + JSON.stringify(s.dialogs));
  };
  s.repo = async () => JSON.parse(await s.eval('JSON.stringify(window.__repo.files())'));
  s.ready = () => s.until(`/컬럼 \\d+개/.test(document.getElementById('deployedState').textContent)`, '홈페이지 목록 불러오기');
  s.close = () => send('Target.disposeBrowserContext', {browserContextId});
  return s;
}

/* ---------- 검증 도우미 ---------- */
const indexSlugs = files => JSON.parse(files['columns/index.json']).columns.map(c => c.slug);
const cardSlugs = files => [...files['columns.html'].matchAll(/href="columns\/([^"]+)\.html"/g)].map(m => m[1]);
const sitemapSlugs = files => [...files['sitemap.xml'].matchAll(/\/columns\/([^/<]+)\.html</g)].map(m => m[1]);

let failed = 0;
async function step(name, fn){
  try { await fn(); console.log('  ✓ ' + name); }
  catch (e) { failed++; console.error('  ✗ ' + name + '\n      ' + e.message); }
}

(async () => {
  const server = http.createServer((req, res) => {
    let rel = decodeURIComponent(req.url.split('?')[0]).replace(/^\/+/, '') || 'index.html';
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
  const initialSlugs = indexSlugs(initial);
  let files = initial;
  console.log(`\n시작 상태: 홈페이지 컬럼 ${initialSlugs.length}개 (${initialSlugs.join(', ')})\n`);

  // 1. 처음 여는 브라우저에서 새 글 발행 → 기존 글은 모두 유지
  await step('새 브라우저에서 새 글 발행: 번호는 배포된 파일 다음(column-10), 기존 9개 유지, 확인 화면 10개 표시', async () => {
    const b = await openBrowser(files);
    await b.ready();
    await b.click('#addColumnBtn');
    assert.strictEqual(await b.eval(`document.querySelector('#columnFields [data-field="slug"]').value`), 'column-10');
    await b.field('title', '테스트 새 글');
    await b.field('cardSummary', '테스트 요약');
    await b.field('description', '테스트 설명');
    await b.field('body', '<p>테스트 본문 첫 문단</p>\n<h2>소제목</h2>\n<p>둘째 문단</p>');
    await b.click('#barPublishBtn');
    await b.waitModal();
    const text = await b.modalText();
    assert.match(text, /발행 후 홈페이지 컬럼 목록: 10개/);
    assert.match(text, /지금 9개/);
    assert.match(text, /1\s*추가/); assert.match(text, /9\s*유지/); assert.match(text, /0\s*삭제/);
    await b.click('#modalRoot [data-act="ok"]');
    await b.untilDialog(/발행이 끝났습니다/);
    files = await b.repo();
    assert.deepStrictEqual(indexSlugs(files), initialSlugs.concat('column-10'));
    assert.deepStrictEqual(cardSlugs(files), indexSlugs(files));
    assert.deepStrictEqual(sitemapSlugs(files).sort(), indexSlugs(files).slice().sort());
    initialSlugs.forEach(s => assert.strictEqual(files['columns/' + s + '.html'], initial['columns/' + s + '.html'], s + ' 페이지가 바뀌면 안 됨'));
    assert.ok(files['columns/column-10.html'].includes('테스트 본문 첫 문단'));
    assert.ok(files['llms.txt'].includes('columns/column-10.html'));
    assert.deepStrictEqual(b.errors, []);
    await b.close();
  });

  // 2. v1 을 쓰던 브라우저(옛 목록 3개가 남아 있음)에서 파일명을 column-04 로 적어도 덮어쓰지 않는다
  await step('옛 v1 저장값이 남은 브라우저 + 이미 있는 파일명(column-04) 입력 → column-11 로 바꿔 올리고 column-04 는 그대로', async () => {
    const legacy = {'hoojeonju_admin_state_v1': {bizName: '후한의원 전주점', columns: [{slug: 'column-01'}, {slug: 'column-02'}, {slug: 'column-03'}]}};
    const b = await openBrowser(files, legacy);
    await b.ready();
    assert.strictEqual(await b.eval(`document.querySelectorAll('#columnSelect option[value^="slug:"]').length`), 10);
    await b.click('#addColumnBtn');
    assert.strictEqual(await b.eval(`document.querySelector('#columnFields [data-field="slug"]').value`), 'column-11');
    await b.field('slug', 'column-04');
    await b.field('title', '겹치는 파일명 테스트');
    await b.field('body', '<p>본문</p>');
    await b.click('#barPublishBtn');
    await b.waitModal();
    const text = await b.modalText();
    assert.match(text, /column-04 은\(는\) 이미 홈페이지에 있어서/);
    assert.match(text, /발행 후 홈페이지 컬럼 목록: 11개/);
    await b.click('#modalRoot [data-act="ok"]');
    await b.untilDialog(/발행이 끝났습니다/);
    const before = files;
    files = await b.repo();
    assert.strictEqual(files['columns/column-04.html'], before['columns/column-04.html'], 'column-04 를 덮어쓰면 안 됨');
    assert.ok(files['columns/column-11.html'].includes('겹치는 파일명 테스트'));
    assert.strictEqual(indexSlugs(files).length, 11);
    assert.deepStrictEqual(b.errors, []);
    await b.close();
  });

  // 3. 기존 글 수정 → 그 글만 바뀌고 개수 그대로
  await step('기존 글(column-04) 수정: 수정 1 · 유지 10, 다른 글 페이지는 그대로', async () => {
    const b = await openBrowser(files);
    await b.ready();
    await b.select('slug:column-04');
    await b.until(`document.querySelector('#columnFields [data-field="title"]') && document.querySelector('#columnFields [data-field="title"]').value.includes('성지')`, 'column-04 불러오기');
    assert.strictEqual(await b.eval(`document.querySelector('#columnFields [data-field="slug"]').readOnly`), true);
    await b.field('title', '전주편평사마귀제거 성지 찾는다면? (수정됨)');
    await b.click('#barPublishBtn');
    await b.waitModal();
    const text = await b.modalText();
    assert.match(text, /글 1개를 수정합니다/);
    assert.match(text, /1\s*수정/); assert.match(text, /10\s*유지/); assert.match(text, /발행 후 홈페이지 컬럼 목록: 11개/);
    await b.click('#modalRoot [data-act="ok"]');
    await b.untilDialog(/발행이 끝났습니다/);
    const before = files;
    files = await b.repo();
    assert.strictEqual(JSON.parse(files['columns/index.json']).columns.find(c => c.slug === 'column-04').title, '전주편평사마귀제거 성지 찾는다면? (수정됨)');
    Object.keys(before).filter(p => /^columns\/column-\d+\.html$/.test(p) && p !== 'columns/column-04.html')
      .forEach(p => assert.strictEqual(files[p], before[p], p + ' 가 바뀌면 안 됨'));
    assert.strictEqual(indexSlugs(files).length, 11);
    await b.close();
  });

  // 4. 확인하는 사이 다른 곳에서 발행 → 덮어쓰지 않고 최신본으로 다시 계산해 한 번 더 확인
  await step('동시 발행: 확인 중 다른 곳에서 발행되면 거절되고, 최신본 기준으로 다시 확인받은 뒤 둘 다 남는다', async () => {
    const b = await openBrowser(files);
    await b.ready();
    await b.select('slug:column-05');
    await b.until(`!!document.querySelector('#columnFields [data-field="title"]')`, 'column-05 불러오기');
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
    assert.strictEqual(JSON.parse(files['columns/index.json']).columns.find(c => c.slug === 'column-05').cardSummary, '동시 발행 테스트 요약');
    assert.strictEqual(indexSlugs(files).length, 11);
    await b.close();
  });

  // 5. 취소하면 아무것도 안 바뀐다 / 발행 전 검사
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
    const now = await b.repo();
    assert.deepStrictEqual(now, files);
    await b.close();
  });

  // 6. 삭제는 [삭제] 버튼 + 확인 화면에서만
  await step('삭제: [이 글 삭제] → 확인창 → 확인 화면(삭제 1) → 그 글 파일만 지워지고 10개', async () => {
    const b = await openBrowser(files);
    await b.ready();
    await b.select('slug:column-11');
    await b.until(`!!document.querySelector('#columnFields [data-field="title"]')`, 'column-11 불러오기');
    await b.click('#delColumnBtn');
    await b.untilDialog(/삭제할까요/);
    await b.waitModal();
    const text = await b.modalText();
    assert.match(text, /1\s*삭제/); assert.match(text, /발행 후 홈페이지 컬럼 목록: 10개/);
    await b.click('#modalRoot [data-act="ok"]');
    await b.untilDialog(/발행이 끝났습니다/);
    files = await b.repo();
    assert.ok(!('columns/column-11.html' in files) && !('columns/data/column-11.json' in files));
    assert.deepStrictEqual(indexSlugs(files), initialSlugs.concat('column-10'));
    assert.deepStrictEqual(cardSlugs(files), indexSlugs(files));
    await b.close();
  });

  console.log(failed ? `\n실패 ${failed}건\n` : '\n화면 검증 모두 통과\n');
  ws.close(); chrome.kill(); server.close();
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
