#!/usr/bin/env python3
# Статический сервер для прототипа без кэша: браузер всегда берёт свежие файлы.
# GET /log/ИМЯ — лог мира из ../data для спектатора (spectate.html?log=/log/ИМЯ), только с loopback.
# POST /level.js — редактор (editor.html) сохраняет уровень; принимается только с loopback, тело должно быть файлом уровня.
import http.server, os, sys
os.chdir(os.path.dirname(os.path.abspath(__file__)))
class H(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store'); super().end_headers()
    def log_message(self, *a): pass
    def do_GET(self):   # /log/ИМЯ — лог мира из ../data (площадка, сервер), только с loopback: для спектатора ?log=/log/ИМЯ
        if self.path.startswith('/log/'):
            name = os.path.basename(self.path[5:].split('?')[0])
            fp = os.path.join('..', 'data', name)
            if self.client_address[0] not in ('127.0.0.1', '::1') or not name.endswith('.log') or not os.path.isfile(fp):
                self.send_error(404); return
            with open(fp, 'rb') as f: body = f.read()
            self.send_response(200); self.send_header('Content-Type', 'text/plain; charset=utf-8'); self.send_header('Content-Length', str(len(body))); self.end_headers(); self.wfile.write(body); return
        super().do_GET()
    def do_POST(self):
        if self.path != '/level.js' or self.client_address[0] not in ('127.0.0.1', '::1'):
            self.send_error(403); return
        body = self.rfile.read(int(self.headers.get('Content-Length', 0))).decode('utf8')
        if not body.startswith('// УРОВЕНЬ') or '\nconst LEVEL = {' not in body:
            self.send_error(400, 'not a level file'); return
        with open('level.js.tmp', 'w', encoding='utf8') as f: f.write(body)
        os.replace('level.js.tmp', 'level.js')
        self.send_response(200); self.send_header('Content-Type', 'text/plain'); self.end_headers(); self.wfile.write(b'ok')
http.server.ThreadingHTTPServer(('', int(sys.argv[1]) if len(sys.argv)>1 else 8765), H).serve_forever()
