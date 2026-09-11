/* =========================================================
   원장 컬럼 핵심 로직 — 관리 도구 v2.0
   ---------------------------------------------------------
   화면(DOM)을 쓰지 않는 순수 함수만 모았습니다.
   어드민(브라우저)과 검증 스크립트(node)가 똑같은 코드를 씁니다.

   이 파일이 지키는 약속 (자세한 설명: 어드민-제작-가이드.md)
   1. 컬럼 목록의 원본은 홈페이지 저장소의 columns/index.json 입니다.
      이 브라우저에 저장된 값으로 목록을 다시 만들지 않습니다.
   2. 발행은 항상 "배포된 목록 + 지금 글 1개"를 파일명(slug) 기준으로 병합합니다.
   3. 새 글 파일명은 저장소에 실제로 있는 파일 번호의 다음 번호로 정합니다.
   4. 목록에서 글이 빠지는 것은 [삭제]를 눌렀을 때뿐입니다.
========================================================= */
(function (root) {
  'use strict';

  /* ---------- 지점별 설정 (다른 지점에 옮길 때는 여기만 바꿉니다) ---------- */
  const SITE = {
    domain: 'https://jjhoowart.co.kr/',
    siteName: '후한의원 전주점',
    bizName: '후한의원 전주점',
    doctor: '허정위',
    phone: '063-251-1050',
    region: '전라북도',
    city: '전주시 완산구',
    street: '온고을로 20 더즌빌딩 2층',
    twitterCard: 'summary_large_image',
    kakaoUrl: 'https://pf.kakao.com/_triUj',
    aboutCondition: '편평사마귀',
    defaultCategory: '편평사마귀',
    defaultImage: 'assets/images/doctor-heo.jpg',
    github: { owner: 'gkwngml1215-code', repo: 'jjwart', branch: 'main' },
  };

  const PATHS = {
    index: 'columns/index.json',
    list: 'columns.html',
    sitemap: 'sitemap.xml',
    llms: 'llms.txt',
    page: slug => 'columns/' + slug + '.html',
    data: slug => 'columns/data/' + slug + '.json',
  };

  const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
  const INDEX_ABOUT = '원장 컬럼 목록의 원본입니다. 관리 도구가 발행할 때 이 파일을 먼저 읽고 파일명(slug) 기준으로 병합합니다. 직접 고칠 때는 다른 글이 빠지지 않게 주의하세요.';
  const VOID_TAGS = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr']);

  /* ---------- 작은 도우미 ---------- */

  function esc(str){
    return String(str == null ? '' : str)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function unesc(str){
    return String(str == null ? '' : str)
      .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
  }

  function stripTags(html){ return String(html || '').replace(/<[^>]*>/g, ''); }

  function flat(str){ return String(str == null ? '' : str).replace(/\s+/g, ' ').trim(); }

  function todayLocal(d){
    d = d || new Date();
    const z = n => String(n).padStart(2, '0');
    return d.getFullYear() + '-' + z(d.getMonth() + 1) + '-' + z(d.getDate());
  }

  /* ---------- 본문 나누기 / 본문 중간 사진 ---------- */

  // 본문 HTML을 최상위 블록(<p>, <h2>, <ul> …) 단위로 쪼갠다.
  // 사진을 "몇 번째 문단 뒤"에 넣을지 고르는 기준이 된다.
  function splitBodyBlocks(body){
    const src = String(body || '');
    const blocks = [];
    const tagRe = /<!--[\s\S]*?-->|<\/?([a-zA-Z][a-zA-Z0-9-]*)\b[^>]*>/g;
    const block = (html, tag) => blocks.push({html: html, text: flat(unesc(stripTags(html))), tag: tag});
    const text = raw => { const t = raw.trim(); if (t) blocks.push({html: t, text: flat(unesc(t)), tag: 'text'}); };
    let depth = 0, pos = 0, start = 0, startTag = '', m;
    while ((m = tagRe.exec(src))) {
      if (depth === 0 && m.index > pos) text(src.slice(pos, m.index));
      pos = tagRe.lastIndex;
      if (!m[1]) continue;                                   // 주석은 건너뛴다
      const name = m[1].toLowerCase();
      if (m[0][1] === '/') {                                 // 닫는 태그
        if (depth > 0 && --depth === 0) block(src.slice(start, pos), startTag);
        continue;
      }
      if (depth === 0) { start = m.index; startTag = name; }
      if (VOID_TAGS.has(name) || /\/>$/.test(m[0])) {
        if (depth === 0) block(src.slice(start, pos), name);
      } else {
        depth++;
      }
    }
    if (depth > 0) block(src.slice(start), startTag);        // 닫히지 않은 태그는 끝까지 한 덩어리
    else if (pos < src.length) text(src.slice(pos));
    return blocks;
  }

  // 위치 선택 드롭다운에 보여줄 짧은 라벨
  function blockLabel(block, i){
    const kind = block.tag === 'h2' ? '소제목' : block.tag === 'ul' || block.tag === 'ol' ? '목록' : '문단';
    const text = block.text.replace(/\s+/g, ' ').slice(0, 22);
    return `${i + 1}. ${kind} — ${text}${block.text.length > 22 ? '…' : ''} 뒤`;
  }

  function normalizeBodyImages(col){
    if (!col) return [];
    if (!Array.isArray(col.bodyImages)) col.bodyImages = [];
    return col.bodyImages;
  }

  // 프로젝트 루트 기준 경로("assets/images/a.jpg")를 컬럼 페이지 기준("../assets/…")으로
  function toColumnRelative(path){
    const p = String(path || '').trim();
    if (!p) return '';
    if (/^(https?:)?\/\//i.test(p)) return p;
    return '../' + p.replace(/^\/+/, '').replace(/^\.\.\//, '');
  }

  function toAbsoluteImage(path, base){
    const p = String(path || '').trim();
    if (!p) return '';
    if (/^(https?:)?\/\//i.test(p)) return p;
    return `${base}/${p.replace(/^\/+/, '').replace(/^\.\.\//, '')}`;
  }

  // 본문 사이사이에 <figure> 사진을 끼워 넣은 최종 본문 HTML
  function buildBodyWithImages(col){
    const images = normalizeBodyImages(col).filter(im => (im.src || '').trim());
    if (!images.length) return col.body || '';

    const blocks = splitBodyBlocks(col.body);
    const figureFor = im => {
      const alt = esc(im.alt || '');
      const cap = (im.caption || '').trim();
      return `
<figure>
  <img src="${esc(toColumnRelative(im.src))}" alt="${alt}" loading="lazy" decoding="async">${cap ? `
  <figcaption>${esc(cap)}</figcaption>` : ''}
</figure>`;
    };

    // after = -1 이면 본문 맨 앞, 그 외에는 after번째 블록 뒤
    const out = [];
    const at = idx => images.filter(im => Number(im.after) === idx).map(figureFor);
    out.push(...at(-1));
    blocks.forEach((b, i) => {
      out.push(b.html);
      out.push(...at(i));
    });
    // 본문이 줄어들어 위치를 잃은 사진은 맨 뒤에 붙여 사라지지 않게 한다
    images.forEach(im => {
      const a = Number(im.after);
      if (a !== -1 && (isNaN(a) || a >= blocks.length)) out.push(figureFor(im));
    });

    return out.join('\n');
  }

  /* ---------- 컬럼 페이지 / 목록 카드 ---------- */

  function buildColumnPage(col){
    const domain = SITE.domain;
    const base = domain.replace(/\/$/, '');
    const url = `${base}/columns/${col.slug}.html`;
    const imgPath = (col.image || SITE.defaultImage).replace(/^\//, '');
    const imgAbs = `${base}/${imgPath}`;
    const imgRel = `../${imgPath}`;
    // 대표 이미지 + 본문 중간 사진을 구조화 데이터에 함께 넣어 검색 노출에 쓰이게 한다
    const bodyImgAbs = normalizeBodyImages(col)
      .map(im => toAbsoluteImage(im.src, base))
      .filter(Boolean);
    const schemaImages = [imgAbs, ...bodyImgAbs].filter((v, i, arr) => arr.indexOf(v) === i);

    const graph = {
      "@context": "https://schema.org",
      "@graph": [
        {
          "@type": col.schemaType || "MedicalWebPage",
          "headline": col.title,
          "description": col.description,
          "url": url,
          "image": schemaImages.length > 1 ? schemaImages : imgAbs,
          "datePublished": col.datePublished,
          "dateModified": col.dateModified || col.datePublished,
          "inLanguage": "ko",
          "about": {"@type": "MedicalCondition", "name": SITE.aboutCondition},
          "author": {
            "@type": "Physician",
            "name": SITE.doctor,
            "affiliation": {"@type": "MedicalClinic", "name": SITE.bizName},
          },
          "publisher": {
            "@type": "MedicalClinic",
            "name": SITE.bizName,
            "telephone": SITE.phone,
            "address": {
              "@type": "PostalAddress",
              "streetAddress": SITE.street,
              "addressLocality": SITE.city,
              "addressRegion": SITE.region,
              "addressCountry": "KR",
            },
          },
          "mainEntityOfPage": {"@type": "WebPage", "@id": url},
        },
        {
          "@type": "BreadcrumbList",
          "itemListElement": [
            {"@type": "ListItem", "position": 1, "name": "홈", "item": domain},
            {"@type": "ListItem", "position": 2, "name": "원장 컬럼", "item": `${base}/columns.html`},
            {"@type": "ListItem", "position": 3, "name": col.title, "item": url},
          ],
        },
      ],
    };

    const navLinks = [
      ['../index.html#about', '편평사마귀란'],
      ['../index.html#treatment', '치료방법'],
      ['../index.html#cost', '비용'],
      ['../index.html#similar', '유사질환'],
      ['../index.html#cases', '전후사진'],
      ['../columns.html', '원장 컬럼'],
      ['../index.html#doctor', '의료진'],
      ['../index.html#faq', 'FAQ'],
    ];
    const desktopNav = navLinks.map(([href, label]) =>
      href === '../columns.html'
        ? `      <a href="${href}" class="text-gold font-bold">${label}</a>`
        : `      <a href="${href}" class="hover:text-gold transition">${label}</a>`
    ).join('\n');
    const mobileNav = navLinks.map(([href, label]) =>
      href === '../columns.html'
        ? `    <a href="${href}" class="text-gold font-bold">${label}</a>`
        : `    <a href="${href}">${label}</a>`
    ).join('\n');

    return `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<link rel="icon" type="image/png" href="/favicon.png">
<link rel="apple-touch-icon" href="/favicon.png">

<title>${esc(col.title)} | ${esc(SITE.bizName)} 원장 컬럼</title>
<meta name="description" content="${esc(col.description)}">
<meta name="keywords" content="${esc(col.keywords)}">
<link rel="canonical" href="${esc(url)}">

<meta property="og:type" content="article">
<meta property="og:site_name" content="${esc(SITE.siteName)}">
<meta property="og:title" content="${esc(col.title)}">
<meta property="og:description" content="${esc(col.description)}">
<meta property="og:url" content="${esc(url)}">
<meta property="og:image" content="${esc(imgAbs)}">
<meta property="og:locale" content="ko_KR">
<meta property="article:published_time" content="${esc(col.datePublished)}">
<meta property="article:modified_time" content="${esc(col.dateModified || col.datePublished)}">
<meta property="article:author" content="${esc(SITE.doctor)}">

<meta name="twitter:card" content="${esc(SITE.twitterCard)}">
<meta name="twitter:title" content="${esc(col.title)}">
<meta name="twitter:description" content="${esc(col.description)}">
<meta name="twitter:image" content="${esc(imgAbs)}">

<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Noto+Sans+KR:wght@400;500;700;900&display=swap" rel="stylesheet">

<script src="https://cdn.tailwindcss.com"><\/script>
<script>
  tailwind.config = {
    theme: {
      extend: {
        colors: {
          point: '#0d0d0d',
          'point-soft': '#242522',
          gold: '#b79e6c',
          'gold-soft': '#eeece5',
          line: '#d9d9d9',
          muted: '#5b5b5b',
        },
        fontFamily: {
          sans: ['"Noto Sans KR"', 'Pretendard', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        },
        boxShadow: {
          soft: '0 12px 32px rgba(13,13,13,0.08)',
        },
      },
    },
  }
<\/script>

<style>
  html { scroll-behavior: smooth; }
  body { font-family: "Noto Sans KR", "Pretendard", ui-sans-serif, system-ui, sans-serif; }
  .eyebrow { letter-spacing: 0.18em; }
  .mobile-nav.hidden { display: none; }
  .article-body h2 { font-size: 1.25rem; font-weight: 800; margin-top: 2.5rem; margin-bottom: 0.75rem; }
  .article-body p { color: #5b5b5b; line-height: 1.9; margin-bottom: 1rem; }
  .article-body ul { margin: 1rem 0 1.5rem; padding-left: 1.1rem; list-style: disc; color: #5b5b5b; line-height: 1.9; }
  .article-body figure { margin: 2.25rem 0; }
  .article-body figure img { width: 100%; height: auto; border-radius: 1rem; box-shadow: 0 12px 32px rgba(13,13,13,0.08); display: block; }
  .article-body figcaption { margin-top: 0.7rem; font-size: 0.8125rem; color: #8a8a8a; line-height: 1.6; text-align: center; }
  .article-body > img { width: 100%; height: auto; border-radius: 1rem; margin: 2.25rem 0; display: block; }
</style>

<script type="application/ld+json">
${JSON.stringify(graph, null, 2)}
<\/script>
</head>
<body class="bg-white text-point antialiased pb-16 md:pb-0">

<header id="top" class="fixed top-0 inset-x-0 z-50 bg-white/90 backdrop-blur border-b border-line">
  <div class="max-w-7xl mx-auto flex items-center justify-between px-6 h-20">
    <a href="../index.html" class="flex items-center gap-3">
      <span class="relative flex items-center justify-center">
        <img src="../assets/images/logo.png" alt="${esc(SITE.bizName)} 로고" class="h-11 w-auto" width="125" height="213">
      </span>
      <span class="leading-tight">
        <span class="block font-extrabold tracking-tight">${esc(SITE.bizName)}</span>
        <span class="block text-[11px] text-muted tracking-widest">HOO KOREAN MEDICAL CLINIC</span>
      </span>
    </a>

    <nav class="hidden lg:flex items-center gap-7 text-sm font-medium">
${desktopNav}
      <a href="../index.html#consult" class="rounded-full bg-point text-white px-5 py-2.5 hover:bg-gold hover:text-point transition">상담·예약</a>
    </nav>

    <button id="mobileMenuBtn" class="lg:hidden w-10 h-10 flex items-center justify-center" aria-label="메뉴 열기">
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none"><path d="M3 6h18M3 12h18M3 18h18" stroke="#0d0d0d" stroke-width="2" stroke-linecap="round"/></svg>
    </button>
  </div>

  <nav id="mobileNav" class="mobile-nav hidden lg:hidden border-t border-line bg-white px-6 py-4 flex flex-col gap-4 text-sm font-medium">
${mobileNav}
    <a href="../index.html#consult" class="rounded-full bg-point text-white text-center px-5 py-2.5">상담·예약</a>
  </nav>
</header>

<div class="fixed right-5 top-1/2 -translate-y-1/2 z-40 hidden md:flex flex-col gap-3">
  <a href="${esc(SITE.kakaoUrl)}" target="_blank" rel="noopener" class="rounded-full bg-[#f1dc3a] text-point text-xs font-bold px-4 py-3 shadow-soft text-center leading-tight">카카오톡<br>상담</a>
  <a href="tel:${esc(SITE.phone)}" class="rounded-full bg-gold text-point text-xs font-bold px-4 py-3 shadow-soft text-center leading-tight">전화<br>상담</a>
</div>

<!-- 모바일 하단 고정 상담 바 (md 미만에서만 표시) -->
<div class="fixed bottom-0 inset-x-0 z-40 md:hidden grid grid-cols-2 border-t border-line shadow-soft" style="padding-bottom:env(safe-area-inset-bottom)">
  <a href="${esc(SITE.kakaoUrl)}" target="_blank" rel="noopener" class="flex items-center justify-center py-4 text-sm font-bold bg-[#f1dc3a] text-point">카카오톡 상담</a>
  <a href="tel:${esc(SITE.phone)}" class="flex items-center justify-center py-4 text-sm font-bold bg-gold text-point">전화 상담</a>
</div>

<main class="pt-32 pb-20 lg:pt-40">
  <article class="max-w-3xl mx-auto px-6">

    <nav class="text-xs text-muted mb-5" aria-label="breadcrumb">
      <a href="../index.html" class="hover:text-gold">홈</a>
      <span class="mx-1">›</span>
      <a href="../columns.html" class="hover:text-gold">원장 컬럼</a>
      <span class="mx-1">›</span>
      <span class="text-point font-semibold">${esc(col.title)}</span>
    </nav>

    <p class="eyebrow text-gold text-sm font-bold">${esc(col.category)}</p>
    <h1 class="mt-2 text-2xl md:text-4xl font-extrabold leading-tight">${esc(col.title)}</h1>
    <p class="mt-4 text-sm text-muted">${esc(col.datePublished)} · ${esc(SITE.bizName)} ${esc(SITE.doctor)} 대표원장</p>

    <img src="${esc(imgRel)}" alt="${esc(col.title)}" class="w-full rounded-2xl shadow-soft object-cover aspect-[16/9] mt-8">

    <div class="article-body mt-10">
${buildBodyWithImages(col)}
    </div>

    <p class="mt-10 text-xs text-muted leading-relaxed border-t border-line pt-6">
      본 컬럼은 일반적인 의학 정보 제공을 목적으로 작성되었으며, 특정 치료 효과를 보장하지 않습니다.
      개인의 상태에 따라 진단과 치료 방법, 시술 효과는 차이가 있을 수 있습니다.
    </p>

    <div class="mt-10 flex flex-wrap gap-3">
      <a href="../columns.html" class="rounded-full border border-point font-bold px-6 py-3 text-sm hover:bg-gold-soft transition">← 컬럼 목록으로</a>
      <a href="../index.html#consult" class="rounded-full bg-point text-white font-bold px-6 py-3 text-sm hover:bg-gold hover:text-point transition">상담 신청하기</a>
    </div>

  </article>
</main>

<section class="py-24 bg-point text-white text-center">
  <div class="max-w-3xl mx-auto px-6">
    <p class="eyebrow text-gold text-sm font-bold">HOO KOREAN MEDICAL CLINIC</p>
    <h2 class="mt-4 text-xl md:text-2xl font-bold leading-relaxed">
      " 궁금한 점이 있다면 편하게 물어보세요.<br>
      상담은 진단부터 시작합니다. "
    </h2>
    <a href="tel:${esc(SITE.phone)}" class="inline-block mt-8 rounded-full bg-gold text-point font-bold px-8 py-3.5">지금 전화 상담하기</a>
  </div>
</section>

<footer class="py-14 bg-white text-center">
  <div class="max-w-3xl mx-auto px-6">
    <img src="../assets/images/logo.png" alt="${esc(SITE.bizName)} 로고" class="h-10 w-auto mx-auto" width="125" height="213">
    <p class="mt-3 font-bold">${esc(SITE.bizName)}</p>
    <p class="mt-2 text-sm text-muted">${esc(SITE.region)} ${esc(SITE.city)} ${esc(SITE.street)}</p>
    <p class="text-sm text-muted">${esc(SITE.phone)}</p>
    <p class="mt-6 text-xs text-muted/70">COPYRIGHT HOO KOREAN MEDICAL CLINIC JEONJU. ALL RIGHTS RESERVED.</p>
  </div>
</footer>

<script>
  document.getElementById('mobileMenuBtn').addEventListener('click', () => {
    document.getElementById('mobileNav').classList.toggle('hidden');
  });
  document.querySelectorAll('#mobileNav a').forEach(a => {
    a.addEventListener('click', () => document.getElementById('mobileNav').classList.add('hidden'));
  });
<\/script>

</body>
</html>
`;
  }

  function buildColumnCards(list){
    if (!list.length) return '<' + '!-- 등록된 컬럼이 없습니다 --' + '>';
    const open = '<' + '!-- COLUMN CARD START --' + '>';
    const close = '<' + '!-- COLUMN CARD END --' + '>';
    return list.map(c => `      ${open}
      <a href="columns/${esc(c.slug)}.html" class="group block rounded-2xl border border-line overflow-hidden hover:shadow-soft transition">
        <img src="${esc(c.image)}" alt="${esc(c.title)}" class="w-full aspect-[4/3] object-cover">
        <div class="p-6">
          <p class="text-xs text-gold font-bold">${esc(c.category)}</p>
          <h2 class="mt-2 font-bold leading-snug group-hover:text-gold transition">${esc(c.title)}</h2>
          <p class="mt-3 text-sm text-muted leading-relaxed line-clamp-3">${esc(c.cardSummary)}</p>
          <p class="mt-4 text-xs text-muted">${esc(c.datePublished)} · ${esc(SITE.doctor)} 대표원장</p>
        </div>
      </a>
      ${close}`).join('\n\n');
  }

  // columns.html 의 COLUMNS:START ~ END 사이만 바꾼다 (나머지는 그대로)
  function replaceCards(html, cards){
    const open = '<' + '!-- COLUMNS:START --' + '>';
    const close = '<' + '!-- COLUMNS:END --' + '>';
    const re = new RegExp('(' + open + ')[\\s\\S]*?(' + close + ')');
    if (!re.test(html)) throw new Error('columns.html 에서 COLUMNS:START / COLUMNS:END 표식을 찾지 못해 발행을 멈춥니다.');
    // 함수로 바꿔 넣어야 글 속의 "$&" 같은 글자가 치환 기호로 오해받지 않는다
    return html.replace(re, (all, a, b) => a + '\n\n' + cards + '\n\n      ' + b);
  }

  /* ---------- sitemap.xml / llms.txt 병합 ---------- */

  // 컬럼 주소만 새 목록으로 바꾸고, 그 밖의 주소(홈 등)는 있던 그대로 둔다
  function mergeSitemap(xml, list, today){
    const base = SITE.domain.replace(/\/$/, '');
    const listUrl = base + '/columns.html';
    const entry = (loc, lastmod, changefreq, priority) =>
`  <url>
    <loc>${esc(loc)}</loc>
    <lastmod>${esc(lastmod)}</lastmod>
    <changefreq>${changefreq}</changefreq>
    <priority>${priority}</priority>
  </url>`;
    const isColumnPage = loc => loc.indexOf(base + '/columns/') === 0 && /\.html$/.test(loc);

    const blocks = String(xml || '').match(/<url>[\s\S]*?<\/url>/g) || [];
    const kept = [];
    let sawList = false;
    blocks.forEach(b => {
      const loc = unesc(((b.match(/<loc>([\s\S]*?)<\/loc>/) || [])[1] || '').trim());
      if (isColumnPage(loc)) return;
      if (loc === listUrl) {
        sawList = true;
        kept.push('  ' + b.replace(/<lastmod>[\s\S]*?<\/lastmod>/, '<lastmod>' + today + '</lastmod>'));
        return;
      }
      kept.push('  ' + b);
    });
    if (!blocks.length) kept.push(entry(SITE.domain, today, 'weekly', '1.0'));
    if (!sawList) kept.push(entry(listUrl, today, 'weekly', '0.8'));

    const cols = list.map(c => entry(`${base}/columns/${c.slug}.html`, c.dateModified || c.datePublished, 'monthly', '0.7'));
    return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${kept.concat(cols).join('\n')}
</urlset>
`;
  }

  // "## 원장 컬럼" 구역의 컬럼 줄만 새 목록으로 바꾸고, 다른 구역은 그대로 둔다
  function mergeLlms(txt, list){
    const base = SITE.domain.replace(/\/$/, '');
    const lines = String(txt || '').replace(/\r\n/g, '\n').split('\n');
    const colLine = c => {
      const sum = flat(c.cardSummary);
      return `- [${flat(c.title)}](${base}/columns/${c.slug}.html)${sum ? ': ' + sum : ''}`;
    };
    const isColLink = l => /^- \[.*\]\(.*\/columns\/[^/()]+\.html\)/.test(l);

    let start = lines.findIndex(l => l.trim() === '## 원장 컬럼');
    if (start < 0) {
      let at = lines.findIndex(l => l.trim() === '## 병원 정보');
      if (at < 0) at = lines.length;
      lines.splice(at, 0, '## 원장 컬럼', `- [원장 컬럼 목록](${base}/columns.html)`, '');
      start = at;
    }
    let end = lines.findIndex((l, i) => i > start && /^## /.test(l));
    if (end < 0) end = lines.length;

    const keptLines = lines.slice(start + 1, end).filter(l => l.trim() && !isColLink(l));
    const section = keptLines.concat(list.map(colLine));
    if (end < lines.length) section.push('');
    return lines.slice(0, start + 1).concat(section, lines.slice(end)).join('\n');
  }

  /* ---------- 데이터 형식 ---------- */

  function normalizeColumn(c){
    c = c || {};
    const s = v => (v == null ? '' : String(v));
    return {
      slug: s(c.slug).trim(),
      title: s(c.title),
      category: s(c.category),
      cardSummary: s(c.cardSummary),
      description: s(c.description),
      keywords: s(c.keywords),
      datePublished: s(c.datePublished).trim(),
      dateModified: s(c.dateModified).trim(),
      image: s(c.image).trim() || SITE.defaultImage,
      schemaType: s(c.schemaType) || 'MedicalWebPage',
      body: s(c.body),
      bodyImages: (Array.isArray(c.bodyImages) ? c.bodyImages : []).map(im => ({
        src: s(im && im.src).trim(),
        alt: s(im && im.alt),
        caption: s(im && im.caption),
        after: im && im.after != null && !isNaN(Number(im.after)) ? Number(im.after) : -1,
      })),
    };
  }

  // 목록(index.json)에 들어가는 항목 — 카드에 필요한 값만
  function cardFields(c){
    const n = normalizeColumn(c);
    return {
      slug: n.slug, title: n.title, category: n.category, cardSummary: n.cardSummary,
      image: n.image, datePublished: n.datePublished, dateModified: n.dateModified,
    };
  }

  function serializeData(c){
    const n = normalizeColumn(c);
    n.bodyImages = n.bodyImages.filter(im => im.src);
    return JSON.stringify(Object.assign({schema: 2}, n), null, 2) + '\n';
  }

  function parseIndex(text){
    let j;
    try { j = JSON.parse(text); } catch (e) {
      throw new Error(PATHS.index + ' 을 읽을 수 없습니다 (형식 오류). 목록을 새로 만들지 않고 멈춥니다.');
    }
    if (!j || !Array.isArray(j.columns)) {
      throw new Error(PATHS.index + ' 안에 columns 목록이 없습니다. 목록을 새로 만들지 않고 멈춥니다.');
    }
    const seen = new Set();
    j.columns.forEach((c, i) => {
      if (!c || typeof c.slug !== 'string' || !SLUG_RE.test(c.slug)) {
        throw new Error(PATHS.index + ' 의 ' + (i + 1) + '번째 항목 파일명이 올바르지 않습니다.');
      }
      if (seen.has(c.slug)) throw new Error(PATHS.index + ' 에 같은 파일명이 두 번 있습니다: ' + c.slug);
      seen.add(c.slug);
    });
    return j.columns.map(cardFields);
  }

  function serializeIndex(list){
    return JSON.stringify({schema: 2, about: INDEX_ABOUT, columns: list.map(cardFields)}, null, 2) + '\n';
  }

  /* ---------- 파일명(slug) ---------- */

  // 저장소에 실제로 있는 컬럼 파일 + 목록에 있는 파일명을 모두 모은다
  function collectSlugs(paths, list){
    const set = new Set((list || []).map(c => c.slug));
    for (const p of paths) {
      const m = /^columns\/([^/]+)\.html$/.exec(p) || /^columns\/data\/([^/]+)\.json$/.exec(p);
      if (m) set.add(m[1]);
    }
    return set;
  }

  // 이미 있는 번호 중 가장 큰 번호의 다음 번호 (빈 번호를 재활용하지 않는다)
  function nextSlug(taken){
    let max = 0;
    taken.forEach(s => {
      const m = /^column-(\d+)$/.exec(s);
      if (m) max = Math.max(max, Number(m[1]));
    });
    let n = max + 1, slug;
    do { slug = 'column-' + String(n).padStart(2, '0'); n++; } while (taken.has(slug));
    return slug;
  }

  /* ---------- 발행 전 검사 ---------- */

  function validateColumn(col){
    const c = normalizeColumn(col);
    const errors = [], warnings = [];
    const body = c.body.trim();
    if (!SLUG_RE.test(c.slug)) errors.push('파일명은 영문 소문자·숫자·하이픈(-)만 쓸 수 있습니다.');
    if (!c.title.trim() || c.title.trim() === '새 컬럼 제목') errors.push('제목을 입력해 주세요.');
    if (!body) errors.push('본문을 입력해 주세요.');
    else if (body.indexOf('본문을 입력하세요') > -1) errors.push('본문에 "본문을 입력하세요" 안내 문구가 남아 있습니다. 지워 주세요.');
    if (body.indexOf('```') > -1) errors.push('본문에 ``` 표시가 들어 있습니다 (다른 곳에서 복사할 때 딸려온 코드 표시). 지워 주세요.');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(c.datePublished)) errors.push('발행일을 입력해 주세요.');
    if (!c.cardSummary.trim()) warnings.push('목록 카드 요약이 비어 있습니다.');
    if (!c.description.trim()) warnings.push('SEO 메타 설명이 비어 있습니다.');
    c.bodyImages.forEach((im, i) => {
      if (!im.src) warnings.push(`본문 사진 ${i + 1}: 사진 경로가 비어 있어 빠집니다.`);
      else if (!im.alt.trim()) warnings.push(`본문 사진 ${i + 1}: 알트 태그가 비어 있습니다.`);
    });
    return {errors, warnings};
  }

  /* ---------- 발행 계획 (병합) ---------- */

  function PlanError(message){ const e = new Error(message); e.plan = true; return e; }
  const brief = c => ({slug: c.slug, title: c.title});

  /*
   * snap : 저장소 최신본 { index: 목록 배열, paths: Map(경로 → sha), texts: {list, sitemap, llms} }
   * op   : { type:'upsert', column, isNew, baseSha, reservedSlugs } 또는 { type:'delete', slug }
   * 반환 : 바뀔 파일(changes)과 사람이 확인할 요약(summary). 저장소에는 아무것도 쓰지 않는다.
   */
  function planPublish(snap, op, today){
    const before = snap.index.map(cardFields);
    const beforeSlugs = new Set(before.map(c => c.slug));
    const existing = collectSlugs(snap.paths.keys(), before);
    const warnings = [], changes = [];
    const summary = {added: [], updated: [], kept: [], deleted: [], renamedFrom: null};
    let after, column = null;

    if (op.type === 'upsert') {
      column = normalizeColumn(op.column);
      column.bodyImages = column.bodyImages.filter(im => im.src);
      if (op.isNew) {
        // 새 글인데 파일명이 이미 저장소에 있으면, 덮어쓰지 않고 다음 빈 번호로 바꾼다
        if (existing.has(column.slug)) {
          const taken = new Set(existing);
          (op.reservedSlugs || []).forEach(s => taken.add(s));
          const fresh = nextSlug(taken);
          summary.renamedFrom = column.slug;
          warnings.push({text: `파일명 ${column.slug} 은(는) 이미 홈페이지에 있어서, 기존 글을 덮어쓰지 않도록 ${fresh} 로 바꿔 올립니다.`});
          column.slug = fresh;
        }
        if (!column.datePublished) column.datePublished = today;
        column.dateModified = column.datePublished;
        after = before.concat([cardFields(column)]);
        summary.added.push(brief(column));
      } else {
        if (!beforeSlugs.has(column.slug)) {
          throw PlanError(`"${column.title}" (${column.slug}) 글이 지금 홈페이지 목록에 없습니다. 다른 곳에서 삭제되었을 수 있어 발행을 멈춥니다.\n[↻ 다시 불러오기]로 최신 목록을 확인해 주세요.`);
        }
        const liveSha = snap.paths.get(PATHS.data(column.slug)) || null;
        if (op.baseSha && liveSha && op.baseSha !== liveSha) {
          warnings.push({needsAck: true, text: '이 글은 편집을 시작한 뒤에 다른 곳(다른 기기·브라우저)에서 먼저 수정·발행되었습니다. 계속하면 그 수정 내용이 지금 화면의 내용으로 바뀝니다. 괜찮으면 체크해 주세요.'});
        }
        column.dateModified = today;
        after = before.map(c => (c.slug === column.slug ? cardFields(column) : c));
        summary.updated.push(brief(column));
      }
      changes.push({path: PATHS.page(column.slug), content: buildColumnPage(column)});
      changes.push({path: PATHS.data(column.slug), content: serializeData(column)});
    } else if (op.type === 'delete') {
      const target = before.find(c => c.slug === op.slug);
      if (!target) throw PlanError('삭제하려는 글이 지금 홈페이지 목록에 없습니다. [↻ 다시 불러오기]로 확인해 주세요.');
      after = before.filter(c => c.slug !== op.slug);
      summary.deleted.push(brief(target));
      [PATHS.page(op.slug), PATHS.data(op.slug)].forEach(p => {
        if (snap.paths.has(p)) changes.push({path: p, content: null});
      });
    } else {
      throw new Error('알 수 없는 발행 작업입니다: ' + op.type);
    }

    // ---- 안전장치: [삭제]로 고른 글 말고는 목록에서 하나도 빠지면 안 된다 ----
    const afterSlugs = new Set(after.map(c => c.slug));
    const deletedSlugs = new Set(summary.deleted.map(c => c.slug));
    if (afterSlugs.size !== after.length) throw PlanError('안전장치: 목록에 같은 파일명이 겹치게 되어 발행을 멈춥니다.');
    before.forEach(c => {
      if (!afterSlugs.has(c.slug) && !deletedSlugs.has(c.slug)) {
        throw PlanError(`안전장치: "${c.title}" 글이 목록에서 빠지게 되어 발행을 멈춥니다.`);
      }
    });
    if (after.length !== before.length + summary.added.length - summary.deleted.length) {
      throw PlanError('안전장치: 발행 후 글 개수가 맞지 않아 발행을 멈춥니다.');
    }

    const touched = new Set(summary.added.concat(summary.updated).map(c => c.slug));
    summary.kept = after.filter(c => !touched.has(c.slug)).map(brief);

    // 목록에 없는 컬럼 파일(손으로 올린 파일 등)은 지우지 않고 알리기만 한다
    const orphans = [...existing].filter(s => !afterSlugs.has(s) && !deletedSlugs.has(s) && snap.paths.has(PATHS.page(s)));
    if (orphans.length) {
      warnings.push({text: `목록에 없는 컬럼 파일이 ${orphans.length}개 있습니다 (${orphans.join(', ')}). 지우지 않고 그대로 둡니다.`});
    }

    changes.push({path: PATHS.index, content: serializeIndex(after)});
    changes.push({path: PATHS.list, content: replaceCards(snap.texts.list, buildColumnCards(after))});
    changes.push({path: PATHS.sitemap, content: mergeSitemap(snap.texts.sitemap, after, today)});
    if (snap.texts.llms != null) changes.push({path: PATHS.llms, content: mergeLlms(snap.texts.llms, after)});

    return {before, after, changes, warnings, summary, column};
  }

  /* ---------- 이미 올라가 있는 컬럼 페이지에서 원본 값 되살리기 ---------- */

  function articleBody(html){
    const open = /<div class="article-body[^"]*">\n?/.exec(html);
    if (!open) return '';
    const from = open.index + open[0].length;
    const disclaimer = html.indexOf('<p class="mt-10 text-xs text-muted', from);
    const until = disclaimer > -1 ? html.lastIndexOf('</div>', disclaimer) : html.indexOf('\n    </div>', from) + 1;
    return until > from ? html.slice(from, until).replace(/\n[ \t]*$/, '') : '';
  }

  function parseColumnHtml(html, slug){
    html = String(html || '').replace(/\r\n/g, '\n');
    const pick = re => { const m = re.exec(html); return m ? m[1] : ''; };
    const meta = (kind, name) => unesc(pick(new RegExp('<meta ' + kind + '="' + name + '" content="([^"]*)"')));

    let schemaType = 'MedicalWebPage';
    try {
      const ld = JSON.parse(pick(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/));
      const first = (ld['@graph'] || [ld])[0];
      if (first && typeof first['@type'] === 'string') schemaType = first['@type'];
    } catch (e) { /* 구조화 데이터가 없으면 기본값 */ }

    // 본문 속 <figure> 사진은 "본문 중간 사진" 목록으로 되돌린다
    const bodyRaw = articleBody(html);
    const kept = [], bodyImages = [];
    splitBodyBlocks(bodyRaw).forEach(b => {
      if (b.tag !== 'figure') { kept.push(b); return; }
      const fig = b.html;
      bodyImages.push({
        src: unesc((/<img[^>]*\ssrc="([^"]*)"/.exec(fig) || [])[1] || '').replace(/^(\.\.\/)+/, ''),
        alt: unesc((/<img[^>]*\salt="([^"]*)"/.exec(fig) || [])[1] || ''),
        caption: flat(unesc(stripTags((/<figcaption[^>]*>([\s\S]*?)<\/figcaption>/.exec(fig) || [])[1] || ''))),
        after: kept.length - 1,
      });
    });

    return normalizeColumn({
      slug: slug,
      title: unesc(pick(/<h1[^>]*>([\s\S]*?)<\/h1>/)),
      category: unesc(pick(/<p class="eyebrow[^"]*">([^<]*)<\/p>\s*<h1/)),
      cardSummary: '',
      description: meta('name', 'description'),
      keywords: meta('name', 'keywords'),
      datePublished: meta('property', 'article:published_time'),
      dateModified: meta('property', 'article:modified_time'),
      image: unesc(pick(/<img src="([^"]*)"[^>]*aspect-\[16\/9\]/)).replace(/^(\.\.\/)+/, ''),
      schemaType: schemaType,
      body: bodyImages.length ? kept.map(b => b.html).join('\n\n') : bodyRaw,
      bodyImages: bodyImages,
    });
  }

  const api = {
    SITE, PATHS, SLUG_RE,
    esc, unesc, flat, todayLocal,
    splitBodyBlocks, blockLabel, normalizeBodyImages, toColumnRelative, toAbsoluteImage, buildBodyWithImages,
    buildColumnPage, buildColumnCards, replaceCards, mergeSitemap, mergeLlms,
    normalizeColumn, cardFields, serializeData, parseIndex, serializeIndex,
    collectSlugs, nextSlug, validateColumn, planPublish, parseColumnHtml,
  };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.HooColumns = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
