#!/usr/bin/env python3
"""bobyak → Teams 자동 알림 (크론 POC)

Supabase에서 그 날 밥약 현황을 읽어 Teams 채널에 요약을 게시한다.
표준 라이브러리만 사용(설치 불필요).

환경변수(또는 아래 기본값):
  BOBYAK_SUPA_URL   Supabase 프로젝트 URL
  BOBYAK_SUPA_KEY   anon 키 (공개 키, RLS로 보호)
  BOBYAK_GROUP      모임 id (?g=... 값)
  TEAMS_WEBHOOK     Teams Incoming Webhook 또는 Power Automate "웹훅 수신" URL

사용:
  python3 teams_notify.py --dry-run            # 전송 안 하고 미리보기
  python3 teams_notify.py --meal lunch         # 점심 강제
  TEAMS_WEBHOOK="https://..." python3 teams_notify.py   # 실제 전송

크론 예 (평일 11시 점심, 17시 저녁):
  0 11 * * 1-5  cd /home/worker/asf/bobyak && TEAMS_WEBHOOK="..." python3 teams_notify.py --meal lunch
  0 17 * * 1-5  cd /home/worker/asf/bobyak && TEAMS_WEBHOOK="..." python3 teams_notify.py --meal dinner
"""
import os, json, argparse, datetime, urllib.request, urllib.error
import smtplib
from email.mime.text import MIMEText
from email.utils import formataddr

