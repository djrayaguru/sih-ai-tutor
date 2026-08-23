"""
One-time migration: imports existing gaps.json records into gaps.db.

Run once, from the backend folder:
    python migrate_gaps_json_to_db.py

Preserves original timestamps so your existing attempt history isn't
overwritten with today's date. Safe to run even if gaps.db already has
data in it — this just adds the migrated rows on top, it doesn't wipe
anything.

gaps.json is left untouched by this script — delete it yourself once
you've confirmed the migration looks right.
"""

import json
import os
import db

GAPS_JSON = "gaps.json"


def migrate():
    if not os.path.exists(GAPS_JSON):
        print(f"No {GAPS_JSON} found — nothing to migrate.")
        return

    with open(GAPS_JSON, "r") as f:
        gaps = json.load(f)

    if not gaps:
        print(f"{GAPS_JSON} is empty — nothing to migrate.")
        return

    conn = db.get_connection()
    migrated = 0
    skipped = 0

    for g in gaps:
        student_id = g.get("student_id")
        topic = g.get("topic")
        correct = g.get("correct")
        difficulty = g.get("difficulty", "medium")
        timestamp = g.get("timestamp")

        if not student_id:
            # Records logged before student_id tracking existed can't be
            # attributed to anyone, so they can't feed per-student
            # aggregation. Flagged and skipped rather than silently
            # dropped or attributed to a fake placeholder.
            skipped += 1
            continue

        conn.execute(
            "INSERT INTO attempts (student_id, topic, correct, difficulty, timestamp) VALUES (?, ?, ?, ?, ?)",
            (student_id, topic, int(bool(correct)), difficulty, timestamp)
        )
        migrated += 1

    conn.commit()
    conn.close()

    print(f"Migrated {migrated} record(s) into {db.DB_FILE}.")
    if skipped:
        print(f"Skipped {skipped} record(s) with no student_id (logged before multi-student tracking existed).")
    print(f"\n{GAPS_JSON} was left untouched — delete it yourself once you've confirmed this looks right.")


if __name__ == "__main__":
    migrate()
