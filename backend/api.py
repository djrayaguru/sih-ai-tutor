import os

import json
import re
import time
import uuid
import auth
import auto_ingest

import faiss
import numpy as np
from fastembed import TextEmbedding
import google.generativeai as genai
from google.api_core.exceptions import ResourceExhausted
from dotenv import load_dotenv
from fastapi import FastAPI, Depends, Header, HTTPException, UploadFile, File, Form
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

import db

load_dotenv()

GEMINI_API_KEYS = [k for k in [os.getenv("GEMINI_API_KEY"), os.getenv("GEMINI_API_KEY_BACKUP")] if k]
if not GEMINI_API_KEYS:
    raise RuntimeError("No GEMINI_API_KEY configured in environment variables.")

_key_index = 0
genai.configure(api_key=GEMINI_API_KEYS[_key_index])


def switch_to_next_key():
    """Rotate to the next configured Gemini API key. Returns True if a fresh
    key was available to switch to, False if we're already on the last one."""
    global _key_index
    if _key_index + 1 >= len(GEMINI_API_KEYS):
        return False
    _key_index += 1
    genai.configure(api_key=GEMINI_API_KEYS[_key_index])
    print(f"[Quota hit — switched to backup Gemini API key #{_key_index + 1}]")
    return True


CONFIDENCE_THRESHOLD = 0.3

print("Loading chunks and index...")
with open("chunks.json", "r", encoding="utf-8") as f:
    chunks = json.load(f)

index = faiss.read_index("materials.index")
embed_model = TextEmbedding(model_name="sentence-transformers/all-MiniLM-L6-v2")
llm = genai.GenerativeModel("gemini-3.6-flash")

app = FastAPI()
app.add_middleware(
    CORSMiddleware,
    allow_origin_regex=r"http://(localhost|127\.0\.0\.1):\d+|https://.*\.vercel\.app",
    allow_methods=["*"],
    allow_headers=["*"],
)


def get_current_user(authorization: str = Header(None)):
    """Reads 'Authorization: Bearer <token>', decodes it, and returns
    {"email": ..., "role": ...}. Raises 401 if the header is missing or the
    token is invalid/expired. Existing endpoints (ask, practice, insights)
    intentionally don't use this — they still work for anonymous/local-id
    students exactly as before. Only the new teacher-only endpoints require it."""
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing or malformed Authorization header.")
    token = authorization.removeprefix("Bearer ").strip()
    user = auth.decode_access_token(token)
    if not user:
        raise HTTPException(status_code=401, detail="Invalid or expired token. Please sign in again.")
    return user


def require_teacher(user: dict = Depends(get_current_user)):
    if user["role"] != "teacher":
        raise HTTPException(status_code=403, detail="This action is only available to teacher accounts.")
    return user


MATERIALS_DIR = "materials"
ALLOWED_MATERIAL_EXTENSIONS = {".pdf", ".txt"}
MAX_MATERIAL_UPLOAD_BYTES = 25 * 1024 * 1024  # 25MB

ALLOWED_UPLOAD_MIME_TYPES = {
    "image/jpeg", "image/png", "image/webp", "image/heic", "image/heif", "application/pdf"
}
MAX_CHAT_UPLOAD_BYTES = 15 * 1024 * 1024  # 15MB — Gemini's inline-data limit has headroom above this


JSON_GENERATION_CONFIG = genai.GenerationConfig(response_mime_type="application/json")


