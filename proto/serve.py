#!/usr/bin/env python3
# Статический сервер для прототипа без кэша: браузер всегда берёт свежие файлы.
# GET /log/ИМЯ — лог мира из ../data для спектатора (spectate.html?log=/log/ИМЯ), только с loopback.
# GET /maps — список карт maps/*.js (id, name, v, format из meta) для редактора и лобби; тот же ответ даёт server/index.js.
# POST /maps/ID.js — редактор (editor.html) сохраняет карту; принимается только с loopback, тело должно быть файлом уровня, id — [a-z0-9_-].
import http.server, os, sys, re, json, glob
os.chdir(os.path.dirname(os.path.abspath(__file__)))
def map_meta(fp):   # meta из текста карты без исполнения: { id:'…', name:'…', v:N, format:N }
    head = open(fp, encoding='utf8').read(4000); m = re.search(r"meta:\s*\{([^}]*)\}", head)
    if not m: return None
    kv = {k: (s if s else int(n)) for k, s, n in re.findall(r"(\w+)\s*:\s*(?:'([^']*)'|(\d+))", m.group(1))}
    return {'id': kv.get('id', os.path.basename(fp)[:-3]), 'name': kv.get('name', ''), 'v': kv.get('v', 0), 'format': kv.get('format', 0)}
class H(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store'); super().end_headers()
    def log_message(self, *a): pass
    def reply(self, body, ctype='text/plain; charset=utf-8'):
        self.send_response(200); self.send_header('Content-Type', ctype); self.send_header('Content-Length', str(len(body))); self.end_headers(); self.wfile.write(body)
    def do_GET(self):   # /log/ИМЯ — лог мира из ../data (площадка, сервер), только с loopback: для спектатора ?log=/log/ИМЯ
        path = self.path.split('?')[0]
        if path.startswith('/log/'):
            name = os.path.basename(path[5:])
            fp = os.path.join('..', 'data', name)
            if self.client_address[0] not in ('127.0.0.1', '::1') or not name.endswith('.log') or not os.path.isfile(fp):
                self.send_error(404); return
            with open(fp, 'rb') as f: body = f.read()
            self.reply(body); return
        if path == '/maps':
            maps = [m for m in (map_meta(fp) for fp in sorted(glob.glob('maps/*.js'))) if m]
            self.reply(json.dumps(maps, ensure_ascii=False).encode('utf8'), 'application/json; charset=utf-8'); return
        super().do_GET()
    def do_POST(self):
        m = re.fullmatch(r'/maps/([a-z0-9_-]{1,32})\.js', self.path)
        if not m or self.client_address[0] not in ('127.0.0.1', '::1'):
            self.send_error(403); return
        body = self.rfile.read(int(self.headers.get('Content-Length', 0))).decode('utf8')
        if not body.startswith('// УРОВЕНЬ') or '\nconst LEVEL = {' not in body or ("id:'%s'" % m.group(1)) not in body:
            self.send_error(400, 'not a level file or meta.id differs from file name'); return
        fp = 'maps/%s.js' % m.group(1)
        with open(fp + '.tmp', 'w', encoding='utf8') as f: f.write(body)
        os.replace(fp + '.tmp', fp)
        self.reply(b'ok')
http.server.ThreadingHTTPServer(('', int(sys.argv[1]) if len(sys.argv)>1 else 8765), H).serve_forever()
