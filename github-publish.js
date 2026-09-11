/* =========================================================
   GitHub 발행 — 관리 도구 v2.1 (전주점·강남점 공용)
   ---------------------------------------------------------
   · 저장소 이름·GitHub 키 저장 이름은 site-config.js 의 SITE 에서 가져옵니다.
   · 목록의 원본은 GitHub 저장소(= 홈페이지)입니다.
     발행할 때마다 저장소 최신본을 먼저 읽고, 지금 글 1개만 병합합니다.
   · 바뀌는 파일 여러 개를 커밋 1개로 한꺼번에 올립니다.
     중간에 실패하면 홈페이지는 아무것도 바뀌지 않습니다.
   · 확인하는 사이 다른 곳에서 발행이 있었다면(동시 발행)
     최신본 기준으로 다시 계산해서 한 번 더 확인받습니다.
   · 올리는 순간 인터넷이 끊겨 결과를 못 받았으면, 저장소를 다시 읽어
     실제로 올라갔는지 확인합니다. (같은 글을 두 번 올리지 않게)
========================================================= */

const GH = HooColumns.SITE.github;
const GH_TOKEN_KEY = HooColumns.SITE.tokenKey;
const GH_API = 'https://api.github.com/repos/' + GH.owner + '/' + GH.repo;

function ghToken(){
  try { return localStorage.getItem(GH_TOKEN_KEY) || ''; } catch (e) { return ''; }
}

/* 한글이 섞인 글도 깨지지 않도록 UTF-8 기준으로 변환한다 */
function toBase64(str){
  const bytes = new TextEncoder().encode(str);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}
function fromBase64(b64){
  const bin = atob(String(b64 || '').replace(/\s/g, ''));
  const bytes = Uint8Array.from(bin, c => c.charCodeAt(0));
  return new TextDecoder('utf-8').decode(bytes);
}

/* GitHub 오류를 사람이 알아볼 수 있는 말로 바꾼다 */
function ghFriendly(status, path, text){
  if (status === 401) return 'GitHub 접근 키가 맞지 않거나 만료·삭제되었습니다.\n화면 아래 [🔑 GitHub 연결]에서 새 키를 넣어 주세요.';
  if (status === 403 && /rate limit/i.test(text || '')) return 'GitHub 요청 한도를 잠시 넘었습니다. 1시간쯤 뒤에 다시 시도해 주세요.';
  if (status === 403 || status === 404) {
    return 'GitHub 저장소(' + GH.owner + '/' + GH.repo + ')에 접근할 권한이 없습니다.\n' +
      '키를 만들 때 저장소를 ' + GH.repo + ' 로, 권한을 Contents: Read and write 로 지정했는지 확인해 주세요.';
  }
  if (status >= 500) return 'GitHub 서버가 잠시 응답하지 않습니다. 몇 분 뒤 다시 시도해 주세요.';
  return 'GitHub 요청 실패 (' + status + ') ' + path + (text ? '\n' + String(text).slice(0, 200) : '');
}

function networkError(cause){
  const e = new Error('인터넷 연결이 끊겼거나 GitHub에 닿지 못했습니다. 연결을 확인하고 다시 시도해 주세요.');
  e.network = true;
  e.cause = cause;
  return e;
}

async function ghApi(path, options){
  options = options || {};
  try {
    return await fetch(GH_API + path, Object.assign({}, options, {
      cache: 'no-store',   // 방금 발행한 내용을 옛날 값으로 읽지 않도록 브라우저 캐시를 쓰지 않는다
      headers: Object.assign({
        'Authorization': 'Bearer ' + ghToken(),
        'Accept': 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
      }, options.headers || {}),
    }));
  } catch (e) {
    throw networkError(e);
  }
}

async function ghJson(path, options){
  const res = await ghApi(path, options);
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    const err = new Error(ghFriendly(res.status, path, text));
    err.status = res.status;
    throw err;
  }
  return res.json();
}

function ghSend(path, body, method){
  return ghApi(path, {
    method: method || 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify(body),
  });
}

async function ghFail(res, what){
  const text = await res.text().catch(() => '');
  const err = new Error(what + ' — ' + ghFriendly(res.status, '', text));
  err.status = res.status;
  return err;
}

async function ghBlobText(sha){
  const j = await ghJson('/git/blobs/' + sha);
  return fromBase64(j.content);
}

