"""Shared helpers for the Intake end-to-end run: static server, network mocks, step recorder, page utilities."""
import json
import re
import shutil
import socket
import subprocess
import sys
import tempfile
import time
import traceback
import urllib.request
from pathlib import Path

sys.dont_write_bytecode = True  # never leave __pycache__ folders next to the app

ROOT = Path(__file__).resolve().parents[2]
SHOTS = ROOT / "tests" / "screenshots"
BAD_TEXT = re.compile(r"\bNaN\b|\bundefined\b|\[object |\bnull\b|Infinity")

# ---------------------------------------------------------------- server

def free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


# What gets uploaded to a static host: the folder minus these. The e2e run serves exactly that, so a file the app
# needs can never be hiding in a test-only folder.
DEPLOY_EXCLUDE = ("tests", "tools", "scripts", "SPEC.md", "__pycache__", "*.pyc", "node_modules", ".git", ".gitignore", "package.json")


def deploy_copy() -> Path:
    """Copy the deployable app (the folder minus test-only files) to a fresh temp folder and return it."""
    dst = Path(tempfile.mkdtemp(prefix="intake-deploy-")) / "app"
    shutil.copytree(ROOT, dst, ignore=shutil.ignore_patterns(*DEPLOY_EXCLUDE))
    return dst


_SERVED = {}


def served_root() -> Path:
    """The deploy copy served by this run (built once)."""
    if "root" not in _SERVED:
        _SERVED["root"] = deploy_copy()
    return _SERVED["root"]


