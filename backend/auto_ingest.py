import os

import re
import json
import hashlib
import faiss
import numpy as np
from pypdf import PdfReader
from fastembed import TextEmbedding

MATERIALS_DIR = "materials"
CHUNKS_FILE = "chunks.json"
INDEX_FILE = "materials.index"
MANIFEST_FILE = "processed_files.json"
CHUNK_SIZE_WORDS = 150
OVERLAP_WORDS = 30

# Lazy-loaded, not loaded at import time: api.py does `import auto_ingest`,
# and a module-level TextEmbedding(...) here would load a SECOND ~250MB
# copy of the model into memory on every backend startup (api.py already
# loads its own). That would very likely blow past Render's 512MB free-tier
# limit again. This only actually loads if something calls embed_and_append
# without passing its own embed_model in (i.e. running this file directly).
_model = None


def get_default_model():
    global _model
    if _model is None:
        _model = TextEmbedding(model_name="sentence-transformers/all-MiniLM-L6-v2")
    return _model


def file_hash(filepath):
    """Content-based hash so renamed-but-identical files aren't reprocessed,
    and edited files (same name, new content) ARE reprocessed."""
    h = hashlib.sha256()
    with open(filepath, "rb") as f:
        h.update(f.read())
    return h.hexdigest()

def read_pdf(filepath):
    reader = PdfReader(filepath)
    return [(i + 1, page.extract_text() or "") for i, page in enumerate(reader.pages)]


def read_txt(filepath):
    with open(filepath, "r", encoding="utf-8") as f:
        return [(1, f.read())]


def chunk_text(text, page_num, source_file, subject=None, uploaded_by=None):
    """subject/uploaded_by are optional so bulk directory ingestion (run_ingestion,
    no teacher attached) and single-file teacher uploads (ingest_single_file) can
    share this same chunker. Old chunks in chunks.json simply won't have these keys
    — retrieve() in api.py doesn't depend on them, they're metadata for the teacher
    portal (which subject/teacher a chunk of grounding material came from)."""
    words = [w for w in re.split(r"\s+", text.strip()) if w]
    chunks = []
    start = 0
    while start < len(words):
        chunk_words = words[start:start + CHUNK_SIZE_WORDS]
        if len(chunk_words) < 10:
            break
        chunk = {
            "text": " ".join(chunk_words),
            "source_file": source_file,
            "page": page_num
        }
        if subject:
            chunk["subject"] = subject
        if uploaded_by:
            chunk["uploaded_by"] = uploaded_by
        chunks.append(chunk)
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
    index = embed_and_append(new_chunks_for_indexing, all_chunks)
    save_manifest(manifest)

    print(f"\nDone. Files processed: {files_processed_this_run}")
    print(f"Total chunks in system: {len(all_chunks)}")
    print(f"Total vectors in index: {index.ntotal}")


def embed_and_append(new_chunks_for_indexing, all_chunks, embed_model=None):
    """Shared by run_ingestion() and ingest_single_file(): embeds the newly
    produced chunks, appends their vectors to the FAISS index on disk, and
    rewrites chunks.json with the full (old + new) chunk list. Accepts an
    optional already-loaded embed_model so callers that already have a
    TextEmbedding instance in memory (like api.py) don't need to load the
    model a second time."""
    embed_model = embed_model or get_default_model()
    texts = [c["text"] for c in new_chunks_for_indexing]
    embeddings = np.array(list(embed_model.embed(texts)), dtype="float32")
    faiss.normalize_L2(embeddings)

    index = load_or_create_index(embeddings.shape[1])
    index.add(embeddings)

    faiss.write_index(index, INDEX_FILE)
    save_chunks(all_chunks)
    return index


def ingest_single_file(filepath, subject=None, uploaded_by=None, embed_model=None):
    """Ingest one already-saved file (e.g. from a teacher's upload through the API)
    into the same chunks.json / materials.index the rest of the app reads from.
    Reuses the exact same reading/chunking/embedding logic as run_ingestion() so a
    teacher-uploaded PDF is retrieved identically to the files that shipped with
    the app — it's just tagged with which subject/teacher it came from.

    Returns the number of chunks the file produced. Raises ValueError if the file
    type is unsupported or no extractable text was found (e.g. a scanned PDF with
    no text layer), so the caller can surface a clear error instead of silently
    doing nothing.
    """
    filename = os.path.basename(filepath)
    lower = filename.lower()
    if lower.endswith(".pdf"):
        pages = read_pdf(filepath)
    elif lower.endswith(".txt"):
        pages = read_txt(filepath)
    else:
        raise ValueError("Only PDF or TXT files are supported.")

    file_chunks = []
    for page_num, text in pages:
        if text.strip():
            file_chunks.extend(chunk_text(text, page_num, filename, subject=subject, uploaded_by=uploaded_by))

    if not file_chunks:
        raise ValueError("Couldn't extract any readable text from this file (is it a scanned/image-only PDF?).")

    all_chunks = load_chunks()
    all_chunks.extend(file_chunks)
    embed_and_append(file_chunks, all_chunks, embed_model=embed_model)

    # Keep the manifest in sync so a later bulk run_ingestion() (e.g. the
    # watch_materials.py script, or redeploying) doesn't reprocess this file
    # a second time if it also happens to sit in MATERIALS_DIR.
    manifest = load_manifest()
    manifest[filename] = file_hash(filepath)
    save_manifest(manifest)

    return len(file_chunks)


if __name__ == "__main__":
    run_ingestion()