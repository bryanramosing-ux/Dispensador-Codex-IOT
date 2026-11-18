"""Launch the pinned Python backend for differential contract tests only."""
import sys
from pathlib import Path

sys.dont_write_bytecode = True
sys.path.insert(0, str(Path(__file__).parent / "backend"))
from dashboard_server import Config, create_server

storage, camera_url, esp32_url, token = sys.argv[1:]
cfg = Config(host="127.0.0.1", port=0, camera_url=camera_url, esp32_url=esp32_url,
             storage=storage, token=token, min_dispense_gap_s=0, start_threads=False)
server, app = create_server(cfg)
# The migration pins the destination. Keep the old code intact and direct its
# learned default-port address to the test device's ephemeral listening port.
app.esp32_base = lambda: cfg.esp32_url
print(server.server_port, flush=True)
server.serve_forever()
