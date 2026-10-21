// 원장 컬럼 자동 점검 — GitHub Actions 가 main 브랜치에 무언가 올라올 때마다, 그리고 매일 한 번 실행합니다.
// 관리 도구가 아닌 다른 경로(손으로 올림, 옛 도구 등)로 목록이 망가져도 바로 알 수 있게 합니다.
// 문제가 있으면 실패(빨간 X)로 끝나고, GitHub 가 저장소 주인에게 메일을 보냅니다.
//
// 확인하는 것
//   · columns/index.json 이 읽히고 파일명이 겹치지 않는지
//   · 목록의 글마다 페이지(.html)·원본값(.json)이 있고, 제목·주소가 맞는지
//   · "새 컬럼 제목"·"본문을 입력하세요"·``` 같은 흔적이 없는지
//   · 글에 쓰인 사진이 실제로 있는지
//   · columns.html 카드 순서, sitemap.xml, llms.txt 가 목록과 같은지
//   · 직전 커밋보다 글 개수가 줄었는데 "컬럼 삭제" 발행이 아닌지  ← v1 사고와 같은 상황
//   · (GEO) 사진 alt 지역 키워드 · 예약/소급 날짜 흔적 · 주소의 날짜 · geo-v1 글의 구조
const fs = require('fs');
const path = require('path');
const {execSync} = require('child_process');

const root = process.cwd();
const read = p => fs.readFileSync(path.join(root, p), 'utf8').replace(/\r\n/g, '\n');
const exists = p => fs.existsSync(path.join(root, p));
const unesc = s => String(s || '').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
const domain = 'https://' + read('CNAME').trim();
const problems = [], warnings = [];

let columns;
try {
  columns = JSON.parse(read('columns/index.json')).columns;
  if (!Array.isArray(columns)) throw new Error('columns 배열이 없음');
} catch (e) {
  problems.push('columns/index.json 을 읽을 수 없습니다: ' + e.message);
}

if (columns) {
  const seen = new Set();
  const images = new Set();
  columns.forEach(c => {
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(c.slug || '')) problems.push(`목록에 잘못된 파일명: ${JSON.stringify(c.slug)}`);
    if (seen.has(c.slug)) problems.push(`목록에 같은 파일명이 두 번: ${c.slug}`);
    seen.add(c.slug);
    if (!c.title || /새 컬럼 제목/.test(c.title)) problems.push(`${c.slug}: 제목이 비었거나 "새 컬럼 제목"입니다`);
    if (c.image) images.add(c.image.replace(/^\//, ''));

    const page = `columns/${c.slug}.html`;
    if (!exists(page)) { problems.push(`${c.slug}: 페이지 파일이 없습니다 (${page})`); return; }
    if (!exists(`columns/data/${c.slug}.json`)) warnings.push(`${c.slug}: 원본값 파일(columns/data/${c.slug}.json)이 없습니다 — 관리 도구에서 다시 발행하면 생깁니다`);
    const html = read(page);
    const h1 = unesc(((/<h1[^>]*>([^<]*)/.exec(html) || [])[1] || '')).trim();
    if (h1 !== String(c.title).trim()) problems.push(`${c.slug}: 페이지 제목("${h1}")이 목록 제목("${c.title}")과 다릅니다`);
    if (!html.includes(`${domain}/columns/${c.slug}.html`)) problems.push(`${c.slug}: 페이지 안의 주소(canonical)가 자기 주소가 아닙니다`);
    if (/새 컬럼 제목|본문을 입력하세요|```/.test(html)) problems.push(`${c.slug}: 페이지에 "새 컬럼 제목"·"본문을 입력하세요"·\`\`\` 흔적이 남아 있습니다`);
    [...html.matchAll(/(?:src|href)="\.\.\/(assets\/images\/[^"]+)"/g)].forEach(m => images.add(m[1]));
  });
  images.forEach(p => { if (!exists(p)) problems.push(`없는 사진을 가리킵니다: ${p}`); });

  const slugs = columns.map(c => c.slug);
  const listHtml = read('columns.html');
  const cards = [...listHtml.matchAll(/href="columns\/([^"]+)\.html"/g)].map(m => m[1]);
  if (cards.join() !== slugs.join()) problems.push(`columns.html 카드(${cards.length}개: ${cards.join(', ')})가 목록(${slugs.length}개: ${slugs.join(', ')})과 다릅니다`);

  const sitemap = read('sitemap.xml');
  const smap = [...sitemap.matchAll(/\/columns\/([^/<]+)\.html</g)].map(m => m[1]).sort();
  if (smap.join() !== slugs.slice().sort().join()) problems.push(`sitemap.xml 의 컬럼 주소(${smap.length}개)가 목록과 다릅니다`);

  if (exists('llms.txt')) {
    const llms = read('llms.txt');
    const lcols = [...llms.matchAll(/\/columns\/([^/()]+)\.html\)/g)].map(m => m[1]).sort();
    if (lcols.join() !== slugs.slice().sort().join()) problems.push(`llms.txt 의 컬럼(${lcols.length}개)이 목록과 다릅니다`);
  }

  // 목록에 없는 컬럼 파일 — 지우지는 않지만 알려 준다
  fs.readdirSync(path.join(root, 'columns')).filter(f => /^[^/]+\.html$/.test(f)).forEach(f => {
    const slug = f.replace(/\.html$/, '');
    if (!seen.has(slug)) warnings.push(`목록에 없는 컬럼 파일이 있습니다: columns/${f} (홈페이지 목록에는 안 보입니다)`);
  });

  // 직전 커밋과 비교: 글이 줄었는데 삭제 발행이 아니면 사고 가능성
  try {
    const prev = JSON.parse(execSync('git show HEAD~1:columns/index.json', {stdio: ['ignore', 'pipe', 'ignore']}).toString('utf8')).columns;
    const msg = execSync('git log -1 --format=%s', {stdio: ['ignore', 'pipe', 'ignore']}).toString('utf8').trim();
    const gone = prev.map(c => c.slug).filter(s => !seen.has(s));
    if (gone.length && !/^컬럼 삭제/.test(msg)) {
      problems.push(`직전 커밋에 있던 글이 사라졌습니다: ${gone.join(', ')} — 그런데 이번 커밋("${msg}")은 [삭제] 발행이 아닙니다. 관리 도구 v1 같은 덮어쓰기가 의심됩니다.`);
    }
  } catch (e) { /* 첫 커밋이거나 직전에 index.json 이 없던 경우 */ }
}

