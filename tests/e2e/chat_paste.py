"""Quick add from a Claude chat: copy the prompt, paste an answer, check the foods, add, Undo; light and dark at 390 px."""
from playwright.sync_api import expect

from helpers import clean_text, overflow

ANSWER = """Here's my estimate for the burrito bowl and the drink.

**Calories:** about 980 in total.

```
Intake
Name: Chicken burrito bowl
Amount: 1 bowl (450 g)
Calories: 680
Protein: 42 g
Carbs: 72 g
Fiber: 11 g
Total sugars: 6 g
Added sugars: 1 g
Fat: 24 g
Sodium: 1,450 mg

Name: Horchata
Amount: 16 oz cup (480 g)
Calories: 300
Total sugars: 40 g
Added sugars: unknown
```"""


def _open(sc):
    p = sc.page
    sc.open_add()
    p.get_by_role("button", name="Quick add").click()
    p.get_by_role("button", name="Paste from a Claude chat").click()
    expect(p.locator(".sheet-title").last).to_have_text("Paste from a chat")


def chat_paste(sc):
    p = sc.page
    try:
        p.context.grant_permissions(["clipboard-read", "clipboard-write"])
        sc.goto("#/diary")
        before = sc.day_total()
        _open(sc)
        # the prompt for Claude: shown, and one tap copies it
        p.locator(".cp-prompt summary").click()
        expect(p.locator(".cp-prompt-text")).to_contain_text("Added sugars: <number> g")
        clean_text(p, "chat paste start")
        p.get_by_role("button", name="Copy prompt").click()
        expect(p.locator(".toast-msg")).to_have_text("Prompt copied. Paste it into your chat with Claude.")
        assert p.evaluate("navigator.clipboard.readText()").startswith("When you estimate the nutrition of food for me")
        if sc.mobile:
            for width in (360, 390):
                p.set_viewport_size({"width": width, "height": 844})
                assert not overflow(p), f"{width}px: {overflow(p)}"
            p.set_viewport_size(sc.size)
        # text that isn't nutrition: say so, stay on the box
        p.fill("#cp-text", "That looks delicious! Enjoy your lunch.")
        p.get_by_role("button", name="Read", exact=True).click()
        expect(p.locator(".sheet .notice.warn")).to_contain_text("No nutrition found")
        expect(p.locator("#cp-text")).to_be_visible()
        # the whole answer from the clipboard: two foods, the prose skipped
        p.evaluate("(t) => navigator.clipboard.writeText(t)", ANSWER)
        p.get_by_role("button", name="Paste", exact=True).click()
        items = p.locator(".sheet .mp-item")
        expect(items).to_have_count(2)
        expect(items.nth(0).locator("strong")).to_have_text("Chicken burrito bowl")
        expect(items.nth(0)).to_contain_text("1 bowl (450 g)")
        expect(items.nth(0)).to_contain_text("680 kcal · P 42 g · C 72 g · F 24 g")
        expect(items.nth(0).locator(".cp-sugars")).to_have_text("Total sugars 6 g · added sugars 1 g")
        expect(items.nth(1).locator(".cp-sugars")).to_have_text("Total sugars 40 g · added sugars not listed")
        expect(p.locator(".sheet .mp-total")).to_contain_text("980 kcal")
        clean_text(p, "chat paste review")
        if sc.mobile:
            sc.shot("chat-paste-light", full=False)
            p.emulate_media(color_scheme="dark")
            p.wait_for_timeout(200)
            sc.shot("chat-paste-dark", full=False)
            assert not overflow(p), overflow(p)
            p.emulate_media(color_scheme="light")
        # keep only the bowl, add it
        p.get_by_role("button", name="Remove Horchata").click()
        expect(items).to_have_count(1)
        add = p.locator(".sheet-foot .btn-primary").last
        expect(add).to_contain_text("Add it to")
        add.click()
        expect(p.locator(".toast-msg")).to_contain_text("Added 1 item to")
        entry = p.locator(".entry", has_text="Chicken burrito bowl")
        expect(entry).to_have_count(1)
        expect(entry).to_contain_text("1 bowl")
        # Undo takes it back off
        p.locator(".toast-action").click()
        expect(entry).to_have_count(0)
        # again, and keep it: its added sugars count toward the day
        sc.close_sheets()  # Add food stays open after an add, ready for the next item
        _open(sc)
        p.get_by_role("button", name="Paste", exact=True).click()
        p.get_by_role("button", name="Remove Horchata").click()
        p.locator(".sheet-foot .btn-primary").last.click()
        expect(entry).to_have_count(1)
        sc.close_sheets()
        entry.click()
        expect(p.locator(".sheet .facts .fact.sub2", has_text="Added sugars")).to_contain_text("1 g")
        sc.close_sheets()
        assert sc.day_total() == before + 680, "the day gained the bowl's 680 kcal"
        # delete it again, so later steps see the day as it was
        p.locator(".entry", has_text="Chicken burrito bowl").click()
        p.get_by_role("button", name="Delete").click()
        expect(p.locator(".entry", has_text="Chicken burrito bowl")).to_have_count(0)
        assert sc.day_total() == before
    finally:
        sc.page.emulate_media(color_scheme="light")
        sc.close_sheets()
        sc.goto("#/today")
