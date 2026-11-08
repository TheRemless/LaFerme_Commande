#!/usr/bin/env python3
"""Premier octet (TTFB) et temps total de pages publiques, mesurés par des sondes Globalping
en Suisse (connexion neuve à chaque fois). Usage : mesure_europe.py HOTE [tours] [chemins...]"""
import json, sys, time, urllib.request, statistics

API = "https://api.globalping.io/v1/measurements"

def appel(url, corps=None):
    req = urllib.request.Request(url, data=json.dumps(corps).encode() if corps else None,
                                 headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.load(r)

def mesurer(hote, chemin, lieux):
    m = appel(API, {"type": "http", "target": hote, "locations": lieux,
                    "measurementOptions": {"protocol": "HTTPS", "request": {"path": chemin, "method": "GET"}}})
    for _ in range(30):
        time.sleep(2)
        d = appel(f"{API}/{m['id']}")
        if d["status"] == "finished":
            break
    out = []
    for r in d["results"]:
        res, p = r["result"], r["probe"]
        t = res.get("timings") or {}
        if res.get("statusCode") and t.get("firstByte") is not None:
            cs = res.get("headers", {}).get("cache-status")
            out.append({"ville": p["city"], "ttfb": t["firstByte"], "total": t["total"],
                        "code": res["statusCode"], "cache": " ".join(cs) if isinstance(cs, list) else cs})
    return out

if __name__ == "__main__":
    hote = sys.argv[1]
    tours = int(sys.argv[2]) if len(sys.argv) > 2 else 3
    chemins = sys.argv[3:] or ["/", "/carte", "/panier", "/commande", "/cgv", "/logo-la-ferme.png"]
    lieux = [{"country": "CH", "limit": 3}]
    print(f"{hote}  ({tours} tours, sondes en Suisse, ms)")
    for c in chemins:
        mesures = []
        for _ in range(tours):
            mesures += mesurer(hote, c, lieux)
        ttfb = [m["ttfb"] for m in mesures]
        caches = sorted({(m["cache"] or "-").split(";")[0] + ("" if "hit" not in (m["cache"] or "") else " hit") for m in mesures})
        print(f"{c:22} TTFB médiane {int(statistics.median(ttfb)) if ttfb else '?'} (min {min(ttfb) if ttfb else '?'}, max {max(ttfb) if ttfb else '?'}, n={len(ttfb)})"
              f"  villes {sorted({m['ville'] for m in mesures})}  codes {sorted({m['code'] for m in mesures})}")
        for m in mesures:
            print(f"    {m['ville']:10} {m['ttfb']:5} / {m['total']:5}  {m['cache']}")
