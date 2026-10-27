"""Boardplot in Streamlit: the first five minutes.

    pip install "boardplot[streamlit]" pandas
    streamlit run streamlit_app.py

The data is synthetic.
"""

import pandas as pd
import streamlit as st

import boardplot as bp

# Boardplot charts need at least 280 px of width; Streamlit's default sidebar leaves about 240 px for content.
st.set_page_config(initial_sidebar_state=360)
st.title("Revenue by region")

df = pd.DataFrame({"region": ["North", "South", "East", "West"], "revenue": [42.0, 35.5, 51.2, 28.9]})

# The chart fills its container, follows the app's light or dark theme, and reruns the script on a click.
result = bp.st_chart(df, "bar", category="region", value="revenue", title="East leads revenue", key="rev", on_click="rerun")
if result.click:
    st.write("You picked", result.click.get("categoryLabel"))
elif result.selection:
    st.write("Last pick:", result.selection.get("categoryLabel"))
else:
    # Always one line here: Streamlit places elements by position, so the charts below keep their place on every rerun.
    st.write("Click a bar.")

left, right = st.columns(2)
with left:
    # A function receives the clicked record before the rerun; it needs a key.
    bp.st_chart(df, "column", category="region", value="revenue", title="Revenue, column view",
                key="rev_column", on_click=lambda record: st.session_state.update(picked=record.get("categoryLabel")))
    if "picked" in st.session_state:
        st.caption(f"Picked in the column view: {st.session_state.picked}")
with right:
    # An explicit theme stays when the app theme changes.
    bp.st_chart(df, "bar", category="region", value="revenue", title="Always dark", theme="standard-dark")

with st.sidebar:
    st.header("Sidebar")
    bp.st_chart(df, "bar", category="region", value="revenue", title="Revenue")
