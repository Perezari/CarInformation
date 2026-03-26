"""
שרת מקומי לאתר איתור רכב — מגיש קבצים + proxy ל-gov.il
הרצה: python server.py
פתח:  http://localhost:8080
"""
import http.server, json, urllib.request, urllib.error, os

PORT = 8080
GOV_ENDPOINT = "https://www.gov.il/he/api/DataGovProxy/GetDGResults"

class Handler(http.server.SimpleHTTPRequestHandler):

    def do_OPTIONS(self):
        self.send_response(200)
        self._cors(); self.end_headers()

    def do_POST(self):
        if self.path.rstrip("/") == "/gov-proxy":
            self._forward()
        else:
            self.send_error(404)

    def _forward(self):
        length = int(self.headers.get("Content-Length", 0))
        body   = self.rfile.read(length)
        print(f"  -> gov.il: {body[:120]}")

        req = urllib.request.Request(
            GOV_ENDPOINT, data=body,
            headers={
                "Content-Type": "application/json",
                "Referer":      "https://www.gov.il/",
                "User-Agent":   "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
                "Accept":       "application/json, text/plain, */*",
                "Origin":       "https://www.gov.il",
            }, method="POST"
        )
        try:
            with urllib.request.urlopen(req, timeout=10) as r:
                data = r.read()
            print(f"  <- {len(data)} bytes OK")
            self.send_response(200)
            self._cors()
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(data)
        except urllib.error.HTTPError as e:
            self.send_response(e.code); self._cors()
            self.send_header("Content-Type","application/json"); self.end_headers()
            self.wfile.write(e.read())
        except Exception as e:
            self.send_response(502); self._cors()
            self.send_header("Content-Type","application/json"); self.end_headers()
            self.wfile.write(json.dumps({"error":str(e)}).encode())

    def _cors(self):
        self.send_header("Access-Control-Allow-Origin",  "*")
        self.send_header("Access-Control-Allow-Methods", "GET,POST,OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")

    def log_message(self, fmt, *args):
        if "gov-proxy" in str(args):
            print(f"[proxy] {args[0][:80]}")
        elif not any(x in str(args[0]) for x in ['.js','.css','.ico','.png','.woff']):
            super().log_message(fmt, *args)

if __name__ == "__main__":
    os.chdir(os.path.dirname(os.path.abspath(__file__)))
    print(f"\n  Car Lookup Server")
    print(f"  -----------------")
    print(f"  http://localhost:{PORT}/index.html")
    print(f"  Ctrl+C לעצירה\n")
    http.server.HTTPServer(("", PORT), Handler).serve_forever()
