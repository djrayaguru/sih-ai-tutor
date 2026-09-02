"""
SQLite storage for student practice attempts, tutor conversation history,
users (students + teachers), and teacher-uploaded materials.

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


def _add_column_if_missing(conn, table, column, ddl):
    """SQLite has no 'ADD COLUMN IF NOT EXISTS', so check pragma table_info
    first. Lets us evolve an existing gaps.db (with real user rows already in
    it) without anyone having to delete the file and lose their data."""
    existing = {row["name"] for row in conn.execute(f"PRAGMA table_info({table})")}
    if column not in existing:
        conn.execute(f"ALTER TABLE {table} ADD COLUMN {ddl}")


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
    conn.execute("""
        CREATE TABLE IF NOT EXISTS conversations (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            student_id TEXT NOT NULL,
            query TEXT NOT NULL,
            context TEXT NOT NULL,
            explanation TEXT NOT NULL,
            timestamp TEXT NOT NULL
        )
    """)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            email TEXT NOT NULL UNIQUE,
            hashed_password TEXT NOT NULL,
            created_at TEXT NOT NULL
        )
    """)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS breakthroughs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            topic TEXT NOT NULL,
            explanation TEXT NOT NULL,
            created_at TEXT NOT NULL
        )
    """)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS materials (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            teacher_email TEXT NOT NULL,
            subject TEXT NOT NULL,
            filename TEXT NOT NULL,
            original_filename TEXT NOT NULL,
            chunk_count INTEGER NOT NULL,
            uploaded_at TEXT NOT NULL
        )
    """)

    # New in this version: a role column on users ('student' or 'teacher').
    # Added via migration rather than in the CREATE TABLE above so existing
    # gaps.db files (with real signups already in them) upgrade in place.
    _add_column_if_missing(conn, "users", "role", "role TEXT NOT NULL DEFAULT 'student'")

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


def log_conversation(student_id, query, context, explanation):
    conn = get_connection()
    conn.execute(
        "INSERT INTO conversations (student_id, query, context, explanation, timestamp) VALUES (?, ?, ?, ?, ?)",
        (student_id, query, context, explanation, datetime.now().isoformat())
    )
    conn.commit()
    conn.close()


def get_conversation_history(student_id):
    conn = get_connection()
    rows = conn.execute(
        "SELECT * FROM conversations WHERE student_id = ? ORDER BY id ASC",
        (student_id,)
    ).fetchall()
    conn.close()
    return [dict(r) for r in rows]


def clear_conversation_history(student_id):
    """Optional: lets a student/frontend explicitly start a fresh session without old topics
    being eligible as follow-up targets forever."""
    conn = get_connection()
    conn.execute("DELETE FROM conversations WHERE student_id = ?", (student_id,))
    conn.commit()
    conn.close()


def create_user(name, email, hashed_password, role="student"):
    conn = get_connection()
    conn.execute(
        "INSERT INTO users (name, email, hashed_password, created_at, role) VALUES (?, ?, ?, ?, ?)",
        (name, email, hashed_password, datetime.now().isoformat(), role)
    )
    conn.commit()
    conn.close()


def get_user_by_email(email):
    conn = get_connection()
    row = conn.execute("SELECT * FROM users WHERE email = ?", (email,)).fetchone()
    conn.close()
    return dict(row) if row else None


def get_all_users():
    conn = get_connection()
    rows = conn.execute("SELECT id, name, email, role, created_at FROM users").fetchall()
    conn.close()
    return [dict(r) for r in rows]


def log_breakthrough(topic, explanation):
    conn = get_connection()
    conn.execute(
        "INSERT INTO breakthroughs (topic, explanation, created_at) VALUES (?, ?, ?)",
        (topic, explanation, datetime.now().isoformat())
    )
    conn.commit()
    conn.close()


def get_all_breakthroughs():
    conn = get_connection()
    rows = conn.execute("SELECT * FROM breakthroughs ORDER BY id DESC").fetchall()
    conn.close()
    return [dict(r) for r in rows]


def create_material(teacher_email, subject, filename, original_filename, chunk_count):
    conn = get_connection()
    conn.execute(
        "INSERT INTO materials (teacher_email, subject, filename, original_filename, chunk_count, uploaded_at) "
        "VALUES (?, ?, ?, ?, ?, ?)",
        (teacher_email, subject, filename, original_filename, chunk_count, datetime.now().isoformat())
    )
    conn.commit()
    conn.close()


def get_materials_by_teacher(teacher_email):
    conn = get_connection()
    rows = conn.execute(
        "SELECT * FROM materials WHERE teacher_email = ? ORDER BY id DESC", (teacher_email,)
    ).fetchall()
    conn.close()
    return [dict(r) for r in rows]


def get_all_materials():
    conn = get_connection()
    rows = conn.execute("SELECT * FROM materials ORDER BY id DESC").fetchall()
    conn.close()
    return [dict(r) for r in rows]


def get_distinct_subjects():
    conn = get_connection()
    rows = conn.execute("SELECT DISTINCT subject FROM materials ORDER BY subject ASC").fetchall()
    conn.close()
    return [r["subject"] for r in rows]


# Ensures the tables exist the moment this module is imported anywhere,
# so nobody has to remember a separate setup step.
init_db()
