"""Stream the ignored Keycloak Docker archive to the VM's Docker daemon."""

from __future__ import annotations

from pathlib import Path

import paramiko


ROOT = Path(__file__).resolve().parents[1]
ARCHIVE = ROOT / ".tools" / "keycloak-26.8.0.tar"
INFO = ROOT / "AI_Creative_Suite_Dev_Pack_v3" / "info.txt"


def main() -> None:
    if not ARCHIVE.is_file() or ARCHIVE.stat().st_size < 50 * 1024 * 1024:
        raise RuntimeError("Keycloak Docker archive is missing or incomplete")
    details = {
        key.strip(): value.strip()
        for line in INFO.read_text(encoding="utf-8-sig").splitlines()
        if ":" in line
        for key, value in [line.split(":", 1)]
    }
    client = paramiko.SSHClient()
    client.load_host_keys(str(Path.home() / ".ssh" / "known_hosts"))
    client.set_missing_host_key_policy(paramiko.RejectPolicy())
    client.connect(
        details["IP"], username=details["账号"], password=details["密码"],
        look_for_keys=False, allow_agent=False, timeout=10,
    )
    try:
        transport = client.get_transport()
        if transport is None:
            raise RuntimeError("SSH transport unavailable")
        channel = transport.open_session()
        channel.exec_command("docker load")
        sent = 0
        next_report = 50 * 1024 * 1024
        with ARCHIVE.open("rb") as archive:
            while chunk := archive.read(1024 * 1024):
                channel.sendall(chunk)
                sent += len(chunk)
                if sent >= next_report:
                    print(f"Streamed {sent // (1024 * 1024)} MiB to Docker", flush=True)
                    next_report += 50 * 1024 * 1024
        channel.shutdown_write()
        output = channel.makefile("r").read().decode()
        errors = channel.makefile_stderr("r").read().decode()
        status = channel.recv_exit_status()
        if status:
            raise RuntimeError(f"Docker load failed: {errors[-1200:]}")
        print(output.strip())
        _, result, error = client.exec_command(
            "docker image inspect quay.io/keycloak/keycloak:26.8.0 --format '{{.Id}}'"
        )
        image_id = result.read().decode().strip()
        if result.channel.recv_exit_status():
            raise RuntimeError(f"Loaded image tag missing: {error.read().decode()[-500:]}")
        print(f"Pinned Keycloak image loaded: {image_id}")
    finally:
        client.close()


if __name__ == "__main__":
    main()