/* 저장소 최신본 한 벌을 읽는다 — 목록·파일 목록·목록 페이지·사이트맵·llms */
async function ghSnapshot(){
  const P = HooColumns.PATHS;
  const ref = await ghJson('/git/ref/heads/' + GH.branch);
  const headSha = ref.object.sha;
  const commit = await ghJson('/git/commits/' + headSha);
  const tree = await ghJson('/git/trees/' + commit.tree.sha + '?recursive=1');
  if (tree.truncated) throw new Error('저장소 파일 목록을 한 번에 다 읽지 못했습니다. 발행을 멈춥니다.');

  const paths = new Map();
  tree.tree.forEach(e => { if (e.type === 'blob') paths.set(e.path, e.sha); });
  const read = p => (paths.has(p) ? ghBlobText(paths.get(p)) : Promise.resolve(null));
  const [indexText, list, sitemap, llms] = await Promise.all([read(P.index), read(P.list), read(P.sitemap), read(P.llms)]);

  if (indexText == null) throw new Error('홈페이지 저장소에 ' + P.index + ' (컬럼 목록 원본)이 없습니다. 목록을 새로 만들지 않고 멈춥니다.');
  if (list == null) throw new Error('홈페이지 저장소에 ' + P.list + ' 이 없습니다.');

  return {
    headSha: headSha,
    treeSha: commit.tree.sha,
    commitDate: commit.committer && commit.committer.date,
    paths: paths,
    index: HooColumns.parseIndex(indexText),
    texts: {list: list, sitemap: sitemap || '', llms: llms},
  };
}

/* 바뀌는 파일들을 커밋 1개로 올린다. 그 사이 저장소가 바뀌었으면 conflict 로 알린다 */
async function ghCommit(snap, changes, message){
  const tree = changes.map(c => (c.content == null
    ? {path: c.path, mode: '100644', type: 'blob', sha: null}
    : {path: c.path, mode: '100644', type: 'blob', content: c.content}));

  let res = await ghSend('/git/trees', {base_tree: snap.treeSha, tree: tree});
  if (!res.ok) throw await ghFail(res, '파일 묶음 만들기 실패');
  const newTree = await res.json();

  res = await ghSend('/git/commits', {message: message, tree: newTree.sha, parents: [snap.headSha]});
  if (!res.ok) throw await ghFail(res, '커밋 만들기 실패');
  const commit = await res.json();

  // force:false — 내가 읽은 뒤에 누가 먼저 올렸다면 덮어쓰지 않고 거절된다
  try {
    res = await ghSend('/git/refs/heads/' + GH.branch, {sha: commit.sha, force: false}, 'PATCH');
  } catch (e) {
    // 이 단계에서 연결이 끊기면 실제로는 올라갔을 수 있다 → 호출한 쪽에서 저장소를 다시 읽어 확인한다
    if (e.network) e.maybePublished = true;
    throw e;
  }
  if (res.status === 409 || res.status === 422) {
    const e = new Error('다른 곳에서 먼저 발행되었습니다.');
    e.conflict = true;
    throw e;
  }
  if (!res.ok) throw await ghFail(res, '홈페이지 반영 실패');
  return commit.sha;
}

/* 계획한 변경이 저장소에 그대로 올라가 있는지 확인한다 (결과를 못 받았을 때) */
async function ghVerifyPublished(plan){
  const snap = await ghSnapshot();
  for (const c of plan.changes) {
    if (c.content == null) { if (snap.paths.has(c.path)) return false; continue; }
    const sha = snap.paths.get(c.path);
    if (!sha) return false;
    if ((await ghBlobText(sha)) !== c.content) return false;
  }
  return true;
}

/* ---------- 상태 표시 ---------- */

function setBarState(msg, ok){
  const el = document.getElementById('barFolderState');
  el.textContent = msg;
  el.className = 'mt-0.5 ' + (ok ? 'text-gold' : 'text-white/50');
}

function setDeployedState(msg, ok){
  const el = document.getElementById('deployedState');
  el.textContent = msg;
  el.className = ok ? 'font-bold text-point' : 'text-muted';
}

function setBusy(busy){
  const btn = document.getElementById('barPublishBtn');
  btn.disabled = busy;
  btn.textContent = busy ? '처리 중…' : '발행 전 확인';
}

function fmtDate(iso){
  try { return new Date(iso).toLocaleString('ko-KR', {dateStyle: 'short', timeStyle: 'short'}); } catch (e) { return ''; }
}

