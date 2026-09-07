# 후한의원 전주점 편평사마귀 랜딩페이지

VS Code에서 바로 열어서 작업할 수 있는 실제 프로젝트입니다. `index.html` 하나로 완성되어 있고(Tailwind CSS는 CDN으로 불러옴), `assets/images/`에는 자리표시(placeholder) 이미지가 들어 있어 실제 사진으로만 교체하면 바로 배포 가능한 구조입니다.

---

## 1. VS Code에서 열기

1. 이 폴더(`hoo-jeonju-landing`) 전체를 VS Code로 엽니다. (`파일 > 폴더 열기`)
2. 확장 프로그램에서 **Live Server** 설치 (Ritwick Dey 제작, 가장 많이 쓰는 버전)
3. `index.html`을 열고, 우클릭 → **Open with Live Server**
4. 브라우저가 자동으로 열리며 실시간으로 수정사항이 반영됩니다.

npm이나 별도 빌드 과정 없이 바로 확인 가능합니다. (Tailwind는 `cdn.tailwindcss.com` Play CDN을 씁니다 — 개발/프리뷰용으로는 충분하고, 실제 운영 배포 시에는 §6을 참고해 빌드 버전으로 바꾸는 걸 권장합니다.)

---

## 2. 폴더 구조

```
hoo-jeonju-landing/
├─ index.html              # 랜딩페이지 전체 (헤더~푸터, 스타일·스크립트 포함)
├─ columns.html            # 원장 컬럼 목록 페이지 (GNB "원장 컬럼" 메뉴)
├─ columns/                # 개별 컬럼 페이지 (각각 독립 URL = SEO/GEO 단위)
│  ├─ column-01.html         # 편평사마귀, 왜 자꾸 번질까요?
│  ├─ column-02.html         # 쥐젖·비립종과 편평사마귀 감별
│  └─ column-03.html         # 제거 후 재발을 줄이는 생활 관리
├─ admin.html              # SEO/GEO·컬럼 관리 도구 (코드 생성기, 배포 대상 아님)
├─ assets/
│  └─ images/
│     ├─ hero-main.svg       # 히어로 이미지 자리 (인물/시술 사진으로 교체)
│     ├─ doctor-heo.svg      # 허정위 원장 사진 자리
│     ├─ treatment-laser.svg # 코트라 CO2레이저 이미지 자리
│     ├─ treatment-needle.svg# 침 치료 이미지 자리
│     ├─ case1-before.svg / case1-after.svg   # 목 편평사마귀 (18일)
│     ├─ case2-before.svg / case2-after.svg   # 이마 편평사마귀 (약 2개월)
│     ├─ case3-before.svg / case3-after.svg   # 헤어라인 편평사마귀 (침+레이저)
│     └─ case4-before.svg / case4-after.svg   # 볼 편평사마귀 (20일)
└─ README.md
```

---

## 3. 실제 사진으로 교체하는 방법

지금 들어있는 `.svg` 파일은 전부 "자리표시용" 더미 이미지입니다(회색 배경에 라벨 텍스트만 있음). 실제 사진 파일을 같은 이름으로 `assets/images/` 폴더에 덮어씌우면 됩니다.

- 파일 형식은 자유입니다. 예를 들어 `hero-main.jpg`를 쓰고 싶다면, `index.html`에서 `src="assets/images/hero-main.svg"`를 `src="assets/images/hero-main.jpg"`로 바꿔주면 됩니다. (VS Code에서 `Ctrl/Cmd + F`로 파일명 검색 후 일괄 변경 가능)
- 전후사진은 **환자 개인정보가 포함된 민감한 자료**이니, 반드시 병원에서 사용 동의를 받은 사진만 사용하고 워터마크·모자이크 처리가 필요한 부분은 미리 처리해서 넣어주세요.

---

## 4. 내용 확인 / 교체가 꼭 필요한 부분

- [ ] **후기 섹션(`#reviews`)** — 현재 예시 문구 3개가 들어있습니다. 네이버 플레이스·카카오 채널의 실제 후기로 교체하세요.
- [ ] **가격(`#cost`)** — `전주홈피.docx` 원고 기준 이벤트가가 들어있습니다. 게시 전 최신 금액인지 다시 확인하세요.
- [ ] **카카오톡 / 네이버 버튼 링크** — 헤더 우측 플로팅 버튼의 `href`를 실제 카카오 채널 URL, 네이버 예약 URL로 교체하세요. (현재는 임시 링크가 들어있습니다.)
- [ ] **의료광고 심의 문구** — 전후사진 하단 고지 문구("개인에 따라 시술 효과는 차이가...")는 의료법상 필수 표기 사항이니 삭제하지 마세요.

---

## 5. 원장 컬럼 & SEO/GEO 관리 도구 (`admin.html`)

브라우저에서 `admin.html`을 열면 값만 입력해서 아래 코드를 자동 생성할 수 있습니다. **서버·DB 없이 코드를 만들어주는 도구**이며, 입력값은 그 브라우저에만 임시 저장됩니다(다른 기기와 공유되지 않음).