def safe_generate(prompt, max_retries=5, base_delay=8, json_mode=False):
    """json_mode=True tells Gemini's API to constrain its output to syntactically
    valid JSON (response_mime_type="application/json"). This is what actually fixes
    'Invalid \\escape' crashes: prompt instructions asking for LaTeX like \\frac{A}{B}
    inside a JSON string are not enough on their own — the model needs to be told, at
    the API level, that backslashes must be escaped as \\\\ to stay valid JSON. Only
    pass this for prompts whose response will be parsed with extract_json(); plain
    text answers should keep the default."""
    delay = base_delay
    generation_config = JSON_GENERATION_CONFIG if json_mode else None
    for attempt in range(max_retries):
        try:
            return llm.generate_content(prompt, generation_config=generation_config)
        except ResourceExhausted as e:
            if switch_to_next_key():
                continue  # retry immediately on the fresh key, no need to wait
            if "PerDay" in str(e):
                raise RuntimeError(
                    "Gemini free-tier DAILY quota exhausted. Resets at midnight Pacific Time "
                    "(roughly midday IST). Enable billing on your Google AI Studio project, or wait."
                ) from e
            if attempt == max_retries - 1:
                raise
            print(f"[Rate limit hit — waiting {delay}s before retry {attempt + 1}/{max_retries}]")
            time.sleep(delay)
            delay *= 2


def retrieve(query, top_k=3):
    query_vec = np.array(list(embed_model.embed([query])), dtype="float32")
    faiss.normalize_L2(query_vec)
    scores, indices = index.search(query_vec, top_k)
    return [{**chunks[idx], "score": float(score)} for score, idx in zip(scores[0], indices[0])]


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
    etc. control-char escape from the model (e.g. a newline inside "solution")
    would also get doubled into a literal two-character "\\n" rather than an
    actual newline. That's acceptable here because json_mode should make the
    model escape correctly in the first place — this only runs as a fallback."""
    def fix(match):
        nxt = match.group(1)
        if nxt in _LEGAL_LONE_ESCAPES:
            return match.group(0)
        if nxt == "u" and re.fullmatch(r"[0-9a-fA-F]{4}", match.string[match.end():match.end() + 4]):
            return match.group(0)
        return "\\\\" + nxt
    return re.sub(r"\\(.)", fix, text)


def extract_json(text):
    text = re.sub(r"^```json\s*|\s*```$", "", text.strip())
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        return json.loads(sanitize_json_backslashes(text))


def fix_unwrapped_latex(text):
    """Gemini sometimes forgets to wrap a line of LaTeX in $...$ even when
    instructed to. Auto-wrap any line that contains raw LaTeX commands
    (\\frac, \\left, \\times, etc.) but no $ delimiters at all."""
    if not text:
        return text

    latex_command_pattern = re.compile(r"\\[a-zA-Z]+|[\^_]\{")

    def fix_line(line):
        if "$" in line:
            return line  # already has at least one delimiter, leave it alone
        if latex_command_pattern.search(line):
            return f"${line.strip()}$"
        return line

    return "\n".join(fix_line(line) for line in text.split("\n"))


STOPWORDS = {"a", "an", "the", "is", "are", "what", "explain", "tell", "me", "can", "you", "of", "in", "to", "and", "how", "do", "does"}

def normalize_topic(topic):
    words = re.findall(r"[a-z0-9]+", topic.lower())
    return set(w for w in words if w not in STOPWORDS)


def topics_match(topic_a, topic_b):
    words_a, words_b = normalize_topic(topic_a), normalize_topic(topic_b)
    if not words_a or not words_b:
        return False
    overlap = words_a & words_b
    return len(overlap) / min(len(words_a), len(words_b)) >= 0.5

def get_relevant_breakthroughs(topic, limit=2):
    all_breakthroughs = db.get_all_breakthroughs()
    matching = [b for b in all_breakthroughs if topics_match(b["topic"], topic)]
    return matching[:limit]

def get_difficulty(student_id, topic):
    student_attempts = db.get_attempts_for_student(student_id)
    topic_attempts = [g for g in student_attempts if topics_match(g["topic"], topic)]
    if not topic_attempts:
        return "medium"
    accuracy = sum(1 for g in topic_attempts if g["correct"]) / len(topic_attempts)
    if accuracy >= 0.7:
        return "hard"
    elif accuracy <= 0.4:
        return "easy"
    return "medium"


PREREQUISITE_MAP = {
    "linear equation": ["solving basic algebraic equations", "plotting points on a coordinate plane"],
    "binomial theorem": ["exponents and powers", "permutations and combinations (nCr)"],
    "probability": ["basic fractions and ratios", "counting outcomes"],
}


SOURCE_PATTERN = re.compile(r"\[Source: (.+?), page (\d+)\]")


def extract_sources_from_context(context):
    seen = set()
    sources = []
    for file, page in SOURCE_PATTERN.findall(context):
        key = (file, page)
        if key not in seen:
            seen.add(key)
            sources.append({"source_file": file, "page": int(page)})
    return sources


def is_struggling(student_id, topic):
    attempts = db.get_attempts_for_student(student_id)
    topic_attempts = [g for g in attempts if topics_match(g["topic"], topic)]
    topic_attempts.sort(key=lambda g: g["id"])
    recent = topic_attempts[-3:]
    if len(recent) < 2:
        return False
    wrong_count = sum(1 for g in recent if not g["correct"])
    return wrong_count >= 2


def get_prerequisite_suggestion(topic):
    for key, prereqs in PREREQUISITE_MAP.items():
        if topics_match(key, topic):
            return prereqs[0]
    return None


def find_followup_target(student_id, new_query):
    history = db.get_conversation_history(student_id)
    if not history:
        return None

    history_list = "\n".join(f"{i}: {entry['query']}" for i, entry in enumerate(history))

    prompt = f"""Here is the list of questions asked so far in this session, in order:
{history_list}

