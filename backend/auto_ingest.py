import os
os.environ["HF_HUB_OFFLINE"] = "1"

import os
import re
import json
import hashlib
import faiss
from pypdf import PdfReader
from sentence_transformers import SentenceTransformer

MATERIALS_DIR = "materials"
CHUNKS_FILE = "chunks.json"
INDEX_FILE = "materials.index"
MANIFEST_FILE = "processed_files.json"
CHUNK_SIZE_WORDS = 150
OVERLAP_WORDS = 30

model = SentenceTransformer("all-MiniLM-L6-v2")

def file_hash(filepath):
    """Content-based hash so renamed-but-identical files aren't reprocessed,
    and edited files (same name, new content) ARE reprocessed."""
    h = hashlib.sha256()
    with open(filepath, "rb") as f:
        h.update(f.read())
    return h.hexdigest()

def read_pdf(filepath):
    reader = PdfReader(filepath)
    return [(i+1, page.extract_text() or"")for i, page in enumerate(reader.pages)]

def read_pdf(filepath):
    reader = PdfReader(filepath)
    return [(i + 1, page.extract_text() or "") for i, page in enumerate(reader.pages)]


def read_txt(filepath):
    with open(filepath, "r", encoding="utf-8") as f:
        return [(1, f.read())]


def chunk_text(text, page_num, source_file):
    words = [w for w in re.split(r"\s+", text.strip()) if w]
    chunks = []
    start = 0
    while start < len(words):
        chunk_words = words[start:start + CHUNK_SIZE_WORDS]
        if len(chunk_words) < 10:
            break
        chunks.append({
            "text": " ".join(chunk_words),
            "source_file": source_file,
            "page": page_num
        })
        start += CHUNK_SIZE_WORDS - OVERLAP_WORDS
    return chunks


def load_manifest():
    if os.path.exists(MANIFEST_FILE):
        with open(MANIFEST_FILE, "r") as f:
            return json.load(f)
    return {}


def save_manifest(manifest):
    with open(MANIFEST_FILE, "w") as f:
        json.dump(manifest, f, indent=2)


def load_chunks():
    if os.path.exists(CHUNKS_FILE):
        with open(CHUNKS_FILE, "r", encoding="utf-8") as f:
            return json.load(f)
    return []


def save_chunks(chunks):
    with open(CHUNKS_FILE, "w", encoding="utf-8") as f:
        json.dump(chunks, f, ensure_ascii=False, indent=2)


def load_or_create_index(dim):
    if os.path.exists(INDEX_FILE):
        return faiss.read_index(INDEX_FILE)
    return faiss.IndexFlatIP(dim)


def run_ingestion():
    manifest = load_manifest()
    all_chunks = load_chunks()

    new_chunks_for_indexing = []
    files_processed_this_run = []

    for filename in os.listdir(MATERIALS_DIR):
        filepath = os.path.join(MATERIALS_DIR, filename)
        if not (filename.lower().endswith(".pdf") or filename.lower().endswith(".txt")):
            continue

        current_hash = file_hash(filepath)

        if manifest.get(filename) == current_hash:
            continue  # unchanged, already processed — skip

        print(f"Processing: {filename}")
        pages = read_pdf(filepath) if filename.lower().endswith(".pdf") else read_txt(filepath)

        file_chunks = []
        for page_num, text in pages:
            if text.strip():
                file_chunks.extend(chunk_text(text, page_num, filename))

        all_chunks.extend(file_chunks)
        new_chunks_for_indexing.extend(file_chunks)
        manifest[filename] = current_hash
        files_processed_this_run.append(filename)
        print(f"  -> {len(file_chunks)} chunks")

    if not new_chunks_for_indexing:
        print("No new or changed files. Index is up to date.")
        return

    print(f"\nEmbedding {len(new_chunks_for_indexing)} new chunks...")
    texts = [c["text"] for c in new_chunks_for_indexing]
    embeddings = model.encode(texts, show_progress_bar=True, convert_to_numpy=True)
    faiss.normalize_L2(embeddings)

    index = load_or_create_index(embeddings.shape[1])
    index.add(embeddings)

    faiss.write_index(index, INDEX_FILE)
    save_chunks(all_chunks)
    save_manifest(manifest)

    print(f"\nDone. Files processed: {files_processed_this_run}")
    print(f"Total chunks in system: {len(all_chunks)}")
    print(f"Total vectors in index: {index.ntotal}")


if __name__ == "__main__":
    run_ingestion()