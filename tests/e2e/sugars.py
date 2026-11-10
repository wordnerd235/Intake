"""Total vs added sugars, end to end: entering both, "not listed", the note, the limit colors, light and dark at 390 px."""
import re

from playwright.sync_api import expect

from helpers import clean_text, overflow

DAY = "2025-03-03"  # a day of its own, so the other steps' foods don't mix in


def _row(p, name):
    return p.locator(".nrow", has=p.locator(".nname", has_text=re.compile(rf"^{name}"))).last


def _field(p, sel):
    return p.locator(".sheet .field", has=p.locator(sel)).last


def _open_nutrients(sc):
    p = sc.page
    if p.viewport_size["width"] < 900:
        p.get_by_role("button", name="Nutrients").click()
        expect(p.locator(".sheet .ntable")).to_be_visible()


def added_sugars(sc):
    """One reported step; always leaves the app on Today with no sheet open, so a failure here can't spill into later steps."""
    try:
        _added_sugars(sc)
    finally:
        sc.page.emulate_media(color_scheme="light")
        sc.close_sheets()
        sc.goto("#/today")
        chip = sc.page.locator(".datenav .chip", has_text="Today")
        if chip.count() and chip.first.is_visible():
            chip.first.click()


def _added_sugars(sc):
    p = sc.page
    sc.goto(f"#/diary/{DAY}")
    expect(p.locator(".datenav-date")).to_contain_text("Mar")
    # a food with both, as on a US label: "Total Sugars 12g / Includes 8g Added Sugars"
    sc.open_add()
    sc.search("zzcereal")
    p.get_by_role("button", name="Create food").click()
    p.fill("#fe-name", "Sweet cereal")
    p.fill("#fe-label", "1 cup")
    p.fill("#fe-kcal", "150")
    p.fill("#fe-carbs", "30")
    p.locator(".sheet details.more summary").last.click()
    expect(_field(p, "#fe-sugar").locator("label")).to_have_text("Total sugars")
    expect(_field(p, "#fe-addedSugar").locator("label")).to_have_text("Added sugars")
    expect(_field(p, "#fe-addedSugar").locator(".hint")).to_contain_text("Leave empty if the label doesn't list it")
    p.fill("#fe-sugar", "12")
    p.fill("#fe-addedSugar", "14")
    p.get_by_role("button", name="Save food").click()
    expect(p.locator(".sheet .field-error")).to_have_text("Added sugars can't be more than total sugars (they're part of it).")
    p.fill("#fe-addedSugar", "8")
    clean_text(p, "food editor with sugars")
    p.get_by_role("button", name="Save food").click()
    expect(p.locator("#fd-qty")).to_be_visible()
    facts = p.locator(".sheet .facts").last
    expect(facts.locator(".fact.sub", has_text="Total sugars")).to_contain_text("12 g")
    expect(facts.locator(".fact.sub2", has_text="Added sugars")).to_contain_text("8 g")
    sc.submit_detail()
    expect(p.locator(".toast-msg")).to_contain_text("Added to")
    sc.close_sheets()
    # a USDA food: total sugars known, added sugars not listed
    sc.open_add()
    sc.search("banana")
    expect(p.locator(".sheet .res-name", has_text=re.compile(r"^Bananas, raw$")).first).to_be_visible()
    sc.pick_result("Bananas, raw")
    facts = p.locator(".sheet .facts").last
    expect(facts.locator(".fact.sub2", has_text="Added sugars").locator(".fact-val")).to_have_text("not listed")
    expect(facts.locator(".fact.sub", has_text="Total sugars")).to_contain_text("14.4 g")
    sc.submit_detail()
    sc.close_sheets()

    # the day: added sugars are 8 g from the cereal, the banana is left out and noted; never green while one is missing
    _open_nutrients(sc)
    added = _row(p, "Added sugars")
    expect(added.locator(".nname small")).to_have_text(" limit")
    expect(added.locator(".ntgt")).to_have_text("≤ 50")
    expect(added.locator(".nval")).to_have_text("≥ 8 g")
    expect(added.locator(".nnote")).to_have_text("Not listed for 1 of 2 foods, so the real total may be higher.")
    assert "is-met" not in added.get_attribute("class") and "is-over" not in added.get_attribute("class")
    total = _row(p, "Total sugars")
    expect(total.locator(".nval")).to_have_text("26.4 g")
    expect(total.locator(".ntgt")).to_have_text("—")
    expect(total.locator(".bar.thin.plain")).to_be_visible()
    expect(total.locator(".bar-text")).to_contain_text("of carbs")
    assert "is-met" not in total.get_attribute("class") and "is-over" not in total.get_attribute("class")
    if sc.mobile:
        sc.shot("sugars-light", full=False)
        p.emulate_media(color_scheme="dark")
        p.wait_for_timeout(200)
        sc.shot("sugars-dark", full=False)
        assert not overflow(p), overflow(p)
        p.emulate_media(color_scheme="light")
    sc.close_sheets()

    # remove the banana: every food lists added sugars, 8 of 50 g is green
    p.locator(".entry", has_text="Bananas, raw").click()
    p.get_by_role("button", name="Delete").click()
    sc.close_sheets()
    _open_nutrients(sc)
    added = _row(p, "Added sugars")
    expect(added).to_have_class(re.compile(r"\bis-met\b"))
    expect(added.locator(".bar-text")).to_have_text("16% · under limit")
    expect(added.locator(".nnote")).to_have_count(0)
    sc.close_sheets()

    # seven cups: 56 g of added sugars is over the limit (red); total sugars stay plain at 84 g
    p.locator(".entry", has_text="Sweet cereal").click()
    p.fill("#fd-qty", "7")
    p.get_by_role("button", name="Save changes").click()
    sc.close_sheets()
    _open_nutrients(sc)
    added = _row(p, "Added sugars")
    expect(added).to_have_class(re.compile(r"\bis-over\b"))
    expect(added.locator(".bar-text")).to_have_text("112% · over limit")
    total = _row(p, "Total sugars")
    expect(total.locator(".nval")).to_have_text("84 g")
    assert "is-over" not in total.get_attribute("class")
    if sc.mobile:
        p.emulate_media(color_scheme="dark")
        p.wait_for_timeout(200)
        sc.shot("sugars-over-dark", full=False)
        p.emulate_media(color_scheme="light")
        sc.shot("sugars-over-light", full=False)
    sc.close_sheets()
    p.locator(".datenav .chip", has_text="Today").click()

    # More > Nutrient targets: added sugars default to 50 g; total sugars have no box (no target)
    sc.goto("#/more")
    targets = p.locator("details.more", has=p.locator("summary", has_text="Nutrient targets"))
    targets.locator("summary").click()
    expect(p.locator("#nt-addedSugar")).to_have_attribute("placeholder", "50")
    expect(p.locator("label[for=nt-addedSugar]")).to_contain_text("limit")
    expect(p.locator("#nt-sugar")).to_have_count(0)
    targets.locator("summary").click()