The student's NEW message is: "{new_query}"

Does this new message refer back to one of the earlier questions (e.g. "explain that again",
"go back to what you said about X") — even if other topics came in between?

If yes, respond with ONLY the number of the question it refers to (e.g. "2").
If no, respond with ONLY the word: new"""

    result = safe_generate(prompt).text.strip().lower()
    if result == "new" or not result.isdigit():
        return None
    index_ = int(result)
    return history[index_] if 0 <= index_ < len(history) else None


def build_concept_prompt(query, context, previous_explanation=None, breakthrough_examples=None):
    base_instructions = """You are a warm, enthusiastic tutor who genuinely loves helping students have
"aha" moments. Answer the student's question using ONLY the concepts and facts in the context
below — do not use outside knowledge.

Format ALL mathematical notation using LaTeX wrapped in dollar signs (e.g. $\\frac{{A}}{{B}}$, $x^2$).

Teach like a real tutor sitting next to the student, not a textbook:
1. Open with a relatable, everyday analogy or a one-line reason this concept actually matters.
2. Give a simple, plain-language explanation of the idea.
3. Break down any formula or definition piece by piece.
4. Walk through one concrete worked example, step by step, thinking out loud.
5. If the context includes a common mix-up or edge case, mention it briefly and warmly.
6. End by asking: "Did that make sense?"

Keep the tone encouraging and human. Do not just copy the textbook's wording."""

    if breakthrough_examples:
        examples_text = "\n\n".join(f"- {b['explanation'][:400]}..." for b in breakthrough_examples)
        base_instructions += f"""

Here are explanations that previously helped OTHER students finally understand a similar topic:
{examples_text}

You may draw inspiration from the analogy or framing style used above if it fits, but do NOT copy
it verbatim — adapt it naturally to this student's specific question and this context."""

    if previous_explanation:
        base_instructions += f"""

IMPORTANT: The student did NOT understand your previous explanation, quoted below. Explain this
concept in a genuinely DIFFERENT way this time — different analogy, different starting point,
or a different worked example.

Your previous explanation:
\"\"\"{previous_explanation}\"\"\""""

    return f"""{base_instructions}

If the context does not contain enough information, say so clearly.
Always mention which page number(s) your explanation comes from.

Context:
{context}

Student question: {query}

Answer:"""


