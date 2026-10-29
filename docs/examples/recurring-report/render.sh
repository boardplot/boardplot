#!/usr/bin/env bash
# Weekly business review: draws the three charts from this week's warehouse
# exports with the saved templates in specs/ and writes one page to send.
# Usage: ./render.sh [exports folder]   (default: exports)
# Writes out/<week>/weekly-revenue.png, channel-table.png, region-variance.png
# and review.html. Stops at the first refused chart: the CLI exits 1 when it
# refuses the input (for example a renamed column) and 2 on an internal error.
set -euo pipefail
cd "$(dirname "$0")"

in="${1:-exports}"
week="$(tail -n 1 "$in/weekly_channel.csv" | cut -d, -f1)"  # Monday of the last full week
out="out/$week"
draw() {  # draw <template> <export> <column map> <width>
  boardplot render "specs/$1.json" --rows "$in/$2" --columns "$3" \
    --target report --width "$4" --format png --out "$out" --overwrite --quiet > /dev/null
}

draw weekly-revenue weekly_channel.csv category=week,date=week,series=channel,value=revenue_keur 1040px
draw channel-table channel_week.csv label=channel 600px
draw region-variance region_week.csv category=region,series=scenario,value=revenue_keur 420px

cat > "$out/review.html" <<HTML
<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Weekly business review</title>
<style>
body { margin: 0; background: #F0F3F7; color: #051C2C; font: 14px/1.5 Arial, sans-serif; }
header { background: #051C2C; color: #fff; padding: 16px 24px; }
header b { color: #AFC3FF; font-size: 12px; letter-spacing: .08em; }
main { max-width: 1088px; margin: 0 auto; padding: 16px 24px; display: grid; grid-template-columns: 600fr 420fr; gap: 16px; }
img { width: 100%; background: #fff; padding: 12px; box-sizing: border-box; display: block; }
.wide { grid-column: 1 / -1; }
</style></head>
<body><header><b>WEEKLY BUSINESS REVIEW</b><br>Alder Outdoor, week of $week</header>
<main><img class="wide" src="weekly-revenue.png" alt="Revenue by week and channel">
<img src="channel-table.png" alt="Revenue by channel, last full week">
<img src="region-variance.png" alt="Revenue by region against last year"></main>
</body></html>
HTML
echo "wrote $out"
