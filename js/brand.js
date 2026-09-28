/* Brand watermark and the demonstration marking.

   The tiled layer is built here rather than in CSS so nothing has to be fetched: the tile is an
   SVG data URI drawn with a generic font stack.

   The marking says "demonstration" rather than anything about ownership, because that is the one
   thing a visitor needs to know: the rig is simulated and this is not a product.

   #nowm=1 removes the tiled layer, for screenshots. */
(function () {
  var q = new URLSearchParams(location.hash.slice(1));
  if (q.get('nowm') === '1') return;

  var DATE = new Date().toISOString().slice(0, 10);
  var WORD = 'Makkal';             // the brand, in the logo's letterforms
  var TAIL = 'Demonstration';      // the notice, in ordinary text
  var LINE = WORD + '  ' + TAIL;   // used only to measure the tile

  // Two staggered rows per tile so the pattern reads as continuous rather than as a grid.
  // The tile is sized from the measured text, otherwise the repeats run into each other.
  // A slab serif to match the logo's letterforms. Rockwell ships with Office on Windows;
  // the rest of the stack degrades to whatever slab or serif is present. Nothing is fetched.
  var WMFONT = 'Rockwell,"Roboto Slab","Bookman Old Style",Georgia,serif';
  var UIFONT = '"Segoe UI",Arial,sans-serif';
  var FONT = '600 26px ' + WMFONT;

  function textWidth(text) {
    try {
      var c = document.createElement('canvas').getContext('2d');
      c.font = FONT;
      return c.measureText(text).width + text.length * 3;   // + letter-spacing, which canvas ignores
    } catch (e) {
      return text.length * 16;                              // rough fallback; only affects spacing
    }
  }

  function tile(text) {
    var tw = Math.ceil(textWidth(text));
    var w = tw + 520, h = 300;                              // sparse: wide gaps, few repeats on screen
    function row(x, y) {   // text comes from WORD + TAIL
      return '<text x="' + x + '" y="' + y + '" font-size="26" letter-spacing="3" fill="#0d1b2a">' +
             '<tspan font-family="' + WMFONT.replace(/"/g, '') + '" font-weight="700">' + WORD + '</tspan>' +
             '<tspan font-family="' + UIFONT.replace(/"/g, '') + '" font-weight="400">  ' + TAIL + '</tspan>' +
             '</text>';
    }
    var svg = '<svg xmlns="http://www.w3.org/2000/svg" width="' + w + '" height="' + h + '">' +
              row(0, 90) + row(Math.round(w / 2), 240) + '</svg>';
    return 'url("data:image/svg+xml,' + encodeURIComponent(svg) + '")';
  }

  function mount() {
    if (document.getElementById('mkWm')) return;

    var wm = document.createElement('div');
    wm.id = 'mkWm';
    wm.setAttribute('aria-hidden', 'true');
    wm.style.backgroundImage = tile(LINE);
    document.body.appendChild(wm);

    var badge = document.createElement('div');
    badge.id = 'mkBadge';
    badge.setAttribute('aria-hidden', 'true');
    badge.innerHTML =
      '<svg class="mk-logo" viewBox="0 0 194.25 78.75"><use href="#mkLogo"></use></svg>' +
      '<b>Demo</b>';
    badge.title = 'Demonstration interface · simulated data · not a product · ' + DATE;
    document.body.appendChild(badge);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount);
  else mount();
})();
