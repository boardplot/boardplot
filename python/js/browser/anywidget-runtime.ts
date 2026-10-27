/**
 * The runtime widget's module: the full browser bundle, sent to the page
 * once per kernel through one hidden widget. Chart widgets reach its exports
 * through anywidget 0.11 composition (`host.getWidget`). It draws nothing.
 */
import { mount } from './mount';
import { identity } from './identity';

export default {
  initialize() {
    return { mount, identity };
  },
};
