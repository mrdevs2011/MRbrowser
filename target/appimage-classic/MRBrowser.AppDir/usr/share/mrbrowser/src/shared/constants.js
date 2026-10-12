'use strict';
/**
 * Shared application constants for MR Browser.
 * @module shared/constants
 */

/** Soft pastel palette for account avatars (Chrome-style neutral pastels). */
const ACCOUNT_COLORS = [
  '#A8D5E5', '#C5B4E3', '#B8E0D2', '#F5D0C5',
  '#D4E5B8', '#E8C4E0', '#C9D6E8', '#E5D5B5',
];

/** Built-in search engines. `%s` is replaced with the encoded query. */
const ENGINES = {
  duckduckgo: {
    name: 'DuckDuckGo',
    url: 'https://duckduckgo.com/?q=%s',
    sug: 'https://duckduckgo.com/ac/?type=list&q=%s',
  },
  google: {
    name: 'Google',
    url: 'https://www.google.com/search?q=%s',
    sug: 'https://suggestqueries.google.com/complete/search?client=firefox&q=%s',
  },
  brave: {
    name: 'Brave Search',
    url: 'https://search.brave.com/search?q=%s',
    sug: null,
  },
  bing: {
    name: 'Bing',
    url: 'https://www.bing.com/search?q=%s',
    sug: 'https://api.bing.com/osjson.aspx?query=%s',
  },
  yandex: {
    name: 'Yandex',
    url: 'https://yandex.com/search/?text=%s',
    sug: null,
  },
};

/** Internal mrb:// routes handled by the custom protocol. */
const INTERNAL_ROUTES = new Set([
  'newtab', 'dashboard', 'history', 'bookmarks', 'downloads', 'settings', 'error',
]);

/** Tile layout metrics (pixels). */
const TILE = Object.freeze({
  GAP: 10,
  RING: 2,
  MIN_WIDTH: 340,
  MIN_PANE: 200,
});

module.exports = {
  ACCOUNT_COLORS,
  ENGINES,
  INTERNAL_ROUTES,
  TILE,
};
