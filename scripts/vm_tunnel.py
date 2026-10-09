"""Forward development VM infrastructure ports to local loopback.

Requires paramiko in the Python environment. Reads the Git-ignored VM info file,
verifies its host key against ~/.ssh/known_hosts, and never prints credentials.
"""

from __future__ import annotations

import select
import socketserver
import threading
from pathlib import Path

import paramiko


ROOT = Path(__file__).resolve().parents[1]
INFO = ROOT / "AI_Creative_Suite_Dev_Pack_v3" / "info.txt"
PORTS = (5432, 6379, 9000, 9001, 8180)


def credentials() -> dict[str, str]:
    return {
        key.strip(): value.strip()
        for line in INFO.read_text(encoding="utf-8-sig").splitlines()
        if ":" in line
        for key, value in [line.split(":", 1)]
    }


def main() -> None:
    details = credentials()
    client = paramiko.SSHClient()
    client.load_host_keys(str(Path.home() / ".ssh" / "known_hosts"))
    client.set_missing_host_key_policy(paramiko.RejectPolicy())
    client.connect(
        details["IP"],
        username=details["账号"],
        password=details["密码"],
        look_for_keys=False,
        allow_agent=False,
        timeout=10,
    )
    transport = client.get_transport()
    if transport is None:
        raise RuntimeError("SSH transport unavailable")

    servers: list[socketserver.ThreadingTCPServer] = []

    class ForwardHandler(socketserver.BaseRequestHandler):
        def handle(self) -> None:
            port = self.server.server_address[1]
            channel = transport.open_channel(
                "direct-tcpip",
                ("127.0.0.1", port),
                self.request.getpeername(),
            )
            if channel is None:
                return
            try:
                while True:
                    readable, _, _ = select.select([self.request, channel], [], [], 30)
                    if self.request in readable:
                        data = self.request.recv(65536)
                        if not data:
                            break
                        channel.sendall(data)
                    if channel in readable:
                        data = channel.recv(65536)
                        if not data:
                            break
                        self.request.sendall(data)
            finally:
                channel.close()

    try:
        for port in PORTS:
            server = socketserver.ThreadingTCPServer(("127.0.0.1", port), ForwardHandler)
            server.daemon_threads = True
            servers.append(server)
            threading.Thread(target=server.serve_forever, daemon=True).start()
        print("VM tunnel ready on localhost ports 5432, 6379, 9000, 9001, 8180", flush=True)
        threading.Event().wait()
    except KeyboardInterrupt:
        pass
    finally:
        for server in servers:
            server.shutdown()
            server.server_close()
        client.close()


if __name__ == "__main__":
    main()
