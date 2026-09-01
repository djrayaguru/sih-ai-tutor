import os
os.environ["HF_HUB_OFFLINE"] = "1"

import json
import os
import re
import time
import faiss
from sentence_transformers import SentenceTransformer
import google.generativeai as genai
from google.api_core.exceptions import ResourceExhausted
from dotenv import load_dotenv
import db

load_dotenv()
genai.configure(api_key=os.getenv("GEMINI_API_KEY"))

CONFIDENCE_THRESHOLD = 0.3


JSON_GENERATION_CONFIG = genai.GenerationConfig(response_mime_type="application/json")


def safe_generate(prompt, max_retries=5, base_delay=8, json_mode=False):
    """
    Retry-with-backoff for free-tier rate limits. A per-DAY quota can't be
    fixed by waiting a few minutes, so we fail fast with a clear message
    instead of burning time on retries that can't succeed.

    json_mode=True constrains Gemini's output to syntactically valid JSON
    (response_mime_type="application/json"). This is what actually prevents
    'Invalid \\escape' crashes: asking for LaTeX like \\frac{A}{B} inside a
    JSON string via prompt instructions alone isn't enough — the model needs
    to be told, at the API level, that backslashes must be escaped as \\\\ to
    stay valid JSON. Only pass this for prompts parsed with extract_json().
    """
    delay = base_delay
    generation_config = JSON_GENERATION_CONFIG if json_mode else None
    for attempt in range(max_retries):
        try:
            return llm.generate_content(prompt, generation_config=generation_config)
        except ResourceExhausted as e:
            if "PerDay" in str(e):
                raise RuntimeError(
                    "Gemini free-tier DAILY quota exhausted for this model/key. "
                    "This resets ~24h after your first call today — retrying now won't help. "
                    "Enable billing (pay-as-you-go) on your Google AI Studio project to remove "
                    "this cap, or wait for the daily reset."
                ) from e
            if attempt == max_retries - 1:
                raise
            print(f"[Rate limit hit — waiting {delay}s before retry {attempt + 1}/{max_retries}]")
            time.sleep(delay)
            delay *= 2

with open("chunks.json", "r", encoding="utf-8") as f:
    chunks = json.load(f)

index = faiss.read_index("materials.index")
embed_model = SentenceTransformer("all-MiniLM-L6-v2")
llm = genai.GenerativeModel("gemini-3.6-flash")


def retrieve(query, top_k=3):
    query_vec = embed_model.encode([query], convert_to_numpy=True)
    faiss.normalize_L2(query_vec)
    scores, indices = index.search(query_vec, top_k)
    return [{**chunks[idx], "score": float(score)} for score, idx in zip(scores[0], indices[0])]


def normalize_topic(topic):
    """Lowercase and strip to bare words, so 'Linear Equations!' and 'linear equation' compare fairly."""
    words = re.findall(r"[a-z0-9]+", topic.lower())
    return set(words)


def topics_match(topic_a, topic_b):
    """True if the topics substantially overlap in wording — catches 'linear equation'
    vs 'linear equation in two variables' as the same topic, without needing exact match."""
    words_a = normalize_topic(topic_a)
    words_b = normalize_topic(topic_b)
    if not words_a or not words_b:
        return False
    overlap = words_a & words_b
    smaller = min(len(words_a), len(words_b))
    return len(overlap) / smaller >= 0.5  # at least half the shorter topic's words match


def get_difficulty(student_id, topic):
    """
    Per-student difficulty. Filters gap history to this student only, so one
    student's accuracy on a topic never affects another student's difficulty
    curve for the same topic. Fuzzy topic matching (topics_match) still
    happens in Python since it's word-overlap logic, not something SQL does
    natively — the database just replaces where the raw attempt rows live.
    """
    student_attempts = db.get_attempts_for_student(student_id)
    topic_attempts = [g for g in student_attempts if topics_match(g["topic"], topic)]
    if not topic_attempts:
        return "medium"

    correct_count = sum(1 for g in topic_attempts if g["correct"])
    accuracy = correct_count / len(topic_attempts)

    if accuracy >= 0.7:
        return "hard"
    elif accuracy <= 0.4:
        return "easy"
    else:
        return "medium"


_LEGAL_LONE_ESCAPES = set('"\\/')


