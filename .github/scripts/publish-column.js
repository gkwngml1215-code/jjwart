// 원장 컬럼 명령줄 발행 — 관리 도구(admin 브랜치)와 똑같은 엔진(columns-core.js)으로 페이지를 만듭니다.
//
//   새 글 발행 : node .github/scripts/publish-column.js <원고.json>
//   검사만     : node .github/scripts/publish-column.js <원고.json> --check
//   전체 재생성: node .github/scripts/publish-column.js --rerender   (글 내용·날짜는 그대로, 새 템플릿만 반영)
//
// 지키는 약속
//   · 목록 원본은 columns/index.json — 파일명(slug) 기준 병합, 다른 글은 절대 빠지지 않음
//   · 새 글 발행일 = 수정일 = 오늘(한국 시간). 미래·과거 날짜는 쓰지 않음
//   · GEO 작성원칙(geo-v1) 검사를 통과하지 못하면 아무 파일도 바꾸지 않고 멈춤
//
// 원고.json 형식 (필수: slug, title, summary, body, references, faqs)
//   { "format": "geo-v1", "slug": "flat-wart-spread-reason", "title": "…?", "category": "편평사마귀",
//     "cardSummary": "…", "description": "…", "keywords": "…", "image": "assets/images/…", "imageAlt": "…",
//     "summary": ["…", "…"], "body": "<p>…</p><h2>…?</h2>…", "references": [{source,title,url}×3], "faqs": [{q,a}×6],
//     "bodyImages": [] }
const fs = require('fs');
const os = require('os');
const path = require('path');
const {execFileSync} = require('child_process');

const root = process.cwd();
const args = process.argv.slice(2);
const flags = new Set(args.filter(a => a.startsWith('--')));
const file = args.find(a => !a.startsWith('--'));

function loadCore(){
  // 시험용: HOO_CORE_DIR=<관리 도구 폴더> 로 아직 올리지 않은 엔진을 쓸 수 있다
  if (process.env.HOO_CORE_DIR) return require(path.resolve(process.env.HOO_CORE_DIR, 'columns-core.js'));
  // admin 브랜치의 최신 엔진을 임시 폴더에 꺼내 쓴다 (엔진이 두 군데로 갈라지지 않게)
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hoo-core-'));
  // 얕은 복제(--depth 1)에는 admin 브랜치가 없을 수 있어 먼저 받아 둔다
  try { execFileSync('git', ['fetch', '-q', '--depth', '1', 'origin', 'admin:refs/remotes/origin/admin'], {cwd: root, stdio: 'ignore'}); } catch (e) { /* 오프라인이면 있는 것으로 */ }
  const show = f => {
    for (const ref of ['origin/admin', 'admin']) {
      try { return execFileSync('git', ['show', `${ref}:${f}`], {cwd: root, stdio: ['ignore', 'pipe', 'ignore']}); } catch (e) { /* 다음 */ }
    }
    throw new Error(`admin 브랜치에서 ${f} 를 찾지 못했습니다. 먼저  git fetch origin admin  을 실행하세요.`);
  };
  for (const f of ['site-config.js', 'columns-core.js']) fs.writeFileSync(path.join(dir, f), show(f));
  return require(path.join(dir, 'columns-core.js'));
}

const C = loadCore();
const read = p => fs.readFileSync(path.join(root, p), 'utf8');
const write = (p, content) => {
  const abs = path.join(root, p);
  if (content == null) { if (fs.existsSync(abs)) fs.unlinkSync(abs); return; }
  fs.mkdirSync(path.dirname(abs), {recursive: true});
  fs.writeFileSync(abs, content);
};
const todayKST = () => new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);

function listFiles(dir, base){
  const out = [];
  for (const e of fs.readdirSync(path.join(root, dir), {withFileTypes: true})) {
    if (e.name === '.git' || e.name === 'node_modules') continue;
    const rel = dir === '.' ? e.name : `${dir}/${e.name}`;
    if (e.isDirectory()) out.push(...listFiles(rel));
    else out.push(rel);
  }
  return out;
}

function snapshot(){
  const paths = new Map(listFiles('.').map(p => [p, 'local']));
  return {
    index: C.parseIndex(read(C.PATHS.index)),
    paths,
    texts: {
      list: read(C.PATHS.list),
      sitemap: read(C.PATHS.sitemap),
      llms: fs.existsSync(path.join(root, C.PATHS.llms)) ? read(C.PATHS.llms) : null,
    },
  };
}

