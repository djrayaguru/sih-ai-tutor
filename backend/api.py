import os
os.environ["HF_HUB_OFFLINE"] = "1"

import json
import re
import uuid
from datetime import datetime

import faiss
from sentence_transformers import SentenceTransformer
import google.generativeai as genai
from dotenv import load_dotenv
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

load_dotenv()
genai.configure(api_key=os.getenv("GEMINI_API_KEY"))

CONFIDENCE_THRESHOLD = 0.3
GAPS_FILE = "gaps.json"

print("Loading chunks and index...")
with open("chunks.json", "r", encoding="utf-8") as f:
    chunks = json.load(f)

index = faiss.read_index("materials.index")
embed_model = SentenceTransformer("all-MiniLM-L6-v2")
llm = genai.GenerativeModel("gemini-3.6-flash")

app = FastAPI()
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
    allow_methods=["*"],
    allow_headers=["*"],
)

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

def get_difficulty(topic):
    if not os.path.exists(GAPS_FILE):
        return "medium"
    with open(GAPS_FILE, "r") as f:
        gaps = json.load(f)
    topic_attempts = [g for g in gaps if topics_match(g["topic"], topic)]
    if not topic_attempts:
        return "medium"
    accuracy = sum(1 for g in topic_attempts if g["correct"]) / len(topic_attempts)
    if accuracy >= 0.7:
        return "hard"
    elif accuracy <= 0.4:
        return "easy"
    return "medium"

def log_gap(topic, correct, difficulty):
    gaps = []
    if os.path.exists(GAPS_FILE):
        with open(GAPS_FILE, "r") as f:
            gaps = json.load(f)
    gaps.append({"topic": topic, "correct": correct, "difficulty": difficulty, "timestamp": datetime.now().isoformat()})
    with open(GAPS_FILE, "w") as f:
        json.dump(gaps, f, indent=2)

# in-memory store for problems awaiting judging — fine for a hackathon demo
active_problems = {}
asked_problems_by_topic = {}

class AskRequest(BaseModel):
    query: str

@app.post("/api/ask")
def ask(req: AskRequest):
    results = retrieve(req.query)
    top_score = results[0]["score"]

    if top_score < CONFIDENCE_THRESHOLD:
        return {"refused": True, "answer": "I don't have enough information in the provided materials to answer that.", "sources": []}

    context = "\n\n---\n\n".join(f"[Source: {r['source_file']}, page {r['page']}]\n{r['text']}" for r in results)

    prompt = f"""You are a tutor. Format ALL mathematical notation using LaTeX wrapped in dollar signs (e.g. $\\frac{{A}}{{B}}$, $x^2$, $\\binom{{n}}{{r}}$) — never write math as plain text without dollar-sign delimiters.

Using ONLY the context below, respond to the student's question:
- If the student is asking you to SOLVE a specific problem and get a final numeric/algebraic answer: do NOT give the final answer. Explain the method and steps only, walk through their exact problem as the example, stop right before the final step, and encourage them to try it themselves.
- If the student is asking to UNDERSTAND a concept, method, or definition: answer it directly and clearly.
- If the context does not contain enough information to answer, say so clearly — do not guess.

Always mention which page number(s) your answer comes from.

Context:
{context}

Student question: {req.query}

Your response:"""

    response = llm.generate_content(prompt)
    return {"refused": False, "answer": response.text, "sources": [{"source_file": r["source_file"], "page": r["page"]} for r in results]}


class GenerateRequest(BaseModel):
    topic: str

@app.post("/api/practice/generate")
def generate_problem_endpoint(req: GenerateRequest):
    results = retrieve(req.topic, top_k=6)
    if results[0]["score"] < CONFIDENCE_THRESHOLD:
        return {"error": "Not enough material on this topic to generate a practice problem."}

    difficulty = get_difficulty(req.topic)
    context = "\n\n".join(r["text"] for r in results)

    previously_asked = asked_problems_by_topic.get(req.topic, [])
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

    generation_config = {"temperature": 0.9}

    raw_response = llm.generate_content(prompt, generation_config=generation_config).text
    try:
        data = extract_json(raw_response)
    except Exception as e:
        print(f"[generate_problem] JSON parse failed: {e}\nRaw response: {raw_response}")
        try:
            raw_response = llm.generate_content(prompt, generation_config=generation_config).text
            data = extract_json(raw_response)
        except Exception as e2:
            print(f"[generate_problem] Retry also failed: {e2}\nRaw response: {raw_response}")
            return {"error": "Could not generate a problem right now — try again."}

    asked_problems_by_topic.setdefault(req.topic, []).append(data["problem"])

    problem_id = str(uuid.uuid4())
    active_problems[problem_id] = data
    return {"problem_id": problem_id, "problem": data["problem"], "topic": data["topic"], "difficulty": data["difficulty"]}


class JudgeRequest(BaseModel):
    problem_id: str
    student_answer: str

@app.post("/api/practice/judge")
def judge_answer_endpoint(req: JudgeRequest):
    problem_data = active_problems.get(req.problem_id)
    if not problem_data:
        return {"error": "This problem has expired — generate a new one."}

    prompt = f"""Question: {problem_data['problem']}
Correct answer: {problem_data['answer']}
Student's answer: {req.student_answer}

Judge if correct, accepting equivalent forms. Respond with ONLY valid JSON:
{{"correct": true or false, "feedback": "one short sentence"}}"""

    try:
        judgment = extract_json(llm.generate_content(prompt).text)
    except Exception:
        judgment = {"correct": False, "feedback": "Could not evaluate answer."}

    log_gap(problem_data["topic"], judgment["correct"], problem_data.get("difficulty", "medium"))
    del active_problems[req.problem_id]
    return {"correct": judgment["correct"], "feedback": judgment["feedback"], "correct_answer": problem_data["answer"]}

@app.get("/api/insights")
def get_insights():
    if not os.path.exists(GAPS_FILE):
        return {"topics": [], "total_attempts": 0}
    with open(GAPS_FILE, "r") as f:
        gaps = json.load(f)
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