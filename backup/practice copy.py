import os
os.environ["HF_HUB_OFFLINE"] = "1"

import json
import os
import re
from datetime import datetime
import faiss
from sentence_transformers import SentenceTransformer
import google.generativeai as genai
from dotenv import load_dotenv

load_dotenv()
genai.configure(api_key=os.getenv("GEMINI_API_KEY"))

CONFIDENCE_THRESHOLD = 0.3
GAPS_FILE = "gaps.json"

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


def get_difficulty(topic):
    if not os.path.exists(GAPS_FILE):
        return "medium"
    with open(GAPS_FILE, "r") as f:
        gaps = json.load(f)

    topic_attempts = [g for g in gaps if topics_match(g["topic"], topic)]
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

def extract_json(text):
    """LLMs sometimes wrap JSON in markdown fences — strip those before parsing."""
    text = re.sub(r"^```json\s*|\s*```$", "", text.strip())
    return json.loads(text)


def generate_problem(topic):
    results = retrieve(topic)
    if results[0]["score"] < CONFIDENCE_THRESHOLD:
        print("Not enough material on this topic to generate a practice problem.")
        return None

    difficulty = get_difficulty(topic)
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

    response = llm.generate_content(prompt)
    try:
        data = extract_json(response.text)
        return data
    except Exception as e:
        print(f"Could not parse problem generation response: {e}")
        return None


def judge_answer(problem, correct_answer, student_answer):
    prompt = f"""Question: {problem}
Correct answer: {correct_answer}
Student's answer: {student_answer}

Judge if the student's answer is correct. Accept equivalent forms (e.g. different notation,
simplified vs unsimplified, with/without units if implied). Respond with ONLY valid JSON:
{{"correct": true or false, "feedback": "one short sentence explaining why"}}"""

    response = llm.generate_content(prompt)
    try:
        return extract_json(response.text)
    except Exception as e:
        print(f"Could not parse judgment: {e}")
        return {"correct": False, "feedback": "Could not evaluate answer."}


def log_gap(topic, correct, difficulty):
    gaps = []
    if os.path.exists(GAPS_FILE):
        with open(GAPS_FILE, "r") as f:
            gaps = json.load(f)
    gaps.append({
        "topic": topic,
        "correct": correct,
        "difficulty": difficulty,
        "timestamp": datetime.now().isoformat()
    })
    with open(GAPS_FILE, "w") as f:
        json.dump(gaps, f, indent=2)


def practice_session():
    topic = input("What topic do you want to practice? ")
    problem_data = generate_problem(topic)
    if not problem_data:
        return

    print(f"\nProblem: {problem_data['problem']}")
    student_answer = input("Your answer: ")

    judgment = judge_answer(problem_data["problem"], problem_data["answer"], student_answer)

    if judgment["correct"]:
        print(f"\n✓ Correct! {judgment['feedback']}")
    else:
        print(f"\n✗ Not quite. {judgment['feedback']}")
        print(f"Correct answer: {problem_data['answer']}")

    log_gap(topic, judgment["correct"], problem_data.get("difficulty", "medium"))
    print(f"Logged to {GAPS_FILE}")


if __name__ == "__main__":
    while True:
        practice_session()
        again = input("\nPractice another topic? (y/n): ")
        if again.lower() != "y":
            break