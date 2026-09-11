/**
 * 아이디 · 비밀번호 검사 (Cloudflare Pages — 직접 업로드용)
 *
 * 이 파일은 어드민으로 들어오는 "모든 요청"을 가장 먼저 가로챕니다.
 * 아이디·비밀번호가 맞지 않으면 어떤 파일도 내주지 않습니다.
 *
 * 아이디와 비밀번호는 이 파일에 적지 않습니다.
 * Cloudflare 대시보드 [Settings → Variables and Secrets]에 저장하고 여기서 꺼내 씁니다.
 *   ADMIN_USER : 아이디
 *   ADMIN_PASS : 비밀번호
 */

// 입력이 틀린 위치에 따라 응답 속도가 달라지지 않도록 전체를 비교한다
function safeEqual(a, b) {
  const enc = new TextEncoder();
  const ab = enc.encode(a);
  const bb = enc.encode(b);
  let diff = ab.length ^ bb.length;
  const len = Math.max(ab.length, bb.length);
  for (let i = 0; i < len; i++) {
    diff |= (ab[i] || 0) ^ (bb[i] || 0);
  }
  return diff === 0;
}

function unauthorized() {
  return new Response('인증이 필요합니다. 아이디와 비밀번호를 입력해 주세요.', {
    status: 401,
    headers: {
      // 브라우저가 아이디·비밀번호 입력창을 띄우게 하는 헤더
      // realm 값은 HTTP 규격상 영문만 가능하다 (한글을 넣으면 응답 자체가 깨진다)
      'WWW-Authenticate': 'Basic realm="Hoo Jeonju Admin", charset="UTF-8"',
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  });
}

export default {
  async fetch(request, env) {
    const USER = env.ADMIN_USER;
    const PASS = env.ADMIN_PASS;

    // 환경 변수를 아직 설정하지 않았다면, 뚫린 채로 열리지 않도록 막는다
    if (!USER || !PASS) {
      return new Response(
        '설정 오류: Cloudflare 대시보드에서 환경 변수 ADMIN_USER 와 ADMIN_PASS 를 먼저 설정한 뒤 재배포해 주세요.',
        { status: 500, headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' } }
      );
    }

    const header = request.headers.get('Authorization') || '';
    if (!header.startsWith('Basic ')) return unauthorized();

    let decoded;
    try {
      // atob 은 바이트만 다루므로, 한글 비밀번호도 되도록 UTF-8 로 되돌린다
      const raw = atob(header.slice(6));
      const bytes = Uint8Array.from(raw, (c) => c.charCodeAt(0));
      decoded = new TextDecoder('utf-8').decode(bytes);
    } catch (e) {
      return unauthorized();
    }

    // 비밀번호에 콜론이 들어가도 되도록 첫 번째 콜론에서만 자른다
    const sep = decoded.indexOf(':');
    if (sep < 0) return unauthorized();
    const user = decoded.slice(0, sep);
    const pass = decoded.slice(sep + 1);

    // 아이디와 비밀번호를 항상 둘 다 검사한다 (한쪽만 맞아도 통과 금지)
    if (!(safeEqual(user, USER) & safeEqual(pass, PASS))) return unauthorized();

    // 통과 — 실제 파일을 내주되, 검색엔진·중간 캐시에 남지 않게 한다
    const response = await env.ASSETS.fetch(request);
    const out = new Response(response.body, response);
    out.headers.set('X-Robots-Tag', 'noindex, nofollow');
    out.headers.set('Cache-Control', 'no-store');
    return out;
  },
};
