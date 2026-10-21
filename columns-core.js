/* =========================================================
   원장 컬럼 핵심 로직 — 관리 도구 v2.1
   ---------------------------------------------------------
   화면(DOM)을 쓰지 않는 순수 함수만 모았습니다.
   어드민(브라우저)과 검증 스크립트(node)가 똑같은 코드를 씁니다.
   이 파일은 전주점·강남점이 똑같습니다. 지점마다 다른 값은 site-config.js 에 있습니다.

   이 파일이 지키는 약속 (자세한 설명: 어드민-제작-가이드.md)
   1. 컬럼 목록의 원본은 홈페이지 저장소의 columns/index.json 입니다.
      이 브라우저에 저장된 값으로 목록을 다시 만들지 않습니다.
   2. 발행은 항상 "배포된 목록 + 지금 글 1개"를 파일명(slug) 기준으로 병합합니다.
   3. 새 글 파일명은 저장소에 실제로 있는 파일 번호의 다음 번호로 정합니다.
   4. 목록에서 글이 빠지는 것은 [삭제]를 눌렀을 때뿐입니다.
========================================================= */
(function (root) {
  'use strict';

  const VERSION = 'v3.0-geo';
  const IS_NODE = typeof module === 'object' && module.exports;
  const SITE = IS_NODE ? require('./site-config.js').SITE : root.HOO_SITE;
  if (!SITE) throw new Error('site-config.js 를 columns-core.js 보다 먼저 불러와야 합니다.');

  const PATHS = {
    index: 'columns/index.json',
    list: 'columns.html',
    sitemap: 'sitemap.xml',
    llms: 'llms.txt',
    page: slug => 'columns/' + slug + '.html',
    data: slug => 'columns/data/' + slug + '.json',
  };

  const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
  const RESERVED_SLUGS = new Set(['index', 'data']);   // columns/index.json, columns/data/ 와 겹치는 이름
  const INDEX_ABOUT = '원장 컬럼 목록의 원본입니다. 관리 도구가 발행할 때 이 파일을 먼저 읽고 파일명(slug) 기준으로 병합합니다. 직접 고칠 때는 다른 글이 빠지지 않게 주의하세요.';
  const VOID_TAGS = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr']);
  // 본문에 들어가면 페이지를 망가뜨리거나 보안상 위험한 태그
  const FORBIDDEN_TAGS = new Set(['script', 'style', 'iframe', 'form', 'input', 'button', 'textarea', 'select', 'object', 'embed', 'link', 'meta', 'html', 'head', 'body', 'base']);
  // 닫는 태그를 빼먹어도 브라우저가 알아서 닫아 주는 태그
  const OPTIONAL_CLOSE = new Set(['p', 'li', 'dt', 'dd', 'tr', 'td', 'th', 'thead', 'tbody', 'tfoot', 'option']);
  const BLOCK_RE = /<(p|h[1-6]|ul|ol|figure|table|blockquote)\b/i;

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

  const uniq = arr => arr.filter((v, i) => arr.indexOf(v) === i);

  function todayLocal(d){
    d = d || new Date();
    const z = n => String(n).padStart(2, '0');
    return d.getFullYear() + '-' + z(d.getMonth() + 1) + '-' + z(d.getDate());
  }

  function koDate(iso){
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || '').trim());
    return m ? `${Number(m[1])}년 ${Number(m[2])}월 ${Number(m[3])}일` : '';
  }

  /* ---------- GEO 작성원칙 (v1) ----------
     새로 쓰는 컬럼(format: 'geo-v1')은 아래 순서·개수를 반드시 지킨다.
       질문형 H1(제목) → 질문형 H2 8개(본문, 비교표 2개 포함) → 참고자료 3개 → FAQ 6개 → 감수 원장 박스 → 최종수정일
     이미지 alt 에는 지역 키워드(SITE.shortName)가 반드시 들어간다 (없으면 자동으로 앞에 붙임). */
  const GEO = {
    FORMAT: 'geo-v1',
    H2_COUNT: 8,
    TABLE_COUNT: 2,
    REF_COUNT: 3,
    FAQ_COUNT: 6,
    MIN_BODY_CHARS: 2500,
    REF_SECTION: '이 글은 어떤 자료를 참고했나요?',
    FAQ_SECTION: '환자분들이 자주 묻는 질문은 무엇인가요?',
    // 의료법(제56조) 위반 소지가 큰 표현 — 발견되면 발행을 멈춘다
    BANNED: ['완치', '100%', '부작용 없', '부작용이 없', '최고의', '최고 ', '유일한', '유일하게', '보장합니다', '확실하게 낫', '재발 없', '재발이 없', '흉터 없이', '흉터가 남지 않', '통증 없이', '무통'],
  };
  const isQuestion = s => /\?\s*$/.test(flat(unesc(stripTags(s))));
  const region = () => String(SITE.shortName || '').trim();

  // 지역 키워드가 없는 alt 에는 "춘천 " 처럼 지역명을 앞에 붙인다
  function regionAlt(alt){
    const a = flat(alt);
    const r = region();
    if (!r) return a;
    if (!a) return `${r} ${SITE.bizName}`;
    return a.indexOf(r) > -1 ? a : `${r} ${a}`;
  }
  // HTML 조각 안의 모든 <img alt> 를 지역 키워드가 들어가게 맞춘다 (alt 가 없으면 만들어 넣음)
  function enforceAlts(html){
    return String(html || '').replace(/<img\b[^>]*>/gi, tag => {
      const m = /\salt="([^"]*)"/i.exec(tag);
      if (m) return tag.replace(m[0], ` alt="${esc(regionAlt(unesc(m[1])))}"`);
      return tag.replace(/<img\b/i, `<img alt="${esc(regionAlt(''))}"`);
    });
  }
  function altsMissingRegion(html){
    const r = region();
    const out = [];
    String(html || '').replace(/<img\b[^>]*>/gi, tag => {
      const m = /\salt="([^"]*)"/i.exec(tag);
      const alt = m ? unesc(m[1]) : '';
      if (!r || alt.indexOf(r) < 0) out.push(alt || '(alt 없음)');
      return tag;
    });
    return out;
  }

  // 본문 <h2> 에 목차용 id 를 붙이고 목차 목록을 돌려준다
  function withH2Ids(html){
    const toc = [];
    let i = 0;
    const out = String(html || '').replace(/<h2([^>]*)>([\s\S]*?)<\/h2>/gi, (all, attrs, inner) => {
      i++;
      const id = 'q' + i;
      toc.push({id: id, text: flat(unesc(stripTags(inner)))});
      return `<h2 id="${id}"${attrs.replace(/\s*id="[^"]*"/i, '')}>${inner}</h2>`;
    });
    return {html: out, toc: toc};
  }

  // 관리 도구 입력칸 ↔ 데이터 변환 (한 줄에 하나)
  //   FAQ      : "Q. 질문?" 다음 줄 "A. 답변"
  //   참고자료 : "출처 | 문서 제목 | https://주소"
  //   핵심 답변: 한 줄에 한 문장
  function faqsToText(list){
    return (list || []).map(f => `Q. ${flat(f.q)}\nA. ${flat(f.a)}`).join('\n\n');
  }
  function textToFaqs(text){
    const out = [];
    let cur = null;
    String(text || '').replace(/\r\n/g, '\n').split('\n').forEach(line => {
      const t = line.trim();
      let m;
      if ((m = /^Q[.:)]?\s*(.+)$/i.exec(t))) { cur = {q: m[1].trim(), a: ''}; out.push(cur); }
      else if ((m = /^A[.:)]?\s*(.*)$/i.exec(t)) && cur) { cur.a = (cur.a ? cur.a + ' ' : '') + m[1].trim(); }
      else if (t && cur) { cur.a = (cur.a ? cur.a + ' ' : '') + t; }
    });
    return out;
  }
  function refsToText(list){
    return (list || []).map(r => [r.source, r.title, r.url].map(flat).join(' | ')).join('\n');
  }
  function textToRefs(text){
    return String(text || '').replace(/\r\n/g, '\n').split('\n').map(l => l.trim()).filter(Boolean).map(l => {
      const parts = l.split('|').map(s => s.trim());
      const url = parts.find(p => /^https?:\/\//i.test(p)) || '';
      const rest = parts.filter(p => p !== url);
      return {source: rest[0] || '', title: rest.slice(1).join(' | ') || rest[0] || '', url: url};
    });
  }
  const linesToList = text => String(text || '').replace(/\r\n/g, '\n').split('\n').map(s => s.replace(/^[-*•]\s*/, '').trim()).filter(Boolean);

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
      const alt = esc(regionAlt(im.alt || ''));
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

  /* ---------- 본문 검사 / 자동 정리 ---------- */

  // 붙여 넣은 본문 HTML이 페이지를 망가뜨리지 않는지 검사한다
  function checkBodyHtml(body){
    const src = String(body || '');
    const errors = [], warnings = [];
    if (!src.trim()) return {errors, warnings};

    if (/<\/\s*</.test(src)) errors.push('본문에 깨진 태그(예: "</<p>")가 있습니다.');

    const stack = [], stray = [], unclosed = [], forbidden = [];
    const tagRe = /<!--[\s\S]*?-->|<\/?([a-zA-Z][a-zA-Z0-9-]*)\b[^>]*>/g;
    let m;
    while ((m = tagRe.exec(src))) {
      if (!m[1]) continue;
      const name = m[1].toLowerCase();
      if (FORBIDDEN_TAGS.has(name)) forbidden.push(name);
      if (VOID_TAGS.has(name) || /\/>$/.test(m[0])) continue;
      if (m[0][1] !== '/') { stack.push(name); continue; }
      const at = stack.lastIndexOf(name);
      if (at < 0) { stray.push(name); continue; }
      stack.splice(at).slice(1).forEach(t => { if (!OPTIONAL_CLOSE.has(t)) unclosed.push(t); });
    }
    stack.forEach(t => { if (!OPTIONAL_CLOSE.has(t)) unclosed.push(t); });

    if (forbidden.length) errors.push('본문에 넣을 수 없는 태그가 있습니다: ' + uniq(forbidden).map(t => '<' + t + '>').join(', '));
    if (stray.length) errors.push('여는 태그 없이 닫는 태그가 있습니다: ' + uniq(stray).map(t => '</' + t + '>').join(', ') + ' — 페이지 모양이 깨질 수 있습니다.');
    if (unclosed.length) errors.push('닫히지 않은 태그가 있습니다: ' + uniq(unclosed).map(t => '<' + t + '>').join(', ') + ' — 뒤쪽 글 전체에 번질 수 있습니다.');
    if (!BLOCK_RE.test(src)) {
      errors.push('본문이 HTML 형식이 아닙니다 (문단 태그가 없어 줄바꿈이 모두 사라집니다). [본문 자동 정리]를 눌러 주세요.');
    } else if (splitBodyBlocks(src).some(b => b.tag === 'text')) {
      warnings.push('태그 밖에 놓인 글이 있습니다 (문단 모양이 적용되지 않음). [본문 자동 정리]로 <p>를 씌울 수 있습니다.');
    }
    if (/<h1\b/i.test(src)) warnings.push('본문에 <h1> 제목이 있습니다. 글 제목은 자동으로 들어가니 본문 소제목은 <h2>를 써 주세요.');
    const plain = src.replace(/<[^>]*>/g, '\n');
    if (/^\s*#{1,6}\s+\S/m.test(plain) || /\*\*[^*\n]+\*\*/.test(plain)) {
      warnings.push('본문에 마크다운 표시(#, ** 등)가 그대로 보입니다. [본문 자동 정리]로 바꿀 수 있습니다.');
    }
    return {errors, warnings};
  }

  // 다른 곳(메모장·AI 답변 등)에서 붙여 넣은 글을 페이지에 맞는 HTML로 정리한다
  // · ```html 같은 코드 표시 줄과 "본문을 입력하세요" 안내 문구를 지운다
  // · 태그 없이 쓴 글·마크다운이면 문단(<p>)·소제목(<h2>)·목록(<ul>/<ol>)으로 바꾼다
  function tidyBody(body){
    let s = String(body || '').replace(/\r\n/g, '\n');
    s = s.replace(/^[ \t]*```[a-zA-Z]*[ \t]*$/gm, '');
    s = s.replace(/본문을 입력하세요\.?/g, '');
    s = s.replace(/<\/\s*<p>/g, '</p><p>').replace(/<p>\s*<\/p>/g, '');   // 깨진 태그를 먼저 고친 뒤 빈 문단을 지운다

    if (BLOCK_RE.test(s)) {
      // 이미 HTML이면 태그 밖에 놓인 글만 <p>로 감싼다
      return splitBodyBlocks(s).map(b => (b.tag === 'text' ? '<p>' + b.html.replace(/\n+/g, '<br>\n') + '</p>' : b.html)).join('\n\n');
    }

    const inline = t => esc(t).replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>');
    const out = [];
    let para = [], list = null;
    const flushPara = () => { if (para.length) out.push('<p>' + para.map(inline).join('<br>\n') + '</p>'); para = []; };
    const flushList = () => {
      if (list) out.push('<' + list.tag + '>\n' + list.items.map(i => '<li>' + inline(i) + '</li>').join('\n') + '\n</' + list.tag + '>');
      list = null;
    };
    s.split('\n').forEach(line => {
      const t = line.trim();
      let m;
      if (!t) { flushPara(); flushList(); return; }
      if ((m = /^#{1,6}\s+(.*)$/.exec(t))) {
        flushPara(); flushList();
        out.push('<h2>' + inline(m[1].replace(/\s*#+$/, '')) + '</h2>');
        return;
      }
      if ((m = /^(?:[-*•]|\d+[.)])\s+(.*)$/.exec(t))) {
        flushPara();
        const tag = /^\d/.test(t) ? 'ol' : 'ul';
        if (list && list.tag !== tag) flushList();
        if (!list) list = {tag: tag, items: []};
        list.items.push(m[1]);
        return;
      }
      flushList();
      para.push(t);
    });
    flushPara(); flushList();
    return out.join('\n\n');
  }

  // 글에 쓰인 사진 경로를 저장소 기준 경로로 모은다 (외부 주소는 제외)
  function imagePaths(col){
    const out = [];
    const local = p => p && !/^(https?:)?\/\//i.test(p) && !/^data:/i.test(p);
    const fromRoot = p => { p = String(p || '').trim(); if (local(p)) out.push(p.replace(/^\/+/, '').replace(/^(\.\.\/)+/, '')); };
    fromRoot(col.image || SITE.defaultImage);
    (col.bodyImages || []).forEach(im => fromRoot(im.src));
    // 본문에 직접 쓴 <img src> 는 컬럼 페이지(columns/) 기준 경로다
    const re = /<img\b[^>]*\ssrc="([^"]*)"/gi;
    let m;
    while ((m = re.exec(String(col.body || '')))) {
      const p = unesc(m[1]).trim();
      if (!local(p)) continue;
      if (/^\.\.\//.test(p)) out.push(p.replace(/^(\.\.\/)+/, ''));
      else if (/^\//.test(p)) out.push(p.replace(/^\/+/, ''));
      else out.push('columns/' + p);
    }
    return uniq(out);
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
    // 수정일은 발행일보다 앞설 수 없다 (예약 발행 흔적 방지)
    const modified = col.dateModified && col.dateModified > col.datePublished ? col.dateModified : col.datePublished;
    const faqs = (col.faqs || []).filter(f => flat(f.q) && flat(f.a));
    const refs = (col.references || []).filter(r => flat(r.url) || flat(r.title));
    const summary = (col.summary || []).map(flat).filter(Boolean);
    const RV = SITE.reviewer || {};
    const reviewerName = RV.name || SITE.doctor;
    const physician = {
      "@type": "Physician",
      "name": reviewerName,
      "jobTitle": RV.title || '대표원장',
      "medicalSpecialty": "한의학",
      "affiliation": {"@type": "MedicalClinic", "name": SITE.bizName},
    };
    const bodyParts = withH2Ids(enforceAlts(buildBodyWithImages(col)));

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
          "dateModified": modified,
          "lastReviewed": modified,
          "inLanguage": "ko",
          "about": {"@type": "MedicalCondition", "name": SITE.aboutCondition},
          "author": physician,
          "reviewedBy": physician,
          ...(refs.length ? {"citation": refs.map(r => ({"@type": "CreativeWork", "name": flat(r.title), "publisher": flat(r.source), "url": flat(r.url)}))} : {}),
          ...(summary.length ? {"abstract": summary.join(' ')} : {}),
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
        ...(faqs.length ? [{
          "@type": "FAQPage",
          "@id": url + '#faq',
          "mainEntity": faqs.map(f => ({
            "@type": "Question",
            "name": flat(f.q),
            "acceptedAnswer": {"@type": "Answer", "text": flat(f.a)},
          })),
        }] : []),
      ],
    };

    const sectionRefs = refs.length ? `
      <section class="geo-refs" aria-labelledby="refs-title">
        <h2 id="refs-title">${esc(GEO.REF_SECTION)}</h2>
        <ol>
${refs.map(r => `          <li><a href="${esc(flat(r.url))}" target="_blank" rel="noopener nofollow">${esc(flat(r.source))}${flat(r.title) && flat(r.title) !== flat(r.source) ? ' — ' + esc(flat(r.title)) : ''}</a></li>`).join('\n')}
        </ol>
      </section>` : '';
    const sectionFaq = faqs.length ? `
      <section class="geo-faq" id="faq" aria-labelledby="faq-title">
        <h2 id="faq-title">${esc(GEO.FAQ_SECTION)}</h2>
${faqs.map(f => `        <details class="faq-item"><summary>${esc(flat(f.q))}</summary><p>${esc(flat(f.a))}</p></details>`).join('\n')}
      </section>` : '';
    const reviewerPhoto = RV.photo || SITE.defaultImage;
    const sectionReviewer = `
      <aside class="geo-reviewer" aria-label="감수 원장">
        <img src="${esc(toColumnRelative(reviewerPhoto))}" alt="${esc(regionAlt(`${SITE.bizName} ${reviewerName} ${RV.title || '대표원장'}`))}" width="88" height="88" loading="lazy">
        <div>
          <p class="geo-reviewer-label">감수 원장</p>
          <p class="geo-reviewer-name">${esc(reviewerName)} ${esc(RV.title || '대표원장')} <span>(${esc(RV.license || '한의사')})</span></p>
          <p class="geo-reviewer-bio">${esc(RV.bio || `${SITE.bizName} ${reviewerName} ${RV.title || '대표원장'}`)}</p>
          <p class="geo-reviewer-note">이 글은 ${esc(SITE.bizName)} ${esc(reviewerName)} ${esc(RV.title || '대표원장')}이 진료 경험과 아래 참고자료를 바탕으로 작성·감수했습니다.</p>
        </div>
      </aside>`;
    const sectionModified = `
      <p class="geo-modified">최종 수정일 <time datetime="${esc(modified)}">${esc(koDate(modified))}</time></p>`;
    const sectionSummary = summary.length ? `
    <div class="geo-answer" role="note" aria-label="핵심 답변">
      <p class="geo-answer-label">핵심 답변</p>
      <ul>
${summary.map(s => `        <li>${esc(s)}</li>`).join('\n')}
      </ul>
    </div>` : '';
    const sectionToc = bodyParts.toc.length >= 3 ? `
    <nav class="geo-toc" aria-label="목차">
      <p class="geo-answer-label">이 글에서 답하는 질문</p>
      <ol>
${bodyParts.toc.map(t => `        <li><a href="#${t.id}">${esc(t.text)}</a></li>`).join('\n')}${faqs.length ? `
        <li><a href="#faq">${esc(GEO.FAQ_SECTION)}</a></li>` : ''}
      </ol>
    </nav>` : '';

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
<meta property="article:modified_time" content="${esc(modified)}">
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
  .article-body ol { margin: 1rem 0 1.5rem; padding-left: 1.2rem; list-style: decimal; color: #5b5b5b; line-height: 1.9; }
  .article-body table { width: 100%; border-collapse: collapse; margin: 1.5rem 0 2rem; font-size: 0.9rem; }
  .article-body caption { caption-side: top; text-align: left; font-weight: 700; color: #0d0d0d; padding-bottom: 0.6rem; }
  .article-body th, .article-body td { border: 1px solid #d9d9d9; padding: 0.65rem 0.75rem; text-align: left; vertical-align: top; line-height: 1.6; }
  .article-body th { background: #eeece5; color: #0d0d0d; font-weight: 700; }
  .article-body td { color: #5b5b5b; }
  .table-wrap { overflow-x: auto; -webkit-overflow-scrolling: touch; }
  .geo-answer, .geo-toc { margin-top: 2rem; border: 1px solid #d9d9d9; border-radius: 1rem; padding: 1.25rem 1.5rem; background: #faf9f6; }
  .geo-answer ul { list-style: disc; padding-left: 1.1rem; color: #242522; line-height: 1.8; }
  .geo-toc ol { list-style: decimal; padding-left: 1.2rem; color: #5b5b5b; line-height: 1.9; font-size: 0.9rem; }
  .geo-toc a:hover { color: #b79e6c; }
  .geo-answer-label, .geo-reviewer-label { font-size: 0.75rem; font-weight: 700; letter-spacing: 0.12em; color: #b79e6c; margin-bottom: 0.5rem; }
  .geo-refs h2, .geo-faq h2 { font-size: 1.25rem; font-weight: 800; margin-top: 3rem; margin-bottom: 0.75rem; }
  .geo-refs ol { list-style: decimal; padding-left: 1.2rem; color: #5b5b5b; line-height: 1.9; font-size: 0.9rem; }
  .geo-refs a { text-decoration: underline; text-underline-offset: 3px; word-break: break-all; }
  .geo-faq .faq-item { border-bottom: 1px solid #d9d9d9; padding: 1rem 0; }
  .geo-faq summary { font-weight: 700; cursor: pointer; line-height: 1.6; }
  .geo-faq .faq-item p { margin-top: 0.6rem; color: #5b5b5b; line-height: 1.85; }
  .geo-reviewer { margin-top: 3rem; display: flex; gap: 1.25rem; align-items: flex-start; border: 1px solid #d9d9d9; border-radius: 1rem; padding: 1.5rem; }
  .geo-reviewer img { width: 88px; height: 88px; border-radius: 9999px; object-fit: cover; object-position: top; flex-shrink: 0; }
  .geo-reviewer-name { font-weight: 800; }
  .geo-reviewer-name span { font-weight: 500; color: #5b5b5b; font-size: 0.875rem; }
  .geo-reviewer-bio, .geo-reviewer-note { margin-top: 0.4rem; font-size: 0.875rem; color: #5b5b5b; line-height: 1.7; }
  .geo-modified { margin-top: 1.25rem; font-size: 0.875rem; color: #5b5b5b; text-align: right; }
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
    <p class="mt-4 text-sm text-muted">작성 <time datetime="${esc(col.datePublished)}">${esc(col.datePublished)}</time> · ${esc(SITE.bizName)} ${esc(reviewerName)} ${esc(RV.title || '대표원장')}</p>

    <img src="${esc(imgRel)}" alt="${esc(regionAlt(col.imageAlt || col.title))}" class="w-full rounded-2xl shadow-soft object-cover${SITE.photoClass} aspect-[16/9] mt-8">
${sectionSummary}${sectionToc}

    <div class="article-body mt-10">
<!-- body:start -->
${bodyParts.html.replace(/<table\b[\s\S]*?<\/table>/gi, t => '<div class="table-wrap">' + t + '</div>')}
<!-- body:end -->
    </div>
${sectionRefs}${sectionFaq}${sectionReviewer}${sectionModified}

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
    <p class="mt-4 text-xl md:text-2xl font-bold leading-relaxed">
      " 궁금한 점이 있다면 편하게 물어보세요.<br>
      상담은 진단부터 시작합니다. "
    </p>
    <a href="tel:${esc(SITE.phone)}" class="inline-block mt-8 rounded-full bg-gold text-point font-bold px-8 py-3.5">지금 전화 상담하기</a>
  </div>
</section>

<footer class="py-14 bg-white text-center">
  <div class="max-w-3xl mx-auto px-6">
    <img src="../assets/images/logo.png" alt="${esc(SITE.bizName)} 로고" class="h-10 w-auto mx-auto" width="125" height="213">
    <p class="mt-3 font-bold">${esc(SITE.bizName)}</p>
    <p class="mt-2 text-sm text-muted">${esc(SITE.region)} ${esc(SITE.city)} ${esc(SITE.street)}</p>
    <p class="text-sm text-muted">${esc(SITE.phone)}</p>
    <p class="mt-6 text-xs text-muted/70">COPYRIGHT HOO KOREAN MEDICAL CLINIC ${SITE.copyright}. ALL RIGHTS RESERVED.</p>
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
        <img src="${esc(c.image)}" alt="${esc(regionAlt(c.title))}" class="w-full aspect-[4/3] object-cover${SITE.photoClass}">
        <div class="p-6">
          <p class="text-xs text-gold font-bold">${esc(c.category)}</p>
          <h2 class="mt-2 font-bold leading-snug group-hover:text-gold transition">${esc(c.title)}</h2>
          <p class="mt-3 text-sm text-muted leading-relaxed line-clamp-3">${esc(c.cardSummary)}</p>
          <p class="mt-4 text-xs text-muted"><time datetime="${esc(c.datePublished)}">${esc(c.datePublished)}</time> · ${esc(SITE.doctor)} 대표원장</p>
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
      format: s(c.format).trim(),
      imageAlt: s(c.imageAlt),
      summary: (Array.isArray(c.summary) ? c.summary : linesToList(c.summary)).map(x => flat(x)).filter(Boolean),
      body: s(c.body),
      faqs: (Array.isArray(c.faqs) ? c.faqs : []).map(f => ({q: flat(f && f.q), a: flat(f && f.a)})).filter(f => f.q || f.a),
      references: (Array.isArray(c.references) ? c.references : []).map(r => (typeof r === 'string'
        ? {source: '', title: flat(stripTags(r)), url: ((/href="([^"]+)"/.exec(r) || [])[1] || '')}
        : {source: flat(r && r.source), title: flat(r && r.title), url: flat(r && r.url)})).filter(r => r.url || r.title),
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

  // 목록·카드는 항상 최신 글이 위 (발행일 내림차순, 같은 날이면 기존 순서 유지)
  function sortNewest(list){
    return list.map((c, i) => ({c, i}))
      .sort((a, b) => String(b.c.datePublished).localeCompare(String(a.c.datePublished)) || a.i - b.i)
      .map(x => x.c);
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
    else if (RESERVED_SLUGS.has(c.slug)) errors.push('"' + c.slug + '" 는 파일명으로 쓸 수 없습니다 (저장소의 다른 파일과 겹침).');
    if (!c.title.trim() || c.title.trim() === '새 컬럼 제목') errors.push('제목을 입력해 주세요.');
    else if (flat(c.title).length > 70) warnings.push('제목이 깁니다 (' + flat(c.title).length + '자). 검색 결과에서 뒷부분이 잘릴 수 있습니다.');
    if (!body) errors.push('본문을 입력해 주세요.');
    else if (body.indexOf('본문을 입력하세요') > -1) errors.push('본문에 "본문을 입력하세요" 안내 문구가 남아 있습니다. [본문 자동 정리]를 누르거나 지워 주세요.');
    if (body.indexOf('```') > -1) errors.push('본문에 ``` 표시가 들어 있습니다 (다른 곳에서 복사할 때 딸려온 코드 표시). [본문 자동 정리]를 눌러 주세요.');
    if (body) {
      const h = checkBodyHtml(body);
      h.errors.forEach(e => { if (errors.indexOf(e) < 0) errors.push(e); });
      h.warnings.forEach(w => warnings.push(w));
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(c.datePublished)) errors.push('발행일을 입력해 주세요.');
    if (!c.cardSummary.trim()) warnings.push('목록 카드 요약이 비어 있습니다.');
    if (!c.description.trim()) warnings.push('SEO 메타 설명이 비어 있습니다.');
    c.bodyImages.forEach((im, i) => {
      if (!im.src) warnings.push(`본문 사진 ${i + 1}: 사진 경로가 비어 있어 빠집니다.`);
      else if (!im.alt.trim()) warnings.push(`본문 사진 ${i + 1}: 알트 태그가 비어 있습니다. (지역명 "${region()}"은 자동으로 붙습니다)`);
    });
    const geo = validateGeo(c);
    if (c.format === GEO.FORMAT) geo.forEach(e => errors.push('[GEO] ' + e));
    else if (geo.length) warnings.push(`GEO 작성원칙(질문형 H1·H2 8개·비교표 2·참고자료 3·FAQ 6) 기준 ${geo.length}개 항목이 맞지 않습니다: ` + geo.slice(0, 3).join(' / ') + (geo.length > 3 ? ' …' : ''));
    return {errors, warnings};
  }

  // GEO 작성원칙 검사 — 문제 목록(문자열 배열)을 돌려준다. 빈 배열이면 통과.
  function validateGeo(col){
    const c = normalizeColumn(col);
    const out = [];
    const r = region();
    const title = flat(c.title);
    if (!isQuestion(title)) out.push('제목(H1)이 질문형(?로 끝남)이 아닙니다.');
    if (r && title.indexOf(r) < 0) out.push(`제목에 지역 키워드 "${r}"가 없습니다.`);
    if (/\d{4}-?\d{2}-?\d{2}|20\d{2}/.test(c.slug)) out.push('파일명(주소)에 날짜·연도가 들어 있습니다.');
    const h2s = [...c.body.matchAll(/<h2\b[^>]*>([\s\S]*?)<\/h2>/gi)].map(m => flat(unesc(stripTags(m[1]))));
    if (h2s.length !== GEO.H2_COUNT) out.push(`본문 소제목(H2)이 ${h2s.length}개입니다 (정확히 ${GEO.H2_COUNT}개).`);
    const notQ = h2s.filter(h => !isQuestion(h));
    if (notQ.length) out.push(`질문형이 아닌 H2: ${notQ.map(h => '"' + h + '"').join(', ')}`);
    if (/<h1\b/i.test(c.body)) out.push('본문에 <h1>이 있습니다 (H1은 제목 하나뿐).');
    const tables = [...c.body.matchAll(/<table\b[\s\S]*?<\/table>/gi)].map(m => m[0]);
    if (tables.length !== GEO.TABLE_COUNT) out.push(`비교표가 ${tables.length}개입니다 (정확히 ${GEO.TABLE_COUNT}개).`);
    tables.forEach((t, i) => {
      if (!/<caption\b/i.test(t)) out.push(`비교표 ${i + 1}에 <caption>(표 제목)이 없습니다.`);
      if (!/<th\b/i.test(t)) out.push(`비교표 ${i + 1}에 <th>(머리글 칸)가 없습니다.`);
    });
    const plain = flat(unesc(stripTags(c.body)));
    if (plain.length < GEO.MIN_BODY_CHARS) out.push(`본문이 짧습니다 (${plain.length}자, 최소 ${GEO.MIN_BODY_CHARS}자).`);
    const refs = c.references;
    if (refs.length !== GEO.REF_COUNT) out.push(`참고자료가 ${refs.length}개입니다 (정확히 ${GEO.REF_COUNT}개).`);
    refs.forEach((x, i) => {
      if (!/^https:\/\//.test(x.url)) out.push(`참고자료 ${i + 1}의 주소가 https 로 시작하지 않습니다.`);
      if (!x.source) out.push(`참고자료 ${i + 1}의 출처(기관명)가 비었습니다.`);
    });
    const allowed = SITE.referenceSources || [];
    if (allowed.length && refs.length) {
      const missing = allowed.filter(src => !refs.some(x => x.source.indexOf(src) > -1));
      if (missing.length) out.push(`참고자료에 꼭 들어가야 할 출처가 빠졌습니다: ${missing.join(', ')}`);
    }
    if (c.faqs.length !== GEO.FAQ_COUNT) out.push(`FAQ가 ${c.faqs.length}개입니다 (정확히 ${GEO.FAQ_COUNT}개).`);
    c.faqs.forEach((f, i) => {
      if (!isQuestion(f.q)) out.push(`FAQ ${i + 1} 질문이 ?로 끝나지 않습니다.`);
      if (!f.a) out.push(`FAQ ${i + 1} 답변이 비었습니다.`);
    });
    if (!c.summary.length) out.push('핵심 답변(제목 바로 아래 2~3문장)이 비었습니다.');
    const everything = [c.title, c.body, c.summary.join(' '), c.faqs.map(f => f.q + ' ' + f.a).join(' ')].join(' ');
    const banned = GEO.BANNED.filter(w => everything.indexOf(w) > -1);
    if (banned.length) out.push(`의료광고 금지 소지 표현: ${banned.map(w => '"' + w.trim() + '"').join(', ')}`);
    return out;
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

      // 저장소에 없는 사진이 들어 있으면 깨진 사진으로 올라가므로 멈춘다
      const missing = imagePaths(column).filter(p => !snap.paths.has(p));
      if (missing.length) {
        throw PlanError('홈페이지에 없는 사진이 들어 있어 발행을 멈춥니다 (그대로 올리면 사진이 깨져 보입니다).\n\n- ' +
          missing.join('\n- ') + '\n\n[PC에서] 버튼으로 사진을 올리거나 경로를 고쳐 주세요.');
      }

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
        // 같은 제목의 글이 이미 있으면 두 번 올리는 것일 수 있어 확인받는다
        const dup = before.find(c => flat(c.title) === flat(column.title));
        if (dup) {
          warnings.push({needsAck: true, text: `같은 제목의 글이 이미 홈페이지에 있습니다 (${dup.slug}). 같은 글을 두 번 올리는 것이 아니라면 체크해 주세요.`});
        }
        // 새 글의 발행일은 항상 "실제로 올리는 날" — 미래 날짜(예약)·과거 날짜 모두 쓰지 않는다
        if (column.datePublished && column.datePublished !== today) {
          warnings.push({text: `발행일 ${column.datePublished} 대신 실제 발행하는 오늘(${today})로 올립니다. (예약·소급 날짜는 쓰지 않습니다)`});
        }
        column.datePublished = today;
        column.dateModified = today;
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
        if (column.datePublished > today) column.datePublished = today;
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

    after = sortNewest(after);
    changes.push({path: PATHS.index, content: serializeIndex(after)});
    changes.push({path: PATHS.list, content: replaceCards(snap.texts.list, buildColumnCards(after))});
    changes.push({path: PATHS.sitemap, content: mergeSitemap(snap.texts.sitemap, after, today)});
    if (snap.texts.llms != null) changes.push({path: PATHS.llms, content: mergeLlms(snap.texts.llms, after)});

    return {before, after, changes, warnings, summary, column};
  }

  /* ---------- 이미 올라가 있는 컬럼 페이지에서 원본 값 되살리기 ---------- */

  function articleBody(html){
    const marked = /<!-- body:start -->\n?([\s\S]*?)\n?<!-- body:end -->/.exec(html);
    if (marked) {
      return marked[1]
        .replace(/<div class="table-wrap">(<table\b[\s\S]*?<\/table>)<\/div>/gi, '$1')
        .replace(/<h2 id="q\d+"/gi, '<h2');
    }
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
    VERSION, SITE, PATHS, SLUG_RE,
    esc, unesc, flat, todayLocal,
    splitBodyBlocks, blockLabel, normalizeBodyImages, toColumnRelative, toAbsoluteImage, buildBodyWithImages,
    checkBodyHtml, tidyBody, imagePaths,
    buildColumnPage, buildColumnCards, replaceCards, mergeSitemap, mergeLlms,
    normalizeColumn, cardFields, serializeData, parseIndex, serializeIndex,
    collectSlugs, nextSlug, validateColumn, planPublish, parseColumnHtml,
    GEO, koDate, regionAlt, enforceAlts, altsMissingRegion, withH2Ids, validateGeo, sortNewest,
    faqsToText, textToFaqs, refsToText, textToRefs, linesToList,
  };
  if (IS_NODE) module.exports = api;
  else root.HooColumns = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