def build_upload_prompt(query):
    """For photos/PDFs a student uploads directly in chat — e.g. a photo of a
    homework problem or their own handwritten attempt at one. Unlike
    build_concept_prompt, there's no retrieved textbook context to ground this
    in; the content the student uploaded IS the context, so the model is told
    to read it carefully instead of being restricted to a chunk of material."""
    return f"""You are a warm, encouraging tutor. A student has uploaded a photo or document —
read everything visible in it (handwritten or printed text, diagrams, equations, tables) carefully
before answering.

The student's question about it: "{query or 'Can you help me understand or solve what is shown here?'}"

- If it shows a problem to solve, walk through the solution step by step, thinking out loud like a
  tutor sitting next to the student — don't just state the final answer.
- If it shows the student's own worked attempt, point out specifically what they did right and
  exactly where any mistake is, rather than only marking it right or wrong.
- Format ALL mathematical notation using LaTeX wrapped in dollar signs (e.g. $\\frac{{A}}{{B}}$, $x^2$).
- If the image/document is unreadable, blurry, or not academic content, say so clearly and ask the
  student to retake or reupload it — don't guess at content you can't actually make out.
- End by asking: "Did that make sense?\""""


asked_problems_by_topic = {}


class AskRequest(BaseModel):
    query: str
    student_id: str


@app.post("/api/ask")
def ask(req: AskRequest):
    try:
        target = find_followup_target(req.student_id, req.query)

        if target:
            context = target["context"]
            effective_query = target["query"]
            previous_explanation = target["explanation"]
            is_followup = True
            breakthroughs = None
        else:
            results = retrieve(req.query)
            top_score = results[0]["score"]

            if top_score < CONFIDENCE_THRESHOLD:
                return {"refused": True, "answer": "I don't have enough information in the provided materials to answer that.", "sources": []}

            context = "\n\n---\n\n".join(f"[Source: {r['source_file']}, page {r['page']}]\n{r['text']}" for r in results)
            effective_query = req.query
            previous_explanation = None
            is_followup = False
            breakthroughs = get_relevant_breakthroughs(req.query)

        prompt = build_concept_prompt(effective_query, context, previous_explanation, breakthroughs)
        response = safe_generate(prompt)

        db.log_conversation(req.student_id, effective_query, context, response.text)

        return {
        "refused": False,
        "answer": response.text,
        "is_followup": is_followup,
        "used_breakthrough": bool(breakthroughs),
        "awaiting_feedback": True,
        "sources": extract_sources_from_context(context)
        }
    except Exception as e:
        print(f"[/api/ask] failed: {e}")
        return {"refused": True, "answer": f"⚠️ {e}", "sources": []}


class FeedbackRequest(BaseModel):
    student_id: str
    understood: bool


@app.post("/api/ask/feedback")
def ask_feedback(req: FeedbackRequest):
    history = db.get_conversation_history(req.student_id)
    if not history:
        return {"error": "No active question to give feedback on."}

    last = history[-1]

    if req.understood:
        db.log_breakthrough(last["query"], last["explanation"])
        return {"message": "Awesome! Glad that clicked. 🎉"}

    try:
        prompt = build_concept_prompt(last["query"], last["context"], last["explanation"])
        response = safe_generate(prompt)
        db.log_conversation(req.student_id, last["query"], last["context"], response.text)
        return {"answer": response.text, "awaiting_feedback": True, "sources": extract_sources_from_context(last["context"])}
    except Exception as e:
        print(f"[/api/ask/feedback] failed: {e}")
        return {"error": f"⚠️ {e}"}


@app.post("/api/ask/upload")
async def ask_with_upload(
    student_id: str = Form(...),
    query: str = Form(""),
    file: UploadFile = File(...),
):
    """Lets a student attach a photo or PDF (e.g. a snapped picture of a homework
    problem or their own worked attempt) instead of, or alongside, typing a question.
    Unlike /api/ask, this doesn't go through the textbook-retrieval/confidence-gate —
    the uploaded file itself is the context the model reads from."""
    content_type = (file.content_type or "").lower()
    if content_type not in ALLOWED_UPLOAD_MIME_TYPES:
        return {"refused": True, "answer": "That file type isn't supported yet — please upload a JPG/PNG photo or a PDF.", "sources": []}

    file_bytes = await file.read()
    if len(file_bytes) > MAX_CHAT_UPLOAD_BYTES:
        return {"refused": True, "answer": "That file is too large (max 15MB) — try a smaller photo or a lower-resolution scan.", "sources": []}
    if not file_bytes:
        return {"refused": True, "answer": "That file came through empty — please try uploading it again.", "sources": []}

    try:
        prompt_parts = [{"mime_type": content_type, "data": file_bytes}, build_upload_prompt(query.strip())]
        response = safe_generate(prompt_parts)
        answer = fix_unwrapped_latex(response.text)

        log_note = f"[Uploaded file: {file.filename}] {query.strip()}".strip()
        db.log_conversation(student_id, log_note, "(student-uploaded file — no textbook context)", answer)

        return {"refused": False, "answer": answer, "awaiting_feedback": True, "sources": []}
    except Exception as e:
        print(f"[/api/ask/upload] failed: {e}")
        return {"refused": True, "answer": f"⚠️ {e}", "sources": []}


