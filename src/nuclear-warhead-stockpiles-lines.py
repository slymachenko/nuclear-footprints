import pandas as pd
import plotly.express as px
import plotly.io as pio

from const import DATA_DIR, VISUALIZATIONS_DIR

stockpiles_df = pd.read_csv(DATA_DIR / 'nuclear-warhead-stockpiles-lines/nuclear-warhead-stockpiles-lines.csv')

pio.templates.default = "plotly_dark"

# Filter for major nuclear powers
major_powers = ['United States', 'Russia', 'China', 'United Kingdom', 'France', 'World']
stockpiles_filtered = stockpiles_df[stockpiles_df['Entity'].isin(major_powers)].copy()

fig_arsenal = px.area(
    stockpiles_filtered,
    x='Year',
    y='Number of nuclear warheads',
    width=800,
    height=800,
    color='Entity',
    title='<b>The Rise & Fall of Nuclear Arsenals (1945-2024)</b><br><sub>Tracking the accumulation of warheads across the Cold War and beyond</sub>',
    labels={'Number of nuclear warheads': 'Warheads', 'Year': 'Year'},
    color_discrete_map={
        'United States': '#FF6B6B', 'Russia': '#4ECDC4', 'China': '#FFE66D',
        'United Kingdom': '#95E1D3', 'France': '#C7CEEA', 'World': '#FFFFFF'
    }
)

fig_arsenal.update_layout(
    hovermode='x unified',
    height=600,
    plot_bgcolor='rgba(15, 25, 35, 0.8)',
    paper_bgcolor='rgba(10, 15, 25, 1)',
    yaxis_title='Number of Warheads',
    legend=dict(orientation='h', yanchor='bottom', y=1.02, xanchor='right', x=1)
)
fig_arsenal.write_html(VISUALIZATIONS_DIR / "nuclear-warhead-stockpiles-lines.html")