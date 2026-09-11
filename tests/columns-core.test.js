// 관리 도구 v2 발행 규칙 검증 — 실행: node tests/columns-core.test.js
// 어드민 제작 가이드의 "반드시 지켜야 할 것"을 코드로 확인합니다.
const assert = require('assert');
const C = require('../columns-core.js');

let failed = 0;
function test(name, fn){
  try { fn(); console.log('  ✓ ' + name); }
  catch (e) { failed++; console.error('  ✗ ' + name + '\n      ' + e.message); }
}

const DOMAIN = C.SITE.domain.replace(/\/$/, '');
const LIST_HTML = '<html><body>\n<div id="columnGrid">\n      <' + '!-- COLUMNS:START --' + '>\n\n      <' + '!-- COLUMNS:END --' + '>\n</div>\n<footer>그대로</footer></body></html>\n';
const LLMS = `# 후한의원\n\n> 소개\n\n## 원장 컬럼\n- [원장 컬럼 목록](${DOMAIN}/columns.html)\n\n## 병원 정보\n- 전화: 000\n`;
const SITEMAP = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n  <url>\n    <loc>${DOMAIN}/</loc>\n    <lastmod>2026-09-07</lastmod>\n    <changefreq>weekly</changefreq>\n    <priority>1.0</priority>\n  </url>\n</urlset>\n`;
const slugOf = n => 'column-' + String(n).padStart(2, '0');

// 저장소 최신본 흉내: 글 n개가 목록·페이지·원본값 파일로 모두 올라가 있는 상태
function makeSnap(n, opts){
  opts = opts || {};
  const index = [];
  const paths = new Map([['index.html', 'x'], ['columns.html', 'x'], [C.PATHS.index, 'x']]);
  for (let i = 1; i <= n; i++) {
    const slug = slugOf(i);
    index.push({slug, title: '글 ' + i, category: '편평사마귀', cardSummary: '요약 ' + i,
      image: 'assets/images/doctor-heo.jpg', datePublished: '2026-09-07', dateModified: '2026-09-07'});
    paths.set(C.PATHS.page(slug), 'page-' + i);
    paths.set(C.PATHS.data(slug), 'data-' + i);
  }
  (opts.extraPaths || []).forEach(p => paths.set(p, 'extra'));
  return {index, paths, texts: {list: C.replaceCards(LIST_HTML, C.buildColumnCards(index)), sitemap: SITEMAP, llms: LLMS}};
}

function draft(slug, title){
  return {slug, title: title || '새 글', category: '편평사마귀', cardSummary: '요약', description: '설명', keywords: '',
    datePublished: '2026-09-11', dateModified: '', image: 'assets/images/doctor-heo.jpg', schemaType: 'MedicalWebPage',
    body: '<p>첫 문단</p>\n<h2>소제목</h2>\n<p>둘째 문단</p>', bodyImages: []};
}

const files = plan => new Map(plan.changes.map(c => [c.path, c.content]));
const indexSlugs = plan => JSON.parse(files(plan).get(C.PATHS.index)).columns.map(c => c.slug);
const cardSlugs = plan => [...files(plan).get(C.PATHS.list).matchAll(/href="columns\/([^"]+)\.html"/g)].map(m => m[1]);
const TODAY = '2026-09-11';

console.log('\n[1] 병합 발행 — 기존 목록을 지우고 새로 채우지 않는다');

test('새 글 추가: 기존 9개는 그대로, 1개만 늘어 10개', () => {
  const snap = makeSnap(9);
  const plan = C.planPublish(snap, {type: 'upsert', column: draft('column-10'), isNew: true}, TODAY);
  assert.strictEqual(plan.after.length, 10);
  assert.deepStrictEqual(indexSlugs(plan), snap.index.map(c => c.slug).concat('column-10'));
  assert.deepStrictEqual(cardSlugs(plan), indexSlugs(plan));
  assert.strictEqual(plan.summary.added.length, 1);
  assert.strictEqual(plan.summary.kept.length, 9);
  // 다른 글의 페이지 파일은 건드리지 않는다
  const pages = plan.changes.filter(c => /^columns\/column-\d+\.html$/.test(c.path)).map(c => c.path);
  assert.deepStrictEqual(pages, ['columns/column-10.html']);
});

test('기존 글 수정: 개수 그대로, 그 글만 수정되고 나머지는 유지', () => {
  const snap = makeSnap(9);
  const col = draft('column-04', '고친 제목');
  const plan = C.planPublish(snap, {type: 'upsert', column: col, isNew: false, baseSha: 'data-4'}, TODAY);
  assert.strictEqual(plan.after.length, 9);
  assert.deepStrictEqual(plan.summary.updated.map(c => c.slug), ['column-04']);
  assert.strictEqual(plan.summary.kept.length, 8);
  assert.strictEqual(plan.after.find(c => c.slug === 'column-04').title, '고친 제목');
  assert.strictEqual(plan.after.find(c => c.slug === 'column-04').dateModified, TODAY);
  assert.deepStrictEqual(plan.after.filter(c => c.slug !== 'column-04'), snap.index.filter(c => c.slug !== 'column-04'));
  assert.strictEqual(plan.warnings.filter(w => w.needsAck).length, 0);
});

test('upsert 발행으로는 어떤 경우에도 목록이 줄지 않는다 (무작위 1000회)', () => {
  let seed = 7;
  const rnd = k => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed % k; };
  for (let t = 0; t < 1000; t++) {
    const snap = makeSnap(rnd(15), {extraPaths: rnd(3) ? [] : [C.PATHS.page(slugOf(20 + rnd(5)))]});
    const isNew = !snap.index.length || rnd(2) === 0;
    const slug = isNew ? slugOf(1 + rnd(25)) : snap.index[rnd(snap.index.length)].slug;
    const plan = C.planPublish(snap, {type: 'upsert', column: draft(slug), isNew}, TODAY);
    const after = new Set(plan.after.map(c => c.slug));
    snap.index.forEach(c => assert.ok(after.has(c.slug), c.slug + ' 가 빠짐'));
    assert.strictEqual(plan.after.length, snap.index.length + (isNew ? 1 : 0));
    assert.strictEqual(after.size, plan.after.length, '파일명 중복');
  }
});

console.log('\n[2] 새 글 파일명 — 배포된 파일과 절대 겹치지 않는다');

test('v1 사고 재현: 다른 브라우저가 "로컬 개수+1" 로 column-04 를 만들어도 덮어쓰지 않고 column-10 으로 올린다', () => {
  const snap = makeSnap(9);
  const plan = C.planPublish(snap, {type: 'upsert', column: draft('column-04'), isNew: true}, TODAY);
  assert.strictEqual(plan.column.slug, 'column-10');
  assert.strictEqual(plan.summary.renamedFrom, 'column-04');
  assert.ok(!files(plan).has('columns/column-04.html'), 'column-04.html 을 덮어쓰면 안 됨');
  assert.ok(files(plan).has('columns/column-10.html'));
  assert.strictEqual(plan.after.length, 10);
});

test('목록에 없는 파일(손으로 올린 페이지)도 번호 계산에 넣고, 지우지 않고 알려만 준다', () => {
  const snap = makeSnap(3, {extraPaths: ['columns/column-09.html']});
  const taken = C.collectSlugs(snap.paths.keys(), snap.index);
  assert.strictEqual(C.nextSlug(taken), 'column-10');
  const plan = C.planPublish(snap, {type: 'upsert', column: draft('column-09'), isNew: true}, TODAY);
  assert.strictEqual(plan.column.slug, 'column-10');
  assert.ok(plan.warnings.some(w => /목록에 없는 컬럼 파일/.test(w.text)));
  assert.ok(!plan.changes.some(c => c.content == null), '아무것도 삭제하면 안 됨');
});

test('비어 있는 번호를 다시 쓰지 않는다 (01·02·07 → 08)', () => {
  assert.strictEqual(C.nextSlug(new Set(['column-01', 'column-02', 'column-07'])), 'column-08');
});

test('아직 발행 안 한 다른 새 글의 파일명과도 겹치지 않는다', () => {
  const snap = makeSnap(9);
  const plan = C.planPublish(snap, {type: 'upsert', column: draft('column-05'), isNew: true, reservedSlugs: ['column-10']}, TODAY);
  assert.strictEqual(plan.column.slug, 'column-11');
});

console.log('\n[3] 삭제 — [삭제]를 눌렀을 때만');

test('삭제 작업: 그 글만 빠지고(9→8) 그 글의 파일만 지운다', () => {
  const snap = makeSnap(9);
  const plan = C.planPublish(snap, {type: 'delete', slug: 'column-05'}, TODAY);
  assert.strictEqual(plan.after.length, 8);
  assert.ok(!indexSlugs(plan).includes('column-05'));
  const removed = plan.changes.filter(c => c.content == null).map(c => c.path).sort();
  assert.deepStrictEqual(removed, ['columns/column-05.html', 'columns/data/column-05.json']);
  assert.deepStrictEqual(plan.summary.deleted.map(c => c.slug), ['column-05']);
});

test('홈페이지 목록에 없는 글을 "수정"으로 발행하면 멈춘다 (새로 끼워 넣지 않음)', () => {
  const snap = makeSnap(3);
  assert.throws(() => C.planPublish(snap, {type: 'upsert', column: draft('column-07'), isNew: false}, TODAY), /목록에 없습니다/);
});

console.log('\n[4] 원본은 저장소 — 목록 파일이 없거나 깨지면 새로 만들지 않는다');

test('index.json 이 깨졌거나, columns 가 없거나, 파일명이 겹치면 멈춘다', () => {
  assert.throws(() => C.parseIndex('not json'), /형식 오류/);
  assert.throws(() => C.parseIndex('{}'), /columns 목록이 없습니다/);
  assert.throws(() => C.parseIndex(JSON.stringify({columns: [{slug: 'column-01'}, {slug: 'column-01'}]})), /두 번/);
});

test('편집을 시작한 뒤 다른 곳에서 먼저 수정했으면 체크해야만 발행된다', () => {
  const snap = makeSnap(5);
  const plan = C.planPublish(snap, {type: 'upsert', column: draft('column-02'), isNew: false, baseSha: 'data-2-옛날'}, TODAY);
  assert.ok(plan.warnings.some(w => w.needsAck));
});

console.log('\n[5] 함께 바뀌는 파일 — 다른 내용은 보존');

test('sitemap: 컬럼이 아닌 주소는 그대로, 목록에서 빠진 옛 컬럼 주소는 정리', () => {
  const xml = SITEMAP.replace('</urlset>', `  <url>\n    <loc>${DOMAIN}/event.html</loc>\n    <lastmod>2026-01-01</lastmod>\n  </url>\n  <url>\n    <loc>${DOMAIN}/columns/column-99.html</loc>\n    <lastmod>2026-01-01</lastmod>\n  </url>\n</urlset>`);
  const out = C.mergeSitemap(xml, makeSnap(2).index, TODAY);
  assert.ok(out.includes(`<loc>${DOMAIN}/</loc>`));
  assert.ok(out.includes(`<loc>${DOMAIN}/event.html</loc>`));
  assert.ok(!out.includes('column-99'));
  assert.ok(out.includes('column-01') && out.includes('column-02'));
  assert.ok(out.includes(`<loc>${DOMAIN}/columns.html</loc>\n    <lastmod>${TODAY}</lastmod>`));
});

test('llms.txt: "## 원장 컬럼" 구역의 컬럼 줄만 바꾸고 다른 구역은 그대로', () => {
  const out = C.mergeLlms(LLMS, makeSnap(2).index);
  assert.ok(out.startsWith('# 후한의원\n\n> 소개\n'));
  assert.ok(out.includes(`- [원장 컬럼 목록](${DOMAIN}/columns.html)`));
  assert.ok(out.includes(`- [글 2](${DOMAIN}/columns/column-02.html): 요약 2`));
  assert.ok(out.endsWith('## 병원 정보\n- 전화: 000\n'));
  assert.strictEqual(C.mergeLlms(out, makeSnap(2).index), out, '두 번 해도 같아야 함');
});

test('columns.html: 표식 밖은 그대로, 요약 속 "$&" 같은 글자도 안전', () => {
  const list = [{slug: 'column-01', title: 'A', category: 'x', cardSummary: '할인 $& 50% $1', image: 'a.jpg', datePublished: '2026-09-11'}];
  const out = C.replaceCards(LIST_HTML, C.buildColumnCards(list));
  assert.ok(out.includes('할인 $&amp; 50% $1'));
  assert.ok(out.endsWith('<footer>그대로</footer></body></html>\n'));
  assert.throws(() => C.replaceCards('<html></html>', ''), /표식/);
});

console.log('\n[6] 발행 전 검사 / 페이지 왕복');

test('제목·본문이 비었거나, 안내 문구·``` 가 남아 있으면 막는다', () => {
  assert.ok(C.validateColumn(Object.assign(draft('column-01'), {title: '  '})).errors.length);
  assert.ok(C.validateColumn(draft('column-01', '새 컬럼 제목')).errors.length);
  assert.ok(C.validateColumn(Object.assign(draft('column-01'), {body: ''})).errors.length);
  assert.ok(C.validateColumn(Object.assign(draft('column-01'), {body: '<p>본문을 입력하세요.</p><p>글</p>'})).errors.length);
  assert.ok(C.validateColumn(Object.assign(draft('column-01'), {body: '```html\n<p>글</p>\n```'})).errors.length);
  assert.ok(C.validateColumn(Object.assign(draft('Column 01'))).errors.length);
  assert.strictEqual(C.validateColumn(draft('column-01')).errors.length, 0);
});

test('본문 중간 사진: 페이지 → 원본값 → 페이지 가 똑같이 되돌아온다', () => {
  const col = C.normalizeColumn(Object.assign(draft('column-03'), {
    bodyImages: [
      {src: 'assets/images/a.jpg', alt: '맨 앞 사진', caption: '', after: -1},
      {src: 'assets/images/b.jpg', alt: '첫 문단 뒤', caption: '캡션', after: 0},
    ],
  }));
  const page = C.buildColumnPage(col);
  const back = C.parseColumnHtml(page, 'column-03');
  assert.deepStrictEqual(back.bodyImages, col.bodyImages);
  assert.strictEqual(C.buildColumnPage(Object.assign(back, {cardSummary: col.cardSummary})), page);
});

console.log(failed ? `\n실패 ${failed}건\n` : '\n모두 통과\n');
process.exitCode = failed ? 1 : 0;