@app.get("/api/subjects")
def list_subjects():
    """Subjects available to practice/ask about. Starts with the 3 the app shipped
    with, then adds whatever subjects teachers have uploaded material for — this is
    what makes 'more subjects' possible without a code change: a teacher uploads a
    new subject's material through the portal, and it shows up here immediately."""
    default_subjects = [
        {"key": "linear equation", "label": "Linear Equations"},
        {"key": "binomial theorem", "label": "Binomial Theorem"},
        {"key": "probability", "label": "Probability"},
    ]
    seen_keys = {s["key"] for s in default_subjects}
    for subject in db.get_distinct_subjects():
        key = subject.strip().lower()
        if key and key not in seen_keys:
            seen_keys.add(key)
            default_subjects.append({"key": subject, "label": subject})
    return {"subjects": default_subjects}


class GenerateRequest(BaseModel):
    topic: str
    student_id: str


@app.post("/api/practice/generate")
def generate_problem_endpoint(req: GenerateRequest):
    results = retrieve(req.topic, top_k=6)
    if results[0]["score"] < CONFIDENCE_THRESHOLD:
        return {"error": "Not enough material on this topic to generate a practice problem."}

    difficulty = get_difficulty(req.student_id, req.topic)
    context = "\n\n".join(r["text"] for r in results)

    dedup_key = (req.student_id, req.topic)
    previously_asked = asked_problems_by_topic.get(dedup_key, [])
    avoid_block = ""
    if previously_asked:
        avoid_list = "\n".join(f"- {q}" for q in previously_asked[-5:])
        avoid_block = f"\n\nDo NOT repeat any of these previously asked questions, and don't just reword them — use a different part of the context, different numbers, or a different angle:\n{avoid_list}"

    prompt = f"""Based ONLY on the context below, create ONE {difficulty}-difficulty multiple-choice question
to test a student's understanding of "{req.topic}".
- Write exactly 4 answer options, only one of which is correct.
- The 3 wrong options should be plausible mistakes a student might realistically make, not obviously silly.
- The question must be solvable using only the concepts in this context.
- Format ALL mathematical notation using LaTeX wrapped in dollar signs (e.g. $\\frac{{A}}{{B}}$, $x^2$). This applies to the question, all four options, the explanation, and the solution.{avoid_block}

Also write a clear, step-by-step worked solution explaining HOW to arrive at the correct answer —
written so a student can check their own reasoning against it, regardless of which option they picked.

Context:
{context}

Respond with ONLY valid JSON in this exact format:
{{"question": "the question text", "options": ["option A", "option B", "option C", "option D"], "correct_index": 0, "explanation": "one short sentence explaining why the correct answer is right", "solution": "the full step-by-step worked solution", "topic": "{req.topic}", "difficulty": "{difficulty}"}}
"correct_index" must be the 0-based index into "options" of the correct answer."""

    try:
        raw_response = safe_generate(prompt, json_mode=True).text
        data = extract_json(raw_response)
    except json.JSONDecodeError as e:
        print(f"[generate_problem] JSON parse failed: {e}\nRaw response: {raw_response!r}")
        return {"error": "⚠️ Couldn't generate a valid question that time. Please try again."}
    except Exception as e:
        print(f"[generate_problem] failed: {e}")
        return {"error": f"⚠️ {e}"}

    data["question"] = fix_unwrapped_latex(data["question"])
    data["options"] = [fix_unwrapped_latex(o) for o in data["options"]]
    data["explanation"] = fix_unwrapped_latex(data.get("explanation", ""))
    data["solution"] = fix_unwrapped_latex(data.get("solution", ""))

    asked_problems_by_topic.setdefault(dedup_key, []).append(data["question"])

    return {
        "problem_id": str(uuid.uuid4()),
        "question": data["question"],
        "options": data["options"],
        "correct_index": data["correct_index"],
        "explanation": data.get("explanation", ""),
        "solution": data.get("solution", ""),
        "topic": data["topic"],
        "difficulty": data["difficulty"]
    }


