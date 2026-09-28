from http.server import ThreadingHTTPServer, BaseHTTPRequestHandler
from pathlib import Path
from urllib.parse import urlsplit
import mimetypes

ROOT = Path(__file__).resolve().parent
REPO = ROOT.parents[3]
FILES = {"/": ROOT / "index.html", "/index.html": ROOT / "index.html", "/dist/main.js": ROOT / "dist/main.js", "/dist/main.css": ROOT / "dist/main.css", "/brand/crewstation-mark-mono.svg": REPO / "apps/console/public/brand/crewstation-mark-mono.svg", "/brand/crewstation-mark.svg": REPO / "apps/console/public/brand/crewstation-mark.svg"}

class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        file = FILES.get(urlsplit(self.path).path)
        if file is None or not file.is_file():
            self.send_error(404)
            return
        data = file.read_bytes()
        self.send_response(200)
        self.send_header("Content-Type", mimetypes.guess_type(file.name)[0] or "application/octet-stream")
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(data)

if __name__ == "__main__":
    print("CrewStation observability demo: http://127.0.0.1:48372", flush=True)
    ThreadingHTTPServer(("127.0.0.1", 48372), Handler).serve_forever()