/* ---------- 홈페이지 목록 불러오기 ---------- */

async function loadDeployed(){
  if (!ghToken()) {
    deployed = {loaded: false, index: [], paths: new Map(), headSha: '', texts: {}};
    setDeployedState('GitHub 미연결 — 화면 아래 [🔑 GitHub 연결]을 먼저 눌러주세요. 연결해야 홈페이지에 올라간 글 목록을 불러옵니다.', false);
    renderColumnSelect(); renderColumnFields(); renderAll();
    return;
  }
  setDeployedState('홈페이지 목록 불러오는 중…', false);
  try {
    const snap = await ghSnapshot();
    deployed = {loaded: true, index: snap.index, paths: snap.paths, headSha: snap.headSha, texts: snap.texts};
    setDeployedState(`홈페이지에 올라간 컬럼 ${snap.index.length}개 — 기준: 저장소 최신본 ${snap.headSha.slice(0, 7)} (${fmtDate(snap.commitDate)})`, true);
  } catch (e) {
    deployed = {loaded: false, index: [], paths: new Map(), headSha: '', texts: {}};
    setDeployedState('홈페이지 목록을 불러오지 못했습니다 — ' + e.message, false);
  }
  renderColumnSelect(); renderColumnFields(); renderAll();
}

/* 홈페이지에 올라가 있는 글 1개의 원본 값을 읽는다 */
async function ghLoadColumn(slug){
  const P = HooColumns.PATHS;
  const dataSha = deployed.paths.get(P.data(slug));
  if (dataSha) {
    return {data: HooColumns.normalizeColumn(JSON.parse(await ghBlobText(dataSha))), sha: dataSha};
  }
  // 원본 값 파일이 없는 글(손으로 만든 페이지 등)은 페이지에서 값을 되살린다
  const pageSha = deployed.paths.get(P.page(slug));
  if (!pageSha) throw new Error(slug + ' 파일을 저장소에서 찾지 못했습니다.');
  const data = HooColumns.parseColumnHtml(await ghBlobText(pageSha), slug);
  const card = deployed.index.find(c => c.slug === slug);
  if (card) data.cardSummary = card.cardSummary;
  return {data: data, sha: null};
}

/* ---------- 발행 ---------- */

async function publishCurrent(){
  if (!current) { alert('발행할 글을 먼저 고르거나 [+ 새 컬럼]으로 만들어 주세요.'); return; }
  if (!ghToken()) { await connectGithub(); if (!ghToken()) return; }

  const check = HooColumns.validateColumn(current.data);
  if (check.errors.length) {
    alert('발행 전에 고쳐야 할 부분이 있습니다.\n\n- ' + check.errors.join('\n- '));
    return;
  }
  await runPublish({
    type: 'upsert',
    column: current.data,
    isNew: current.isNew,
    baseSha: current.baseSha,
    reservedSlugs: otherNewDraftSlugs(),
  }, check.warnings);
}

async function publishDelete(slug, title){
  if (!ghToken()) { await connectGithub(); if (!ghToken()) return; }
  if (!confirm(`"${title}" 글을 홈페이지에서 삭제할까요?\n\n다음 확인 화면에서 [삭제하고 발행]을 눌러야 실제로 삭제됩니다.`)) return;
  await runPublish({type: 'delete', slug: slug}, []);
}