SUPA_URL = os.environ.get("BOBYAK_SUPA_URL", "https://wrtboawksvrqzjapsyym.supabase.co")
SUPA_KEY = os.environ.get("BOBYAK_SUPA_KEY",
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6IndydGJvYXdrc3ZycXpqYXBzeXltIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODE1MTA1NzksImV4cCI6MjA5NzA4NjU3OX0.PcBrhUmvFxKdLCARTpMZF5Kg9xZs3WR6g1TKqWFMJ3g")
GROUP_ID = os.environ.get("BOBYAK_GROUP", "5nqsm8yk")          # Magok Lunch Task
WEBHOOK  = os.environ.get("TEAMS_WEBHOOK", "")
APP_LINK = "https://bob-yak.vercel.app"

KST = datetime.timezone(datetime.timedelta(hours=9))
WD = "월화수목금토일"  # datetime.weekday(): 월=0


def supa_get(path):
    req = urllib.request.Request(
        f"{SUPA_URL}/rest/v1/{path}",
        headers={"apikey": SUPA_KEY, "Authorization": f"Bearer {SUPA_KEY}"})
    with urllib.request.urlopen(req, timeout=15) as r:
        return json.load(r)


def attends(status, meal):
    return status in ("both", "full") or status == meal


def build(meal, now):
    date = now.strftime("%Y-%m-%d")
    grp = supa_get(f"groups?id=eq.{GROUP_ID}&select=name,members")
    if not grp:
        raise SystemExit(f"모임을 찾을 수 없음: {GROUP_ID}")
    name, members = grp[0]["name"], grp[0]["members"]

    status_by = {r["member"]: r["status"]
                 for r in supa_get(f"absences?group_id=eq.{GROUP_ID}&date=eq.{date}&select=member,status")}
    note_by = {(r["member"], r["meal"]): r["text"]
               for r in supa_get(f"notes?group_id=eq.{GROUP_ID}&date=eq.{date}&select=member,meal,text")}

    meet_time = ""
    raw = note_by.get(("##meet##", meal), "")
    if raw:
        try:
            meet_time = json.loads(raw).get("time", "")
        except Exception:
            pass

    present = [m for m in members if attends(status_by.get(m["name"]), meal)]
    absent  = [m for m in members if not attends(status_by.get(m["name"]), meal)]
    eat     = [m for m in present if note_by.get((m["name"], meal + "#eat")) == "1"]

    wd = WD[now.weekday()]
    head = f"[{now.month}/{now.day}({wd}) {'저녁' if meal == 'dinner' else '점심'}]"
    lines = [
        head,
        (f"{meet_time} 집합 · " if meet_time else "") + f"참석 {len(present)}/{len(members)}"
        + (f" · 외식 제안 {len(eat)}" if eat else ""),
        "참석: " + (", ".join(m["name"] for m in present) or "-"),
        "불참: " + (", ".join(m["name"] for m in absent) or "-"),
        f"{APP_LINK}/?g={GROUP_ID}",
    ]
    text = "\n".join(lines)
    card = {
        "@type": "MessageCard", "@context": "https://schema.org/extensions",
        "themeColor": "FF8FA3", "summary": f"{name} 밥약",
        "title": f"{name} · {head}",
        "text": "  \n".join(lines[1:]),  # Teams 마크다운 줄바꿈
    }
    return {"text": text, "card": card, "name": name, "head": head, "lines": lines}


def send_email(subject, html_body):
    host = os.environ.get("MAIL_SMTP", "")
    if not host:
        raise SystemExit("MAIL_SMTP 미설정 (사내 SMTP 서버 주소 필요)")
    port = int(os.environ.get("MAIL_PORT", "25"))
    sender = os.environ.get("MAIL_FROM", "bobyak-noreply@lge.com")
    to = os.environ.get("MAIL_TO", "heejin.suh@lge.com")
    msg = MIMEText(html_body, "html", "utf-8")
    msg["Subject"] = subject
    msg["From"] = formataddr(("밥약 알림", sender))
    msg["To"] = to
    with smtplib.SMTP(host, port, timeout=15) as s:
        if os.environ.get("MAIL_TLS"):
            s.starttls()
        user, pw = os.environ.get("MAIL_USER"), os.environ.get("MAIL_PASS")
        if user and pw:
            s.login(user, pw)
        s.sendmail(sender, [a.strip() for a in to.split(",")], msg.as_string())
    print(f"메일 발송 완료 → {to}")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--meal", choices=["lunch", "dinner"], default=None,
                    help="미지정 시 14시 기준 자동(점심/저녁)")
    ap.add_argument("--dry-run", action="store_true", help="전송 안 하고 미리보기")
    ap.add_argument("--card", action="store_true",
                    help="MessageCard로 전송(채널 Incoming Webhook용)")
    ap.add_argument("--email", action="store_true",
                    help="이메일로 발송 (Power Automate '새 메일 도착' 트리거 → 단톡방 게시용)")
    args = ap.parse_args()

    now = datetime.datetime.now(KST)
    meal = args.meal or ("dinner" if now.hour >= 14 else "lunch")
    r = build(meal, now)
    text = r["text"]
    subject = f"[밥약알림] {r['name']} {r['head']}"
    html_body = "<br>".join(r["lines"])

    if args.dry_run:
        print("===== 미리보기 (단톡방에 갈 내용) =====")
        print(text)
        print("\n===== 이메일 모드 =====")
        print(f"제목: {subject}")
        print(f"본문(HTML): {html_body}")
        print("\n===== 웹훅 모드 payload =====")
        print(json.dumps(r["card"] if args.card else {"text": text}, ensure_ascii=False, indent=2))
        return

    if args.email or (os.environ.get("MAIL_SMTP") and not WEBHOOK):
        send_email(subject, html_body)
        return

    if WEBHOOK:
        payload = r["card"] if args.card else {"text": text}
        body = json.dumps(payload).encode("utf-8")
        req = urllib.request.Request(WEBHOOK, data=body, headers={"Content-Type": "application/json"})
        try:
            with urllib.request.urlopen(req, timeout=15) as resp:
                print(f"웹훅 전송 완료: HTTP {resp.status}")
        except urllib.error.HTTPError as e:
            print(f"전송 실패: HTTP {e.code} {e.read().decode(errors='ignore')}")
        return

    print("[전송 대상 미설정] --email(MAIL_SMTP) 또는 TEAMS_WEBHOOK 필요. --dry-run으로 미리보기.")


if __name__ == "__main__":
    main()