SEED_OLD_SAVED = """async () => {
  const { store } = await import('./js/store.js');
  const old = { key: 'off:0073130002005', name: 'Sourdough Test Loaf', brand: 'Bakeco', source: 'off',
    per100g: { kcal: 250, carbs: 48, sugar: 4, fat: 2, protein: 9 }, servings: [{ label: '1 slice (50 g)', grams: 50 }] };
  await store.touchFoodMeta(old, old.servings[0], 1);  // in Recents, saved before added sugars existed
  await store.saveRecipe({ name: 'Zz sourdough toast', servings: 1, ingredients: [
    { foodKey: old.key, name: old.name, brand: old.brand, serving: old.servings[0], qty: 2, per: { kcal: 125, carbs: 24, sugar: 2, fat: 1, protein: 4.5 } }] });
}"""


def saved_foods_refresh(sc):
    """Commercial products saved before added sugars existed are looked up again in the background after a start."""
    p = sc.page
    try:
        p.evaluate(SEED_OLD_SAVED)
        before = sc.net.count("api/v2/product/0073130002005")
        p.reload()
        expect(p.locator(".toast-msg")).to_have_text("Added sugars filled in for 1 saved food and 1 recipe.", timeout=20000)
        assert sc.net.count("api/v2/product/0073130002005") == before + 1, "looked up once"
        sc.open_add()
        sc.search("sourdough test")
        sc.pick_result("Sourdough Test Loaf")
        facts = p.locator(".sheet .facts").last
        expect(facts.locator(".fact.sub2", has_text="Added sugars")).to_contain_text("1 g")  # 2 g per 100 g, 50 g slice
        sc.close_sheets()
        sc.open_add()
        sc.search("zz sourdough")
        sc.pick_result("Zz sourdough toast")
        facts = p.locator(".sheet .facts").last
        expect(facts.locator(".fact.sub2", has_text="Added sugars")).to_contain_text("2 g")  # two slices
        sc.close_sheets()
        # the next start asks nothing again
        p.reload()
        p.wait_for_timeout(7500)
        assert sc.net.count("api/v2/product/0073130002005") == before + 1, "not looked up a second time"
        # fix 1: a barcode lookup (without logging) brings an outdated saved copy up to date
        p.evaluate("""async () => { const { store } = await import('./js/store.js');
          await store.touchFoodMeta({ key: 'off:3017620422003', name: 'Hazelnut Spread Test', brand: 'Testco', source: 'off',
            per100g: { kcal: 500, sugar: 50 }, servings: [{ label: '15 g', grams: 15 }] }, { label: '15 g', grams: 15 }, 1); }""")
        sc.open_add()
        p.get_by_role("button", name="Scan a barcode").click()
        p.fill("#bc-manual", "3017620422003")
        p.get_by_role("button", name="Look up").click()
        expect(p.locator("#fd-qty")).to_be_visible()
        sc.close_sheets()
        kcal = p.evaluate("""async () => { const { store } = await import('./js/store.js');
          for (let i = 0; i < 20; i++) { const m = await store.getFoodMeta('off:3017620422003'); if (m.food.per100g.kcal !== 500) return m.food.per100g.kcal;
            await new Promise((r) => setTimeout(r, 100)); } return 500; }""")
        assert kcal == 539, f"saved copy still {kcal} kcal per 100 g after the lookup"
    finally:
        sc.close_sheets()
        sc.goto("#/today")
