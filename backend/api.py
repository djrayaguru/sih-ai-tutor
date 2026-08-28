import os
os.environ["HF_HUB_OFFLINE"] = "1"

import json
import re
import time
import uuid
import auth 
import faiss
from sentence_transformers import SentenceTransformer
import google.generativeai as genai
from google.api_core.exceptions import ResourceExhausted
from dotenv import load_dotenv
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

import db

load_dotenv()
genai.configure(api_key=os.getenv("GEMINI_API_KEY"))

CONFIDENCE_THRESHOLD = 0.3

print("Loading chunks and index...")
with open("chunks.json", "r", encoding="utf-8") as f:
    chunks = json.load(f)

index = faiss.read_index("materials.index")
embed_model = SentenceTransformer("all-MiniLM-L6-v2")
llm = genai.GenerativeModel("gemini-3.6-flash")

app = FastAPI()
app.add_middleware(
    CORSMiddleware,
    allow_origin_regex=r"http://(localhost|127\.0\.0\.1):\d+",
    allow_methods=["*"],
    allow_headers=["*"],
)


def safe_generate(prompt, max_retries=5, base_delay=8):
    delay = base_delay
    for attempt in range(max_retries):
        try:
            return llm.generate_content(prompt)
        except ResourceExhausted as e:
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
    query_vec = embed_model.encode([query], convert_to_numpy=True)
    faiss.normalize_L2(query_vec)
    scores, indices = index.search(query_vec, top_k)
    return [{**chunks[idx], "score": float(score)} for score, idx in zip(scores[0], indices[0])]


def extract_json(text):
    text = re.sub(r"^```json\s*|\s*```$", "", text.strip())
    return json.loads(text)


def normalize_topic(topic):
    return set(re.findall(r"[a-z0-9]+", topic.lower()))


def topics_match(topic_a, topic_b):
    words_a, words_b = normalize_topic(topic_a), normalize_topic(topic_b)
    if not words_a or not words_b:
        return False
    overlap = words_a & words_b
    return len(overlap) / min(len(words_a), len(words_b)) >= 0.5


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


def build_concept_prompt(query, context, previous_explanation=None):
    base_instructions = """You are a warm, enthusiastic tutor who genuinely loves helping students have
"aha" moments. Answer the student's question using ONLY the concepts and facts in the context
below — do not use outside knowledge.

Format ALL mathematical notation using LaTeX wrapped in dollar signs (e.g. $\\frac{{A}}{{B}}$, $x^2$).

FIRST, determine what the student wants:
- If they are asking you to SOLVE a specific problem and get a final numeric/algebraic answer
  (however phrased — including "check my answer", "walk me through this one", a specific
  numbered question): you must NOT give the final answer anywhere in your response. Teach the
  METHOD only, walk through their exact problem as the example, stop right before the final
  step, and encourage them to complete that last step themselves.
- If they are asking to UNDERSTAND a concept, method, or definition in general (no single
  specific final answer being sought): teach it fully using the approach below.

FORMATTING RULES — this matters a lot, follow it strictly:
- Use a short markdown header (###) for each major section (e.g. "### The Idea", "### Worked Example", "### Watch Out For").
- Keep every paragraph to 2-3 sentences MAX. If you have more to say, start a new paragraph or use a bullet list instead.
- If you're presenting more than one related case or example (like "what if X" / "what if Y"), ALWAYS use a bullet list, one bullet per case — never cram them into one paragraph.
- Always leave the content feeling spacious and easy to scan, never a dense wall of text.

Teach like a real tutor sitting next to the student, not a textbook:
1. Open with a relatable, everyday analogy or a one-line reason this concept actually matters.
2. Give a simple, plain-language explanation of the idea.
3. Break down any formula or definition piece by piece.
4. Walk through one concrete worked example, step by step, thinking out loud (for solve-requests, stop right before the final answer as instructed above).
5. If the context includes a common mix-up or edge case, mention it briefly and warmly, as a bullet list if there's more than one.
6. End by asking: "Did that make sense?"

Keep the tone encouraging and human. Do not just copy the textbook's wording."""

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


