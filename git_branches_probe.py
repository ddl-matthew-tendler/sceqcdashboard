import os, requests

PROJECT_ID = "6a28b1b84da5364a82ae0c65"
REPO_ID = "6a28b1ba4da5364a82ae0c68"
HOST = os.environ.get("DOMINO_API_HOST", "").rstrip("/")
PATH = "/v4/projects/%s/gitRepositories/%s/git/branches?searchPattern=dev&count=50" % (PROJECT_ID, REPO_ID)
URL = HOST + PATH

print("=== git/branches probe ===")
print("DOMINO_API_HOST:", HOST)
print("URL:", URL)


def get_token():
    r = requests.get("http://localhost:8899/access-token", timeout=10)
    return r.text.strip()


try:
    token = get_token()
    print("token acquired, len:", len(token), "prefix:", token[:10])
except Exception as e:
    print("FAILED to get sidecar token:", repr(e))
    token = None

if token:
    bearer = token if token.startswith("Bearer ") else ("Bearer " + token)

    # Attempt 1: Authorization Bearer
    try:
        r = requests.get(URL, headers={"Authorization": bearer}, timeout=30)
        print("\n--- Attempt 1: Authorization: Bearer ---")
        print("STATUS:", r.status_code)
        print("BODY[:500]:", r.text[:500])
    except Exception as e:
        print("\n--- Attempt 1 ERROR:", repr(e))

    # Attempt 2: X-Domino-Api-Key
    try:
        r = requests.get(URL, headers={"X-Domino-Api-Key": token.replace("Bearer ", "")}, timeout=30)
        print("\n--- Attempt 2: X-Domino-Api-Key ---")
        print("STATUS:", r.status_code)
        print("BODY[:500]:", r.text[:500])
    except Exception as e:
        print("\n--- Attempt 2 ERROR:", repr(e))

print("\n=== done ===")
