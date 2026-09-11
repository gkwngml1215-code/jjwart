/* =========================================================
   GitHub에 직접 저장 (어디서든 발행)
   → 폴더 연결도, 「사이트에-올리기.bat」 실행도 필요 없습니다.

   admin.html 안의 기존 기능(글 작성·미리보기)은 그대로 두고,
   "저장하는 방법"만 이 파일이 바꿔 끼웁니다.
========================================================= */

const GH_OWNER  = 'gkwngml1215-code';
const GH_REPO   = 'jjwart';
const GH_BRANCH = 'main';
const GH_TOKEN_KEY = 'hoo-admin-gh-token';

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
  const bin = atob(b64.replace(/\s/g, ''));
  const bytes = Uint8Array.from(bin, c => c.charCodeAt(0));
  return new TextDecoder('utf-8').decode(bytes);
}

async function ghApi(path, options){
  return fetch('https://api.github.com/repos/' + GH_OWNER + '/' + GH_REPO + path, {
    ...options,
    headers: {
      'Authorization': 'Bearer ' + ghToken(),
      'Accept': 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      ...(options && options.headers),
    },
  });
}

/* 파일 하나의 현재 내용을 읽는다 (없으면 null) */
async function ghRead(path){
  const res = await ghApi('/contents/' + path + '?ref=' + GH_BRANCH, { method: 'GET' });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error('읽기 실패 (' + res.status + ') ' + path);
  const j = await res.json();
  return { sha: j.sha, text: fromBase64(j.content) };
}

/* 파일 하나를 저장한다 (있으면 덮어쓰기, 없으면 새로 만들기) */
async function ghWrite(path, text, message){
  const existing = await ghRead(path);
  if (existing && existing.text === text) return 'skip';   // 바뀐 게 없으면 건너뛴다

  const body = { message: message, content: toBase64(text), branch: GH_BRANCH };
  if (existing) body.sha = existing.sha;

  const res = await ghApi('/contents/' + path, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error('저장 실패 (' + res.status + ') ' + path + '\n' + t.slice(0, 200));
  }
  return existing ? 'update' : 'create';
}

/* GitHub 연결 — 발급받은 접근 키를 이 브라우저에 기억시킨다 */
async function connectGithub(){
  const current = ghToken();
  const msg = current
    ? 'GitHub 접근 키가 이미 저장되어 있습니다.\n\n바꾸시려면 새 키를 붙여넣고 [확인],\n연결을 끊으시려면 내용을 모두 지우고 [확인]을 누르세요.'
    : 'GitHub 접근 키를 붙여넣어 주세요.\n\n(발급 방법은 「어드민-사용법.md」 문서를 참고하세요)';
  const input = prompt(msg, current);
  if (input === null) return;

  const key = input.trim();
  if (!key) {
    try { localStorage.removeItem(GH_TOKEN_KEY); } catch (e) {}
    setFolderState('GitHub 연결 해제됨', false);
    return;
  }

  try { localStorage.setItem(GH_TOKEN_KEY, key); } catch (e) {}
  setFolderState('GitHub 확인 중...', false);

  try {
    const res = await ghApi('', { method: 'GET' });
    if (res.status === 401) throw new Error('접근 키가 올바르지 않습니다. 다시 복사해 주세요.');
    if (res.status === 403 || res.status === 404) {
      throw new Error('이 저장소에 접근할 권한이 없습니다.\n\n키를 만들 때 저장소를 jjwart 로,\n권한을 Contents: Read and write 로 지정했는지 확인해 주세요.');
    }
    if (!res.ok) throw new Error('연결 실패 (' + res.status + ')');
    setFolderState('GitHub 연결됨: ' + GH_OWNER + '/' + GH_REPO, true);
    showToast('GitHub 연결 완료');
  } catch (e) {
    try { localStorage.removeItem(GH_TOKEN_KEY); } catch (_) {}
    setFolderState('GitHub 연결 실패', false);
    alert('GitHub 연결에 실패했습니다.\n\n' + e.message);
  }
}

