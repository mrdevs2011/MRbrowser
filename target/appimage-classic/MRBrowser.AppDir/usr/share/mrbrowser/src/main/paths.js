'use strict';
/**
 * Absolute paths for the main process. Keeps loadFile / preload paths consistent
 * after the src/ layout migration.
 * @module main/paths
 */
const path = require('path');

/** Project root (repository / packaged app root). */
const ROOT = path.join(__dirname, '..', '..');

module.exports = {
  ROOT,
  packageJson: path.join(ROOT, 'package.json'),
  icon: path.join(ROOT, 'assets', 'icon.png'),
  uiHtml: path.join(ROOT, 'src', 'renderer', 'chrome', 'ui.html'),
  uiPreload: path.join(ROOT, 'src', 'renderer', 'chrome', 'preload.js'),
  internalHtml: path.join(ROOT, 'src', 'renderer', 'internal', 'internal.html'),
  pagePreload: path.join(ROOT, 'src', 'renderer', 'internal', 'pagepreload.js'),
  frameHtml: path.join(ROOT, 'src', 'renderer', 'frame', 'frame.html'),
  framePreload: path.join(ROOT, 'src', 'renderer', 'frame', 'framepreload.js'),
};
