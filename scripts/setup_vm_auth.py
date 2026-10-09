"""Deploy an isolated development Keycloak realm to the supplied VM.

Requires the ignored development-pack info.txt and paramiko. Secrets are saved only
to the ignored .env.auth.local and mode-600 files on the VM. No secrets are printed.
"""

from __future__ import annotations

import json
import secrets
import time
import uuid
from pathlib import Path

import paramiko


ROOT = Path(__file__).resolve().parents[1]
INFO = ROOT / "AI_Creative_Suite_Dev_Pack_v3" / "info.txt"
LOCAL_SECRETS = ROOT / ".env.auth.local"
REMOTE_ROOT = "/opt/ai-creative-suite"
IMAGE = "quay.io/keycloak/keycloak:26.8.0"


def read_pairs(path: Path) -> dict[str, str]:
    return {
        key.strip(): value.strip()
        for line in path.read_text(encoding="utf-8-sig").splitlines()
        if "=" in line
        for key, value in [line.split("=", 1)]
    }


def credentials() -> dict[str, str]:
    if LOCAL_SECRETS.exists():
        values = read_pairs(LOCAL_SECRETS)
    else:
        values = {
            "ACS_AUTH_ADMIN_PASSWORD": secrets.token_urlsafe(36),
            "ACS_AUTH_TEST_PASSWORD": secrets.token_urlsafe(36),
            "ACS_AUTH_CLIENT_SECRET": secrets.token_urlsafe(36),
            "ACS_AUTH_TEST_SUBJECT": str(uuid.uuid4()),
        }
        LOCAL_SECRETS.write_text(
            "".join(f"{key}={value}\n" for key, value in values.items()), encoding="utf-8"
        )
    required = {
        "ACS_AUTH_ADMIN_PASSWORD", "ACS_AUTH_TEST_PASSWORD",
        "ACS_AUTH_CLIENT_SECRET", "ACS_AUTH_TEST_SUBJECT",
    }
    if not required.issubset(values):
        raise RuntimeError("Incomplete local auth development credentials")
    return values


def realm(values: dict[str, str]) -> dict:
    return {
        "realm": "acs-dev",
        "enabled": True,
        "sslRequired": "none",
        "registrationAllowed": False,
        "loginWithEmailAllowed": True,
        "accessTokenLifespan": 300,
        "clients": [{
            "clientId": "acs-dev-cli",
            "name": "ACS local integration testing only",
            "enabled": True,
            "protocol": "openid-connect",
            "publicClient": False,
            "secret": values["ACS_AUTH_CLIENT_SECRET"],
            "standardFlowEnabled": False,
            "directAccessGrantsEnabled": True,
            "serviceAccountsEnabled": False,
            "protocolMappers": [{
                "name": "acs-api-audience",
                "protocol": "openid-connect",
                "protocolMapper": "oidc-audience-mapper",
                "consentRequired": False,
                "config": {
                    "included.custom.audience": "acs-api",
                    "access.token.claim": "true",
                    "id.token.claim": "false",
                },
            }],
        }],
        "users": [{
            "id": values["ACS_AUTH_TEST_SUBJECT"],
            "username": "acs-dev-user",
            "enabled": True,
            "firstName": "ACS",
            "lastName": "Developer",
            "email": "acs-dev-user@example.invalid",
            "emailVerified": True,
            "requiredActions": [],
            "credentials": [{
                "type": "password",
                "value": values["ACS_AUTH_TEST_PASSWORD"],
                "temporary": False,
            }],
        }],
    }


def remote(client: paramiko.SSHClient, command: str) -> tuple[int, str, str]:
    _, output, errors = client.exec_command(command, timeout=90)
    stdout = output.read().decode()
    stderr = errors.read().decode()
    return output.channel.recv_exit_status(), stdout, stderr


def main() -> None:
    details = {
        key.strip(): value.strip()
        for line in INFO.read_text(encoding="utf-8-sig").splitlines()
        if ":" in line
        for key, value in [line.split(":", 1)]
    }
    values = credentials()
    client = paramiko.SSHClient()
    client.load_host_keys(str(Path.home() / ".ssh" / "known_hosts"))
    client.set_missing_host_key_policy(paramiko.RejectPolicy())
    client.connect(
        details["IP"], username=details["账号"], password=details["密码"],
        look_for_keys=False, allow_agent=False, timeout=10,
    )
    try:
        status, _, _ = remote(client, f"docker image inspect {IMAGE} >/dev/null 2>&1")
        if status:
            raise RuntimeError("Pinned Keycloak image is not present on the VM")
        status, _, stderr = remote(
            client, f"install -d -m 700 {REMOTE_ROOT}/auth-realm-import"
        )
        if status:
            raise RuntimeError(f"Cannot create auth directory: {stderr}")
        sftp = client.open_sftp()
        try:
            with sftp.open(f"{REMOTE_ROOT}/auth.env", "w") as handle:
                handle.write(
                    "KC_BOOTSTRAP_ADMIN_USERNAME=acs-dev-admin\n"
                    f"KC_BOOTSTRAP_ADMIN_PASSWORD={values['ACS_AUTH_ADMIN_PASSWORD']}\n"
                )
            sftp.chmod(f"{REMOTE_ROOT}/auth.env", 0o600)
            with sftp.open(f"{REMOTE_ROOT}/auth-realm-import/acs-dev-realm.json", "w") as handle:
                handle.write(json.dumps(realm(values), ensure_ascii=False))
            sftp.chmod(f"{REMOTE_ROOT}/auth-realm-import/acs-dev-realm.json", 0o600)
            sftp.put(
                str(ROOT / "deploy" / "compose.auth.vm.yaml"),
                f"{REMOTE_ROOT}/compose.auth.vm.yaml",
            )
        finally:
            sftp.close()
        status, _, errors = remote(
            client,
            f"chown 1000:0 {REMOTE_ROOT}/auth-realm-import "
            f"{REMOTE_ROOT}/auth-realm-import/acs-dev-realm.json",
        )
        if status:
            raise RuntimeError(f"Cannot grant Keycloak import access: {errors[-500:]}")
        status, output, errors = remote(
            client,
            f"docker compose -p acs-auth -f {REMOTE_ROOT}/compose.auth.vm.yaml up -d --force-recreate",
        )
        if status:
            raise RuntimeError(f"Keycloak Compose failed: {errors[-1200:]}")
        print(output.strip())
        for _ in range(36):
            status, _, _ = remote(
                client,
                "curl -fsS -o /dev/null http://127.0.0.1:8180/realms/acs-dev/.well-known/openid-configuration",
            )
            if status == 0:
                print("Keycloak development realm ready on VM loopback port 8180")
                return
            time.sleep(5)
        raise RuntimeError("Keycloak did not become ready within 3 minutes")
    finally:
        client.close()


if __name__ == "__main__":
    main()
