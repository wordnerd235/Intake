"""Sync UI pass: with a firebase config present (and a fake in-page SDK), sign up / sync / sign out / switch accounts."""
import re

from playwright.sync_api import expect

from fake_firebase import CONFIG
from helpers import Net, clean_text, num


def run_cloud(browser, base, rec):
    net = Net()
    net.fake_firebase = True
    ctx = browser.new_context(viewport={"width": 390, "height": 844}, has_touch=True, is_mobile=True, service_workers="block")
    net.install(ctx, base)
    ctx.route(re.compile(r".*/js/firebase-config\.js$"), lambda r: r.fulfill(status=200, content_type="application/javascript", body=CONFIG))
    errors = []
    p = ctx.new_page()
    p.set_default_timeout(10000)
    p.on("console", lambda m: errors.append(f"{m.type}: {m.text}") if m.type == "error" else None)
    p.on("pageerror", lambda e: errors.append(f"pageerror: {e}"))
    step = rec.step
    import os
    if os.environ.get("E2E_DEBUG"):
        rec.on_fail = lambda label: p.screenshot(path=os.path.join(os.environ["E2E_DEBUG"], re.sub(r"\W+", "_", label) + ".png"))
    go = lambda route: (p.evaluate(f"location.hash = '{route}'"), p.wait_for_timeout(250))
    docs = lambda: p.evaluate("Object.keys(globalThis.__fb ? globalThis.__fb.docs : {})")

    def setup_and_log():
        p.goto(base + "index.html")
        expect(p.locator("h1")).to_have_text("Welcome to Intake")
        p.get_by_role("button", name="Skip setup, I will do this later").click()
        expect(p.locator(".ring-num")).to_be_visible()
        p.locator(".fab").click()
        p.get_by_role("button", name="Quick add").click()
        p.fill("#qa-name", "Cloud lunch")
        p.fill("#qa-kcal", "410")
        p.get_by_role("button", name="Add", exact=True).click()
        p.keyboard.press("Escape")
        go("#/more")
        expect(p.locator(".row-link.big .muted")).to_have_text("Signed out", timeout=10000)

    def email_first_and_google_secondary():
        go("#/account")
        expect(p.get_by_role("heading", name="Sign in to sync")).to_be_visible()
        # R-03: the email form leads; Google is a secondary button below it
        email_y = p.locator("#ac-email").bounding_box()["y"]
        google = p.get_by_role("button", name="Continue with Google")
        assert google.bounding_box()["y"] > p.get_by_role("button", name="Sign in", exact=True).bounding_box()["y"] > email_y
        assert "btn-primary" not in (google.get_attribute("class") or "")
        assert p.locator("#ac-ios-note").count() == 0, "the installed-iOS note must not show in a normal browser"

    def google_redirect_error_is_shown():
        p2 = ctx.new_page()
        p2.set_default_timeout(10000)
        p2.add_init_script("globalThis.__fbRedirectError = 'auth/unauthorized-domain'")  # the fake SDK's getRedirectResult rejects once
        p2.goto(base + "index.html#/account")
        expect(p2.locator(".field-error")).to_contain_text("isn't authorized in Firebase", timeout=10000)
        p2.close()

    def ios_standalone_note():
        p3 = ctx.new_page()
        p3.set_default_timeout(10000)
        p3.add_init_script(
            "Object.defineProperty(navigator, 'standalone', { value: true });"
            "Object.defineProperty(navigator, 'userAgent', { get: () => 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 Version/17.4 Mobile/15E148 Safari/604.1' });"
        )
        p3.goto(base + "index.html#/account")
        note = p3.locator("#ac-ios-note")
        expect(note).to_have_text("Google sign-in may not work in the installed app — use email & password (one account works on all devices)")
        # the note sits right under the Google button
        below = p3.evaluate(
            """() => {
              const g = [...document.querySelectorAll('button')].find((b) => b.textContent.includes('Continue with Google'));
              const n = document.getElementById('ac-ios-note');
              return !!g && !!n && n.getBoundingClientRect().top >= g.getBoundingClientRect().bottom - 1;
            }"""
        )
        assert below, "the iOS note must sit under the Google button"
        p3.close()

    def sign_up():
        go("#/account")
        expect(p.get_by_role("heading", name="Sign in to sync")).to_be_visible()
        p.get_by_role("button", name="Create an account").click()
        p.fill("#ac-email", "first@example.com")
        p.fill("#ac-pass", "abc")
        p.get_by_role("button", name="Create account").click()
        expect(p.locator(".field-error")).to_contain_text("at least 6")
        p.fill("#ac-pass", "secret123")
        p.get_by_role("button", name="Create account").click()
        expect(p.locator(".acct strong")).to_have_text("first@example.com")
        expect(p.locator(".ledger dd").first).to_contain_text("Synced", timeout=10000)
        clean_text(p, "account signed in")

    def data_reaches_cloud():
        for _ in range(40):
            if any("/foodLogs/" in d for d in docs()):
                break
            p.wait_for_timeout(250)
        names = docs()
        assert any(re.match(r"users/u1/foodLogs/", d) for d in names), names
        assert any(d == "users/u1/settings/profile" for d in names), names
        p.get_by_role("button", name="Sync now").click()
        expect(p.locator(".toast-msg")).to_have_text("Sync complete")
        expect(p.locator(".ledger div").nth(2).locator("dd")).to_have_text("0")

    def edit_syncs():
        go("#/today")
        p.locator(".water-card .btn-primary").click()
        go("#/account")
        for _ in range(40):
            if any("/water/" in d for d in docs()):
                return
            p.wait_for_timeout(250)
        raise AssertionError(f"water doc never reached the cloud: {docs()}")

    def offline_then_recover():
        p.evaluate("globalThis.__fb.offline = true")
        go("#/today")
        p.locator(".water-card .btn-primary").click()
        go("#/account")
        expect(p.locator(".ledger dd").first).not_to_contain_text("Synced", timeout=10000)  # error or pending, never claims Synced
        p.evaluate("globalThis.__fb.offline = false")
        p.get_by_role("button", name="Sync now").click()
        expect(p.locator(".ledger dd").first).to_contain_text("Synced", timeout=15000)

    def sign_out_keeps_data():
        p.get_by_role("button", name="Sign out", exact=True).click()
        expect(p.get_by_role("heading", name="Sign in to sync")).to_be_visible()
        go("#/diary")
        expect(p.locator(".entry", has_text="Cloud lunch")).to_have_count(1)

    def other_account_asks():
        go("#/account")
        p.get_by_role("button", name="Create an account").click()
        p.fill("#ac-email", "second@example.com")
        p.fill("#ac-pass", "another-secret")
        p.get_by_role("button", name="Create account").click()
        expect(p.get_by_role("heading", name="Use this account on this device?")).to_be_visible()
        p.get_by_role("button", name="Erase this device's data first").click()
        expect(p.locator(".acct strong")).to_have_text("second@example.com")
        expect(p.locator(".ledger dd").first).to_contain_text("Synced", timeout=10000)  # erase finished and the new account is attached
        go("#/diary")
        expect(p.locator("h1")).to_have_text("Welcome to Intake")  # erased: this new account starts with setup again

    def first_account_restores():
        go("#/account")
        p.get_by_role("button", name="Sign out", exact=True).click()
        p.fill("#ac-email", "first@example.com")
        p.fill("#ac-pass", "wrong-password")
        p.get_by_role("button", name="Sign in", exact=True).click()
        expect(p.locator(".field-error")).to_contain_text("incorrect")
        p.fill("#ac-pass", "secret123")
        p.get_by_role("button", name="Sign in", exact=True).click()
        expect(p.locator(".acct strong")).to_have_text("first@example.com")
        for _ in range(40):  # the pulled settings mark setup as done; then the diary opens
            go("#/diary")
            if p.locator(".totals .big-val .num").count():
                break
            p.wait_for_timeout(250)
        expect(p.locator(".entry", has_text="Cloud lunch")).to_have_count(1, timeout=10000)
        assert num(p.locator(".totals .big-val .num").inner_text()) == 410

    def sign_out_and_remove():
        go("#/account")
        p.get_by_role("button", name="Sign out and remove data from this device").click()
        p.locator(".dialog").get_by_role("button", name="Sign out and remove").click()
        expect(p.locator(".toast-msg")).to_contain_text("removed local data")
        go("#/diary")
        expect(p.locator("h1")).to_have_text("Welcome to Intake")

    def no_errors():
        bad = [e for e in errors if "Failed to load resource" not in e]
        assert not bad, bad[:3]

    step("[cloud] first run offers sync, signed-out status", setup_and_log)
    step("[cloud] email sign-in leads, Google is secondary", email_first_and_google_secondary)
    step("[cloud] a failed Google redirect is shown, not swallowed", google_redirect_error_is_shown)
    step("[cloud] installed iOS app gets the Google note", ios_standalone_note)
    step("[cloud] create account (validation, then success)", sign_up)
    step("[cloud] local data is pushed to the account", data_reaches_cloud)
    step("[cloud] a new edit syncs automatically", edit_syncs)
    step("[cloud] failed push is reported honestly, then recovers", offline_then_recover)
    step("[cloud] sign out keeps local data", sign_out_keeps_data)
    step("[cloud] a different account asks merge or erase", other_account_asks)
    step("[cloud] sign back in and the data returns (wrong password refused)", first_account_restores)
    step("[cloud] sign out and remove data from this device", sign_out_and_remove)
    step("[cloud] no console errors", no_errors)
    ctx.close()