async function runPublish(op, extraWarnings){
  setBusy(true);
  let notice = '';
  try {
    for (let attempt = 1; attempt <= 3; attempt++) {
      setBarState('홈페이지 최신 목록 확인 중…', true);
      const snap = await ghSnapshot();

      let plan;
      try {
        plan = HooColumns.planPublish(snap, op, HooColumns.todayLocal());
      } catch (e) {
        setBarState('발행 멈춤 — 홈페이지는 바뀌지 않았습니다', false);
        alert(e.message);
        return false;
      }

      const ok = await showPublishConfirm(plan, op, (extraWarnings || []).map(t => ({text: t})), notice);
      if (!ok) { setBarState('발행 취소 — 홈페이지는 바뀌지 않았습니다', false); return false; }

      setBarState('발행 중…', true);
      try {
        await ghCommit(snap, plan.changes, commitMessage(op, plan));
      } catch (e) {
        if (e.conflict) {
          notice = '확인하시는 사이에 다른 곳에서 홈페이지가 바뀌었습니다. 최신 목록 기준으로 다시 계산했으니 한 번 더 확인해 주세요.';
          continue;
        }
        if (e.maybePublished) {
          // 결과를 못 받았을 뿐 실제로는 올라갔을 수 있다. 저장소를 다시 읽어 확인한다.
          setBarState('연결이 끊겨 발행 결과 확인 중…', true);
          let done = false;
          try { done = await ghVerifyPublished(plan); } catch (_) { done = false; }
          if (done) { await onPublished(op, plan); return true; }
          setBarState('발행 결과를 확인하지 못했습니다', false);
          alert('올리는 도중 인터넷 연결이 끊겨 발행 결과를 확인하지 못했습니다.\n\n' +
            '연결이 돌아오면 [↻ 다시 불러오기]를 눌러 홈페이지 목록을 확인해 주세요.\n' +
            '글이 이미 올라가 있으면 다시 발행할 필요가 없습니다. (같은 제목의 글을 또 올리면 확인 화면에서 알려 드립니다)');
          return false;
        }
        throw e;
      }
      await onPublished(op, plan);
      return true;
    }
    alert('다른 곳에서 계속 발행이 일어나 이번 발행을 멈췄습니다. 잠시 후 다시 시도해 주세요.');
  } catch (e) {
    setBarState('발행 실패 — 홈페이지는 바뀌지 않았습니다', false);
    alert('발행 중 오류가 발생했습니다. 홈페이지는 바뀌지 않았습니다.\n\n' + e.message);
  } finally {
    setBusy(false);
  }
  return false;
}

function commitMessage(op, plan){
  const s = plan.summary;
  const head = op.type === 'delete'
    ? '컬럼 삭제: ' + s.deleted[0].slug + ' ' + s.deleted[0].title
    : s.added.length
      ? '컬럼 발행: ' + s.added[0].slug + ' ' + s.added[0].title
      : '컬럼 수정: ' + s.updated[0].slug + ' ' + s.updated[0].title;
  return HooColumns.flat(head) +
    '\n\n발행 후 목록 ' + plan.after.length + '개 (추가 ' + s.added.length + ' / 수정 ' + s.updated.length +
    ' / 유지 ' + s.kept.length + ' / 삭제 ' + s.deleted.length + ')\n관리 도구 ' + HooColumns.VERSION;
}

async function onPublished(op, plan){
  const P = HooColumns.PATHS;
  if (op.type === 'upsert') {
    if (current) removeDraft(current.key);
    removeDraft('slug:' + plan.column.slug);
    current = {key: 'slug:' + plan.column.slug, isNew: false, baseSha: null, data: plan.column};
  } else {
    removeDraft('slug:' + op.slug);
    current = null;
  }
  await loadDeployed();
  if (current) current.baseSha = deployed.paths.get(P.data(current.data.slug)) || null;
  renderColumnSelect(); renderColumnFields(); renderAll();

  const s = plan.summary;
  setBarState('발행 완료 — 1~2분 뒤 홈페이지에 반영됩니다', true);
  alert('발행이 끝났습니다.\n\n홈페이지 컬럼 목록: ' + plan.after.length + '개' +
    (s.renamedFrom ? '\n파일명: ' + s.renamedFrom + ' → ' + plan.column.slug + ' (겹치지 않게 변경)' : '') +
    '\n\n홈페이지에 실제로 보이기까지 1~2분 걸립니다.\n' + HooColumns.SITE.domain.replace(/\/$/, '') + ' 에서 확인해 주세요.');
}

