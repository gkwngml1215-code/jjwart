// 관리 도구 v2.1 발행 규칙 검증 — 실행: node tests/columns-core.test.js
// 어드민 제작 가이드의 "반드시 지켜야 할 것"과 v2.1에서 보강한 약점을 코드로 확인합니다.
// 이 파일은 전주점·강남점이 똑같습니다 (지점 값은 site-config.js 에서 읽습니다).
const assert = require('assert');
const C = require('../columns-core.js');

let failed = 0;
function test(name, fn){
  try { fn(); console.log('  ✓ ' + name); }
  catch (e) { failed++; console.error('  ✗ ' + name + '\n      ' + e.message); }
}

const DOMAIN = C.SITE.domain.replace(/\/$/, '');
const IMG = C.SITE.defaultImage;
const LIST_HTML = '<html><body>\n<div id="columnGrid">\n      <' + '!-- COLUMNS:START --' + '>\n\n      <' + '!-- COLUMNS:END --' + '>\n</div>\n<footer>그대로</footer></body></html>\n';
const LLMS = `# 후한의원\n\n> 소개\n\n## 원장 컬럼\n- [원장 컬럼 목록](${DOMAIN}/columns.html)\n\n## 병원 정보\n- 전화: 000\n`;
const SITEMAP = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n  <url>\n    <loc>${DOMAIN}/</loc>\n    <lastmod>2026-09-07</lastmod>\n    <changefreq>weekly</changefreq>\n    <priority>1.0</priority>\n  </url>\n</urlset>\n`;
const slugOf = n => 'column-' + String(n).padStart(2, '0');

// 저장소 최신본 흉내: 글 n개가 목록·페이지·원본값 파일로 모두 올라가 있는 상태
function makeSnap(n, opts){
  opts = opts || {};
  const index = [];
  const paths = new Map([['index.html', 'x'], ['columns.html', 'x'], [C.PATHS.index, 'x'], [IMG, 'img'], ['assets/images/a.jpg', 'img'], ['assets/images/b.jpg', 'img']]);
  for (let i = 1; i <= n; i++) {
    const slug = slugOf(i);
    index.push({slug, title: '글 ' + i, category: '편평사마귀', cardSummary: '요약 ' + i,
      image: IMG, datePublished: '2026-09-07', dateModified: '2026-09-07'});
    paths.set(C.PATHS.page(slug), 'page-' + i);
    paths.set(C.PATHS.data(slug), 'data-' + i);
  }
  (opts.extraPaths || []).forEach(p => paths.set(p, 'extra'));
  return {index, paths, texts: {list: C.replaceCards(LIST_HTML, C.buildColumnCards(index)), sitemap: SITEMAP, llms: LLMS}};
}

function draft(slug, title){
  return {slug, title: title || '새 글', category: '편평사마귀', cardSummary: '요약', description: '설명', keywords: '',
    datePublished: '2026-09-11', dateModified: '', image: IMG, schemaType: 'MedicalWebPage',
    body: '<p>첫 문단</p>\n<h2>소제목</h2>\n<p>둘째 문단</p>', bodyImages: []};
}

const files = plan => new Map(plan.changes.map(c => [c.path, c.content]));
const indexSlugs = plan => JSON.parse(files(plan).get(C.PATHS.index)).columns.map(c => c.slug);
const cardSlugs = plan => [...files(plan).get(C.PATHS.list).matchAll(/href="columns\/([^"]+)\.html"/g)].map(m => m[1]);
const TODAY = '2026-09-11';

console.log(`\n[${C.SITE.bizName} · ${C.VERSION}]`);
console.log('\n[1] 병합 발행 — 기존 목록을 지우고 새로 채우지 않는다');

test('새 글 추가: 기존 9개는 그대로, 1개만 늘어 10개', () => {
  const snap = makeSnap(9);
  const plan = C.planPublish(snap, {type: 'upsert', column: draft('column-10'), isNew: true}, TODAY);
  assert.strictEqual(plan.after.length, 10);
  assert.deepStrictEqual(indexSlugs(plan), snap.index.map(c => c.slug).concat('column-10'));
  assert.deepStrictEqual(cardSlugs(plan), indexSlugs(plan));
  assert.strictEqual(plan.summary.added.length, 1);
  assert.strictEqual(plan.summary.kept.length, 9);
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
    const plan = C.planPublish(snap, {type: 'upsert', column: draft(slug, '무작위 ' + t), isNew}, TODAY);
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

test('"index"·"data" 처럼 저장소의 다른 파일과 겹치는 파일명은 막는다', () => {
  assert.ok(C.validateColumn(draft('index')).errors.some(e => /쓸 수 없습니다/.test(e)));
  assert.ok(C.validateColumn(draft('data')).errors.some(e => /쓸 수 없습니다/.test(e)));
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

console.log('\n[5] 같은 글 두 번 올리기 방지');

test('이미 있는 글과 같은 제목의 새 글은 체크해야만 발행된다 (연결 끊김 뒤 재발행 상황)', () => {
  const snap = makeSnap(5);
  const plan = C.planPublish(snap, {type: 'upsert', column: draft('column-06', '글 3'), isNew: true}, TODAY);
  assert.ok(plan.warnings.some(w => w.needsAck && /같은 제목/.test(w.text)));
  const plan2 = C.planPublish(snap, {type: 'upsert', column: draft('column-06', '전혀 다른 제목'), isNew: true}, TODAY);
  assert.ok(!plan2.warnings.some(w => w.needsAck));
});

console.log('\n[6] 사진 — 저장소에 없는 사진으로는 발행하지 않는다');

test('대표 사진·본문 사진·본문 <img> 경로를 모두 모은다', () => {
  const col = Object.assign(draft('column-01'), {
    image: 'assets/images/a.jpg',
    bodyImages: [{src: 'assets/images/b.jpg', alt: '', caption: '', after: 0}, {src: 'https://cdn.example.com/x.jpg', alt: '', caption: '', after: 0}],
    body: '<p>글</p><img src="../assets/images/c.jpg"><img src="https://x.com/y.png">',
  });
  assert.deepStrictEqual(C.imagePaths(col).sort(), ['assets/images/a.jpg', 'assets/images/b.jpg', 'assets/images/c.jpg']);
});

test('없는 사진이 있으면 발행을 멈추고 어떤 사진인지 알려 준다 (강남 "성지" 글 사고 재현)', () => {
  const snap = makeSnap(3);
  const col = Object.assign(draft('column-04'), {image: 'assets/images/doctor-nobody.jpg'});
  assert.throws(() => C.planPublish(snap, {type: 'upsert', column: col, isNew: true}, TODAY), /홈페이지에 없는 사진[\s\S]*doctor-nobody\.jpg/);
  const ok = Object.assign(draft('column-04'), {bodyImages: [{src: 'assets/images/a.jpg', alt: 'a', caption: '', after: 0}]});
  assert.doesNotThrow(() => C.planPublish(snap, {type: 'upsert', column: ok, isNew: true}, TODAY));
});

console.log('\n[7] 본문 검사 / 자동 정리');

test('깨진 태그·여는 태그 없는 닫는 태그·안 닫힌 태그·금지 태그를 잡는다', () => {
  assert.ok(C.checkBodyHtml('<p>본문을 입력하세요.</<p>안녕</p>').errors.some(e => /깨진 태그/.test(e)));
  assert.ok(C.checkBodyHtml('<p>글</p></div>').errors.some(e => /여는 태그 없이/.test(e)));
  assert.ok(C.checkBodyHtml('<ul><li>하나</li>').errors.some(e => /닫히지 않은 태그.*<ul>/.test(e)));
  assert.ok(C.checkBodyHtml('<p>글</p><script>alert(1)</script>').errors.some(e => /넣을 수 없는 태그/.test(e)));
  assert.strictEqual(C.checkBodyHtml('<p>첫<br>줄<p>둘째<h2>소제목</h2><ul><li>하나<li>둘</ul>').errors.length, 0, '<p><li>는 안 닫아도 됨');
  assert.strictEqual(C.checkBodyHtml('<p>정상</p>\n<h2>소제목</h2>\n<p>글 <b>굵게</b></p>').errors.length, 0);
});

test('태그 없는 글·마크다운은 자동 정리 대상으로 알려 준다', () => {
  assert.ok(C.checkBodyHtml('그냥 글입니다.\n둘째 줄').errors.some(e => /HTML 형식이 아닙니다/.test(e)));
  assert.ok(C.checkBodyHtml('<p>글</p>\n태그 밖 글').warnings.some(w => /태그 밖에 놓인 글/.test(w)));
  assert.ok(C.checkBodyHtml('<p>## 소제목</p><p>**굵게**</p>').warnings.some(w => /마크다운/.test(w)));
  assert.ok(C.checkBodyHtml('<h1>제목</h1><p>글</p>').warnings.some(w => /<h1>/.test(w)));
});

test('자동 정리: 코드 표시·안내 문구를 지우고 마크다운을 문단·소제목·목록으로 바꾼다', () => {
  const out = C.tidyBody('```html\n<p>본문을 입력하세요.</<p>안녕하세요.</p>\n```');
  assert.strictEqual(out, '<p>안녕하세요.</p>');
  const md = C.tidyBody('안녕하세요.\n둘째 줄\n\n## 왜 생길까요\n- 하나\n- 둘\n\n1. 첫째\n2. 둘째\n\n**굵게** 마무리');
  assert.ok(md.includes('<p>안녕하세요.<br>\n둘째 줄</p>'));
  assert.ok(md.includes('<h2>왜 생길까요</h2>'));
  assert.ok(md.includes('<ul>\n<li>하나</li>\n<li>둘</li>\n</ul>'));
  assert.ok(md.includes('<ol>\n<li>첫째</li>\n<li>둘째</li>\n</ol>'));
  assert.ok(md.includes('<p><b>굵게</b> 마무리</p>'));
  assert.strictEqual(C.checkBodyHtml(md).errors.length, 0);
  const mixed = C.tidyBody('<p>정상</p>\n태그 밖 글');
  assert.strictEqual(mixed, '<p>정상</p>\n\n<p>태그 밖 글</p>');
  const same = '<p>이미 정상</p>\n\n<h2>소제목</h2>';
  assert.strictEqual(C.tidyBody(same), same);
});

test('발행 전 검사가 본문 문제를 함께 알려 준다', () => {
  const bad = Object.assign(draft('column-01'), {body: '<p>글</p></div>'});
  assert.ok(C.validateColumn(bad).errors.some(e => /여는 태그 없이/.test(e)));
  assert.ok(C.validateColumn(Object.assign(draft('column-01'), {title: '  '})).errors.length);
  assert.ok(C.validateColumn(draft('column-01', '새 컬럼 제목')).errors.length);
  assert.ok(C.validateColumn(Object.assign(draft('column-01'), {body: ''})).errors.length);
  assert.ok(C.validateColumn(Object.assign(draft('column-01'), {body: '<p>본문을 입력하세요.</p><p>글</p>'})).errors.length);
  assert.ok(C.validateColumn(Object.assign(draft('column-01'), {body: '```html\n<p>글</p>\n```'})).errors.length);
  assert.ok(C.validateColumn(Object.assign(draft('Column 01'))).errors.length);
  assert.strictEqual(C.validateColumn(draft('column-01')).errors.length, 0);
});

console.log('\n[8] 함께 바뀌는 파일 — 다른 내용은 보존');

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

console.log('\n[9] 페이지 왕복 / 지점 값');

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

test('페이지에 이 지점의 주소·전화·카카오·저작권이 들어간다 (다른 지점 값 섞임 없음)', () => {
  const page = C.buildColumnPage(C.normalizeColumn(draft('column-01')));
  assert.ok(page.includes(`${DOMAIN}/columns/column-01.html`));
  assert.ok(page.includes('tel:' + C.SITE.phone));
  assert.ok(page.includes(C.SITE.kakaoUrl));
  assert.ok(page.includes('CLINIC ' + C.SITE.copyright + '.'));
  assert.ok(page.includes(C.SITE.doctor + ' 대표원장'));
  const others = {'jjwart': ['gnhoowart', '강남점', '홍진우', '_LYNVu'], 'gnwart': ['jjhoowart', '전주점', '허정위', '_triUj']}[C.SITE.github.repo] || [];
  others.forEach(s => assert.ok(!page.includes(s), '다른 지점 값이 섞임: ' + s));
});

console.log(failed ? `\n실패 ${failed}건\n` : '\n모두 통과\n');
process.exitCode = failed ? 1 : 0;