// ---- GEO 점검 ----
//   · 모든 페이지의 사진 alt 에 지역 키워드(.github/geo.json 의 region)가 있는지
//   · 발행일이 미래(예약 흔적)이거나 수정일이 발행일보다 앞선 글이 없는지, 주소에 날짜가 없는지
//   · GEO 원칙(geo-v1)으로 쓴 글이 질문형 H2 8개·비교표 2개·참고자료 3개·FAQ 6개를 지키는지
const geoCfg = exists('.github/geo.json') ? JSON.parse(read('.github/geo.json')) : {};
const regionKw = geoCfg.region || '';
const strip = h => unesc(String(h || '').replace(/<[^>]*>/g, '')).replace(/\s+/g, ' ').trim();
if (regionKw) {
  const pages = ['index.html', 'columns.html'].concat(
    exists('columns') ? fs.readdirSync(path.join(root, 'columns')).filter(f => f.endsWith('.html')).map(f => 'columns/' + f) : []);
  pages.filter(exists).forEach(p => {
    const html = read(p);
    [...html.matchAll(/<img\b[^>]*>/gi)].forEach(m => {
      const alt = unesc(((/\salt="([^"]*)"/i.exec(m[0]) || [])[1] || ''));
      if (alt.indexOf(regionKw) < 0) problems.push(`${p}: 사진 alt 에 지역 키워드 "${regionKw}"가 없습니다 → "${alt || '(alt 없음)'}"`);
    });
  });
}
const todayKST = new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);
(columns || []).forEach(c => {
  if (/\d{4}-?\d{2}-?\d{2}/.test(c.slug)) problems.push(`${c.slug}: 주소에 날짜가 들어 있습니다`);
  if (c.datePublished > todayKST) problems.push(`${c.slug}: 발행일(${c.datePublished})이 미래입니다 — 예약 발행 흔적`);
  if (c.dateModified && c.dateModified < c.datePublished) problems.push(`${c.slug}: 수정일(${c.dateModified})이 발행일(${c.datePublished})보다 앞섭니다`);
  const dp = `columns/data/${c.slug}.json`;
  if (!exists(dp)) return;
  let d; try { d = JSON.parse(read(dp)); } catch (e) { problems.push(`${dp}: 형식 오류`); return; }
  if (d.format !== 'geo-v1') return;
  const q = s => /\?\s*$/.test(strip(s));
  const h2 = [...String(d.body || '').matchAll(/<h2\b[^>]*>([\s\S]*?)<\/h2>/gi)].map(m => strip(m[1]));
  if (!q(d.title)) problems.push(`${c.slug}: 제목이 질문형이 아닙니다`);
  if (h2.length !== 8 || !h2.every(q)) problems.push(`${c.slug}: 질문형 H2 8개가 아닙니다 (${h2.length}개)`);
  const tables = (String(d.body || '').match(/<table\b/gi) || []).length;
  if (tables !== 2) problems.push(`${c.slug}: 비교표가 2개가 아닙니다 (${tables}개)`);
  if ((d.references || []).length !== 3) problems.push(`${c.slug}: 참고자료가 3개가 아닙니다`);
  if ((d.faqs || []).length !== 6) problems.push(`${c.slug}: FAQ가 6개가 아닙니다`);
  const html = exists(`columns/${c.slug}.html`) ? read(`columns/${c.slug}.html`) : '';
  if (html && !/class="geo-reviewer"/.test(html)) problems.push(`${c.slug}: 감수 원장 박스가 없습니다`);
  if (html && !/class="geo-modified"/.test(html)) problems.push(`${c.slug}: 최종 수정일 표시가 없습니다`);
  if (html && !/"@type": "FAQPage"/.test(html)) problems.push(`${c.slug}: FAQPage 구조화 데이터가 없습니다`);
});

warnings.forEach(w => console.log('::warning::' + w));
problems.forEach(p => console.log('::error::' + p));
if (problems.length) {
  console.log(`\n✗ 문제 ${problems.length}건 — 홈페이지 컬럼 목록이 어긋나 있습니다. 관리 도구로 다시 발행하거나 git 기록에서 되돌려 주세요.`);
  process.exit(1);
}
console.log(`✓ 컬럼 ${columns.length}편 — 목록·페이지·사진·sitemap·llms 모두 일치${warnings.length ? ` (주의 ${warnings.length}건)` : ''}`);
