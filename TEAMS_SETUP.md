# Teams 단톡방 자동 알림 설정 (POC)

`teams_notify.py`가 Supabase에서 그 날 밥약 현황을 읽어 **요약 텍스트를 POST**한다.
Teams **단톡방(그룹 채팅)** 은 Incoming Webhook을 못 쓰므로 **Power Automate 플로우**를 통해 게시한다.

```
[크론] python3 teams_notify.py  ──POST {"text": "..."}──▶  [Power Automate 웹훅]  ──▶  단톡방에 게시
```

## 1. 먼저 미리보기 (URL 없이도 됨)

```bash
python3 teams_notify.py --dry-run --meal lunch
```
→ 단톡방에 갈 내용이 그대로 출력된다.

## 2. Power Automate 플로우 만들기

1. <https://make.powerautomate.com> → **만들기 → 인스턴트 클라우드 흐름**
2. 트리거: **"HTTP 요청을 받을 때"(When a HTTP request is received)**
   - 요청 본문 JSON 스키마:
     ```json
     { "type": "object", "properties": { "text": { "type": "string" } } }
     ```
3. 새 단계: **Microsoft Teams → "채팅 또는 채널에 메시지 게시"**
   - **게시 위치(Post in):** `Group chat(그룹 채팅)`
   - **그룹 채팅:** 알림 받을 그 **단톡방** 선택
   - **메시지(Message):** 동적 콘텐츠 **`text`** 선택
     - 줄바꿈이 안 보이면 메시지를 `replace(triggerBody()?['text'], decodeUriComponent('%0A'), '<br>')` 로
4. **저장** → 트리거 단계를 열어 **HTTP POST URL 복사**

## 3. URL 넣고 실행

```bash
export TEAMS_WEBHOOK="https://prod-xx.logic.azure.com:443/workflows/...."
python3 teams_notify.py --meal lunch          # 실제 전송
```

## 4. 크론 등록 (평일 점심 11시 / 저녁 17시)

```cron
0 11 * * 1-5  cd /home/worker/asf/bobyak && TEAMS_WEBHOOK="https://..." python3 teams_notify.py --meal lunch
0 17 * * 1-5  cd /home/worker/asf/bobyak && TEAMS_WEBHOOK="https://..." python3 teams_notify.py --meal dinner
```

## 설정값 (환경변수로 덮어쓰기 가능)

| 변수 | 기본값 | 설명 |
|------|--------|------|
| `BOBYAK_GROUP` | `5nqsm8yk` | 모임 id (`?g=...`) |
| `BOBYAK_SUPA_URL` / `BOBYAK_SUPA_KEY` | (내장) | Supabase URL / anon 키 |
| `TEAMS_WEBHOOK` | (없음) | Power Automate 트리거 URL |

> 참고: Teams **채널**(단톡방 아님)에 보낼 거면 채널 Incoming Webhook URL을 `TEAMS_WEBHOOK`에 넣고
> `--card` 옵션으로 실행하면 색 들어간 MessageCard로 게시된다.
