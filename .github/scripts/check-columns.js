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

warnings.forEach(w => console.log('::warning::' + w));
problems.forEach(p => console.log('::error::' + p));
if (problems.length) {
  console.log(`\n✗ 문제 ${problems.length}건 — 홈페이지 컬럼 목록이 어긋나 있습니다. 관리 도구로 다시 발행하거나 git 기록에서 되돌려 주세요.`);
  process.exit(1);
}
console.log(`✓ 컬럼 ${columns.length}편 — 목록·페이지·사진·sitemap·llms 모두 일치${warnings.length ? ` (주의 ${warnings.length}건)` : ''}`);