def sanitize_json_backslashes(text):
    """Safety net for when the model still emits a raw, non-JSON-escaped
    backslash — e.g. LaTeX like \\frac{A}{B} or \\times — despite json_mode.
    json.loads only accepts \\", \\\\, \\/, \\b, \\f, \\n, \\r, \\t, and a
    well-formed \\uXXXX as escapes; anything else raises 'Invalid \\escape'.

    We can't just "leave valid escapes alone": LaTeX commands routinely start
    with the very letters JSON treats as control-char escapes (\\frac, \\times,
    \\right, \\begin, \\nabla, ...), so naively trusting \\f/\\t/\\n/\\r/\\b would
    silently corrupt them into form-feed/tab/newline/etc. characters instead of
    leaving the LaTeX intact. Instead, only \\", \\\\, \\/ and a real \\uXXXX
    (checked for 4 hex digits) are treated as intentional; every other \\X is
    doubled so it survives as a literal backslash. Trade-off: a genuine \\n/\\t/
    etc. control-char escape from the model would also get doubled into a
    literal two-character "\\n" rather than an actual newline — acceptable
    since json_mode should make the model escape correctly in the first
    place; this only runs as a fallback."""
    def fix(match):
        nxt = match.group(1)
        if nxt in _LEGAL_LONE_ESCAPES:
            return match.group(0)
        if nxt == "u" and re.fullmatch(r"[0-9a-fA-F]{4}", match.string[match.end():match.end() + 4]):
            return match.group(0)
        return "\\\\" + nxt
    return re.sub(r"\\(.)", fix, text)


def extract_json(text):
    """LLMs sometimes wrap JSON in markdown fences — strip those before parsing."""
    text = re.sub(r"^```json\s*|\s*```$", "", text.strip())
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        return json.loads(sanitize_json_backslashes(text))


def generate_problem(topic, student_id):
    results = retrieve(topic)
    if results[0]["score"] < CONFIDENCE_THRESHOLD:
        print("Not enough material on this topic to generate a practice problem.")
        return None

    difficulty = get_difficulty(student_id, topic)
    print(f"[Difficulty selected: {difficulty}]")

    context = "\n\n".join(r["text"] for r in results)

    prompt = f"""Based ONLY on the context below, create ONE {difficulty}-difficulty practice problem
to test a student's understanding of "{topic}".
- If difficulty is "easy": test a basic, single-step concept.
- If difficulty is "medium": test a standard multi-step application.
- If difficulty is "hard": test a more complex or combined-concept application.
The problem must be solvable using only the concepts in this context.

Context:
{context}

Respond with ONLY valid JSON, no markdown, no extra text, in this exact format:
{{"problem": "the question text", "answer": "the correct answer", "topic": "{topic}", "difficulty": "{difficulty}"}}"""

    response = safe_generate(prompt, json_mode=True)
    try:
        return extract_json(response.text)
    except Exception as e:
        print(f"Could not parse problem generation: {e}")
        return None


def judge_answer(problem, correct_answer, student_answer):
    prompt = f"""Question: {problem}
Correct answer: {correct_answer}
Student's answer: {student_answer}

First, judge if the student's answer is correct. Accept equivalent forms (e.g. different notation,
simplified vs unsimplified, with/without units if implied).

Then provide a clear, step-by-step worked solution showing HOW to solve this problem correctly —
written so the student can check their own method against it, regardless of whether they got the
right answer. Walk through the reasoning step by step, not just the final calculation.

Respond with ONLY valid JSON in this exact format:
{{"correct": true or false, "feedback": "one short sentence on whether they got it right", "solution": "the full step-by-step worked solution"}}"""

    response = safe_generate(prompt, json_mode=True)
    try:
        return extract_json(response.text)
    except Exception as e:
        print(f"Could not parse judgment: {e}")
        return {"correct": False, "feedback": "Could not evaluate answer.", "solution": "Not available."}


def log_gap(student_id, topic, correct, difficulty):
    db.log_gap(student_id, topic, correct, difficulty)


def practice_session(student_id):
    topic = input("What topic do you want to practice? ")
    problem_data = generate_problem(topic, student_id)
    if not problem_data:
        return

    print(f"\nProblem: {problem_data['problem']}")
    student_answer = input("Your answer: ")

    judgment = judge_answer(problem_data["problem"], problem_data["answer"], student_answer)

    if judgment["correct"]:
        print(f"\n✓ Correct! {judgment['feedback']}")
    else:
        print(f"\n✗ Not quite. {judgment['feedback']}")

    print(f"\nHere's the full worked solution so you can check your method:\n{judgment['solution']}")

    log_gap(student_id, topic, judgment["correct"], problem_data.get("difficulty", "medium"))
    print(f"Logged to {db.DB_FILE}")


if __name__ == "__main__":
    student_id = input("Enter your name/ID to start practicing: ").strip()
    while True:
        practice_session(student_id)
        again = input("\nPractice another topic? (y/n): ")
        if again.lower() != "y":
            break