function fail(msg){ console.error('✗ ' + msg); process.exit(1); }

if (flags.has('--rerender')) {
  // 글 내용과 날짜는 그대로 두고 페이지·목록·sitemap·llms 만 새 템플릿으로 다시 만든다
  const snap = snapshot();
  const list = C.sortNewest(snap.index);
  let n = 0;
  list.forEach(card => {
    const dataPath = C.PATHS.data(card.slug);
    let col;
    if (fs.existsSync(path.join(root, dataPath))) col = C.normalizeColumn(JSON.parse(read(dataPath)));
    else col = C.parseColumnHtml(read(C.PATHS.page(card.slug)), card.slug);
    col.cardSummary = col.cardSummary || card.cardSummary;
    // 수정일이 발행일보다 앞선 기록은 발행일로 맞춘다
    if (!col.dateModified || col.dateModified < col.datePublished) col.dateModified = col.datePublished;
    write(C.PATHS.page(col.slug), C.buildColumnPage(col));
    write(dataPath, C.serializeData(col));
    n++;
  });
  const fixed = list.map(c => Object.assign({}, c, {dateModified: c.dateModified && c.dateModified > c.datePublished ? c.dateModified : c.datePublished}));
  write(C.PATHS.index, C.serializeIndex(fixed));
  write(C.PATHS.list, C.replaceCards(snap.texts.list, C.buildColumnCards(fixed)));
  // sitemap 의 목록 페이지 날짜는 가장 최근 글 기준 (오늘 날짜로 바꾸지 않음)
  const newest = fixed.map(c => c.dateModified).sort().pop() || todayKST();
  write(C.PATHS.sitemap, C.mergeSitemap(snap.texts.sitemap, fixed, newest));
  if (snap.texts.llms != null) write(C.PATHS.llms, C.mergeLlms(snap.texts.llms, fixed));
  console.log(`✓ ${n}편 다시 만듦 (${C.SITE.bizName} · 엔진 ${C.VERSION})`);
  process.exit(0);
}

if (!file) fail('원고 JSON 파일 경로를 주세요.  예: node .github/scripts/publish-column.js draft.json');
let draft;
try { draft = JSON.parse(fs.readFileSync(path.resolve(file), 'utf8')); } catch (e) { fail('원고 JSON 을 읽을 수 없습니다: ' + e.message); }
draft.format = draft.format || C.GEO.FORMAT;
const today = todayKST();
draft.datePublished = today;
draft.dateModified = today;
draft.image = draft.image || C.SITE.defaultImage;
draft.schemaType = draft.schemaType || 'MedicalWebPage';

const v = C.validateColumn(draft);
v.warnings.forEach(w => console.log('⚠ ' + w));
if (v.errors.length) {
  v.errors.forEach(e => console.error('✗ ' + e));
  fail(`검사 실패 ${v.errors.length}건 — 아무 파일도 바꾸지 않았습니다.`);
}

const snap = snapshot();
if (snap.index.some(c => c.slug === draft.slug)) fail(`파일명 ${draft.slug} 은(는) 이미 있습니다. 다른 파일명을 쓰세요.`);
if (snap.index.some(c => C.flat(c.title) === C.flat(draft.title))) fail('같은 제목의 글이 이미 있습니다.');
const plan = C.planPublish(snap, {type: 'upsert', column: draft, isNew: true}, today);
plan.warnings.forEach(w => console.log('⚠ ' + w.text));

const page = plan.changes.find(c => c.path === C.PATHS.page(plan.column.slug)).content;
const missingAlt = C.altsMissingRegion(page);
if (missingAlt.length) fail('지역 키워드가 없는 alt: ' + missingAlt.join(', '));

if (flags.has('--check')) {
  console.log(`✓ 검사 통과 — ${plan.column.slug} "${plan.column.title}" (바꾼 파일 없음)`);
  process.exit(0);
}
plan.changes.forEach(c => write(c.path, c.content));
console.log(`✓ 발행 준비 완료: columns/${plan.column.slug}.html · 목록 ${plan.before.length} → ${plan.after.length}편 · 발행일 ${today}`);
console.log(`  커밋 메시지: 컬럼 발행: ${plan.column.slug} ${plan.column.title}`);
