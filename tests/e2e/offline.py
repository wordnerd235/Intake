"""Offline pass: install the service worker, go offline, reload, and keep using the app."""
import functools
import http.server
import re
import threading

from playwright.sync_api import expect

from helpers import Net, clean_text, num, served_root


class PatchableServer:
    """Static server that can serve a changed sw.js, to simulate shipping a new version of the app."""

    def __init__(self):
        self.patched = False
        outer = self

        class Handler(http.server.SimpleHTTPRequestHandler):
            def log_message(self, *a):
                pass

            def do_GET(self):
                if self.path.split("?")[0] == "/sw.js" and outer.patched:
                    body = (served_root() / "sw.js").read_text(encoding="utf-8").replace("const CACHE_VERSION = '", "const CACHE_VERSION = 'e2e-").encode()
                    self.send_response(200)
                    self.send_header("Content-Type", "application/javascript")
                    self.send_header("Content-Length", str(len(body)))
                    self.send_header("Cache-Control", "no-store")
                    self.end_headers()
                    self.wfile.write(body)
                    return
                super().do_GET()

        self.httpd = http.server.ThreadingHTTPServer(("127.0.0.1", 0), functools.partial(Handler, directory=str(served_root())))
        self.base = f"http://127.0.0.1:{self.httpd.server_address[1]}/"
        threading.Thread(target=self.httpd.serve_forever, daemon=True).start()

    def stop(self):
        self.httpd.shutdown()

ROUTES = ("#/today", "#/diary", "#/progress", "#/foods/foods", "#/more")


def run_offline(browser, _base, rec):
    srv = PatchableServer()
    base = srv.base
    net = Net()
    ctx = browser.new_context(viewport={"width": 390, "height": 844}, has_touch=True, is_mobile=True)  # service workers allowed
    net.install(ctx, base)
    errors = []
    page = ctx.new_page()
    page.set_default_timeout(10000)
    page.on("console", lambda m: errors.append(f"{m.type}: {m.text}") if m.type == "error" else None)
    page.on("pageerror", lambda e: errors.append(f"pageerror: {e}"))
    step = rec.step

    def install_sw():
        page.goto(base + "index.html")
        page.get_by_role("button", name="Skip setup, I will do this later").click()
        expect(page.locator(".ring-num")).to_be_visible()
        page.evaluate("navigator.serviceWorker.ready.then(() => true)")
        for _ in range(40):
            if page.evaluate("!!navigator.serviceWorker.controller"):
                break
            page.wait_for_timeout(150)
        else:
            page.reload()
            assert page.evaluate("!!navigator.serviceWorker.controller"), "service worker never took control"
        names = page.evaluate("caches.keys()")
        assert any(n.startswith("intake-v") for n in names), names
        shell = next(n for n in names if n.startswith("intake-v"))
        count = page.evaluate("(n) => caches.open(n).then((c) => c.keys()).then((k) => k.length)", shell)
        assert count >= 55, f"only {count} files precached"
        for r in ROUTES:  # warm every lazy view once while online
            page.evaluate(f"location.hash = '{r}'")
            page.wait_for_timeout(250)

    def data_cached():
        for _ in range(60):  # foods.json (1.5 MB) is cached best-effort right after install
            keys = page.evaluate("caches.open('intake-data').then((c) => c.keys()).then((k) => k.map((r) => r.url))")
            if any(u.endswith("data/foods.json") for u in keys):
                return
            page.wait_for_timeout(250)
        raise AssertionError("foods.json was not cached")

    def reload_offline():
        ctx.set_offline(True)
        net.offline = True
        page.goto(base + "index.html#/today")
        page.reload()
        expect(page.locator(".ring-num")).to_be_visible()
        clean_text(page, "offline today")

    def navigate_offline():
        for r in ROUTES:
            page.evaluate(f"location.hash = '{r}'")
            page.wait_for_timeout(350)
            assert page.locator(".empty-title", has_text="could not load").count() == 0, f"{r} failed to load offline"
            assert page.locator("h1").count() >= 1, r
            clean_text(page, f"offline {r}")

    def log_food_offline():
        page.evaluate("location.hash = '#/today'")
        page.locator(".fab").click()
        page.fill("#af-q", "banana")
        expect(page.locator(".sheet .res-name", has_text=re.compile(r"^Bananas, raw$")).first).to_be_visible()
        page.press("#af-q", "Enter")  # the online search is on request now; offline it explains itself and local results still work
        expect(page.locator(".sheet .online")).to_contain_text("offline", timeout=10000)
        page.locator(".sheet .res-row").filter(has=page.locator(".res-name", has_text=re.compile(r"^Bananas, raw$"))).first.locator(".res-add").click()
        expect(page.locator(".toast-msg")).to_contain_text("Added 1 medium")
        page.keyboard.press("Escape")
        page.evaluate("location.hash = '#/diary'")
        expect(page.locator(".totals .big-val .num")).to_have_text("105")

    def back_online():
        ctx.set_offline(False)
        net.offline = False
        page.reload()
        expect(page.locator(".totals .big-val .num")).to_have_text("105")

    def update_toast():
        # a new service worker version shows the update bar; Reload applies it
        page.evaluate(
            """async () => {
              const reg = await navigator.serviceWorker.ready;
              window.__updateFound = new Promise((r) => reg.addEventListener('updatefound', r, { once: true }));
            }"""
        )
        srv.patched = True
        page.evaluate("navigator.serviceWorker.getRegistration().then((r) => r.update())")
        expect(page.locator(".update-bar")).to_be_visible(timeout=15000)
        expect(page.locator(".update-bar")).to_contain_text("Update available")
        with page.expect_navigation(timeout=15000):
            page.locator(".update-bar .btn").click()
        expect(page.locator(".totals .big-val .num")).to_have_text("105")
        names = page.evaluate("caches.keys()")
        assert any("e2e-" in n for n in names) and len([n for n in names if n.startswith("intake-v")]) == 1, names

    def clean_console():
        bad = [e for e in errors if "net::ERR_INTERNET_DISCONNECTED" not in e and "Failed to fetch" not in e]
        assert not bad, bad[:3]

    step("[offline] install service worker and precache the app", install_sw)
    step("[offline] foods.json cached for offline search", data_cached)
    step("[offline] reload while offline opens the app", reload_offline)
    step("[offline] every screen works offline", navigate_offline)
    step("[offline] search and log a food offline", log_food_offline)
    step("[offline] back online, data intact", back_online)
    step("[offline] update bar appears for a new version and Reload applies it", update_toast)
    step("[offline] no unexpected console errors", clean_console)
    ctx.close()
    srv.stop()
