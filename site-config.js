/* =========================================================
   지점별 설정 — 전주점
   ---------------------------------------------------------
   관리 도구의 나머지 파일(index.html, columns-core.js, github-publish.js, tests/)은
   전주점·강남점이 똑같습니다. 지점마다 다른 값은 이 파일에만 둡니다.
   고친 뒤에는 어드민-제작-가이드.md 의 검증 두 가지를 꼭 실행하세요.
========================================================= */
(function (root) {
  // 컬럼 페이지·목록 카드·발행에 쓰는 값
  const SITE = {
    domain: 'https://jjhoowart.co.kr/',
    shortName: '전주',
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
    photoClass: '',                     // 사진 자르기 기준 (강남점은 ' object-top')
    copyright: 'JEONJU',
    github: { owner: 'gkwngml1215-code', repo: 'jjwart', branch: 'main' },
    tokenKey: 'hoo-admin-gh-token',     // 이 브라우저에 GitHub 키를 저장하는 이름
    storagePrefix: 'hoojeonju',         // 이 브라우저에 설정·임시저장본을 저장하는 이름 앞부분
  };

  // 1~7번 SEO 설정 기본값 (이 브라우저에 저장된 값이 없을 때 쓰임)
  const DEFAULT_SETTINGS = {
    seoTitle: "전주편평사마귀 무제한 제거 | 후한의원 전주점",
    seoDescription: "전주 완산구 후한의원 전주점 편평사마귀 제거 - 코트라 CO2레이저와 침 치료를 병행해 재발까지 관리합니다. 허정위 대표원장.",
    seoKeywords: "전주편평사마귀, 전주점제거, 전주사마귀, 후한의원 전주점, 전주쥐젖, 전주비립종",
    siteDomain: "https://jjhoowart.co.kr/",
    naverVerify: "7ea1a5c6cee02d5d806af3f44a5f014078f7c837",
    googleVerify: "yZd46Ityn4BO7WtfGqjIA3ovc6VnzkO5WfvgerHyybM",
    ogImage: "",
    ogSiteName: "후한의원 전주점",
    ogType: "website",
    twitterCard: "summary_large_image",
    bizName: "후한의원 전주점",
    bizDoctor: "허정위",
    bizPhone: "063-251-1050",
    bizStreet: "온고을로 20 더즌빌딩 2층",
    bizCity: "전주시 완산구",
    bizRegion: "전라북도",
    bizPostal: "",
    bizLat: "",
    bizLng: "",
    bizPriceRange: "₩₩ (25,000원~)",
    bizSpecialty: "한의원 · 피부 병변 클리닉 (편평사마귀·쥐젖·비립종 제거)",
    hours: [
      {day:'월', code:'Mo', closed:false, open:'10:30', close:'20:30'},
      {day:'화', code:'Tu', closed:false, open:'10:30', close:'20:30'},
      {day:'수', code:'We', closed:false, open:'10:30', close:'20:30'},
      {day:'목', code:'Th', closed:true,  open:'10:30', close:'20:30'},
      {day:'금', code:'Fr', closed:false, open:'10:30', close:'20:30'},
      {day:'토', code:'Sa', closed:false, open:'10:00', close:'14:00'},
      {day:'일', code:'Su', closed:true,  open:'10:00', close:'14:00'},
    ],
    faqItems: [
      {q:'편평사마귀 제거 후 어떻게 관리하나요?', a:'시술 부위가 아물기까지 3~7일 정도는 항생 연고나 습윤 밴드로 보호해 주세요. 딱지가 생기면 손으로 떼지 말고 자연스럽게 떨어질 때까지 기다려야 흉터·색소침착을 예방할 수 있습니다.'},
      {q:'쥐젖, 비립종도 같이 제거되나요?', a:'네, 정확한 감별 진단 후 편평사마귀와 함께 쥐젖·비립종 등을 동시에 제거할 수 있습니다. 병변 종류와 범위에 따라 추가 비용이 발생할 수 있어 상담 시 함께 확인해 드립니다.'},
      {q:'침 치료는 왜 함께 진행하나요?', a:'편평사마귀는 바이러스성 질환이라 겉으로 보이는 병변만 없애면 재발하기 쉽습니다. 침 치료로 국소 면역력을 높여 재발 가능성을 낮추는 방향까지 함께 관리합니다.'},
      {q:'치료 후 화장은 언제부터 가능한가요?', a:'습윤 밴드를 붙인 경우 겉면 위로는 다음 날부터 가벼운 화장이 가능합니다. 밴드를 붙이지 않았다면 미세한 상처가 있을 수 있어 며칠간 자극을 피하는 것이 좋습니다. 정확한 시기는 시술 후 안내드립니다.'},
      {q:'목요일에도 진료하나요?', a:'후한의원 전주점은 목요일과 일요일은 휴진입니다. 월·화·수·금은 10:30~20:30, 토요일은 10:00~14:00(점심시간 없이) 진료합니다.'},
    ],
    bots: [
      {name:'GPTBot', label:'GPTBot (OpenAI 학습/검색)', allow:true},
      {name:'ChatGPT-User', label:'ChatGPT-User (OpenAI 사용자 열람)', allow:true},
      {name:'OAI-SearchBot', label:'OAI-SearchBot (OpenAI 검색 노출)', allow:true},
      {name:'Google-Extended', label:'Google-Extended (Google AI 답변)', allow:true},
      {name:'PerplexityBot', label:'PerplexityBot (Perplexity)', allow:true},
      {name:'ClaudeBot', label:'ClaudeBot (Anthropic 크롤러)', allow:true},
      {name:'anthropic-ai', label:'anthropic-ai (Anthropic)', allow:true},
      {name:'Applebot-Extended', label:'Applebot-Extended (Apple Intelligence)', allow:true},
      {name:'CCBot', label:'CCBot (Common Crawl, 다수 LLM 학습원)', allow:true},
      {name:'Bytespider', label:'Bytespider (ByteDance)', allow:false},
    ],
    llmsSummary: "전라북도 전주시 완산구에 위치한 후한의원 전주점은 코트라 CO2레이저와 침 치료를 병행해 편평사마귀·쥐젖·비립종을 제거하고 재발까지 관리하는 한의원입니다.",
    llmsDetail: "",
    lastmod: "2026-09-07",
  };

  const api = {SITE: SITE, DEFAULT_SETTINGS: DEFAULT_SETTINGS};
  if (typeof module === 'object' && module.exports) module.exports = api;
  else { root.HOO_SITE = SITE; root.HOO_DEFAULT_SETTINGS = DEFAULT_SETTINGS; }
})(typeof globalThis !== 'undefined' ? globalThis : this);
