# Teams 단톡방 자동 알림 (이메일 우회, 무료)

단톡방(그룹 채팅)은 무료 웹훅이 안 되고 HTTP 트리거는 Premium이라,
**메일 → Power Automate "새 메일 도착"(무료) → 단톡방 게시** 로 우회한다.

```
[크론] teams_notify.py --email  ──메일──▶  내 메일함  ──[Power Automate]──▶  단톡방 게시
```

## 1. 먼저 미리보기 (아무 설정 없이)

```bash
python3 teams_notify.py --dry-run --meal lunch
```
→ 단톡방에 갈 내용 / 메일 제목·본문이 출력된다.

## 2. 메일 발송 설정 (스크립트 쪽)

환경변수로 SMTP를 지정한다. **사내 메일 릴레이**가 가장 간단(보통 인증 없음).

```bash
export MAIL_SMTP="사내SMTP주소"      # 예: mailrelay.lge.com  (IT/기존 스크립트 참고)
export MAIL_PORT="25"
export MAIL_TO="heejin.suh@lge.com"  # 트리거가 도는 내 메일함
export MAIL_FROM="bobyak-noreply@lge.com"
python3 teams_notify.py --email --meal lunch   # 실제 메일 발송
```
> O365 직접 발송 대안: `MAIL_SMTP=smtp.office365.com MAIL_PORT=587 MAIL_TLS=1 MAIL_USER=... MAIL_PASS=앱암호`
> (단, 회사가 SMTP AUTH를 막아뒀으면 사내 릴레이를 써야 함)

메일은 **제목 `[밥약알림] ...`**, 본문은 요약(HTML, 줄바꿈 포함)으로 나간다.

## 3. Power Automate 흐름 (무료)

1. <https://make.powerautomate.com> → **자동화된 클라우드 흐름**
2. **트리거:** Office 365 Outlook **"새 전자 메일이 도착하면 (V3)"**
   - 폴더: 받은 편지함
   - **고급 옵션 → 제목 필터:** `[밥약알림]`
3. **액션:** Microsoft Teams **"채팅 또는 채널에 메시지 게시"** (← 아까 만든 그 액션)
   - 다음으로 게시: **흐름 봇**
   - 게시 위치: **그룹 채팅** → **Magok Lunch Task**
   - **메시지:** 동적 콘텐츠 **본문(Body)** 선택
4. 저장 → 끝! (메일이 오면 자동으로 단톡방에 게시)

## 4. 크론 등록 (평일 점심 11시 / 저녁 17시)

```cron
0 11 * * 1-5  cd /home/worker/asf/bobyak && MAIL_SMTP="..." MAIL_TO="heejin.suh@lge.com" python3 teams_notify.py --email --meal lunch
0 17 * * 1-5  cd /home/worker/asf/bobyak && MAIL_SMTP="..." MAIL_TO="heejin.suh@lge.com" python3 teams_notify.py --email --meal dinner
```

## 설정값 (환경변수)

| 변수 | 기본값 | 설명 |
|------|--------|------|
| `BOBYAK_GROUP` | `5nqsm8yk` | 모임 id (`?g=...`) |
| `MAIL_SMTP` | (필수) | SMTP 서버 |
| `MAIL_PORT` / `MAIL_FROM` / `MAIL_TO` | 25 / noreply / heejin | 메일 설정 |
| `MAIL_TLS` / `MAIL_USER` / `MAIL_PASS` | (옵션) | STARTTLS·인증 필요 시 |

> 참고: Teams **채널**이면 무료 Incoming Webhook도 가능 → `TEAMS_WEBHOOK` 설정 후 `--card`.
