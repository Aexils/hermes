import urllib.request, json, sys

username = sys.argv[1] if len(sys.argv) > 1 else "Aexils"
password = sys.argv[2] if len(sys.argv) > 2 else ""

data = json.dumps({"username": username, "password": password}).encode()
req = urllib.request.Request(
    "http://booklore:6060/api/v1/auth/login",
    data=data,
    headers={"Content-Type": "application/json"},
    method="POST",
)
resp = urllib.request.urlopen(req)
body = json.loads(resp.read())
print("refreshToken:", body.get("refreshToken"))
print("accessToken:", body.get("accessToken", "")[:40], "...")
