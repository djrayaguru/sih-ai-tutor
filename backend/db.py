"""
SQLite storage for student practice attempts — replaces gaps.json.

Still just a single file (gaps.db) sitting in the backend folder, no server
to install or configure. What changes vs. flat JSON:
  - safe if multiple students write attempts at the same time
  - queryable directly instead of loading/rewriting the whole file every time
"""

import sqlite3
from datetime import datetime

DB_FILE = "gaps.db"


def get_connection():
    conn = sqlite3.connect(DB_FILE)
    conn.row_factory = sqlite3.Row  # lets us access columns by name, like a dict
    return conn


def init_db():
    conn = get_connection()
    conn.execute("""
        CREATE TABLE IF NOT EXISTS attempts (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            student_id TEXT NOT NULL,
            topic TEXT NOT NULL,
            correct INTEGER NOT NULL,
            difficulty TEXT NOT NULL,
            timestamp TEXT NOT NULL
        )
    """)
    conn.commit()
    conn.close()


def log_gap(student_id, topic, correct, difficulty):
    conn = get_connection()
    conn.execute(
        "INSERT INTO attempts (student_id, topic, correct, difficulty, timestamp) VALUES (?, ?, ?, ?, ?)",
        (student_id, topic, int(bool(correct)), difficulty, datetime.now().isoformat())
    )
    conn.commit()
    conn.close()


def get_attempts_for_student(student_id):
    conn = get_connection()
    rows = conn.execute(
        "SELECT * FROM attempts WHERE student_id = ?", (student_id,)
    ).fetchall()
    conn.close()
    return [dict(r) for r in rows]


def get_all_attempts():
    conn = get_connection()
    rows = conn.execute("SELECT * FROM attempts").fetchall()
    conn.close()
    return [dict(r) for r in rows]


# Ensures the table exists the moment this module is imported anywhere,
# so nobody has to remember a separate setup step.
init_db()