/* 발행 전 확인 화면 — [발행하기]를 눌러야만 홈페이지가 바뀐다 */
function showPublishConfirm(plan, op, extraWarnings, notice){
  const E = HooColumns.esc;
  const s = plan.summary;
  const warnings = plan.warnings.concat(extraWarnings || []);
  const isDelete = op.type === 'delete';
  const items = arr => arr.map(c => `<li><span class="text-muted text-xs">${E(c.slug)}</span> ${E(c.title)}</li>`).join('');
  const group = (label, arr, tone) => (arr.length
    ? `<div class="mt-4"><p class="text-xs font-bold ${tone}">${label} ${arr.length}개</p><ul class="mt-1 space-y-1 text-sm">${items(arr)}</ul></div>`
    : '');
  const stat = (n, label, tone) => `<div class="rounded-lg py-2 ${n ? tone : 'bg-[#f7f6f3] text-muted'}"><b class="block text-lg">${n}</b>${label}</div>`;
  const files = plan.changes.map(c => `<li>${c.content == null ? '<b class="text-red-600">삭제</b>' : '저장'} · ${E(c.path)}</li>`).join('');
  const title = isDelete ? '글 1개를 홈페이지에서 삭제합니다' : s.added.length ? '새 글 1개를 홈페이지에 추가합니다' : '글 1개를 수정합니다';

  const root = document.getElementById('modalRoot');
  root.innerHTML = `
  <div class="fixed inset-0 z-[70] bg-black/50 flex items-center justify-center p-4">
    <div class="bg-white rounded-2xl shadow-soft w-full max-w-lg max-h-[88vh] overflow-y-auto p-6" role="dialog" aria-modal="true">
      <p class="text-xs text-gold font-bold">발행 전 확인</p>
      <h3 class="mt-1 text-lg font-extrabold">${title}</h3>
      ${notice ? `<p class="mt-3 rounded-lg bg-gold-soft p-3 text-xs leading-relaxed">${E(notice)}</p>` : ''}
      <div class="mt-4 rounded-xl border border-line p-4">
        <p class="text-sm">발행 후 홈페이지 컬럼 목록: <b id="planTotal" class="text-xl">${plan.after.length}개</b>
          <span class="text-muted text-xs">(지금 ${plan.before.length}개)</span></p>
        <div class="mt-3 grid grid-cols-4 gap-2 text-center text-xs">
          ${stat(s.added.length, '추가', 'bg-gold-soft text-point')}
          ${stat(s.updated.length, '수정', 'bg-gold-soft text-point')}
          ${stat(s.kept.length, '유지', 'bg-gold-soft text-point')}
          ${stat(s.deleted.length, '삭제', 'bg-red-50 text-red-700')}
        </div>
      </div>
      ${group('새로 추가', s.added, 'text-gold')}
      ${group('수정', s.updated, 'text-gold')}
      ${group('삭제', s.deleted, 'text-red-600')}
      <details class="mt-4">
        <summary class="text-xs font-bold cursor-pointer">그대로 유지되는 글 ${s.kept.length}개 보기</summary>
        <ul class="mt-1 space-y-1 text-sm">${items(s.kept)}</ul>
      </details>
      ${warnings.length ? `<div class="mt-4 rounded-lg border border-amber-300 bg-amber-50 p-3 text-xs leading-relaxed space-y-2">${warnings.map(w => (w.needsAck
        ? `<label class="flex gap-2 items-start font-bold"><input type="checkbox" class="ack mt-0.5"><span>${E(w.text)}</span></label>`
        : `<p>⚠ ${E(w.text)}</p>`)).join('')}</div>` : ''}
      ${isDelete ? '' : '<p class="mt-4 text-[11px] text-muted">실제 모양은 오른쪽 <b>[미리보기]</b> 탭에서 발행 전에 볼 수 있습니다.</p>'}
      <details class="mt-4">
        <summary class="text-[11px] text-muted cursor-pointer">바뀌는 파일 ${plan.changes.length}개 보기</summary>
        <ul class="mt-1 text-[11px] text-muted space-y-0.5">${files}</ul>
      </details>
      <div class="mt-6 flex justify-end gap-2">
        <button type="button" data-act="cancel" class="rounded-full border border-line text-sm font-bold px-5 py-2.5 hover:bg-gold-soft transition">취소</button>
        <button type="button" data-act="ok" class="rounded-full ${isDelete ? 'bg-red-600' : 'bg-point'} text-white text-sm font-bold px-6 py-2.5 disabled:opacity-40 disabled:cursor-not-allowed">${isDelete ? '삭제하고 발행' : '발행하기'}</button>
      </div>
    </div>
  </div>`;

  return new Promise(resolve => {
    const ok = root.querySelector('[data-act="ok"]');
    const acks = Array.from(root.querySelectorAll('.ack'));
    const sync = () => { ok.disabled = acks.some(a => !a.checked); };
    acks.forEach(a => a.addEventListener('change', sync));
    sync();
    const close = v => { root.innerHTML = ''; resolve(v); };
    ok.addEventListener('click', () => close(true));
    root.querySelector('[data-act="cancel"]').addEventListener('click', () => close(false));
  });
}

/* ---------- GitHub 연결 ---------- */