def start_server():
    port = free_port()
    proc = subprocess.Popen([sys.executable, "-B", "-m", "http.server", str(port), "--bind", "127.0.0.1"], cwd=served_root(), stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    for _ in range(50):
        try:
            urllib.request.urlopen(f"http://127.0.0.1:{port}/index.html", timeout=0.5).read(10)
            return proc, f"http://127.0.0.1:{port}/"
        except Exception:
            time.sleep(0.1)
    proc.kill()
    raise RuntimeError("static server did not start")

# ---------------------------------------------------------------- mocks

OFF_PRODUCT = {
    "code": "3017620422003", "product_name": "Hazelnut Spread Test", "brands": "Testco, Other", "serving_size": "15 g", "serving_quantity": 15,
    "nutriments": {"energy-kcal_100g": 539, "proteins_100g": 6.3, "carbohydrates_100g": 57.5, "fat_100g": 30.9, "saturated-fat_100g": 10.6, "sugars_100g": 56.3, "salt_100g": 0.107, "fiber_100g": 0},
}
FDC_FOOD = {
    "fdcId": 424242, "description": "MOCK CRUNCHY CEREAL BAR", "brandName": "MOCKCO", "gtinUpc": "0123456789012", "servingSize": 40, "servingSizeUnit": "g",
    "householdServingFullText": "1 bar",
    "foodNutrients": [
        {"nutrientNumber": "208", "unitName": "KCAL", "value": 400}, {"nutrientNumber": "203", "unitName": "G", "value": 8},
        {"nutrientNumber": "205", "unitName": "G", "value": 70}, {"nutrientNumber": "204", "unitName": "G", "value": 10},
        {"nutrientNumber": "307", "unitName": "MG", "value": 250},
    ],
}


class Net:
    """Collects every non-local request so tests can assert the app only talks to the mocked services."""

    def __init__(self):
        self.external = []
        self.fail_online = False  # when True the OFF/FDC mocks answer 503
        self.rate_limit = False  # when True the OFF/FDC mocks answer 429
        self.fail_off_times = 0  # the next N Open Food Facts requests answer 503 (exercises the one automatic retry)
        self.offline = False  # mirrors context.set_offline(): mocked hosts must fail too
        self.fake_firebase = False  # serve in-page stand-ins for the Firebase SDK instead of the generic script stub

    def count(self, needle: str) -> int:
        """How many external requests so far contained `needle` (for example 'search.openfoodfacts.org/search')."""
        return sum(1 for u in self.external if needle in u)

    def install(self, context, origin: str):
        def handler(route):
            url = route.request.url
            if url.startswith(origin):
                return route.continue_()
            self.external.append(url)
            if self.offline:
                return route.abort("internetdisconnected")
            ok = lambda body: route.fulfill(status=200, content_type="application/json", headers={"access-control-allow-origin": "*"}, body=json.dumps(body))
            if self.rate_limit and ("openfoodfacts" in url or "nal.usda.gov" in url):
                return route.fulfill(status=429, headers={"access-control-allow-origin": "*"}, body="slow down")
            if self.fail_off_times and "openfoodfacts" in url:
                self.fail_off_times -= 1
                return route.fulfill(status=503, headers={"access-control-allow-origin": "*"}, body="unavailable")
            if self.fail_online and ("openfoodfacts" in url or "nal.usda.gov" in url):
                return route.fulfill(status=503, headers={"access-control-allow-origin": "*"}, body="unavailable")
            if "search.openfoodfacts.org/search" in url:
                return ok({"hits": [OFF_PRODUCT]})
            if "openfoodfacts.org/cgi/search.pl" in url:
                return ok({"products": []})
            if "openfoodfacts.org/api/v2/product/3017620422003" in url:
                return ok({"status": 1, "product": OFF_PRODUCT})
            if "openfoodfacts.org/api/v2/product/" in url:
                return ok({"status": 0})
            if "nal.usda.gov/fdc/v1/foods/search" in url:
                return ok({"foods": [FDC_FOOD]})
            if self.fake_firebase and "gstatic.com/firebasejs/" in url:
                from fake_firebase import MODULES

                name = url.rsplit("/", 1)[-1].split("?")[0]
                if name in MODULES:
                    return route.fulfill(status=200, content_type="application/javascript", headers={"access-control-allow-origin": "*"}, body=MODULES[name])
            if "unpkg.com" in url or "gstatic.com" in url:
                return route.fulfill(status=200, content_type="application/javascript", headers={"access-control-allow-origin": "*"}, body="/* blocked in tests */")
            return route.fulfill(status=404, body="not mocked")

        context.route(re.compile(r"^https?://(?!127\.0\.0\.1|localhost)"), handler)

# ---------------------------------------------------------------- recorder

class Recorder:
    def __init__(self):
        self.results = []
        self.on_fail = None  # optional callback(label) used to capture a debug screenshot

    def step(self, label, fn, *args):
        t0 = time.time()
        try:
            fn(*args)
            self.results.append((label, True, ""))
            print(f"  ok    {label} ({time.time() - t0:.1f}s)")
        except Exception as e:  # noqa: BLE001 - record any failure and keep going
            msg = "".join(traceback.format_exception_only(type(e), e)).strip().splitlines()[0][:300]
            self.results.append((label, False, msg))
            if self.on_fail:
                try:
                    self.on_fail(label)
                except Exception:  # noqa: BLE001
                    pass
            print(f"  FAIL  {label}: {msg}")

    def summary(self):
        bad = [r for r in self.results if not r[1]]
        print(f"\n{len(self.results) - len(bad)}/{len(self.results)} e2e steps passed")
        for label, _, msg in bad:
            print(f"  FAILED {label}: {msg}")
        return not bad

# ---------------------------------------------------------------- page utils

def num(text: str) -> int:
    """First integer in a string, ignoring thousands separators and a leading minus sign glyph."""
    m = re.search(r"\d[\d,]*", text)
    if not m:
        raise AssertionError(f"no number in {text!r}")
    return int(m.group(0).replace(",", ""))


def overflow(page) -> list:
    """Elements that stick out of the viewport horizontally (ignoring ones inside a scrolling strip)."""
    return page.evaluate(
        """() => {
          const vw = document.documentElement.clientWidth, out = [];
          if (document.documentElement.scrollWidth > vw + 1) out.push('document scrollWidth ' + document.documentElement.scrollWidth + ' > ' + vw);
          for (const el of document.querySelectorAll('body *')) {
            const r = el.getBoundingClientRect();
            if (!r.width || getComputedStyle(el).position === 'fixed' || el.closest('.tabs-row, svg, .scrim, .menu')) continue;
            if (r.right > vw + 1 || r.left < -1) out.push((el.tagName + '.' + (el.className.baseVal ?? el.className)).slice(0, 60) + ' [' + Math.round(r.left) + ',' + Math.round(r.right) + ']');
          }
          return out.slice(0, 6);
        }"""
    )


def small_targets(page) -> list:
    """Visible interactive elements smaller than 44 px in either direction."""
    return page.evaluate(
        """() => {
          const out = [];
          const sel = 'button, a[href], select, input:not([type=hidden]):not([type=range]):not([type=checkbox]), [role=tab], [role=radio], label.switch, .link, .link-btn, .toast-action';
          for (const el of document.querySelectorAll(sel)) {
            const r = el.getBoundingClientRect(), cs = getComputedStyle(el);
            if (!r.width || cs.visibility === 'hidden' || cs.display === 'none' || el.closest('[hidden]') || el.classList.contains('skip-link')) continue;
            if (el.closest('p, li, .hint, .credit') && el.tagName === 'A' && !el.classList.contains('row-link') && !el.classList.contains('side-link') && !el.classList.contains('link')) continue; // links inside a sentence
            if (r.width < 43.5 || r.height < 43.5) out.push((el.tagName + '.' + el.className + ' "' + (el.getAttribute('aria-label') || el.textContent || '').trim().slice(0, 24) + '" ' + Math.round(r.width) + 'x' + Math.round(r.height)));
          }
          return out.slice(0, 14);
        }"""
    )


def clean_text(page, where: str):
    text = page.evaluate("document.body.innerText")
    m = BAD_TEXT.search(text)
    assert not m, f"{where}: found {m.group(0)!r} in page text near ...{text[max(0, m.start() - 40):m.end() + 40]!r}"
