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
├─ columns/                # 원장 컬럼 (각각 독립 URL = SEO/GEO 단위)
│  ├─ index.json             # 컬럼 목록 원본 — 관리 도구가 발행할 때 이 파일 기준으로 병합
│  ├─ data/column-XX.json    # 글마다 편집용 원본 값
│  └─ column-XX.html         # 실제 글 페이지
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

관리 도구(어드민)는 이 폴더에 없습니다. 같은 저장소의 `admin` 브랜치에 따로 있습니다 (§5).

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

## 5. 원장 컬럼 & SEO/GEO 관리 도구 (v2.0)

관리 도구는 이 저장소의 **`admin` 브랜치**에 있고, Cloudflare Pages(GitHub 연결)로 배포됩니다.
홈페이지(`main` 브랜치, GitHub Pages)에는 올라가지 않습니다.

- 설치·사용법: `admin` 브랜치의 `어드민-설치-순서.md`
- 만드는 규칙·구조·검증 방법: `admin` 브랜치의 `어드민-제작-가이드.md`

### 컬럼 발행 방식

관리 도구는 발행할 때마다 이 저장소의 `columns/index.json`(컬럼 목록 원본)을 먼저 읽고,
**지금 쓰는 글 1개만** 파일명(slug) 기준으로 추가·수정한 뒤 나머지 글은 그대로 둡니다.
발행 전에 "발행 후 몇 개, 추가·수정·유지·삭제" 확인 화면을 보여주고, 바뀌는 파일은 커밋 1개로 한꺼번에 올립니다.

| 파일 | 발행할 때 바뀌는 부분 |
|---|---|
| `columns/index.json` | 해당 글 항목만 추가·수정 (삭제는 [삭제]를 눌렀을 때만) |
| `columns/data/<파일명>.json`, `columns/<파일명>.html` | 해당 글 파일만 |
| `columns.html` | `COLUMNS:START` ~ `COLUMNS:END` 사이 카드 목록만 |
| `sitemap.xml` | 컬럼 주소만 (홈 등 다른 주소는 그대로) |
| `llms.txt` | `## 원장 컬럼` 구역의 컬럼 줄만 |

> - `columns.html`의 `COLUMNS:START` / `COLUMNS:END` 주석은 자동 갱신 표식이니 지우지 마세요.
> - 컬럼을 **손으로** 추가·삭제할 때는 `columns/index.json`도 같이 고쳐야 합니다. (관리 도구를 쓰면 자동)
> - `사이트에-올리기.bat`은 예전(v1) 폴더 연결 방식용입니다. 지금은 쓰지 않습니다.

### 버전

| 태그 | 내용 |
|---|---|
| `v1.0` | 관리 도구 v1의 덮어쓰기로 사라졌던 컬럼을 복원한 상태 (컬럼 9편) |
| `v2.0` | 컬럼 목록 원본(`columns/index.json`, `columns/data/`) 도입 — 관리 도구 v2.0과 함께 사용 |

### ⚠️ 컬럼 원고 관련 주의

`column-01`~`03`은 처음 구축할 때 넣은 **구조 확인용 예시 원고**입니다. 의료광고는 심의 대상이므로, 게시 전 반드시 원장님 감수를 거쳐 실제 원고로 교체하세요. 각 컬럼 하단의 고지 문구("본 컬럼은 일반적인 의학 정보 제공을 목적으로...")는 삭제하지 마세요.

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