async function connectGithub(){
  const saved = ghToken();
  const msg = saved
    ? 'GitHub 접근 키가 이미 저장되어 있습니다.\n\n바꾸시려면 새 키를 붙여넣고 [확인],\n연결을 끊으시려면 내용을 모두 지우고 [확인]을 누르세요.'
    : 'GitHub 접근 키를 붙여넣어 주세요.\n\n(발급 방법은 「어드민-설치-순서.md」 문서를 참고하세요)';
  const input = prompt(msg, saved);
  if (input === null) return;

  const key = input.trim();
  if (!key) {
    try { localStorage.removeItem(GH_TOKEN_KEY); } catch (e) {}
    setBarState('GitHub 연결 해제됨', false);
    await loadDeployed();
    return;
  }

  try { localStorage.setItem(GH_TOKEN_KEY, key); } catch (e) {}
  setBarState('GitHub 확인 중...', false);

  try {
    const res = await ghApi('', {method: 'GET'});
    if (!res.ok) throw new Error(ghFriendly(res.status, '', await res.text().catch(() => '')));
    setBarState('GitHub 연결됨: ' + GH.owner + '/' + GH.repo, true);
    showToast('GitHub 연결 완료');
  } catch (e) {
    try { localStorage.removeItem(GH_TOKEN_KEY); } catch (_) {}
    setBarState('GitHub 연결 실패', false);
    alert('GitHub 연결에 실패했습니다.\n\n' + e.message);
  }
  await loadDeployed();
}

/* ---------- 본문 사진 업로드 ---------- */

/* 이미지 같은 파일은 글자가 아니므로 바이트 그대로 base64로 바꾼다 */
async function fileToBase64(file){
  const bytes = new Uint8Array(await file.arrayBuffer());
  let bin = '';
  const CHUNK = 0x8000;   // 한 번에 다 넘기면 브라우저가 멈출 수 있어 나눠서 처리
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
  }
  return btoa(bin);
}

/* assets/images 안의 사진 파일 이름 목록 */
async function ghListImages(){
  if (!ghToken()) return [];
  const res = await ghApi('/contents/assets/images?ref=' + GH.branch, {method: 'GET'});
  if (!res.ok) return [];
  const items = await res.json();
  if (!Array.isArray(items)) return [];
  return items
    .filter(it => it.type === 'file' && /\.(jpe?g|png|webp|gif|svg|avif)$/i.test(it.name))
    .map(it => it.name);
}

/* 사진 한 장을 assets/images 에 올리고 컬럼에서 쓸 경로를 돌려준다.
   같은 이름이 있으면 safeImageName()이 번호를 붙여 오므로 기존 사진을 덮어쓰지 않는다. */
async function ghUploadImage(file, name){
  if (!ghToken()) { await connectGithub(); if (!ghToken()) throw new Error('GitHub 연결이 필요합니다.'); }

  const path = 'assets/images/' + name;
  setBarState('사진 올리는 중 — ' + name, true);

  const existing = await ghApi('/contents/' + path + '?ref=' + GH.branch, {method: 'GET'});
  if (existing.ok) throw new Error('같은 이름의 사진이 이미 있습니다: ' + name + '\n파일 이름을 바꿔서 다시 올려주세요.');

  const res = await ghSend('/contents/' + path, {
    message: '사진 추가: ' + name,
    content: await fileToBase64(file),
    branch: GH.branch,
  }, 'PUT');
  if (!res.ok) {
    setBarState('사진 올리기 실패', false);
    throw await ghFail(res, '사진 저장 실패');
  }

  // 방금 올린 사진을 발행 전 검사(사진 존재 확인)가 알 수 있게 목록에 넣는다
  try { const j = await res.json(); if (j && j.content && j.content.sha) deployed.paths.set(path, j.content.sha); } catch (e) {}

  setBarState('사진 올림 — ' + name, true);
  return path;
}

/* ---------- 화면에 연결 ---------- */

document.getElementById('barGithubBtn').addEventListener('click', connectGithub);
document.getElementById('barPublishBtn').addEventListener('click', publishCurrent);
document.getElementById('reloadDeployedBtn').addEventListener('click', loadDeployed);

setBarState(
  ghToken() ? 'GitHub 연결됨: ' + GH.owner + '/' + GH.repo
            : 'GitHub 미연결 — [🔑 GitHub 연결]을 먼저 눌러주세요',
  !!ghToken()
);
loadDeployed();
