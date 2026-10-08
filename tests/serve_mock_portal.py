import http.server
import socketserver
import sys

PORTAL_HTML = """<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <title>SoftMania Lab - Infra Automation Environment</title>
    <style>
        body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #f1f5f9; margin: 0; padding: 24px; color: #1e293b; }
        .header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px; }
        .logo { font-size: 24px; font-weight: bold; color: #16a34a; }
        .card { background: white; border-radius: 8px; box-shadow: 0 1px 3px rgba(0,0,0,0.1); padding: 20px; margin-bottom: 24px; }
        table { width: 100%; border-collapse: collapse; margin-top: 10px; }
        th { text-align: left; padding: 12px 8px; border-bottom: 2px solid #e2e8f0; font-size: 13px; color: #475569; }
        td { padding: 12px 8px; border-bottom: 1px solid #e2e8f0; font-size: 13px; vertical-align: middle; }
        .status-badge { display: inline-block; padding: 3px 8px; border-radius: 12px; font-size: 11px; font-weight: bold; background: #dcfce7; color: #15803d; }
        .btn { padding: 5px 12px; border-radius: 4px; border: none; font-weight: bold; font-size: 12px; cursor: pointer; }
        .btn-start { background: #16a34a; color: white; }
        .btn-stop { background: #ef4444; color: white; }
        .btn-reboot { background: #f59e0b; color: white; }
        .btn-del { background: #dc2626; color: white; }
        .copy-icon { display: inline-flex; width: 16px; height: 16px; margin-left: 4px; vertical-align: middle; cursor: pointer; color: #94a3b8; }
        .pem-grid { display: flex; gap: 16px; margin-top: 12px; }
        .pem-card { background: #f8fafc; border: 1px solid #cbd5e1; border-radius: 8px; padding: 14px 18px; display: flex; align-items: center; justify-content: space-between; flex: 1; }
        .pem-name { font-weight: 600; font-family: monospace; color: #0f172a; font-size: 13px; }
        .download-btn { background: #16a34a; color: white; border: none; padding: 6px 12px; border-radius: 4px; font-weight: bold; font-size: 12px; cursor: pointer; text-decoration: none; }
    </style>
</head>
<body>
    <div class="header">
        <div class="logo">SoftMania</div>
        <div>Credits: <strong>7540.29</strong></div>
    </div>

    <div class="card">
        <h3>Infra Automation Environment</h3>
        <table>
            <thead>
                <tr>
                    <th style="width: 24px;"><input type="checkbox"></th>
                    <th>Server Name ↑</th>
                    <th>State</th>
                    <th>Private IP</th>
                    <th>Public IP</th>
                    <th>SSH Command</th>
                    <th>Actions</th>
                    <th>Firewall</th>
                </tr>
            </thead>
            <tbody>
                <tr>
                    <td><input type="checkbox"></td>
                    <td>
                        <strong>Deployment Server-Workshop</strong><br>
                        <span style="color: #ef4444; font-size: 11px;">(Runtime: 7 hrs 42 mins 11 secs | Total Credits: 424.55)</span>
                    </td>
                    <td><span style="color: #64748b;">stopped</span></td>
                    <td>##.###.###. 174 <span class="copy-icon">📋</span></td>
                    <td>-</td>
                    <td>-</td>
                    <td>
                        <button class="btn btn-start">Start</button>
                        <button class="btn btn-del">Delete</button>
                    </td>
                    <td><button class="btn" style="background: #2563eb; color: white;">Access</button></td>
                </tr>
                <tr>
                    <td><input type="checkbox"></td>
                    <td>
                        <strong>Linux1-Workshop</strong><br>
                        <span style="color: #ef4444; font-size: 11px;">(Runtime: 21 hrs 6 mins 11 secs | Total Credits: 659.87)</span>
                    </td>
                    <td><span class="status-badge">running</span></td>
                    <td>##.###.###. 79 <span class="copy-icon">📋</span></td>
                    <td>
                        <span>13.218.167.162</span>
                        <span class="copy-icon" data-value="13.218.167.162">📋</span>
                    </td>
                    <td>
                        <span>ssh -i "ps-dev-grad2it.in...</span>
                        <span class="copy-icon" title="ssh -i &quot;ps-dev-grad2it.in.pem&quot; ubuntu@13.218.167.162" data-clipboard-text="ssh -i &quot;ps-dev-grad2it.in.pem&quot; ubuntu@13.218.167.162">📋</span>
                    </td>
                    <td>
                        <button class="btn btn-stop">Stop</button>
                        <button class="btn btn-reboot">Reboot</button>
                        <button class="btn btn-del">Delete</button>
                    </td>
                    <td><button class="btn" style="background: #2563eb; color: white;">Access</button></td>
                </tr>
            </tbody>
        </table>
    </div>

    <div class="card">
        <h3>SSH PEM Files</h3>
        <div class="pem-grid">
            <div class="pem-card">
                <span class="pem-name">narayanansubramani14-gmail.com.pem</span>
                <a href="#download-key1" class="download-btn">Download 📥</a>
            </div>
            <div class="pem-card">
                <span class="pem-name">ps-dev-grad2it.in.pem</span>
                <a href="#download-key2" class="download-btn">Download 📥</a>
            </div>
        </div>
    </div>
</body>
</html>"""

class ReusableTCPServer(socketserver.TCPServer):
    allow_reuse_address = True

class PortalHandler(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        self.send_response(200)
        self.send_header('Content-type', 'text/html; charset=utf-8')
        self.end_headers()
        self.wfile.write(PORTAL_HTML.encode('utf-8'))
    def log_message(self, format, *args):
        pass

if __name__ == '__main__':
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8080
    server = ReusableTCPServer(('127.0.0.1', port), PortalHandler)
    print(f"Portal running on http://127.0.0.1:{port}", flush=True)
    server.serve_forever()