| 탭 | 생성되는 것 | 넣을 위치 |
|---|---|---|
| SEO 메타태그 | title/description/keywords/canonical/OG/Twitter | `index.html`의 `<head>` 안 |
| 구조화 데이터 | MedicalClinic + FAQPage JSON-LD | `index.html`의 `</head>` 직전 |
| robots.txt | AI 크롤러(GPTBot·ClaudeBot·PerplexityBot 등) 허용/차단 | 루트에 `robots.txt`로 저장 |
| llms.txt | 생성형 AI용 사이트 요약 (컬럼 목록 포함) | 루트에 `llms.txt`로 저장 |
| sitemap.xml | 메인 + 컬럼 목록 + 개별 컬럼 URL | 루트에 `sitemap.xml`로 저장 |
| **컬럼 페이지** | 선택한 컬럼의 완성된 HTML 파일 | `columns/` 폴더에 저장 |
| **컬럼 목록 카드** | 목록에 표시될 카드 코드 | `columns.html`의 `<div id="columnGrid">` 안쪽 교체 |

### 새 컬럼 추가하는 순서

> ⚠️ **admin.html은 반드시 Live Server로 여세요.** (`admin.html` 우클릭 → Open with Live Server → `http://127.0.0.1:5500/admin.html`)
> 파일을 더블클릭해서 열면(`file://` 주소) 브라우저 보안 정책상 폴더에 직접 저장하는 기능이 막힙니다.

1. 처음 한 번만: 화면 맨 아래 **`📁 폴더 연결`** → `hoo-jeonju-landing` 폴더(= `index.html`이 있는 폴더) 선택 → 권한 허용
2. **8. 원장 컬럼** 섹션 → **`+ 새 컬럼`**
3. 파일명(slug), 제목, 카테고리, 목록 요약, **메타 설명(description)**, 키워드, 발행일, 본문 입력
   - 본문은 HTML로 씁니다: `<h2>소제목</h2>`, `<p>문단</p>`, `<ul><li>항목</li></ul>`
4. 화면 맨 아래 **`홈페이지에 바로 반영`** 클릭 → 끝

4번 한 번으로 아래가 전부 자동 처리됩니다.

- `columns/<파일명>.html` 생성 (SEO 메타태그 + JSON-LD 포함)
- `columns.html` 목록에 카드 추가 (`COLUMNS:START` ~ `COLUMNS:END` 사이만 교체하므로 나머지 디자인은 그대로)
- `sitemap.xml` 갱신

`columns.html`을 새로고침하면 바로 보입니다. 기존 컬럼을 수정할 때도 같은 버튼을 누르면 됩니다.

> `columns.html`의 `COLUMNS:START` / `COLUMNS:END` 주석은 자동 갱신 표식이니 지우지 마세요.
> 폴더 연결이 안 되는 환경(Firefox/Safari 등)에서는 섹션 8 하단의 "폴더 연결이 안 될 때 (수동 저장)"를 펼쳐 다운로드·붙여넣기로 처리할 수 있습니다.

> `admin.html`은 관리용 도구라 검색엔진에 노출되지 않도록 `noindex`가 걸려 있습니다. 실제 서버에 올릴 때는 접근 제한을 걸거나 아예 업로드하지 않는 편이 안전합니다.

### ⚠️ 컬럼 원고 관련 주의

현재 들어있는 컬럼 3개는 **구조 확인용 예시 원고**입니다. 의료광고는 심의 대상이므로, 게시 전 반드시 원장님 감수를 거쳐 실제 원고로 교체하세요. 각 컬럼 하단의 고지 문구("본 컬럼은 일반적인 의학 정보 제공을 목적으로...")는 삭제하지 마세요.

---

## 6. (선택) 실제 배포 전 Tailwind 빌드로 전환하기

Play CDN(`cdn.tailwindcss.com`)은 개발 중 빠르게 확인하기엔 좋지만, 실제 운영 사이트에는 속도상 빌드 버전을 권장합니다.

```bash
npm init -y
npm install -D tailwindcss postcss autoprefixer
npx tailwindcss init -p
```

`tailwind.config.js`에 `index.html`의 `tailwind.config` 값(컬러 토큰 등)을 그대로 옮기고, `npx tailwindcss -i ./src/input.css -o ./assets/css/style.css --watch`로 빌드한 뒤 `index.html`의 `<script src="https://cdn.tailwindcss.com">`와 `tailwind.config = {...}` 스크립트를 제거하고 `<link rel="stylesheet" href="assets/css/style.css">`로 교체하면 됩니다.

---

## 7. 참고 문서

같이 전달받은 아래 두 파일에 색상/카피/구조 배경 설명이 더 자세히 담겨 있습니다.
- `clinic-landing-coding-guide.md` — 범용 클리닉 랜딩페이지 코딩 구조 가이드
- `hooclinic-jeonju-landing-guide.md` — 후한의원 전주점 전용 데이터(브랜드 컬러, 실측 정보, 카피 원문)
