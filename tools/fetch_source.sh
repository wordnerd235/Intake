#!/usr/bin/env bash
# Fetch the USDA FoodData Central "SR Legacy" CSV export from a GitHub mirror
# and copy the handful of CSVs that build_foods.py needs into one flat folder.
#
# Usage:  tools/fetch_source.sh [OUT_DIR]
#         (default OUT_DIR: <repo>/.cache/sr_legacy)
#
# Source: https://github.com/tomwhite/ingreedy-data  (pinned commit below).
# The mirror stores the official FDC download
#   FoodData_Central_sr_legacy_food_csv_2019-04-02.zip   (SR Legacy, April 2018 data)
#   FoodData_Central_Supporting_Data_csv_2019-04-02.zip  (nutrient.csv, food_category.csv, ...)
# unzipped under data/raw/. Only a sparse, blobless checkout is done (~38 MB of CSV).
set -euo pipefail

REPO_URL="https://github.com/tomwhite/ingreedy-data"
COMMIT="846f8c3acce98def8645dd891605c46093e6ae44"
SR_DIR="data/raw/FoodData_Central_sr_legacy_food_csv_ 2019-04-02"
SUP_DIR="data/raw/FoodData_Central_Supporting_Data_csv_ 2019-04-02"

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OUT="${1:-$HERE/../.cache/sr_legacy}"
mkdir -p "$OUT"
OUT="$(cd "$OUT" && pwd)"

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

git clone --quiet --filter=blob:none --no-checkout "$REPO_URL" "$TMP/repo"
cd "$TMP/repo"
git checkout --quiet "$COMMIT" -- \
  "$SR_DIR/food.csv" \
  "$SR_DIR/food_nutrient.csv" \
  "$SR_DIR/food_portion.csv" \
  "$SR_DIR/sr_legacy_food.csv" \
  "$SR_DIR/all_downloaded_table_record_counts.csv" \
  "$SUP_DIR/nutrient.csv" \
  "$SUP_DIR/food_category.csv" \
  "$SUP_DIR/measure_unit.csv"

for f in food food_nutrient food_portion sr_legacy_food all_downloaded_table_record_counts; do
  cp "$SR_DIR/$f.csv" "$OUT/$f.csv"
done
for f in nutrient food_category measure_unit; do
  cp "$SUP_DIR/$f.csv" "$OUT/$f.csv"
done

echo "SR Legacy CSVs written to: $OUT"
ls -l "$OUT"
