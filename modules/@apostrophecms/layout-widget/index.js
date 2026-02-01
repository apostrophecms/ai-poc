export default {
  options: {
    label: 'project:layout',
    description: 'project:layoutDescription',
    previewImage: 'svg',
    aiSkill: `The layout widget creates a multi-column layout using a 12-column CSS grid system.

IMPORTANT: The layout widget itself just contains a "columns" area. The actual column positioning is controlled by @apostrophecms/layout-column widgets inside that area.

Each layout-column widget has a "desktop" object with:
- colstart: which grid column to start at (1-12)
- colspan: how many columns wide (1-12)

To create a gap between columns, ensure the second column's colstart is greater than the first column's (colstart + colspan).

Example for two columns with a 2-column gap:
- Column 1: desktop.colstart=1, desktop.colspan=5 (occupies columns 1-5)
- Column 2: desktop.colstart=8, desktop.colspan=5 (occupies columns 8-12, leaving 6-7 as gap)`
  }
};
