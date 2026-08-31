// Tiny dependency-free SVG weekly bar chart (reviews per day, last 7 days).
const Charts = (() => {
  const DOW_VI = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'];

  function weeklyBarChartSVG(data) {
    const w = 320, h = 140, padBottom = 22, padTop = 10;
    const max = Math.max.apply(null, data.map(function (d) { return d.reviews; }).concat([1]));
    const barW = (w - 20) / data.length - 8;
    let bars = '';
    data.forEach(function (d, i) {
      const barH = ((h - padBottom - padTop) * d.reviews) / max;
      const x = 10 + i * ((w - 20) / data.length);
      const y = h - padBottom - barH;
      const dow = DOW_VI[new Date(d.date).getDay()];
      bars += '<rect x="' + x + '" y="' + y + '" width="' + barW + '" height="' + Math.max(barH, 1) +
        '" rx="4" fill="var(--accent)" opacity="0.9"></rect>';
      bars += '<text x="' + (x + barW / 2) + '" y="' + (h - 6) + '" font-size="10" text-anchor="middle" fill="var(--text-dim)">' + dow + '</text>';
      if (d.reviews > 0) {
        bars += '<text x="' + (x + barW / 2) + '" y="' + (y - 4) + '" font-size="10" text-anchor="middle" fill="var(--text)">' + d.reviews + '</text>';
      }
    });
    return '<svg viewBox="0 0 ' + w + ' ' + h + '" width="100%" height="' + h + '" xmlns="http://www.w3.org/2000/svg">' + bars + '</svg>';
  }

  return { weeklyBarChartSVG: weeklyBarChartSVG };
})();