active_problems = {}
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
        else:
            results = retrieve(req.query)
            top_score = results[0]["score"]

            if top_score < CONFIDENCE_THRESHOLD:
                return {"refused": True, "answer": "I don't have enough information in the provided materials to answer that.", "sources": []}

            context = "\n\n---\n\n".join(f"[Source: {r['source_file']}, page {r['page']}]\n{r['text']}" for r in results)
            effective_query = req.query
            previous_explanation = None
            is_followup = False

        prompt = build_concept_prompt(effective_query, context, previous_explanation)
        response = safe_generate(prompt)

        db.log_conversation(req.student_id, effective_query, context, response.text)

        return {
            "refused": False,
            "answer": response.text,
            "is_followup": is_followup,
            "awaiting_feedback": True
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
        return {"message": "Awesome! Glad that clicked. 🎉"}

    try:
        prompt = build_concept_prompt(last["query"], last["context"], last["explanation"])
        response = safe_generate(prompt)
        db.log_conversation(req.student_id, last["query"], last["context"], response.text)
        return {"answer": response.text, "awaiting_feedback": True}
    except Exception as e:
        print(f"[/api/ask/feedback] failed: {e}")
        return {"error": f"⚠️ {e}"}


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
        avoid_block = f"\n\nDo NOT repeat any of these previously asked problems, and don't just reword them — use a different part of the context, different numbers, or a different angle:\n{avoid_list}"

    prompt = f"""Based ONLY on the context below, create ONE {difficulty}-difficulty practice problem
to test a student's understanding of "{req.topic}".
The problem must be solvable using only the concepts in this context.{avoid_block}

Context:
{context}

Respond with ONLY valid JSON: {{"problem": "the question text", "answer": "the correct answer", "topic": "{req.topic}", "difficulty": "{difficulty}"}}"""

    try:
        raw_response = safe_generate(prompt).text
        data = extract_json(raw_response)
    except Exception as e:
        print(f"[generate_problem] failed: {e}")
        return {"error": f"⚠️ {e}"}

    asked_problems_by_topic.setdefault(dedup_key, []).append(data["problem"])

    problem_id = str(uuid.uuid4())
    active_problems[problem_id] = data
    return {"problem_id": problem_id, "problem": data["problem"], "topic": data["topic"], "difficulty": data["difficulty"]}


class JudgeRequest(BaseModel):
    problem_id: str
    student_answer: str
    student_id: str


@app.post("/api/practice/judge")
def judge_answer_endpoint(req: JudgeRequest):
    problem_data = active_problems.get(req.problem_id)
    if not problem_data:
        return {"error": "This problem has expired — generate a new one."}

    prompt = f"""Question: {problem_data['problem']}
Correct answer: {problem_data['answer']}
Student's answer: {req.student_answer}

First, judge if the student's answer is correct. Accept equivalent forms: different notation,
simplified vs unsimplified, with/without units if implied, and different letter casing
(e.g. treat "a" and "A" as the same variable).

Then provide a clear, step-by-step worked solution showing HOW to solve this problem correctly —
written so the student can check their own method against it, regardless of whether they got the
right answer. Walk through the reasoning step by step, not just the final calculation.

Respond with ONLY valid JSON in this exact format:
{{"correct": true or false, "feedback": "one short sentence on whether they got it right", "solution": "the full step-by-step worked solution"}}"""

    try:
        judgment = extract_json(safe_generate(prompt).text)
    except Exception as e:
        print(f"[judge_answer] JSON parse failed: {e}")
        judgment = {"correct": False, "feedback": "Could not evaluate answer.", "solution": "Not available."}

    db.log_gap(req.student_id, problem_data["topic"], judgment["correct"], problem_data.get("difficulty", "medium"))
    del active_problems[req.problem_id]
    return {
        "correct": judgment["correct"],
        "feedback": judgment["feedback"],
        "correct_answer": problem_data["answer"],
        "solution": judgment.get("solution", "Not available.")
    }


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


@app.post("/api/auth/signup")
def signup(req: SignupRequest):
    existing = db.get_user_by_email(req.email)
    if existing:
        return {"error": "An account with this email already exists."}

    hashed = auth.hash_password(req.password)
    db.create_user(req.name, req.email, hashed)

    token = auth.create_access_token(req.email)
    return {"token": token, "name": req.name, "email": req.email}


class LoginRequest(BaseModel):
    email: str
    password: str


@app.post("/api/auth/login")
def login(req: LoginRequest):
    user = db.get_user_by_email(req.email)
    if not user or not auth.verify_password(req.password, user["hashed_password"]):
        return {"error": "Invalid email or password."}

    token = auth.create_access_token(req.email)
    return {"token": token, "name": user["name"], "email": user["email"]}