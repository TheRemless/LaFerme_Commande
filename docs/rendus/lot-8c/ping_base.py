import json, time, urllib.request, statistics
API = "https://api.globalping.io/v1/measurements"
def appel(url, corps=None):
    req = urllib.request.Request(url, data=json.dumps(corps).encode() if corps else None, headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=60) as r: return json.load(r)
for nom, lieu in [("Ohio", {"magic": "Ohio", "limit": 3}), ("Francfort", {"magic": "Frankfurt", "limit": 3}), ("Zurich", {"magic": "Zurich", "limit": 2}), ("Geneve", {"magic": "Geneva", "limit": 2})]:
    m = appel(API, {"type": "ping", "target": "aws-0-eu-central-2.pooler.supabase.com", "locations": [lieu], "measurementOptions": {"packets": 6, "protocol": "TCP", "port": 5432}})
    for _ in range(30):
        time.sleep(2); d = appel(f"{API}/{m['id']}")
        if d["status"] == "finished": break
    for r in d["results"]:
        s = r["result"].get("stats") or {}
        print(nom, r["probe"]["city"], r["probe"]["network"], "rtt moy", s.get("avg"), "min", s.get("min"), "perte", s.get("loss"))
