#!/usr/bin/env python3
"""Build data/exercises.json (activity list with MET values).

The table below is the source of truth.  MET values were transcribed from the category
pages of the 2024 Adult Compendium of Physical Activities (https://pacompendium.com/adult-compendium/,
read 2026-10-23); every row carries the Compendium activity code so it can be re-checked at
https://pacompendium.com/<category-page>.  Names are shortened/cleaned for display; the MET
values are the Compendium's, unchanged.

Two pickleball rows are the only entries that are not 2024 *Adult* Compendium rows (see NOTES).

Run:  python3 -I tools/build_exercises.py            -> data/exercises.json
"""
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)

SOURCE = ("2024 Adult Compendium of Physical Activities (Herrmann et al., J Sport Health Sci 2024;13(1):6-12; "
          "https://pacompendium.com/adult-compendium/). MET = multiples of resting energy expenditure "
          "(1 MET ~ 1 kcal/kg/h). 'code' = Compendium activity code.")

W, R, C, S, G, M, SP, H, D, O, X = ("Walking", "Running", "Cycling", "Swimming", "Gym & Strength",
                                      "Cardio Machines", "Sports", "Home & Yard", "Dance & Mind-Body",
                                      "Outdoor", "Occupational/Other")

# (id, name, met, category, compendium code[, note])
ROWS = [
    # ---- Walking
    ("walk-stroll", "Walking, less than 2.0 mph, level, strolling, very slow", 2.3, W, "17151"),
    ("walk-2mph", "Walking, 2.0 to 2.4 mph, level, slow pace, firm surface", 2.8, W, "17152"),
    ("walk-2.5mph", "Walking, 2.5 mph, level, firm surface", 3.0, W, "17170"),
    ("walk-3mph", "Walking, 3.0 mph (2.8 to 3.4), level, moderate pace, firm surface", 3.8, W, "17190"),
    ("walk-3.5mph", "Walking, 3.5 to 3.9 mph, level, brisk pace, for exercise", 4.8, W, "17200"),
    ("walk-4mph", "Walking, 4.0 to 4.4 mph, level, very brisk pace", 5.5, W, "17220"),
    ("walk-4.5mph", "Walking, 4.5 to 4.9 mph, level, very, very brisk", 7.0, W, "17230"),
    ("walk-5mph", "Walking, 5.0 to 5.5 mph, level, firm surface", 8.5, W, "17231"),
    ("walk-pleasure", "Walking for pleasure", 3.5, W, "17160"),
    ("walk-dog", "Walking the dog", 3.0, W, "17165"),
    ("walk-to-work", "Walking to work or class", 4.0, W, "17270"),
    ("walk-nordic", "Nordic walking (poles), 2.5 to 3.5 mph, level, moderate pace", 4.3, W, "17302"),
    ("walk-nordic-fast", "Nordic walking (poles), 3.6 to 4.4 mph, level, moderate pace", 5.3, W, "17304"),
    ("walk-stroller", "Pushing a stroller / walking with children, 2.5 to 3.1 mph", 3.8, W, "17100"),
    ("stairs-slow", "Stair climbing, slow", 4.5, W, "17133"),
    ("stairs-general", "Stair climbing, general", 6.8, W, "17131"),
    ("stairs-fast", "Stair climbing, fast", 9.3, W, "17134"),

    # ---- Running
    ("jog-general", "Jogging, general", 7.5, R, "12020"),
    ("jog-walk", "Jog/walk combination (jogging less than 10 minutes at a time)", 6.0, R, "12010"),
    ("run-4mph", "Running, 4.0 to 4.2 mph (13 min/mile)", 6.5, R, "12028"),
    ("run-5mph", "Running, 5.0 to 5.2 mph (12 min/mile)", 8.5, R, "12030"),
    ("run-5.5mph", "Running, 5.5 to 5.8 mph", 9.0, R, "12045"),
    ("run-6mph", "Running, 6.0 to 6.3 mph (10 min/mile)", 9.3, R, "12050"),
    ("run-6.7mph", "Running, 6.7 mph (9 min/mile)", 10.5, R, "12060"),
    ("run-7mph", "Running, 7.0 mph (8.5 min/mile)", 11.0, R, "12070"),
    ("run-7.5mph", "Running, 7.5 mph (8 min/mile)", 11.8, R, "12080"),
    ("run-8mph", "Running, 8.0 mph (7.5 min/mile)", 12.0, R, "12090"),
    ("run-9mph", "Running, 9.0 mph (6.5 min/mile)", 13.0, R, "12110"),
    ("run-10mph", "Running, 10.0 mph (6 min/mile)", 14.8, R, "12120"),
    ("run-cross-country", "Running, cross country", 9.3, R, "12140"),
    ("run-uphill", "Running uphill, 4.5 mph, 5% incline", 10.3, R, "12255"),

    # ---- Cycling
    ("bike-leisure-slow", "Bicycling, under 10 mph, leisure, to work or for pleasure", 4.0, C, "01010"),
    ("bike-easy", "Bicycling, self-selected easy pace", 4.3, C, "01015"),
    ("bike-9.4mph", "Bicycling, leisure, 9.4 mph", 5.8, C, "01019"),
    ("bike-commute", "Bicycling to/from work, self-selected pace", 6.8, C, "01011"),
    ("bike-10-12mph", "Bicycling, 10 to 11.9 mph, leisure, slow, light effort", 6.8, C, "01020"),
    ("bike-12-14mph", "Bicycling, 12 to 13.9 mph, moderate effort", 8.0, C, "01030"),
    ("bike-14-16mph", "Bicycling, 14 to 15.9 mph, fast, vigorous effort", 10.0, C, "01040"),
    ("bike-16-19mph", "Bicycling, 16 to 19 mph, very fast, racing", 12.0, C, "01050"),
    ("bike-mountain", "Bicycling, mountain, general", 8.5, C, "01009"),
    ("bike-stationary-general", "Stationary bike, general", 6.8, C, "01200"),
    ("bike-stationary-50w", "Stationary bike, 50 watts, light effort", 4.0, C, "01214"),
    ("bike-stationary-100w", "Stationary bike, 90 to 100 watts, moderate to vigorous", 6.0, C, "01220"),
    ("bike-stationary-150w", "Stationary bike, 126 to 150 watts", 8.0, C, "01228"),
    ("bike-stationary-200w", "Stationary bike, 151 to 199 watts, vigorous", 10.3, C, "01232"),
    ("spin-class", "Spin / RPM bike class", 9.0, C, "01270"),

    # ---- Swimming & water exercise
    ("swim-laps-slow", "Swimming laps, freestyle, slow, recreational", 5.8, S, "18240"),
    ("swim-laps-moderate", "Swimming, crawl, medium speed (~50 yd/min), vigorous effort", 8.0, S, "18290"),
    ("swim-laps-fast", "Swimming laps, freestyle, fast, vigorous effort", 9.8, S, "18230"),
    ("swim-backstroke", "Swimming, backstroke, recreational", 4.8, S, "18255"),
    ("swim-breaststroke", "Swimming, breaststroke, recreational", 5.3, S, "18265"),
    ("swim-breaststroke-training", "Swimming, breaststroke, training or competition", 10.3, S, "18260"),
    ("swim-butterfly", "Swimming, butterfly, general", 13.8, S, "18270"),
    ("swim-leisure", "Swimming, leisurely, not lap swimming", 6.0, S, "18310"),
    ("swim-open-water", "Swimming, lake, ocean, river", 6.0, S, "18300"),
    ("water-aerobics", "Water aerobics, water calisthenics", 5.5, S, "18355"),
    ("water-jogging", "Water jogging, vigorous effort", 9.8, S, "18366"),
    ("water-walking", "Water walking, moderate effort", 4.8, S, "18368"),
    ("water-polo", "Water polo", 10.0, S, "18360"),

    # ---- Gym & strength
    ("weights-light", "Weight training, multiple exercises, 8-15 reps, light to moderate effort", 3.5, G, "02054"),
    ("weights-vigorous", "Weight lifting, free weights/machines, powerlifting or bodybuilding, vigorous effort", 6.0, G, "02050"),
    ("weights-squat-deadlift", "Weight training, squats and deadlifts, slow or explosive effort", 5.0, G, "02052"),
    ("weights-circuit", "Weight training, circuit / supersets (peripheral heart action)", 5.8, G, "02055"),
    ("bodyweight-general", "Body weight exercises (squat, lunge, push-up, crunch), general", 3.0, G, "02056"),
    ("bodyweight-hard", "Body weight exercises (squat, lunge, push-up, crunch), high intensity", 6.5, G, "02057"),
    ("calisthenics-moderate", "Calisthenics (push-ups, sit-ups, pull-ups, lunges), moderate effort", 3.8, G, "02022"),
    ("calisthenics-vigorous", "Calisthenics (push-ups, burpees, jumping jacks, battling ropes), vigorous effort", 7.5, G, "02020"),
    ("circuit-moderate", "Circuit training, moderate effort", 5.0, G, "02035"),
    ("circuit-vigorous", "Circuit training with kettlebells, minimal rest, vigorous", 7.5, G, "02040"),
    ("hiit-moderate", "High intensity interval training, moderate effort", 7.0, G, "02210"),
    ("hiit-vigorous", "High intensity interval training (burpees, mountain climbers, Tabata), vigorous", 11.0, G, "02214"),
    ("kettlebell-swings", "Kettlebell swings", 9.8, G, "02058"),
    ("boot-camp", "Boot camp / obstacle course training", 5.0, G, "02008"),
    ("jump-rope-slow", "Jumping rope, slow pace (under 100 skips/min)", 8.3, G, "15552"),
    ("jump-rope", "Jumping rope, moderate pace (100-120 skips/min)", 11.8, G, "15551"),
    ("gym-general", "Health club exercise, general", 5.5, G, "02060"),
    ("home-workout", "Home exercise, general", 3.8, G, "02064"),
    ("workout-video", "Exercise video / TV workout, vigorous (cardio-resistance)", 6.0, G, "02145"),
    ("aerobics-general", "Aerobics class, general", 7.3, G, "02000"),

    # ---- Cardio machines
    ("elliptical-moderate", "Elliptical trainer, moderate effort", 5.0, M, "02048"),
    ("elliptical-vigorous", "Elliptical trainer, vigorous effort", 9.0, M, "02049"),
    ("rowing-machine-moderate", "Rowing machine, under 100 watts, moderate effort", 5.0, M, "02071"),
    ("rowing-machine-100w", "Rowing machine, 100 to 149 watts, vigorous effort", 7.5, M, "02072"),
    ("rowing-machine-150w", "Rowing machine, 150 to 199 watts, vigorous effort", 11.0, M, "02073"),
    ("rowing-machine-200w", "Rowing machine, 200 watts or more, very vigorous", 14.0, M, "02074"),
    ("stair-climber", "Stair climber / stair treadmill, general", 9.3, M, "02065"),
    ("ski-machine", "Ski machine (NordicTrack-type), general", 6.8, M, "02080"),
    ("treadmill-2.5mph", "Treadmill walking, 2.5 to 2.9 mph, 0% grade", 3.5, M, "17352"),
    ("treadmill-3mph", "Treadmill walking, 3.0 to 3.4 mph, 0% grade", 3.8, M, "17355"),
    ("treadmill-3.5mph", "Treadmill walking, 3.5 to 3.9 mph, 0% grade", 4.8, M, "17358"),
    ("treadmill-4mph", "Treadmill walking, 4.0 to 4.4 mph, 0% grade", 5.8, M, "17361"),
    ("treadmill-4.5mph", "Treadmill walking, 4.5 to 4.9 mph, 0% grade", 6.8, M, "17364"),
    ("arm-ergometer", "Arm ergometer / hand bike, light", 2.8, M, "02115"),
    ("slide-board", "Slide board exercise, general", 10.5, M, "02085"),

    # ---- Sports
    ("basketball-game", "Basketball, game", 8.0, SP, "15040"),
    ("basketball-pickup", "Basketball, non-game, general", 6.0, SP, "15050"),
    ("basketball-shooting", "Basketball, shooting baskets", 5.0, SP, "15070"),
    ("soccer-casual", "Soccer, casual, general", 7.0, SP, "15610"),
    ("soccer-competitive", "Soccer, competitive", 9.5, SP, "15605"),
    ("tennis-general", "Tennis, general, moderate effort", 6.8, SP, "15675"),
    ("tennis-singles", "Tennis, singles", 8.0, SP, "15690"),
    ("tennis-doubles", "Tennis, doubles", 6.0, SP, "15680"),
    ("pickleball-social", "Pickleball, recreational / social", 4.1, SP, "",
     "Not in the 2024 Adult Compendium. Mean of 4.1 METs from Smith et al. 2018 (older-adult pickleball study) as cited by topendsports.com."),
    ("pickleball-competitive", "Pickleball, competitive", 5.3, SP, "OAC 1552560",
     "From the 2024 Older Adult Compendium (code 1552560, MET60), not the Adult Compendium."),
    ("badminton-social", "Badminton, social singles and doubles", 5.5, SP, "15030"),
    ("badminton-competitive", "Badminton, competitive", 7.0, SP, "15020"),
    ("table-tennis", "Table tennis / ping pong", 4.0, SP, "15660"),
    ("racquetball", "Racquetball, general", 7.0, SP, "15530"),
    ("squash", "Squash, general", 7.3, SP, "15652"),
    ("golf-walk-carry", "Golf, walking, carrying clubs", 4.3, SP, "15265"),
    ("golf-walk-pull", "Golf, walking, pulling clubs", 4.5, SP, "15285"),
    ("golf-cart", "Golf, using power cart", 3.5, SP, "15290"),
    ("volleyball-casual", "Volleyball, non-competitive, general", 3.0, SP, "15720"),
    ("volleyball-beach", "Volleyball, beach, in sand", 8.0, SP, "15725"),
    ("softball-baseball", "Softball or baseball, fast or slow pitch, moderate effort", 5.0, SP, "15620"),
    ("football-touch", "Football, touch / flag, general", 8.0, SP, "15230"),
    ("bowling", "Bowling", 3.0, SP, "15090"),
    ("boxing-bag", "Boxing, punching bag", 5.8, SP, "15110"),
    ("boxing-sparring", "Boxing, sparring", 7.8, SP, "15120"),
    ("martial-arts", "Martial arts (judo, karate, kickboxing, tae kwon do), moderate pace", 10.3, SP, "15430"),
    ("hockey-ice", "Hockey, ice, general", 8.0, SP, "15360"),
    ("disc-golf", "Frisbee golf (disc golf)", 3.8, SP, "15252"),
    ("inline-skating", "Roller blading / in-line skating, 9 mph, recreational pace", 7.5, SP, "15591"),
    ("horseback-riding", "Horseback riding, general", 5.5, SP, "15370"),

    # ---- Home & yard
    ("clean-sweeping", "Cleaning, sweeping floors, general", 3.3, H, "05010"),
    ("clean-mopping", "Cleaning, mopping, standing, moderate effort", 3.5, H, "05021"),
    ("clean-vacuum", "Vacuuming, general, moderate effort", 3.0, H, "05043"),
    ("clean-house", "Cleaning house, general, moderate effort", 3.3, H, "05030"),
    ("clean-scrub-floors", "Scrubbing floors / bathtub on hands and knees, moderate effort", 3.5, H, "05130"),
    ("clean-dusting", "Dusting or polishing furniture", 2.5, H, "05032"),
    ("dishes", "Washing dishes, standing", 2.0, H, "05041"),
    ("cooking", "Cooking or food preparation, moderate effort", 3.5, H, "05049"),
    ("laundry", "Laundry, moderate effort", 4.0, H, "05092"),
    ("grocery-shopping", "Food shopping with or without a cart", 3.3, H, "05060"),
    ("carry-groceries", "Carrying groceries, level ground, walking", 3.5, H, "05054"),
    ("moving-furniture", "Moving furniture, household items, carrying boxes", 5.8, H, "05120"),
    ("kids-play-moderate", "Playing with children, walking/running, moderate effort", 3.5, H, "05175"),
    ("kids-play-vigorous", "Playing with children, walking/running, vigorous effort", 5.8, H, "05180"),
    ("carry-child", "Walking while carrying a small child (15 lb or more)", 3.0, H, "05181"),
    ("gardening", "Gardening, general, moderate effort", 3.8, H, "08245"),
    ("weeding", "Weeding, cultivating garden, moderate effort", 4.5, H, "08240"),
    ("raking", "Raking lawn or leaves, moderate effort", 4.0, H, "08160"),
    ("mowing-push", "Mowing lawn, walking, power mower, moderate or vigorous effort", 5.0, H, "08120"),
    ("mowing-riding", "Mowing lawn, riding mower", 2.5, H, "08100"),
    ("shovel-snow", "Shoveling snow by hand, moderate effort", 5.3, H, "08195"),
    ("digging-garden", "Digging, spading, filling garden, composting", 5.0, H, "08050"),
    ("yardwork-moderate", "Yardwork, general, moderate effort", 4.0, H, "08261"),
    ("chop-wood", "Chopping wood, splitting logs, moderate effort", 4.5, H, "08019"),
    ("paint-inside", "Painting inside house, wallpapering, scraping paint", 3.3, H, "06160"),
    ("paint-outside", "Painting outside of home", 5.0, H, "06150"),
    ("wash-car", "Washing and waxing car", 2.0, H, "06225"),

    # ---- Dance & mind-body
    ("dance-ballroom-slow", "Ballroom dancing, slow (waltz, foxtrot, slow dancing)", 3.0, D, "03040"),
    ("dance-ballroom-fast", "Ballroom dancing, fast", 5.5, D, "03030"),
    ("dance-general", "Dancing, ethnic or cultural (Greek, salsa, merengue, swing, etc.)", 4.5, D, "03025"),
    ("dance-vigorous", "Dancing, nightclub / disco / line dancing / polka, vigorous effort", 9.8, D, "03031"),
    ("dance-folk", "Folk dancing, moderate effort", 5.0, D, "03033"),
    ("dance-salsa", "Salsa dancing with partner", 4.8, D, "03090"),
    ("dance-ballet", "Ballet, modern, or jazz dance, rehearsal or class", 5.0, D, "03010"),
    ("zumba", "Zumba, group class", 6.5, D, "02310"),
    ("aerobic-dance-low", "Aerobic dance, low impact, moderate effort", 4.8, D, "02005"),
    ("aerobic-dance-high", "Aerobic dance, high impact, vigorous effort", 8.0, D, "02006"),
    ("yoga-hatha", "Yoga, Hatha", 2.3, D, "02150"),
    ("yoga-vinyasa", "Yoga, Vinyasa", 2.7, D, "02185"),
    ("yoga-hot", "Yoga, hot", 3.0, D, "02155"),
    ("yoga-power", "Yoga, power", 4.0, D, "02160"),
    ("pilates", "Pilates, general", 2.8, D, "02105"),
    ("tai-chi", "Tai chi, qi gong, general", 3.3, D, "15670"),
    ("stretching", "Stretching, mild", 2.3, D, "02101"),

    # ---- Outdoor
    ("hike-slow", "Hiking, slow, no load", 3.8, O, "17081"),
    ("hike-normal", "Hiking, normal pace, no load", 5.3, O, "17082"),
    ("hike-cross-country", "Hiking, cross country", 6.0, O, "17080"),
    ("backpacking", "Backpacking", 7.0, O, "17010"),
    ("hill-climb", "Hill climbing, no load, 1-5% grade, moderate to brisk", 5.3, O, "17034"),
    ("rock-climbing", "Rock or mountain climbing", 8.0, O, "15533"),
    ("kayaking", "Kayaking, moderate effort", 5.0, O, "18100"),
    ("rowing-outdoor", "Rowing / canoeing, 4.0 to 5.9 mph, moderate effort", 5.8, O, "18050"),
    ("paddleboard", "Stand up paddle boarding, general", 6.5, O, "18224"),
    ("surfing", "Surfing, body or board, general", 3.0, O, "18220"),
    ("snorkeling", "Snorkeling", 5.0, O, "18210"),
    ("ski-downhill", "Skiing, downhill / snowboarding, moderate effort", 6.3, O, "19160"),
    ("ski-downhill-vigorous", "Skiing, downhill / snowboarding, vigorous effort", 8.0, O, "19170"),
    ("ski-cross-country", "Skiing, cross country, 4.0 to 4.9 mph, moderate effort", 8.5, O, "19090"),
    ("snowboarding", "Snowboarding, recreational, moderate pace", 7.5, O, "19201"),
    ("snowshoeing", "Snow shoeing, moderate effort", 5.3, O, "19190"),
    ("ice-skating", "Ice skating, general", 7.0, O, "19030"),

    # ---- Occupational / other
    ("work-desk", "Sitting tasks, light effort (office work)", 1.5, X, "11580"),
    ("work-computer", "Sitting, computer work", 1.3, X, "11582"),
    ("work-standing-desk", "Standing workstation, typing, computer work", 1.3, X, "11583"),
    ("work-standing-light", "Standing tasks, light effort (store clerk, bartending, filing)", 1.8, X, "11600"),
    ("work-standing-moderate", "Standing, light to moderate effort (assembling, stocking, welding)", 3.3, X, "11610"),
    ("work-standing-heavy", "Standing, moderate to heavy tasks (lifting over 50 lb, masonry)", 4.5, X, "11630"),
    ("work-patient-care", "Patient care, healthcare activities", 2.3, X, "11650"),
    ("work-custodial", "Custodial work, moderate effort", 3.8, X, "11126"),
    ("work-housekeeping", "Hotel housekeeper (making beds, cleaning, pushing cart)", 4.0, X, "11070"),
    ("work-manual-labor", "Manual or unskilled labor, moderate effort", 4.5, X, "11476"),
    ("work-construction", "Construction, outside, remodeling", 4.0, X, "11120"),
    ("sleeping", "Sleeping", 1.0, X, "07030"),
    ("tv-sitting", "Sitting, watching television", 1.0, X, "07020"),
    ("reading-sitting", "Sitting, reading", 1.0, X, "09030"),
    ("driving-car", "Driving a car or light truck", 2.0, X, "16010"),
]


