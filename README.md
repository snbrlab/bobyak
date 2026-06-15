# 🍚 bobyak — 밥약 부재 달력

> 밥 먹고 합시다!

단톡방 멤버들이 **언제 부재인지** 달력에 색깔로 톡톡 찍어 공유하는 귀여운 웹앱.
**모임장이 모임을 만들면 우리만의 링크가 생기고**, 그 링크를 단톡방에 공유하면 끝.
로그인 없음, 사람마다 고유 색.

```
모임 만들기(이름+멤버) → 링크 생성 → 단톡방 공유
→ 각자 이름 선택 → 달력 날짜 탭 → 내 색깔로 부재 표시 (다시 탭하면 취소)
```

## 📁 구성

| 파일 | 역할 |
|------|------|
| `index.html` | 화면 구조 (모임 만들기 / 달력) |
| `styles.css` | 말랑말랑 귀여운 스타일 (폰트: 제목 Jua / 본문 Gowun Dodum) |
| `app.js` | 라우팅 + 모임/달력 로직 + 저장소 추상화 |
| `config.js` | **색 팔레트 + Supabase 키** (여기만 수정) |
| `supabase_schema.sql` | Supabase 테이블 생성 SQL (`groups` + `absences`) |

빌드 과정 없는 순수 정적 사이트라 그대로 Vercel에 올라갑니다.

---

## 1. 로컬에서 바로 보기 (로컬 모드)

```bash
cd /home/worker/asf/bobyak
python3 -m http.server 8000
# 브라우저: http://127.0.0.1:8000
```

`config.js`의 Supabase 키가 비어 있으면 **이 브라우저에만 저장**되는 로컬 모드로
동작해요. UI·폰트·흐름을 먼저 확인하기 좋아요.

> ⚠️ 로컬 모드에선 모임 링크가 **이 브라우저에만** 존재해요.
> 진짜로 단톡방에 링크를 공유하려면 아래 **공유 모드**(Supabase)가 필요합니다.

---

## 2. 공유 모드 켜기 (Supabase, 무료)

1. <https://supabase.com> 가입 → **New project** 생성 (무료)
2. 좌측 **SQL Editor** → `supabase_schema.sql` 내용 붙여넣고 **RUN**
   (테이블 `groups`, `absences` 2개가 생겨요)
3. **Project Settings → API** 에서 두 값 복사:
   - `Project URL`
   - `anon public` key
4. `config.js`의 `supabase` 항목에 붙여넣기:
   ```js
   supabase: {
     url: "https://xxxxx.supabase.co",
     anonKey: "eyJhbGciOi...",
   },
   ```
5. 새로고침 → 푸터가 `· 공유 모드 ·`로 바뀌면 성공! 🎉

> ⚠️ `anon` 키는 브라우저에 노출돼도 되는 공개 키예요(RLS 정책으로 보호).
> 단, 위 스키마는 "누구나 읽기/쓰기" 정책이라 **링크를 아는 사람은 누구나** 수정 가능.
> 사내/지인용으론 충분하지만, 더 잠그려면 정책을 좁히세요.

---

## 3. Vercel 배포

### 방법 A — CLI (제일 빠름)
```bash
npm i -g vercel
cd /home/worker/asf/bobyak
vercel        # 안내 따라가면 끝 (프레임워크: Other)
vercel --prod # 운영 배포
```

### 방법 B — GitHub 연동
1. 이 저장소(<https://github.com/snbrlab/bobyak>)를 Vercel에 연결
2. Vercel 대시보드 → **Add New → Project** → 저장소 선택
3. Framework Preset: **Other**, Build/Output: 비워둠 → Deploy

배포 후, 앱에서 **모임을 만들고 나온 링크(`?g=...`)**를 단톡방에 공유하세요! 📲

---

## 🎨 커스터마이징 한입

- **색 팔레트**: `config.js`의 `palette` (멤버 추가 순서대로 자동 배정)
- **폰트**: `styles.css` 상단 `--font-head` / `--font-body` 한 줄만 변경
  (귀여운 후보: 제목 `"Jua"`, 본문 `"Gowun Dodum"`(깔끔) 또는 `"Dongle"`(더 동글))
- **테마 색**: `styles.css` 상단 `:root` 변수
