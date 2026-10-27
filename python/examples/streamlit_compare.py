"""The same synthetic data drawn four ways: Boardplot, Streamlit's built-in chart, Altair and Plotly.

    pip install "boardplot[streamlit]" altair plotly pandas
    streamlit run streamlit_compare.py

Each library gets its default look and the shortest usual call, with the same
title where the library takes one. The data is synthetic.
"""

import altair as alt
import numpy as np
import pandas as pd
import plotly.express as px
import streamlit as st

import boardplot as bp

st.set_page_config(page_title="Chart comparison", layout="wide")
st.title("Same data, four libraries")

LIBRARIES = ("Boardplot", "Streamlit built-in", "Altair", "Plotly")


def row(case: str, boardplot, builtin, altair_chart, plotly_fig) -> None:
    st.header(case)
    columns = st.columns(4)
    for column, name in zip(columns, LIBRARIES):
        column.caption(name)
    with columns[0]:
        boardplot()
    with columns[1]:
        builtin()
    with columns[2]:
        st.altair_chart(altair_chart)
    with columns[3]:
        st.plotly_chart(plotly_fig)


# 1. Category comparison
regions = pd.DataFrame({
    "region": ["North", "South", "East", "West", "Central", "Islands"],
    "revenue": [42.0, 35.5, 51.2, 28.9, 33.4, 12.7],
})
title = "East leads revenue"
row(
    "Category comparison",
    lambda: bp.st_chart(regions, "bar", category="region", value="revenue", title=title),
    lambda: st.bar_chart(regions, x="region", y="revenue", horizontal=True),
    alt.Chart(regions, title=title).mark_bar().encode(x="revenue", y=alt.Y("region", sort="-x")),
    px.bar(regions, x="revenue", y="region", orientation="h", title=title),
)

# 2. Negative values
change = pd.DataFrame({
    "product": ["Alpha", "Beta", "Gamma", "Delta", "Epsilon"],
    "change": [12.5, -8.2, 4.1, -15.6, 9.3],
})
title = "Delta lost the most"
row(
    "Negative values",
    lambda: bp.st_chart(change, "column", category="product", value="change", title=title),
    lambda: st.bar_chart(change, x="product", y="change"),
    alt.Chart(change, title=title).mark_bar().encode(x="product", y="change"),
    px.bar(change, x="product", y="change", title=title),
)

# 3. Time series
trend = pd.DataFrame({
    "month": pd.date_range("2024-01-01", periods=24, freq="MS"),
    "revenue": np.round(100 + np.arange(24) * 2.5 + 6 * np.sin(np.arange(24) / 2), 1),
})
title = "Revenue grows steadily"
row(
    "Time series",
    lambda: bp.st_chart(trend, "line", category="month", date="month", value="revenue", title=title),
    lambda: st.line_chart(trend, x="month", y="revenue"),
    alt.Chart(trend, title=title).mark_line().encode(x="month", y="revenue"),
    px.line(trend, x="month", y="revenue", title=title),
)

# 4. Long labels in a narrow column
teams = pd.DataFrame({
    "team": [
        "Customer success and onboarding",
        "Enterprise sales, northern region",
        "Platform engineering and reliability",
        "Marketing operations and analytics",
        "Finance, planning and controlling",
    ],
    "headcount": [18.0, 24.0, 31.0, 12.0, 9.0],
})
title = "Platform engineering is the largest team"
row(
    "Long labels in a narrow column",
    lambda: bp.st_chart(teams, "bar", category="team", value="headcount", title=title),
    lambda: st.bar_chart(teams, x="team", y="headcount", horizontal=True),
    alt.Chart(teams, title=title).mark_bar().encode(x="headcount", y=alt.Y("team", sort="-x")),
    px.bar(teams, x="headcount", y="team", orientation="h", title=title),
)

# 5. Several series
sales = pd.DataFrame({
    "region": ["North", "South", "East", "West"] * 3,
    "year": ["2023"] * 4 + ["2024"] * 4 + ["2025"] * 4,
    "revenue": [38.0, 31.2, 44.5, 27.1, 40.3, 33.9, 47.8, 28.0, 42.0, 35.5, 51.2, 28.9],
})
title = "East grows fastest"
row(
    "Several series",
    lambda: bp.st_chart(sales, "column", category="region", series="year", value="revenue", title=title),
    lambda: st.bar_chart(sales, x="region", y="revenue", color="year", stack=False),
    alt.Chart(sales, title=title).mark_bar().encode(x="region", xOffset="year", y="revenue", color="year"),
    px.bar(sales, x="region", y="revenue", color="year", barmode="group", title=title),
)

# 6. Missing values
gaps = trend.copy()
gaps.loc[[5, 6, 14], "revenue"] = None
title = "Three months have no data"
row(
    "Missing values",
    lambda: bp.st_chart(gaps, "line", category="month", date="month", value="revenue", title=title),
    lambda: st.line_chart(gaps, x="month", y="revenue"),
    alt.Chart(gaps, title=title).mark_line().encode(x="month", y="revenue"),
    px.line(gaps, x="month", y="revenue", title=title),
)