def main():
    ids = [r[0] for r in ROWS]
    dup = {i for i in ids if ids.count(i) > 1}
    if dup:
        sys.exit(f"duplicate exercise ids: {sorted(dup)}")
    cats = {r[3] for r in ROWS}
    out = []
    for r in ROWS:
        e = {"id": r[0], "name": r[1], "met": r[2], "cat": r[3]}
        if r[4]:
            e["code"] = r[4]
        if len(r) > 5:
            e["note"] = r[5]
        out.append(e)
    path = os.path.join(ROOT, "data", "exercises.json")
    os.makedirs(os.path.dirname(path), exist_ok=True)
    body = ",\n".join("  " + json.dumps(e, ensure_ascii=False, separators=(",", ":")) for e in out)
    text = '{"source":' + json.dumps(SOURCE, ensure_ascii=False) + ',"exercises":[\n' + body + "\n]}\n"
    json.loads(text)  # self-check
    with open(path, "w", encoding="utf-8") as fh:
        fh.write(text)
    by_cat = {}
    for e in out:
        by_cat[e["cat"]] = by_cat.get(e["cat"], 0) + 1
    print(f"wrote {path}: {len(out)} exercises, {os.path.getsize(path):,} bytes")
    for c in (W, R, C, S, G, M, SP, H, D, O, X):
        print(f"  {c:<20} {by_cat.get(c, 0)}")
    assert cats == set(by_cat), cats


if __name__ == "__main__":
    main()
