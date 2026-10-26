"""The Intake user journey, run once per viewport. Each method is one reported step."""
import re
import tempfile
from pathlib import Path

from playwright.sync_api import expect

from helpers import SHOTS, Net, clean_text, num, overflow, small_targets

BANANA_KCAL = 105


class Scenario:
    def __init__(self, browser, base, kind, rec):
        self.kind, self.base, self.rec, self.browser = kind, base, rec, browser
        self.mobile = kind == "mobile"
        self.net = Net()
        self.size = {"width": 390, "height": 844} if self.mobile else {"width": 1366, "height": 900}
        self.ctx = browser.new_context(viewport=self.size, has_touch=self.mobile, is_mobile=self.mobile, device_scale_factor=2 if self.mobile else 1, service_workers="block", accept_downloads=True)
        self.net.install(self.ctx, base)
        self.errors = []
        self.page = self.new_page(self.ctx)
        self.expected_failures = ("openfoodfacts", "nal.usda.gov")  # services the test deliberately makes answer 503
        self.budget = None
        self.day_total_before_extra = 0

    # ---- plumbing
    def new_page(self, ctx):
        p = ctx.new_page()
        p.on("console", lambda m: self.errors.append(f"console.{m.type}: {m.text}") if m.type == "error" and not any(x in (m.location or {}).get("url", "") for x in self.expected_failures) else None)
        p.on("pageerror", lambda e: self.errors.append(f"pageerror: {e}"))
        p.set_default_timeout(8000)
        return p

    def shot(self, name, page=None, full=True):
        """Screenshot; for tall pages the viewport is stretched so the fixed tab bar sits at the bottom, as on a real phone."""
        SHOTS.mkdir(parents=True, exist_ok=True)
        p = page or self.page
        path = str(SHOTS / f"{name}-{self.kind}.png")
        if not full:
            p.wait_for_timeout(450)  # let the sheet finish sliding in
            return p.screenshot(path=path)
        size = p.viewport_size
        height = p.evaluate("document.documentElement.scrollHeight")
        if height > size["height"]:
            p.set_viewport_size({"width": size["width"], "height": min(height, 4000)})
            p.wait_for_timeout(150)
        p.screenshot(path=path)
        p.set_viewport_size(size)
        p.wait_for_timeout(100)

    def goto(self, route):
        self.page.evaluate(f"location.hash = '{route}'")
        self.page.wait_for_timeout(250)

    def close_sheets(self):
        for _ in range(4):
            if self.page.locator(".scrim").count() == 0:
                break
            self.page.keyboard.press("Escape")
            self.page.wait_for_timeout(260)

    def add_button(self):
        narrow = self.page.viewport_size["width"] < 900  # the sidebar button only exists on wide screens
        return self.page.locator(".fab" if narrow else ".side-add")

    def open_add(self):
        self.add_button().click()
        expect(self.page.locator(".sheet.add-food")).to_be_visible()

    def search(self, q):
        self.page.fill("#af-q", q)

    def day_total(self):
        self.goto("#/diary")
        expect(self.page.locator(".totals .big-val .num")).to_be_visible()
        return num(self.page.locator(".totals .big-val .num").inner_text())

    def toast_text(self):
        return self.page.locator(".toast-msg").inner_text()

    def pick_result(self, name):
        row = self.page.locator(".sheet .res-row").filter(has=self.page.locator(".res-name", has_text=re.compile(rf"^{re.escape(name)}$"))).first
        row.locator(".res-main").click()

    def submit_detail(self):
        self.page.locator(".sheet-foot .btn-primary").last.click()

    # ---- steps
    def onboarding(self):
        p = self.page
        p.goto(self.base + "index.html")
        expect(p.locator("h1")).to_have_text("Welcome to Intake")
        assert p.url.endswith("#/onboarding"), p.url
        clean_text(p, "onboarding 1")
        self.shot("onboarding")
        p.get_by_role("button", name="Get started").click()
        # validation first: empty fields must not advance
        p.get_by_role("button", name="Continue").click()
        expect(p.locator(".field-error")).to_contain_text("Choose male or female")  # no sex is pre-selected (R-19)
        p.get_by_role("radio", name="Male", exact=True).click()
        p.get_by_role("button", name="Continue").click()
        expect(p.locator(".field-error")).to_contain_text("birth year between")
        p.fill("#ob-birth", "2016")  # a 10-year-old is out of range
        p.get_by_role("button", name="Continue").click()
        expect(p.locator(".field-error")).to_contain_text("birth year between")
        p.fill("#ob-birth", "1990")
        p.fill("#ob-ft", "5")
        p.fill("#ob-in", "10")
        p.fill("#ob-weight", "180")
        p.get_by_role("button", name="Continue").click()
        expect(p.locator("h1")).to_have_text("Your goal")
        p.get_by_role("radio", name="Lose weight").click()
        p.fill("#ob-goal", "165")
        p.get_by_role("button", name="Continue").click()
        expect(p.locator("h1")).to_have_text("Your daily budget")
        self.budget = num(p.locator(".onb-budget .big-num").inner_text())
        assert 1700 <= self.budget <= 2100, f"unexpected budget {self.budget}"
        clean_text(p, "onboarding budget")
        self.shot("onboarding-budget")
        p.get_by_role("button", name="Start tracking").click()
        expect(p.locator(".ring-num")).to_be_visible()
        assert p.url.endswith("#/today")

    def today_empty(self):
        p = self.page
        expect(p.locator(".ring-label")).to_have_text("kcal left")
        assert num(p.locator(".ring-num").inner_text()) == self.budget
        clean_text(p, "today (empty)")
        self.shot("today-empty")

    def search_banana_and_add(self):
        p = self.page
        self.open_add()
        self.search("banana")
        expect(p.locator(".sheet .res-name", has_text=re.compile(r"^Bananas, raw$")).first).to_be_visible()
        first = p.locator(".sheet .usda .res-name, .sheet .res-name").first.inner_text()
        assert first == "Bananas, raw", f"top result for banana was {first!r}"
        self.shot("add-food", full=False)
        self.pick_result("Bananas, raw")
        expect(p.locator("#fd-qty")).to_be_visible()
        unit = p.locator("#fd-unit option:checked").inner_text()
        assert unit.startswith("1 medium"), f"default serving was {unit!r}"
        expect(p.locator(".facts-kcal strong")).to_have_text(str(BANANA_KCAL))
        clean_text(p, "food detail")
        self.shot("food-detail", full=False)
        self.submit_detail()
        expect(p.locator(".toast-msg")).to_contain_text("Added to")
        self.close_sheets()
        assert self.day_total() == BANANA_KCAL
        self.goto("#/today")
        assert num(self.page.locator(".ring-num").inner_text()) == self.budget - BANANA_KCAL
        clean_text(p, "today after banana")

    def edit_quantity(self):
        p = self.page
        self.day_total()
        p.locator(".entry", has_text="Bananas, raw").first.click()
        expect(p.locator("#fd-qty")).to_be_visible()
        p.fill("#fd-qty", "2")
        expect(p.locator(".facts-kcal strong")).to_have_text(str(BANANA_KCAL * 2))
        p.get_by_role("button", name="Save changes").click()
        self.close_sheets()
        assert self.day_total() == BANANA_KCAL * 2
        p.locator(".entry", has_text="Bananas, raw").first.click()
        p.fill("#fd-qty", "1 1/2")  # fractions are accepted
        expect(p.locator(".facts-kcal strong")).to_have_text(str(round(BANANA_KCAL * 1.5)))
        p.fill("#fd-qty", "1/2")
        expect(p.locator(".facts-kcal strong")).to_have_text("53")
        p.fill("#fd-qty", "abc")
        expect(p.locator(".field-error").first).to_contain_text("Enter an amount")
        assert p.locator(".sheet-foot .btn-primary").last.is_disabled()
        p.fill("#fd-qty", "1")
        p.get_by_role("button", name="Save changes").click()
        self.close_sheets()
        assert self.day_total() == BANANA_KCAL

    def delete_and_undo(self):
        p = self.page
        self.day_total()
        p.locator(".entry", has_text="Bananas, raw").first.click()
        p.get_by_role("button", name="Delete").click()
        expect(p.locator(".toast-msg")).to_have_text("Entry deleted")
        expect(p.locator(".entry", has_text="Bananas, raw")).to_have_count(0)
        assert num(p.locator(".totals .big-val .num").inner_text()) == 0
        p.locator(".toast-action").click()
        expect(p.locator(".entry", has_text="Bananas, raw")).to_have_count(1)
        assert num(p.locator(".totals .big-val .num").inner_text()) == BANANA_KCAL

    def quick_add(self):
        p = self.page
        self.open_add()
        p.get_by_role("button", name="Quick add").click()
        clean_text(p, "quick add sheet")
        p.get_by_role("button", name="Add", exact=True).click()  # empty calories must be refused
        expect(p.locator("#qa-kcal")).to_be_visible()
        expect(p.locator(".sheet .field-error").last).to_contain_text("calories")
        p.fill("#qa-name", "Coffee with cream")
        p.fill("#qa-kcal", "250")
        p.fill("#qa-p", "2")
        p.get_by_role("button", name="Add", exact=True).click()
        self.close_sheets()
        assert self.day_total() == BANANA_KCAL + 250
        expect(p.locator(".entry", has_text="Coffee with cream")).to_have_count(1)

    def custom_food(self):
        p = self.page
        self.open_add()
        self.search("zzprotein")
        p.get_by_role("button", name="Create food").click()
        expect(p.locator("#fe-name")).to_have_value("zzprotein")
        clean_text(p, "food editor")
        p.fill("#fe-name", "Protein bar")
        p.fill("#fe-label", "1 bar")
        p.fill("#fe-kcal", "200")
        p.fill("#fe-protein", "20")
        p.get_by_role("button", name="Save food").click()
        expect(p.locator("#fd-qty")).to_be_visible()  # detail opens straight away
        self.submit_detail()
        self.close_sheets()
        assert self.day_total() == BANANA_KCAL + 250 + 200
        self.open_add()
        self.search("protein bar")
        expect(p.locator(".sheet .res-name", has_text="Protein bar").first).to_be_visible()
        self.close_sheets()

    def recipe(self):
        p = self.page
        before = self.day_total()
        self.goto("#/foods/recipes")
        expect(p.locator(".empty-title")).to_have_text("No recipes yet")
        p.get_by_role("button", name="New recipe").click()
        p.fill("#re-name", "Banana pot")
        p.fill("#re-serv", "2")
        p.get_by_role("button", name="Add ingredient").click()
        p.locator("#af-q").fill("banana")
        self.pick_result("Bananas, raw")
        p.locator(".sheet-foot .btn-primary", has_text="Add ingredient").click()
        expect(p.locator("#fd-qty")).to_have_count(0)
        p.keyboard.press("Escape")  # the picker stays open so several ingredients can be added; close it
        expect(p.locator(".ing-name")).to_have_text("Bananas, raw")
        expect(p.locator(".facts-kcal strong").first).to_have_text("53")
        clean_text(p, "recipe editor")
        # R-32: Save is refused, with a message, while an ingredient amount is not usable
        amount = p.get_by_label("Amount of Bananas, raw")
        for bad in ("abc", "", "0", "10001"):
            amount.fill(bad)
            p.get_by_role("button", name="Save recipe").click()
            expect(p.locator(".sheet .field-error").last).to_contain_text("Not saved")
            expect(p.locator("#re-name")).to_be_visible()  # the editor stays open
            assert p.locator(".toast-msg", has_text="Recipe saved").count() == 0, f"saved with amount {bad!r}"
        amount.fill("1")
        p.get_by_role("button", name="Save recipe").click()
        expect(p.locator(".res-name", has_text="Banana pot")).to_be_visible()
        p.get_by_role("button", name="Log Banana pot").click()
        expect(p.locator("#fd-qty")).to_be_visible()
        self.submit_detail()
        self.close_sheets()
        assert self.day_total() == before + 53

    def exercise(self):
        p = self.page
        self.goto("#/today")
        left = num(p.locator(".ring-num").inner_text())
        self.goto("#/diary")
        p.get_by_role("button", name="Add exercise").click()
        p.fill("#ex-q", "walking")
        p.locator(".sheet .res-main").first.click()
        clean_text(p, "exercise form")
        p.fill("#ex-min", "30")
        kcal = num(p.locator("#ex-kcal").input_value())
        assert kcal > 50, kcal
        p.locator(".sheet-foot .btn-primary").click()
        expect(p.locator(".toast-msg")).to_contain_text("burned")
        self.close_sheets()
        self.goto("#/today")
        assert num(p.locator(".ring-num").inner_text()) == left + kcal, "remaining should rise by the exercise kcal"
        assert p.locator(".ring-label").inner_text() == "kcal left"
        clean_text(p, "today after exercise")

    def water_and_weight(self):
        p = self.page
        self.goto("#/today")
        add = p.locator(".water-card .btn-primary")
        add.click()
        expect(p.locator(".water-card .big-val .num")).to_have_text("8")
        add.click()
        expect(p.locator(".water-card .big-val .num")).to_have_text("16")
        p.get_by_role("button", name="Remove 8 oz").click()
        expect(p.locator(".water-card .big-val .num")).to_have_text("8")
        p.locator(".weight-card").get_by_role("button", name="Edit").click()
        p.fill("input[aria-label='Weight in lb']", "179.2")
        p.get_by_role("button", name="Save", exact=True).click()
        expect(p.locator(".weight-card .big-val")).to_contain_text("179.2 lb")
        self.close_sheets()

    def date_navigation(self):
        p = self.page
        self.goto("#/diary")
        label = p.locator(".datenav-date").inner_text()
        p.get_by_role("button", name="Previous day").click()
        expect(p.locator(".datenav-date")).not_to_have_text(label)
        assert p.locator(".datenav .chip", has_text="Today").is_visible()
        expect(p.locator(".entry", has_text="Bananas, raw")).to_have_count(0)  # yesterday is empty
        p.get_by_role("button", name="Next day").click()
        expect(p.locator(".datenav-date")).to_have_text(label)
        p.locator("input.datenav-input").evaluate("e => { e.value = '2026-10-01'; e.dispatchEvent(new Event('change')); }")
        expect(p.locator(".datenav-date")).to_contain_text("Oct")
        p.locator(".datenav .chip", has_text="Today").click()
        expect(p.locator(".datenav-date")).to_have_text(label)

    def copy_meal_from_yesterday(self):
        p = self.page
        self.goto("#/diary")
        p.get_by_role("button", name="Previous day").click()
        self.open_add()
        p.locator(".meal-pick").select_option(index=2)  # Dinner
        p.get_by_role("button", name="Quick add").click()
        p.fill("#qa-name", "Yesterday dinner")
        p.fill("#qa-kcal", "320")
        p.get_by_role("button", name="Add", exact=True).click()
        self.close_sheets()
        p.locator(".datenav .chip", has_text="Today").click()
        before = self.day_total()
        p.get_by_role("button", name="Dinner options").click()
        p.get_by_role("menuitem", name="Copy from yesterday").click()
        expect(p.locator(".toast-msg")).to_contain_text("Copied 1 item")
        expect(p.locator(".entry", has_text="Yesterday dinner")).to_have_count(1)
        assert num(p.locator(".totals .big-val .num").inner_text()) == before + 320
        p.locator(".toast-action").click()  # Undo
        expect(p.locator(".entry", has_text="Yesterday dinner")).to_have_count(0)
        p.get_by_role("button", name="Dinner options").click()
        p.get_by_role("menuitem", name="Copy from yesterday").click()
        expect(p.locator(".entry", has_text="Yesterday dinner")).to_have_count(1)

    def copy_whole_day(self):
        p = self.page
        self.goto("#/diary")
        total = num(p.locator(".totals .big-val .num").inner_text())
        assert total > 0, total
        p.get_by_role("button", name="Diary options").click()
        p.get_by_role("menuitem", name="Copy whole day to…").click()
        expect(p.locator(".sheet-title").last).to_have_text("Copy whole day")
        p.get_by_role("button", name="Copy day").click()  # default target: tomorrow
        expect(p.locator(".toast-msg")).to_contain_text("Copied")
        p.get_by_role("button", name="Next day").click()
        expect(p.locator(".totals .big-val .num")).to_have_text(str(int(total)))
        p.locator(".toast-action").click()  # Undo removes exactly the copied rows
        expect(p.locator(".totals .big-val .num")).to_have_text("0")
        p.get_by_role("button", name="Previous day").click()
        expect(p.locator(".totals .big-val .num")).to_have_text(str(int(total)))

    def amount_limits(self):
        p = self.page
        self.goto("#/diary")
        p.locator(".entry", has_text="Bananas, raw").first.click()
        expect(p.locator("#fd-qty")).to_be_visible()
        for bad, msg in (("99999", "at most 10,000 servings"), ("9000", "That comes to 1,062,000 g"), ("0", "above 0"), ("1e22", "Enter an amount")):
            p.fill("#fd-qty", bad)
            expect(p.locator(".field-error").first).to_contain_text(msg)
            assert p.locator(".sheet-foot .btn-primary").last.is_disabled(), bad
            clean_text(p, f"amount {bad}")
        p.select_option("#fd-unit", label="g")  # grams typed: the message talks about grams, not servings
        p.fill("#fd-qty", "10001")
        expect(p.locator(".field-error").first).to_have_text("One entry can hold at most 10,000 g.")
        p.select_option("#fd-unit", index=0)
        p.fill("#fd-qty", "80")  # 80 medium bananas is about 9.4 kg: still within the 10 kg cap
        expect(p.locator(".facts-kcal strong")).to_have_text(re.compile(r"^8,40\d$"))
        p.fill("#fd-qty", "1")
        self.close_sheets()

    def number_caps(self):
        """R-21: every number field has a ceiling, says which one, and keeps what was really saved."""
        p = self.page
        # Quick Add: calories and macros
        self.open_add()
        p.get_by_role("button", name="Quick add").click()
        p.fill("#qa-kcal", "999999999")
        p.get_by_role("button", name="Add", exact=True).click()
        expect(p.locator(".sheet .field-error").last).to_have_text("Calories can be at most 10,000 kcal.")
        p.fill("#qa-kcal", "250")
        p.fill("#qa-p", "99999")
        p.get_by_role("button", name="Add", exact=True).click()
        expect(p.locator(".sheet .field-error").last).to_have_text("Protein can be at most 2,000 g.")
        self.close_sheets()
        # exercise: minutes, then calories burned
        self.goto("#/diary")
        p.get_by_role("button", name="Add exercise").click()
        p.fill("#ex-q", "walking")
        p.locator(".sheet .res-main").first.click()
        p.fill("#ex-min", "999999")
        p.locator(".sheet-foot .btn-primary").click()
        expect(p.locator(".sheet .field-error").last).to_have_text("Minutes can be at most 1,440 min.")
        p.fill("#ex-min", "30")
        p.fill("#ex-kcal", "999999")
        p.locator(".sheet-foot .btn-primary").click()
        expect(p.locator(".sheet .field-error").last).to_have_text("Calories burned can be at most 5,000 kcal.")
        p.fill("#ex-kcal", "5001")
        p.locator(".sheet-foot .btn-primary").click()
        expect(p.locator(".sheet .field-error").last).to_have_text("Calories burned can be at most 5,000 kcal.")
        self.close_sheets()
        # custom food: calories per serving and serving weight
        self.open_add()
        self.search("zzcapfood")
        p.get_by_role("button", name="Create food").click()
        p.fill("#fe-name", "Cap test")
        p.fill("#fe-kcal", "99999999")
        p.get_by_role("button", name="Save food").click()
        expect(p.locator(".sheet .field-error").last).to_have_text("Calories can be at most 10,000 kcal.")
        p.fill("#fe-kcal", "100")
        p.fill("#fe-grams", "99999")
        p.get_by_role("button", name="Save food").click()
        expect(p.locator(".sheet .field-error").last).to_have_text("Serving weight can be at most 10,000 g.")
        self.close_sheets()
        # settings: the calorie override and the water goal reject, explain, and put the saved value back
        self.goto("#/more")
        saved = p.input_value("#pf-ovr")
        for bad, msg in (("99999999", "at most 10,000 kcal"), ("5", "at least 500 kcal"), ("abc", "must be a number")):
            p.fill("#pf-ovr", bad)
            p.locator("#pf-ovr").dispatch_event("change")
            expect(p.locator(".toast-msg")).to_contain_text(msg)
            assert p.input_value("#pf-ovr") == saved, (bad, p.input_value("#pf-ovr"), saved)
            clean_text(p, "override rejected")
        goal = p.input_value("#pf-water")
        p.fill("#pf-water", "99999")
        p.locator("#pf-water").dispatch_event("change")
        expect(p.locator(".toast-msg")).to_contain_text("Water goal can be at most 340 oz.")
        assert p.input_value("#pf-water") == goal
        # Today's weight box
        self.goto("#/today")
        self.goto("#/diary")

    def thousands_separator(self):
        """R-30: "1,200" means 1200 (not 1.2); "1,5" is still a decimal; an unclear comma is refused with a message."""
        p = self.page
        before = self.day_total()
        assert p.locator(".datenav .chip", has_text="Today").is_hidden(), "expected to be on today"
        self.open_add()
        p.get_by_role("button", name="Quick add").click()
        p.fill("#qa-name", "Restaurant dinner")
        p.fill("#qa-kcal", "1,2345")
        p.get_by_role("button", name="Add", exact=True).click()
        expect(p.locator(".sheet .field-error").last).to_contain_text("is unclear")
        p.fill("#qa-kcal", "1,200")
        p.get_by_role("button", name="Add", exact=True).click()
        self.close_sheets()
        assert self.day_total() == before + 1200, (before, self.day_total())
        row = p.locator(".entry", has_text="Restaurant dinner")
        expect(row).to_have_count(1)
        expect(row.locator(".entry-kcal")).to_have_text("1,200")
        row.click()  # take it off again so later totals stay as they were
        p.get_by_role("button", name="Delete").click()
        self.close_sheets()
        assert self.day_total() == before, (before, self.day_total())

    def copy_day_into_filled_day(self):
        """R-29: copying into a day that already has entries asks, and offers add or replace; Undo restores."""
        p = self.page
        self.goto("#/diary")
        chip = p.locator(".datenav .chip", has_text="Today")
        if chip.is_visible():  # only shown when another day is on screen
            chip.click()
        # exercise rows share the .entry class; the copy only moves food, so count food rows apart
        food = p.locator(".entry").filter(has_not=p.locator(".entry-kcal", has_text=re.compile(r"^\+")))

        def settled():
            """Read (food rows, food kcal, day total) once two reads 200 ms apart agree, so a re-render in flight is not measured."""
            last = None
            for _ in range(30):
                kcal = sum(num(t) for t in food.locator(".entry-kcal").all_inner_texts())
                cur = (food.count(), kcal, num(p.locator(".totals .big-val .num").inner_text()))
                if cur == last:
                    return cur
                last = cur
                p.wait_for_timeout(200)
            raise AssertionError(f"diary never settled: {last}")

        p.get_by_role("button", name="Previous day").click()
        expect(p.locator(".datenav .chip", has_text="Today")).to_be_visible()
        expect(p.locator(".entry", has_text="Yesterday dinner").first).to_be_visible()
        y_count, y_kcal, y_total = settled()
        assert y_count > 0, "yesterday has nothing to copy"
        p.locator(".datenav .chip", has_text="Today").click()
        expect(p.locator(".datenav .chip", has_text="Today")).to_be_hidden()
        before_count, before_kcal, before_total = settled()
        assert before_count > 0, "today should already hold entries from earlier steps"
        other = before_total - before_kcal  # whatever else moves the day total (exercise), which a copy leaves alone
        p.get_by_role("button", name="Diary options").click()
        p.get_by_role("menuitem", name="Copy yesterday into this day").click()
        dlg = p.locator(".sheet.dialog")
        expect(dlg).to_be_visible()
        expect(dlg.locator(".sheet-title")).to_contain_text(f"already has {before_count} item")
        # Cancel changes nothing
        dlg.get_by_role("button", name="Cancel").click()
        expect(dlg).to_have_count(0)
        expect(food).to_have_count(before_count)
        # Add keeps what is there and appends the copies
        p.get_by_role("button", name="Diary options").click()
        p.get_by_role("menuitem", name="Copy yesterday into this day").click()
        p.locator(".sheet.dialog").get_by_role("button", name="Add", exact=True).click()
        expect(p.locator(".toast-msg")).to_contain_text(f"Copied {y_count} ")
        expect(food).to_have_count(before_count + y_count)
        expect(p.locator(".totals .big-val .num")).to_have_text(f"{before_total + y_kcal:,}")
        p.locator(".toast-action").click()  # Undo
        expect(food).to_have_count(before_count)
        expect(p.locator(".totals .big-val .num")).to_have_text(f"{before_total:,}")
        # Replace removes what is there, and Undo brings it all back
        p.get_by_role("button", name="Diary options").click()
        p.get_by_role("menuitem", name="Copy yesterday into this day").click()
        p.locator(".sheet.dialog").get_by_role("button", name="Replace").click()
        expect(p.locator(".toast-msg")).to_contain_text(f"Replaced {before_count} with {y_count} ")
        expect(food).to_have_count(y_count)
        expect(p.locator(".totals .big-val .num")).to_have_text(f"{other + y_kcal:,}")
        p.locator(".toast-action").click()  # Undo
        expect(food).to_have_count(before_count)
        expect(p.locator(".totals .big-val .num")).to_have_text(f"{before_total:,}")

    def toast_clears_add_button(self):
        """R-25: on a phone the toast must not sit on top of the round Add button."""
        p = self.page
        if not self.mobile:
            return
        self.goto("#/today")
        self.open_add()
        self.search("apple")
        p.locator(".sheet .res-row").first.locator(".res-add").click()
        p.keyboard.press("Escape")  # close the sheet while the toast is still up
        p.wait_for_timeout(400)
        toast = p.locator(".toast").first
        expect(toast).to_be_visible()
        fab = p.locator(".fab").bounding_box()
        box = toast.bounding_box()
        assert box["x"] + box["width"] <= fab["x"] + 1, f"toast {box} overlaps the Add button {fab}"
        p.locator(".toast-action").click()

    def toasts_behave(self):
        p = self.page
        # R-08: with a sheet open the toast sits low, within thumb reach, not on top of the sheet header
        self.goto("#/today")
        self.open_add()
        self.search("apple")
        p.locator(".sheet .res-row").first.locator(".res-add").click()
        toast = p.locator(".toast").first
        expect(toast).to_be_visible()
        if p.viewport_size["width"] < 900:
            top = toast.bounding_box()["y"]
            assert top > p.viewport_size["height"] * 0.5, f"toast at y={top}"
        p.locator(".toast-action").click()  # Undo, keeps the day's total unchanged
        self.close_sheets()
        # M2: a toast goes away by itself after about 5 s
        self.goto("#/diary")
        p.get_by_role("button", name="Diary options").click()
        p.get_by_role("menuitem", name="Copy yesterday into this day").click()
        p.locator(".sheet.dialog").get_by_role("button", name="Add", exact=True).click()  # today already has entries (R-29)
        expect(p.locator(".toast")).to_have_count(1)
        expect(p.locator(".entry", has_text="Yesterday dinner")).to_have_count(2)
        p.wait_for_timeout(5800)
        expect(p.locator(".toast")).to_have_count(0)
        # ...and a toast does not follow you to another screen (this also removes the duplicate again)
        p.locator(".entry", has_text="Yesterday dinner").last.click()
        p.get_by_role("button", name="Delete").click()
        expect(p.locator(".toast")).to_have_count(1)
        expect(p.locator(".entry", has_text="Yesterday dinner")).to_have_count(1)
        p.wait_for_timeout(1000)
        self.goto("#/progress")
        expect(p.locator(".toast")).to_have_count(0)

    def compact_totals_are_plain(self):
        p = self.page
        self.goto("#/diary")
        p.wait_for_timeout(300)
        stray = p.evaluate(
            """() => { const c = document.querySelector('.page').cloneNode(true); c.querySelectorAll('.ntable-wrap').forEach((n) => n.remove()); return c.innerText.includes('≥'); }"""
        )
        assert not stray, "compact summaries must show plain numbers (the >= mark is only for the Nutrients table)"
        if p.viewport_size["width"] < 900:
            p.get_by_role("button", name="Nutrients").click()
        expect(p.locator(".ntable-legend").last).to_have_text("≥ means some logged foods have no data for that nutrient")
        expect(p.locator(".ntable").last).to_contain_text("≥")
        self.close_sheets()

    def online_search_and_barcode(self):
        p = self.page
        OFF = "search.openfoodfacts.org/search"
        self.open_add()
        # R-05: nothing goes out while typing; the online source is asked on Enter or when the row is tapped
        before = self.net.count(OFF)
        p.fill("#af-q", "")
        p.type("#af-q", "hazelnut spread", delay=40)
        p.wait_for_timeout(1500)
        assert self.net.count(OFF) == before, "typing must not call the online source"
        row = p.locator(".sheet .online-row", has_text="Search branded foods online")
        expect(row).to_be_visible()
        p.press("#af-q", "Enter")
        expect(p.locator(".sheet .res-name", has_text="Hazelnut Spread Test")).to_be_visible(timeout=8000)
        expect(p.locator(".credit", has_text="Open Food Facts")).to_be_visible()
        assert self.net.count(OFF) == before + 1
        clean_text(p, "online results")
        self.shot("add-food-online", full=False)
        # the same query again is served from the session cache
        self.search("hazelnut spreads")
        self.search("hazelnut spread")
        p.press("#af-q", "Enter")
        expect(p.locator(".sheet .res-name", has_text="Hazelnut Spread Test")).to_be_visible(timeout=8000)
        assert self.net.count(OFF) == before + 1, "a repeated query must come from the cache"
        # tapping the row works as well as Enter
        self.search("")
        p.type("#af-q", "granola crunch", delay=20)
        p.locator(".sheet .online-row .res-main").click()
        expect(p.locator(".sheet .res-name", has_text="Hazelnut Spread Test")).to_be_visible(timeout=8000)
        assert self.net.count(OFF) == before + 2
        # no local match: one automatic search after a pause, never a second
        self.search("")
        p.fill("#af-q", "zzqxv blorp")
        p.wait_for_timeout(2200)
        expect(p.locator(".sheet .res-name", has_text="Hazelnut Spread Test")).to_be_visible(timeout=8000)
        assert self.net.count(OFF) == before + 3, "no-match query should search online exactly once"
        # a busy server (429) gets a plain message
        self.net.rate_limit = True
        p.fill("#af-q", "kiwi smoothie bowl")
        p.press("#af-q", "Enter")
        expect(p.locator(".sheet .online .notice.warn")).to_contain_text("busy", timeout=10000)
        self.net.rate_limit = False
        # barcode by typing the number (the camera is not available in the test browser)
        self.search("")
        p.get_by_role("button", name="Scan a barcode").click()
        p.fill("#bc-manual", "12")
        p.get_by_role("button", name="Look up").click()
        expect(p.locator("#bc-err")).to_contain_text("6 to 14 digits")
        p.fill("#bc-manual", "3017620422003")
        p.get_by_role("button", name="Look up").click()
        expect(p.locator("#fd-qty")).to_be_visible()
        expect(p.locator(".sheet-title").last).to_have_text("Hazelnut Spread Test")
        p.get_by_role("button", name="Add to", exact=False).click()
        self.close_sheets()
        expect(p.locator(".entry", has_text="Hazelnut Spread Test").first).to_be_visible() if "diary" in p.url else None
        # an unknown barcode explains itself
        self.open_add()
        p.get_by_role("button", name="Scan a barcode").click()
        p.fill("#bc-manual", "99999999")
        p.get_by_role("button", name="Look up").click()
        expect(p.locator(".notice.warn")).to_contain_text("No product found")
        self.close_sheets()
        # the online service failing must not break local search
        self.net.fail_online = True
        self.open_add()
        self.search("apple")
        expect(p.locator(".sheet .usda .res-name").first).to_be_visible()
        p.press("#af-q", "Enter")
        expect(p.locator(".sheet .online .notice.warn")).to_be_visible(timeout=10000)
        self.net.fail_online = False
        self.close_sheets()

    def seed_history(self):
        """Fill 40 days of weights, meals and water through the app's own store so Progress has something to draw."""
        self.page.evaluate(
            """async () => {
              const { store } = await import('./js/store.js');
              const { today, addDays } = await import('./js/dates.js');
              const t = today();
              for (let i = 1; i <= 40; i++) {
                const d = addDays(t, -i);
                if (i % 2 === 0) await store.setWeight(d, 82 - (40 - i) * 0.05 + Math.sin(i) * 0.3);
                if (i % 3 !== 0) await store.addLog({ date: d, meal: i % 4, foodKey: 'quick', name: 'Seed meal', brand: '', serving: { label: 'serving', grams: null }, qty: 1, per: { kcal: 1500 + (i * 37) % 700, protein: 90, carbs: 180, fat: 50 } });
                if (i % 2 === 1) await store.setWater(d, 1200 + i * 20);
              }
            }"""
        )

    def progress(self):
        p = self.page
        self.goto("#/progress")
        expect(p.locator(".chart-host svg.chart").first).to_be_visible()
        assert p.locator(".chart-host .ch-trend").count() >= 1, "weight trend line missing"
        assert p.locator(".chart-host .ch-dot").count() >= 10
        assert p.locator(".chart-host .ch-bar").count() >= 10
        assert p.locator(".stat-val").count() >= 6
        clean_text(p, "progress")
        for label in ("1M", "6M", "All"):
            p.get_by_role("radio", name=label).click()
            p.wait_for_timeout(200)
            clean_text(p, f"progress {label}")
        p.get_by_role("radio", name="3M").click()
        self.shot("progress")

    def other_screens(self):
        p = self.page
        for route, name in (("#/foods/foods", "foods"), ("#/foods/meals", "foods-meals"), ("#/more", "more"), ("#/account", "account")):
            self.goto(route)
            p.wait_for_timeout(200)
            clean_text(p, route)
            self.shot(name)
        self.goto("#/diary")
        self.shot("diary")
        self.goto("#/today")
        self.shot("today")
        self.goto("#/diary")
        p.get_by_role("button", name="Nutrients").click() if self.mobile else None
        if self.mobile:
            expect(p.locator(".sheet .ntable")).to_be_visible()
            self.shot("nutrients-sheet", full=False)
            self.close_sheets()
        # dark theme
        p.emulate_media(color_scheme="dark")
        self.goto("#/today")
        p.wait_for_timeout(300)
        self.shot("today-dark")
        p.emulate_media(color_scheme="light")

    def settings_flow(self):
        p = self.page
        self.goto("#/more")
        p.get_by_role("radio", name="kg").first.click()
        p.wait_for_timeout(300)
        self.goto("#/today")
        expect(p.locator(".weight-card .big-val")).to_contain_text("kg")
        self.goto("#/more")
        p.get_by_role("radio", name="lb").first.click()
        p.wait_for_timeout(300)
        p.fill("#pf-ovr", "1800")
        p.locator("#pf-ovr").dispatch_event("change")
        expect(p.locator(".budget-main strong")).to_have_text("1,800 kcal")
        p.fill("#pf-ovr", "")
        p.locator("#pf-ovr").dispatch_event("change")
        expect(p.locator(".budget-main strong")).not_to_have_text("1,800 kcal")
        clean_text(p, "more")

    def reload_persists(self):
        p = self.page
        self.goto("#/diary")
        before = self.day_total()
        p.reload()
        expect(p.locator(".totals .big-val .num")).to_be_visible()
        # The diary may paint before IndexedDB answers; give it up to 4 s to settle on the stored total.
        after = None
        for _ in range(40):
            after = num(p.locator(".totals .big-val .num").inner_text())
            if after == before:
                break
            p.wait_for_timeout(100)
        assert after == before, f"day total after reload {after} != {before} before"
        assert p.url.endswith("#/diary")

    def export_then_import(self):
        p = self.page
        self.goto("#/diary")
        total = num(p.locator(".totals .big-val .num").inner_text())
        self.goto("#/more")
        with p.expect_download() as dl:
            p.get_by_role("button", name="Export backup (JSON)").click()
        path = Path(tempfile.mkdtemp()) / dl.value.suggested_filename
        dl.value.save_as(path)
        assert path.stat().st_size > 2000
        fresh = self.browser.new_context(viewport=self.size, has_touch=self.mobile, is_mobile=self.mobile, service_workers="block")
        self.net.install(fresh, self.base)
        q = self.new_page(fresh)
        q.goto(self.base + "index.html")
        expect(q.locator("h1")).to_have_text("Welcome to Intake")
        q.set_input_files("input[type=file]", str(path))
        expect(q.locator(".ring-num")).to_be_visible()
        assert q.url.endswith("#/today")
        q.evaluate("location.hash = '#/diary'")
        expect(q.locator(".totals .big-val .num")).to_be_visible()
        assert num(q.locator(".totals .big-val .num").inner_text()) == total, "diary totals differ after restore"
        q.evaluate("location.hash = '#/more'")
        expect(q.locator("#pf-birth")).to_have_value("1990")
        q.evaluate("location.hash = '#/progress'")
        expect(q.locator(".chart-host .ch-dot").first).to_be_visible()
        fresh.close()

    def no_horizontal_overflow(self):
        p = self.page
        problems = []
        for width in (360, 390):
            p.set_viewport_size({"width": width, "height": 800})
            for route in ("#/today", "#/diary", "#/progress", "#/foods/foods", "#/foods/recipes", "#/more", "#/account"):
                self.goto(route)
                p.wait_for_timeout(350)
                bad = overflow(p)
                if bad:
                    problems.append(f"{width}px {route}: {bad}")
            for sheet_name, opener in (("add-food", lambda: self.open_add()), ("food-detail", None)):
                self.goto("#/today")
                if sheet_name == "add-food":
                    opener()
                    self.search("banana")
                    p.wait_for_timeout(500)
                else:
                    self.goto("#/diary")
                    p.locator(".entry").first.click()
                    p.wait_for_timeout(300)
                bad = overflow(p)
                if bad:
                    problems.append(f"{width}px sheet {sheet_name}: {bad}")
                self.close_sheets()
        p.set_viewport_size(self.size)
        assert not problems, "; ".join(problems)

    def tap_targets(self):
        p = self.page
        problems = []
        for route in ("#/today", "#/diary", "#/progress", "#/foods/foods", "#/foods/recipes", "#/more", "#/account"):
            self.goto(route)
            p.wait_for_timeout(300)
            bad = small_targets(p)
            if bad:
                problems.append(f"{route}: {bad}")
        # sheets: the recipe editor (with an ingredient row), the Diary options menu
        self.goto("#/foods/recipes")
        p.get_by_role("button", name="New recipe").click()
        p.get_by_role("button", name="Add ingredient").click()
        p.locator("#af-q").fill("banana")
        self.pick_result("Bananas, raw")
        p.locator(".sheet-foot .btn-primary", has_text="Add ingredient").click()
        p.keyboard.press("Escape")
        expect(p.locator(".ing-name")).to_have_text("Bananas, raw")
        bad = small_targets(p)
        if bad:
            problems.append(f"recipe editor: {bad}")
        self.close_sheets()
        self.goto("#/diary")
        p.get_by_role("button", name="Diary options").click()
        p.wait_for_timeout(250)
        bad = small_targets(p)
        if bad:
            problems.append(f"diary menu: {bad}")
        p.keyboard.press("Escape")
        self.goto("#/today")
        self.open_add()
        self.search("banana")
        p.wait_for_timeout(600)
        bad = small_targets(p)
        if bad:
            problems.append(f"add-food: {bad}")
        self.close_sheets()
        assert not problems, "; ".join(problems)

    def keyboard_and_back(self):
        p = self.page
        self.goto("#/today")
        self.open_add()
        p.keyboard.press("Escape")
        expect(p.locator(".scrim")).to_have_count(0)
        self.open_add()
        p.go_back()  # the phone's Back button closes the sheet instead of leaving the app
        expect(p.locator(".scrim")).to_have_count(0)
        assert p.url.endswith("#/today"), p.url

    def no_console_errors(self):
        assert not self.errors, f"{len(self.errors)} console errors, first: {self.errors[0]}"

    def only_mocked_services_used(self):
        allowed = ("openfoodfacts.org", "nal.usda.gov", "unpkg.com", "gstatic.com")
        stray = [u for u in self.net.external if not any(a in u for a in allowed)]
        assert not stray, stray[:3]

    def run(self):
        s = self.rec.step
        k = self.kind
        import os
        if os.environ.get("E2E_DEBUG"):
            self.rec.on_fail = lambda label: self.page.screenshot(path=os.path.join(os.environ["E2E_DEBUG"], re.sub(r"\W+", "_", label) + ".png"))
        for label, fn in (
            ("onboarding", self.onboarding), ("today starts empty", self.today_empty),
            ("search banana, add 1 medium = 105 kcal", self.search_banana_and_add), ("edit quantity (fractions, validation)", self.edit_quantity),
            ("delete entry and Undo", self.delete_and_undo), ("quick add", self.quick_add), ("create custom food and log it", self.custom_food),
            ("create recipe and log a serving", self.recipe), ("exercise raises remaining", self.exercise), ("water and weight", self.water_and_weight),
            ("date navigation", self.date_navigation), ("copy meal from yesterday (+Undo)", self.copy_meal_from_yesterday),
            ("copy whole day (+Undo)", self.copy_whole_day), ("amount limits", self.amount_limits), ("number fields have ceilings and say which", self.number_caps),
            ("copy day into a filled day: add or replace", self.copy_day_into_filled_day), ("thousands separator: 1,200 is 1200", self.thousands_separator), ("toast clears the Add button", self.toast_clears_add_button), ("toasts: low with a sheet, auto-dismiss, cleared on navigation", self.toasts_behave),
            ("compact totals are plain, Nutrients table has the legend", self.compact_totals_are_plain),
            ("online search + barcode entry (mocked)", self.online_search_and_barcode), ("Progress charts with data", lambda: (self.seed_history(), self.progress())),
            ("foods, more, account, diary screens", self.other_screens), ("units and calorie override", self.settings_flow),
            ("reload persists", self.reload_persists), ("export JSON, restore in a fresh browser", self.export_then_import),
            ("Esc and Back close sheets", self.keyboard_and_back), ("no horizontal overflow at 360 and 390", self.no_horizontal_overflow),
        ):
            s(f"[{k}] {label}", fn)
        if self.mobile:
            s(f"[{k}] tap targets are at least 44 px", self.tap_targets)
        s(f"[{k}] no console errors", self.no_console_errors)
        s(f"[{k}] only mocked services contacted", self.only_mocked_services_used)
        self.ctx.close()