/* 발행 — 컬럼 페이지 + 목록 + 사이트맵을 한 번에 올린다 */
async function publishToGithub(){
  if (!ghToken()) { await connectGithub(); if (!ghToken()) return; }

  const btn = document.getElementById('barPublishBtn');
  const label = btn.textContent;
  btn.disabled = true;

  try {
    const total = state.columns.length + 2;
    let done = 0;
    const step = (name) => {
      done++;
      setFolderState('발행 중 ' + done + '/' + total + ' — ' + name, true);
      btn.textContent = '발행 중... ' + done + '/' + total;
    };

    // 1) 컬럼 페이지들
    const saved = selectedColumn;
    for (let i = 0; i < state.columns.length; i++) {
      selectedColumn = i;
      const slug = state.columns[i].slug;
      await ghWrite('columns/' + slug + '.html', buildColumnPage(), '컬럼 발행: ' + slug);
      step(slug + '.html');
    }
    selectedColumn = saved;

    // 2) columns.html 안의 목록 카드 갱신
    const listFile = await ghRead('columns.html');
    if (!listFile) throw new Error('저장소에서 columns.html 을 찾지 못했습니다.');
    const cOpen  = '<' + '!-- COLUMNS:START --' + '>';
    const cClose = '<' + '!-- COLUMNS:END --' + '>';
    const marker = new RegExp('(' + cOpen + ')[\\s\\S]*?(' + cClose + ')');
    if (!marker.test(listFile.text)) {
      alert('columns.html 에서 COLUMNS:START 표식을 찾지 못했습니다.\n목록 자동 갱신을 건너뜁니다.');
    } else {
      const updated = listFile.text.replace(marker, '$1\n\n' + buildColumnCards() + '\n\n      $2');
      await ghWrite('columns.html', updated, '컬럼 목록 갱신');
    }
    step('columns.html');

    // 3) 사이트맵 갱신
    await ghWrite('sitemap.xml', buildSitemap(), '사이트맵 갱신');
    step('sitemap.xml');

    setFolderState('발행 완료 — 1~2분 뒤 홈페이지에 반영됩니다', true);
    showToast('발행 완료 — 컬럼 ' + state.columns.length + '개');
    alert('발행이 끝났습니다.\n\n홈페이지에 실제로 보이기까지 1~2분 걸립니다.\njjhoowart.co.kr 에서 확인해 주세요.');
  } catch (e) {
    setFolderState('발행 실패', false);
    alert('발행 중 오류가 발생했습니다.\n\n' + e.message);
  } finally {
    btn.disabled = false;
    btn.textContent = label;
  }
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

/* 파일 하나의 sha만 확인한다 (이미 있으면 덮어쓰기용) */
async function ghSha(path){
  const res = await ghApi('/contents/' + path + '?ref=' + GH_BRANCH, { method: 'GET' });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error('확인 실패 (' + res.status + ') ' + path);
  const j = await res.json();
  return j.sha;
}

/* assets/images 안의 사진 파일 이름 목록 */
async function ghListImages(){
  const res = await ghApi('/contents/assets/images?ref=' + GH_BRANCH, { method: 'GET' });
  if (!res.ok) return [];
  const items = await res.json();
  if (!Array.isArray(items)) return [];
  return items
    .filter(it => it.type === 'file' && /\.(jpe?g|png|webp|gif|svg|avif)$/i.test(it.name))
    .map(it => it.name);
}

/* 사진 한 장을 assets/images 에 올리고 컬럼에서 쓸 경로를 돌려준다 */
async function ghUploadImage(file, name){
  if (!ghToken()) { await connectGithub(); if (!ghToken()) throw new Error('GitHub 연결이 필요합니다.'); }

  const path = 'assets/images/' + name;
  setFolderState('사진 올리는 중 — ' + name, true);

  const body = { message: '사진 추가: ' + name, content: await fileToBase64(file), branch: GH_BRANCH };
  const sha = await ghSha(path);
  if (sha) body.sha = sha;

  const res = await ghApi('/contents/' + path, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const t = await res.text();
    setFolderState('사진 올리기 실패', false);
    throw new Error('사진 저장 실패 (' + res.status + ')\n' + t.slice(0, 200));
  }

  setFolderState('사진 올림 — ' + name, true);
  return path;
}

/* ---------- 화면에 연결 ---------- */


document.getElementById('barGithubBtn').addEventListener('click', connectGithub);

/* 발행 버튼은 이제 GitHub으로만 보낸다.
   원본 admin.html이 걸어둔 기존 폴더 저장 동작이 같이 실행되면 안 되므로,
   버튼을 복제해서 갈아끼워 예전 동작을 완전히 떼어낸다. */
(function replacePublishButton(){
  const old = document.getElementById('barPublishBtn');
  if (!old) return;
  const fresh = old.cloneNode(true);
  old.parentNode.replaceChild(fresh, old);
  fresh.addEventListener('click', publishToGithub);
})();

/* 폴더 연결 버튼은 더 이상 쓰지 않으므로 감춘다 */
(function hideFolderButton(){
  const b = document.getElementById('barConnectBtn');
  if (b) b.classList.add('hidden');
})();

/* 시작할 때 상태 표시 */
setFolderState(
  ghToken() ? 'GitHub 연결됨: ' + GH_OWNER + '/' + GH_REPO
            : 'GitHub 미연결 — [GitHub 연결]을 먼저 눌러주세요',
  !!ghToken()
);
