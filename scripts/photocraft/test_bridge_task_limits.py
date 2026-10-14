"""Exercise the pinned local worker's admission and retry behavior."""

from concurrent.futures import ThreadPoolExecutor
from json import loads
from time import monotonic, sleep
from urllib.error import HTTPError
from urllib.request import Request, urlopen

from test_provider_mask_bridge import BASE, SOURCE, edit


def health() -> dict:
    with urlopen(f"{BASE}/health", timeout=5) as response:
        return loads(response.read())


def main() -> None:
    status = health()
    assert status["engine"] == "PhotoCraft"
    assert status["version"] == "0.6.0"
    assert status["maxActiveRequests"] == 1
    with ThreadPoolExecutor(max_workers=1) as workers:
        running = workers.submit(edit, SOURCE.read_bytes(), "image/jpeg")
        deadline = monotonic() + 15
        while health()["activeRequests"] != 1 and monotonic() < deadline:
            sleep(0.1)
        assert health()["activeRequests"] == 1
        request = Request(
            f"{BASE}/v1/inspect",
            data=SOURCE.read_bytes(),
            headers={"Content-Type": "image/jpeg"},
            method="POST",
        )
        try:
            urlopen(request, timeout=5)
            raise AssertionError("busy worker accepted another task")
        except HTTPError as error:
            assert error.code == 429
            assert error.headers["Retry-After"] == "3"
        result = running.result(timeout=120)
        assert result["layers"] == 2
    assert health()["activeRequests"] == 0
    broken = Request(
        f"{BASE}/v1/inspect",
        data=b"not a real image",
        headers={"Content-Type": "image/png"},
        method="POST",
    )
    try:
        urlopen(broken, timeout=10)
        raise AssertionError("invalid input was accepted")
    except HTTPError as error:
        assert error.code == 400
    with urlopen(request, timeout=30) as response:
        assert loads(response.read())["width"] == 1920
    assert health()["activeRequests"] == 0
    print("PASS: pinned local worker limits concurrent jobs and recovers after failure")


if __name__ == "__main__":
    main()
