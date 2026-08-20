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
    else:
        prompt = f"""You are a tutor. Answer the student's question using ONLY the context below.
If the context does not contain enough information to answer, say so clearly — do not guess or use outside knowledge.
Always mention which page number(s) your answer comes from.

Context:
{context}

Student question: {query}

Answer:"""

    response = llm.generate_content(prompt)
    print(f"\nTutor: {response.text}")

if __name__ == "__main__":
    while True:
        q = input("\nAsk a question (or 'quit'): ")
        if q.lower() == "quit":
            break
        ask(q)