import time
from watchdog.observers import Observer
from watchdog.events import FileSystemEventHandler
from auto_ingest import run_ingestion, MATERIALS_DIR

DEBOUNCE_SECONDS = 3  # wait a few seconds after last change before processing
                       # (avoids running mid-upload, e.g. while a file is still being copied)

class MaterialsHandler(FileSystemEventHandler):
    def __init__(self):
        self.last_event_time = 0

    def on_any_event(self, event):
        if event.is_directory:
            return
        if not (event.src_path.lower().endswith(".pdf") or event.src_path.lower().endswith(".txt")):
            return
        self.last_event_time = time.time()

def main():
    print(f"Watching '{MATERIALS_DIR}' for new or changed files... (Ctrl+C to stop)")
    handler = MaterialsHandler()
    observer = Observer()
    observer.schedule(handler, MATERIALS_DIR, recursive=False)
    observer.start()

    try:
        while True:
            time.sleep(1)
            # if a file event happened, and enough quiet time has passed, run ingestion
            if handler.last_event_time and (time.time() - handler.last_event_time) > DEBOUNCE_SECONDS:
                print("\nChange detected, running ingestion...")
                run_ingestion()
                handler.last_event_time = 0
                print(f"\nWatching '{MATERIALS_DIR}' again...")
    except KeyboardInterrupt:
        observer.stop()
    observer.join()

if __name__ == "__main__":
    main()