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
    def connect() -> tuple[paramiko.SSHClient, paramiko.Transport]:
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
            banner_timeout=10,
            auth_timeout=10,
        )
        transport = client.get_transport()
        if transport is None:
            client.close()
            raise RuntimeError("SSH transport unavailable")
        transport.set_keepalive(30)
        return client, transport

    client, transport = connect()
    connection_lock = threading.Lock()
    connection = {"client": client, "transport": transport}

    servers: list[socketserver.ThreadingTCPServer] = []

    class ForwardHandler(socketserver.BaseRequestHandler):
        def handle(self) -> None:
            port = self.server.server_address[1]
            try:
                with connection_lock:
                    current_transport = connection["transport"]
                if not current_transport.is_active():
                    return
                channel = current_transport.open_channel(
                    "direct-tcpip",
                    ("127.0.0.1", port),
                    self.request.getpeername(),
                )
            except (OSError, EOFError, paramiko.SSHException):
                return
            if channel is None:
                return
            try:
                while True:
                    try:
                        readable, _, _ = select.select([self.request, channel], [], [], 30)
                    except (OSError, ValueError):
                        break
                    if self.request in readable:
                        try:
                            data = self.request.recv(65536)
                        except OSError:
                            break
                        if not data:
                            break
                        try:
                            channel.sendall(data)
                        except (OSError, EOFError):
                            break
                    if channel in readable:
                        try:
                            data = channel.recv(65536)
                        except (OSError, EOFError):
                            break
                        if not data:
                            break
                        try:
                            self.request.sendall(data)
                        except OSError:
                            break
            finally:
                channel.close()

    try:
        for port in PORTS:
            server = socketserver.ThreadingTCPServer(("127.0.0.1", port), ForwardHandler)
            server.daemon_threads = True
            servers.append(server)
            threading.Thread(target=server.serve_forever, daemon=True).start()
        print("VM tunnel ready on localhost ports 5432, 6379, 9000, 9001, 8180", flush=True)
        while True:
            threading.Event().wait(5)
            with connection_lock:
                active = connection["transport"].is_active()
            if active:
                continue
            try:
                next_client, next_transport = connect()
            except (OSError, EOFError, paramiko.SSHException):
                continue
            with connection_lock:
                old_client = connection["client"]
                connection["client"] = next_client
                connection["transport"] = next_transport
            old_client.close()
            print("VM tunnel reconnected", flush=True)
    except KeyboardInterrupt:
        pass
    finally:
        for server in servers:
            server.shutdown()
            server.server_close()
        with connection_lock:
            connection["client"].close()


if __name__ == "__main__":
    main()