class LogAttemptRequest(BaseModel):
    student_id: str
    topic: str
    correct: bool
    difficulty: str


@app.post("/api/practice/log")
def log_attempt_endpoint(req: LogAttemptRequest):
    db.log_gap(req.student_id, req.topic, req.correct, req.difficulty)

    prerequisite_suggestion = None
    if not req.correct and is_struggling(req.student_id, req.topic):
        prerequisite_suggestion = get_prerequisite_suggestion(req.topic)

    return {"logged": True, "prerequisite_suggestion": prerequisite_suggestion}


@app.get("/api/insights")
def get_insights():
    gaps = db.get_all_attempts()
    if not gaps:
        return {"topics": [], "total_attempts": 0}

    canonical_topics = []
    topic_stats = {}

    for g in gaps:
        t = g["topic"]
        matched = next((c for c in canonical_topics if topics_match(t, c)), None)
        if matched is None:
            canonical_topics.append(t)
            matched = t
            topic_stats[matched] = {"attempts": 0, "wrong": 0}
        topic_stats[matched]["attempts"] += 1
        if not g["correct"]:
            topic_stats[matched]["wrong"] += 1

    topics = sorted(
        [{"topic": t, "attempts": s["attempts"], "struggle_rate": round((s["wrong"] / s["attempts"]) * 100)} for t, s in topic_stats.items()],
        key=lambda x: x["struggle_rate"], reverse=True
    )
    return {"topics": topics, "total_attempts": len(gaps)}


class SignupRequest(BaseModel):
    name: str
    email: str
    password: str
    role: str = "student"


@app.post("/api/auth/signup")
def signup(req: SignupRequest):
    existing = db.get_user_by_email(req.email)
    if existing:
        return {"error": "An account with this email already exists."}

    role = req.role if req.role in ("student", "teacher") else "student"
    hashed = auth.hash_password(req.password)
    db.create_user(req.name, req.email, hashed, role=role)

    token = auth.create_access_token(req.email, role=role)
    return {"token": token, "name": req.name, "email": req.email, "role": role}


class LoginRequest(BaseModel):
    email: str
    password: str


@app.post("/api/auth/login")
def login(req: LoginRequest):
    user = db.get_user_by_email(req.email)
    if not user or not auth.verify_password(req.password, user["hashed_password"]):
        return {"error": "Invalid email or password."}

    role = user.get("role", "student")
    token = auth.create_access_token(req.email, role=role)
    return {"token": token, "name": user["name"], "email": user["email"], "role": role}


