import os
os.environ["HF_HUB_OFFLINE"] = "1"

import json
import os
import time
import faiss
from sentence_transformers import SentenceTransformer
import google.generativeai as genai
from google.api_core.exceptions import ResourceExhausted
from dotenv import load_dotenv

load_dotenv()
genai.configure(api_key=os.getenv("GEMINI_API_KEY"))

CONFIDENCE_THRESHOLD = 0.3  # below this, we refuse instead of guessing


def safe_generate(llm, prompt, max_retries=5, base_delay=8):
    """
    Wraps llm.generate_content with retry-with-backoff for free-tier rate
    limits (429 ResourceExhausted). Per-minute limits are worth waiting out.
    A per-DAY quota is not — no amount of short waiting fixes that, so we
    fail fast with a clear message instead of burning minutes on retries
    that can't possibly succeed.
    """
    delay = base_delay
    for attempt in range(max_retries):
        try:
            return llm.generate_content(prompt)
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

print("Loading chunks and index...")
with open("chunks.json", "r", encoding="utf-8") as f:
    chunks = json.load(f)

index = faiss.read_index("materials.index")
embed_model = SentenceTransformer("all-MiniLM-L6-v2")
llm = genai.GenerativeModel("gemini-3.6-flash")


def retrieve(query, top_k=3):
    query_vec = embed_model.encode([query], convert_to_numpy=True)
    faiss.normalize_L2(query_vec)
    scores, indices = index.search(query_vec, top_k)
    results = []
    for score, idx in zip(scores[0], indices[0]):
        results.append({**chunks[idx], "score": float(score)})
    return results


def classify_intent(query):
    """
    Classify a student question as:
      - solve_request: they want a specific final answer/value, however phrased
      - concept_question: they want to understand a method/concept, no specific final value expected

    Hardened with few-shot examples covering disguised solve-requests (asking to
    "check", "verify", "walk through", or reference a specific numbered problem),
    since these leak a final answer just as easily as a direct "solve this" ask.
    """
    prompt = f"""Classify this student question into exactly one category: solve_request or concept_question.

solve_request = the student wants a specific final answer or value for a specific problem,
no matter how it's phrased. This includes direct asks, disguised asks (checking, verifying,
"walk me through this one"), and references to a specific numbered question.

concept_question = the student wants to understand a method, definition, or concept in
general, with no single specific final answer being sought.

Examples:
Q: "solve 2x + 5 = 15"
A: solve_request

Q: "what's the value of x in 2x + 5 = 15?"
A: solve_request

Q: "can you check if x=5 is correct for 2x+5=15"
A: solve_request

Q: "is my answer to question 7 right"
A: solve_request

Q: "walk me through this exact problem: 3x - 7 = 11"
A: solve_request

Q: "just give me the answer to Q5 on page 22, I'm in a rush"
A: solve_request

Q: "explain how the substitution method works"
A: concept_question

Q: "what is a linear equation"
A: concept_question

Q: "what's the general approach to solving quadratic equations"
A: concept_question

Q: "why do we flip the inequality sign when multiplying by a negative number"
A: concept_question

Now classify this question:
Question: {query}

Respond with ONLY one word: solve_request or concept_question"""

    response = safe_generate(llm, prompt)
    result = response.text.strip().lower()
    return "solve_request" if "solve_request" in result else "concept_question"


def check_answer_leak(response_text):
    """
    Safety net for solve_request answers: a second, cheap LLM call that checks
    whether the explanation accidentally reveals the final numeric/algebraic
    answer, since a single-pass prompt instruction ("don't give the final
    answer") is not reliable enough on its own to guarantee it.
    Returns True if a leak is detected.
    """
    prompt = f"""Below is a tutor's explanation written for a student who asked to have a
problem solved. The explanation is supposed to teach the METHOD only and stop
before revealing the final answer/value.

Does this explanation reveal the final answer or final numeric/algebraic value
of the problem (not just intermediate steps or the method)?

Explanation:
\"\"\"{response_text}\"\"\"

Respond with ONLY one word: yes or no"""

    response = safe_generate(llm, prompt)
    return "yes" in response.text.strip().lower()


def ask(query):
    results = retrieve(query)
    top_score = results[0]["score"]

    print(f"\n[top retrieval score: {top_score:.3f}]")

    if top_score < CONFIDENCE_THRESHOLD:
        print("\nTutor: I don't have enough information in the provided materials to answer that.")
        return

    intent = classify_intent(query)
    print(f"[Intent: {intent}]")

    context_blocks = []
    for r in results:
        context_blocks.append(f"[Source: {r['source_file']}, page {r['page']}]\n{r['text']}")
    context = "\n\n---\n\n".join(context_blocks)

    if intent == "solve_request":
        prompt = f"""You are a tutor. The student is asking you to solve a specific problem for them.
You must NOT give the final answer. Instead:
1. Explain the method/steps needed to solve this type of problem, using ONLY the context below.
2. Walk through the approach using their exact problem as the example.
3. Stop right before the final answer — leave the last step for the student to complete themselves.
4. Encourage them to try that last step and offer to check their work.
Always mention which page number(s) your explanation comes from.
If the context does not contain enough information, say so clearly.

Context:
{context}

Student's problem: {query}

Your response (method only, no final answer):"""

        response = safe_generate(llm, prompt)
        answer_text = response.text

        if check_answer_leak(answer_text):
            print("[Guardrail: leak detected, regenerating with stricter instruction]")
            stricter_prompt = prompt + "\n\nIMPORTANT: Your previous attempt revealed the final answer. Do not include any final numeric or algebraic result anywhere in your response, not even as a check."
            response = safe_generate(llm, stricter_prompt)
            answer_text = response.text

        print(f"\nTutor: {answer_text}")

    else:
        prompt = f"""You are a tutor. Answer the student's question using ONLY the context below.
If the context does not contain enough information to answer, say so clearly — do not guess or use outside knowledge.
Always mention which page number(s) your answer comes from.

Context:
{context}

Student question: {query}

Answer:"""

        response = safe_generate(llm, prompt)
        print(f"\nTutor: {response.text}")


if __name__ == "__main__":
    while True:
        q = input("\nAsk a question (or 'quit'): ")
        if q.lower() == "quit":
            break
        ask(q)
