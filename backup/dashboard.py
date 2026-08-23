"""
Phase 6 — Teacher dashboard.

Reads gaps.json (per-attempt records across all students, each tagged with
student_id since Phase 6 needs multi-student aggregation) and produces a
self-contained static HTML report: no server, no API — just run this and
open the output file in a browser.

Run from the backend folder:
    python dashboard.py

Framed around misconceptions, not individual surveillance: the report shows
class-level weak-topic breakdowns and averages, not a per-student leaderboard
or list of individual wrong answers.
"""

import json
import os
from collections import defaultdict

GAPS_FILE = "gaps.json"
OUTPUT_FILE = "dashboard.html"


def load_gaps():
    if not os.path.exists(GAPS_FILE):
        return []
    with open(GAPS_FILE, "r") as f:
        return json.load(f)


def aggregate(gaps):
    """
    Groups attempts by topic. Topics aren't merged/fuzzy-matched here the way
    practice.py's topics_match() does for difficulty — the dashboard shows
    topics as students actually typed them, since collapsing wording variants
    silently could hide real phrasing confusion a teacher might want to see.
    """
    by_topic = defaultdict(list)
    students = set()

    for g in gaps:
        topic = g.get("topic", "unknown")
        by_topic[topic].append(g)
        if g.get("student_id"):
            students.add(g["student_id"])

    topic_stats = []
    for topic, attempts in by_topic.items():
        total = len(attempts)
        correct = sum(1 for a in attempts if a.get("correct"))
        accuracy = correct / total if total else 0
        topic_students = set(a.get("student_id") for a in attempts if a.get("student_id"))
        topic_stats.append({
            "topic": topic,
            "attempts": total,
            "correct": correct,
            "accuracy": accuracy,
            "students_attempted": len(topic_students),
            "weak_count": total - correct,
        })

    # Weakest topics first — this is what a teacher opens the dashboard to see
    topic_stats.sort(key=lambda t: t["accuracy"])

    overall_attempts = len(gaps)
    overall_correct = sum(1 for g in gaps if g.get("correct"))
    overall_accuracy = overall_correct / overall_attempts if overall_attempts else 0

    return {
        "enrollment": len(students),
        "overall_attempts": overall_attempts,
        "overall_accuracy": overall_accuracy,
        "topics": topic_stats,
    }


def render_html(data):
    max_weak = max((t["weak_count"] for t in data["topics"]), default=1) or 1

    rows = ""
    bars = ""
    for t in data["topics"]:
        pct = round(t["accuracy"] * 100)
        bar_width = round((t["weak_count"] / max_weak) * 100)
        rows += f"""
        <tr>
          <td>{t['topic']}</td>
          <td>{t['attempts']}</td>
          <td>{t['students_attempted']}</td>
          <td>{pct}%</td>
        </tr>"""
        bars += f"""
        <div class="bar-row">
          <div class="bar-label">{t['topic']} <span class="weak-count">({t['weak_count']} incorrect attempts)</span></div>
          <div class="bar-track"><div class="bar-fill" style="width:{bar_width}%"></div></div>
        </div>"""

    return f"""<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>Class Diagnostic Dashboard</title>
<style>
  body {{ font-family: -apple-system, Segoe UI, sans-serif; background: #f7f7f9; color: #1a1a1a; padding: 40px; }}
  .container {{ max-width: 880px; margin: 0 auto; }}
  h1 {{ font-size: 22px; margin-bottom: 4px; }}
  .subtitle {{ color: #666; margin-bottom: 32px; }}
  .stats {{ display: flex; gap: 16px; margin-bottom: 32px; }}
  .stat-card {{ background: white; border-radius: 10px; padding: 18px 22px; box-shadow: 0 1px 3px rgba(0,0,0,0.08); flex: 1; }}
  .stat-number {{ font-size: 28px; font-weight: 700; }}
  .stat-label {{ color: #666; font-size: 13px; margin-top: 2px; }}
  h2 {{ font-size: 16px; margin-top: 36px; margin-bottom: 14px; }}
  .bar-row {{ margin-bottom: 14px; }}
  .bar-label {{ font-size: 13px; margin-bottom: 4px; }}
  .weak-count {{ color: #999; }}
  .bar-track {{ background: #e8e8ec; border-radius: 6px; height: 14px; overflow: hidden; }}
  .bar-fill {{ background: #d9534f; height: 100%; border-radius: 6px; }}
  table {{ width: 100%; border-collapse: collapse; background: white; border-radius: 10px; overflow: hidden; box-shadow: 0 1px 3px rgba(0,0,0,0.08); }}
  th, td {{ text-align: left; padding: 10px 14px; font-size: 13px; border-bottom: 1px solid #eee; }}
  th {{ color: #666; font-weight: 600; }}
</style>
</head>
<body>
<div class="container">
  <h1>Class Diagnostic Dashboard</h1>
  <div class="subtitle">Based on actual problem-solving performance, not self-reported weakness</div>

  <div class="stats">
    <div class="stat-card">
      <div class="stat-number">{data['enrollment']}</div>
      <div class="stat-label">Students enrolled</div>
    </div>
    <div class="stat-card">
      <div class="stat-number">{data['overall_attempts']}</div>
      <div class="stat-label">Total practice attempts</div>
    </div>
    <div class="stat-card">
      <div class="stat-number">{round(data['overall_accuracy']*100)}%</div>
      <div class="stat-label">Class-wide accuracy</div>
    </div>
  </div>

  <h2>Weakest topics (lowest accuracy first)</h2>
  {bars if bars else '<p style="color:#999">No practice data yet.</p>'}

  <h2>Full breakdown</h2>
  <table>
    <tr><th>Topic</th><th>Attempts</th><th>Students</th><th>Accuracy</th></tr>
    {rows if rows else '<tr><td colspan="4" style="color:#999">No data yet</td></tr>'}
  </table>
</div>
</body>
</html>"""


def main():
    gaps = load_gaps()
    data = aggregate(gaps)
    html = render_html(data)

    with open(OUTPUT_FILE, "w", encoding="utf-8") as f:
        f.write(html)

    print(f"Enrollment: {data['enrollment']} students")
    print(f"Total attempts: {data['overall_attempts']}")
    print(f"Class-wide accuracy: {round(data['overall_accuracy']*100)}%")
    print("\nWeakest topics:")
    for t in data["topics"][:5]:
        print(f"  {t['topic']}: {round(t['accuracy']*100)}% ({t['attempts']} attempts, {t['students_attempted']} students)")
    print(f"\nDashboard written to {OUTPUT_FILE} — open it in a browser.")


if __name__ == "__main__":
    main()