@app.post("/api/teacher/materials/upload")
async def upload_material(
    subject: str = Form(...),
    file: UploadFile = File(...),
    current_user: dict = Depends(require_teacher),
):
    """Teacher uploads a PDF/TXT of course material tagged with a subject. It gets
    chunked and embedded into the exact same chunks.json/materials.index that
    /api/ask and /api/practice/generate already read from — as soon as this
    finishes, students can immediately ask about or get quizzed on that subject,
    no server restart needed, because we reload the in-memory chunks/index below."""
    subject = subject.strip()
    if not subject:
        return {"error": "Please provide a subject name for this material."}

    ext = os.path.splitext(file.filename or "")[1].lower()
    if ext not in ALLOWED_MATERIAL_EXTENSIONS:
        return {"error": "Only PDF or TXT files are supported for course material right now."}

    contents = await file.read()
    if len(contents) > MAX_MATERIAL_UPLOAD_BYTES:
        return {"error": "File is too large (max 25MB)."}
    if not contents:
        return {"error": "That file came through empty — please try uploading it again."}

    os.makedirs(MATERIALS_DIR, exist_ok=True)
    stored_name = f"{uuid.uuid4().hex}{ext}"
    filepath = os.path.join(MATERIALS_DIR, stored_name)
    with open(filepath, "wb") as f:
        f.write(contents)

    try:
        chunk_count = auto_ingest.ingest_single_file(
            filepath, subject=subject, uploaded_by=current_user["email"], embed_model=embed_model
        )
    except ValueError as e:
        os.remove(filepath)
        return {"error": str(e)}
    except Exception as e:
        os.remove(filepath)
        print(f"[upload_material] failed: {e}")
        return {"error": f"⚠️ Couldn't process this file: {e}"}

    # Reload so this process's retrieve() sees the new material immediately —
    # ingest_single_file() wrote the updated chunks.json/materials.index to disk,
    # but this running server still has the pre-upload copies in memory.
    global chunks, index
    with open("chunks.json", "r", encoding="utf-8") as f:
        chunks = json.load(f)
    index = faiss.read_index("materials.index")

    db.create_material(current_user["email"], subject, stored_name, file.filename, chunk_count)

    return {"uploaded": True, "filename": file.filename, "subject": subject, "chunks_added": chunk_count}


@app.get("/api/teacher/materials")
def list_materials(current_user: dict = Depends(require_teacher)):
    return {"materials": db.get_materials_by_teacher(current_user["email"])}


@app.get("/api/teacher/insights")
def teacher_insights(current_user: dict = Depends(require_teacher)):
    """Class-wide performance for the teacher dashboard: weakest topics overall,
    plus a per-student breakdown. Deliberately shows accuracy/attempts per student
    rather than individual wrong answers — framed around where students need help,
    not surveillance of exactly what they got wrong."""
    gaps = db.get_all_attempts()
    if not gaps:
        return {"topics": [], "students": [], "total_attempts": 0}

    names_by_email = {u["email"]: u["name"] for u in db.get_all_users()}

    canonical_topics = []
    topic_stats = {}
    student_stats = {}

    for g in gaps:
        t = g["topic"]
        matched = next((c for c in canonical_topics if topics_match(t, c)), None)
        if matched is None:
            canonical_topics.append(t)
            matched = t
            topic_stats[matched] = {"attempts": 0, "wrong": 0}
        topic_stats[matched]["attempts"] += 1
        if not g["correct"]:
            topic_stats[matched]["wrong"] += 1

        sid = g["student_id"]
        if sid not in student_stats:
            student_stats[sid] = {"attempts": 0, "correct": 0, "topics": {}}
        student_stats[sid]["attempts"] += 1
        student_stats[sid]["correct"] += int(bool(g["correct"]))
        student_stats[sid]["topics"].setdefault(matched, {"attempts": 0, "wrong": 0})
        student_stats[sid]["topics"][matched]["attempts"] += 1
        if not g["correct"]:
            student_stats[sid]["topics"][matched]["wrong"] += 1

    topics = sorted(
        [{"topic": t, "attempts": s["attempts"], "struggle_rate": round((s["wrong"] / s["attempts"]) * 100)} for t, s in topic_stats.items()],
        key=lambda x: x["struggle_rate"], reverse=True
    )

    students = []
    for sid, s in student_stats.items():
        weakest_topic = min(
            s["topics"].items(),
            key=lambda kv: (kv[1]["attempts"] - kv[1]["wrong"]) / kv[1]["attempts"]
        )[0] if s["topics"] else None
        students.append({
            "student_id": sid,
            "name": names_by_email.get(sid),
            "attempts": s["attempts"],
            "accuracy": round((s["correct"] / s["attempts"]) * 100),
            "weakest_topic": weakest_topic,
        })
    students.sort(key=lambda s: s["accuracy"])

    return {"topics": topics, "students": students, "total_attempts": len(gaps)}
