import os
os.environ["HF_HUB_OFFLINE"] = "1"

import json
import os
import faiss
from sentence_transformers import SentenceTransformer
import google.generativeai as genai
from dotenv import load_dotenv

load_dotenv()
genai.configure(api_key=os.getenv("GEMINI_API_KEY"))

CONFIDENCE_THRESHOLD = 0.3  # below this, we refuse instead of guessing

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
    prompt = f"""Classify this student question into exactly one category:
- "solve_request": the student is asking you to solve a specific problem/equation and get a final answer for them (e.g. "solve 2x+5=15", "what's the answer to this", "do this homework question")
- "concept_question": the student is asking to understand a concept, method, or definition (e.g. "explain linear equations", "what is a function", "how do I approach these problems")

Question: {query}

Respond with ONLY one word: solve_request or concept_question"""

    response = llm.generate_content(prompt)
    result = response.text.strip().lower()
    return "solve_request" if "solve_request" in result else "concept_question"

MAX_EXPLANATION_ATTEMPTS = 3

def build_concept_prompt(query, context, previous_explanation=None):
    base_instructions = """You are a warm, enthusiastic tutor who genuinely loves helping students have
"aha" moments. Answer the student's question using ONLY the concepts and facts in the context
below — do not use outside knowledge.

Teach like a real tutor sitting next to the student, not a textbook:
1. Open with a relatable, everyday analogy or a one-line reason this concept actually matters.
2. Give a simple, plain-language explanation of the idea.
3. Break down any formula or definition piece by piece.
4. Walk through one concrete worked example, step by step, thinking out loud.
5. If the context includes a common mix-up or edge case, mention it briefly and warmly.
6. End by asking: "Did that make sense?"

Keep the tone encouraging and human. Do not just copy the textbook's wording."""

    if previous_explanation:
        base_instructions += f"""

IMPORTANT: The student did NOT understand your previous explanation, quoted below. You must
explain this concept in a genuinely DIFFERENT way this time — use a different analogy, start
from a more basic starting point, or use a different worked example. Do not just reword the
same explanation.

Your previous explanation:
\"\"\"{previous_explanation}\"\"\""""

    return f"""{base_instructions}

If the context does not contain enough information, say so clearly.
Always mention which page number(s) your explanation comes from.

Context:
{context}

Student question: {query}

Answer:"""


def ask(query):
    results = retrieve(query)
    top_score = results[0]["score"]

    print(f"\n[top retrieval score: {top_score:.3f}]")

    if top_score < CONFIDENCE_THRESHOLD:
        print("\nTutor: I don't have enough information in the provided materials to answer that.")
        return

    intent = classify_intent(query)
    print(f"[Intent: {intent}]")

    context_blocks = [f"[Source: {r['source_file']}, page {r['page']}]\n{r['text']}" for r in results]
    context = "\n\n---\n\n".join(context_blocks)

    if intent == "solve_request":
        prompt = f"""You are a tutor. The student is asking you to solve a specific problem for them.
You must NOT give the final answer. Instead:
1. Explain the method/steps needed, using ONLY the context below.
2. Walk through the approach using their exact problem as the example.
3. Stop right before the final answer.
4. Encourage them to try that last step.
Always mention which page number(s) your explanation comes from.

Context:
{context}

Student's problem: {query}

Your response (method only, no final answer):"""
        response = llm.generate_content(prompt)
        print(f"\nTutor: {response.text}")
        return

    # concept_question: teach, check understanding, re-teach if needed
    previous_explanation = None
    for attempt in range(1, MAX_EXPLANATION_ATTEMPTS + 1):
        prompt = build_concept_prompt(query, context, previous_explanation)
        response = llm.generate_content(prompt)
        explanation = response.text
        print(f"\nTutor: {explanation}")

        if attempt == MAX_EXPLANATION_ATTEMPTS:
            print("\nTutor: Let's pause here — feel free to ask this a different way, or try a practice problem to build intuition!")
            break

        understood = input("\nDid that make sense? (y/n): ").strip().lower()
        if understood == "y":
            print("\nTutor: Awesome! Glad that clicked. 🎉")
            break
        else:
            print("\n[Re-explaining with a different approach...]")
            previous_explanation = explanation

if __name__ == "__main__":
    while True:
        q = input("\nAsk a question (or 'quit'): ")
        if q.lower() == "quit":
            break
        ask(q)