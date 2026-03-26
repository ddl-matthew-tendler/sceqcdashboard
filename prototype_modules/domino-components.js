/**
 * domino-components.js — Infrastructure for aliasing antd CDN components
 * to their real @domino/base-components names.
 *
 * This file provides the dominoAlias() function and the antd destructuring.
 * The actual aliases are added by the agent during prototype construction
 * by following the Component Discovery Workflow:
 *
 *   1. Search example_domino_frontend_code/frontend/packages/base-components/src/
 *   2. Read the real component's .tsx file and props interface
 *   3. If it wraps a single antd component → add a dominoAlias() line below
 *   4. If it's composite → add a stand-in in domino-standins.js instead
 *
 * EXAMPLE (agent adds these based on what the prototype actually uses):
 *
 *   const DominoTable = dominoAlias(AntTable, 'DominoTable');
 *   const Callout     = dominoAlias(AntAlert, 'Callout');
 *   const TextInput   = dominoAlias(AntInput, 'TextInput');
 */

const { createElement: h } = React;

// Destructure all antd components that might be needed as alias targets.
// This block is stable — it's antd's public API, not Domino's.
const {
  ConfigProvider,
  Button: AntButton,
  Card: AntCard,
  Modal: AntModal,
  Table: AntTable,
  Select: AntSelect,
  Input: AntInput,
  Tag: AntTag,
  Alert: AntAlert,
  Tabs: AntTabs,
  Form: AntForm,
  Drawer: AntDrawer,
  Breadcrumb: AntBreadcrumb,
  Badge: AntBadge,
  Switch: AntSwitch,
  Checkbox: AntCheckbox,
  Radio: AntRadio,
  Tooltip: AntTooltip,
  Popover: AntPopover,
  Space,
  Collapse: AntCollapse,
  Spin,
  Upload: AntUpload,
  Segmented: AntSegmented,
  Dropdown: AntDropdown,
  Menu: AntMenu,
} = antd;

/**
 * dominoAlias — Wraps an antd component with its real Domino name and
 * injects a data-domino-component attribute so Dev Tools can identify it.
 */
function dominoAlias(AntComponent, dominoName) {
  function Wrapper(props) {
    var children = props ? props.children : undefined;
    var rest = Object.assign({}, props, { 'data-domino-component': dominoName });
    delete rest.children;
    return React.createElement(AntComponent, rest, children);
  }
  Wrapper.displayName = dominoName;
  Object.keys(AntComponent).forEach(function (k) { Wrapper[k] = AntComponent[k]; });
  return Wrapper;
}

// ============================================================
// PRE-BUILT ALIASES — complex wrappers that aren't simple dominoAlias() calls.
// These are provided because the real component's styling differs enough
// from antd that the agent can't just remap a type string.
// ============================================================

// Real: import { Button } from '@domino/base-components'
// Domino uses type: 'primary'|'secondary'|'tertiary'|'link'
// and color: 'regular'|'danger'.
//
// Secondary and tertiary have custom purple-tinted colors (from Button/styles.ts)
// that have NO antd equivalent. The alias maps to antd 'default' and attaches a
// CSS class (domino-btn-secondary / domino-btn-tertiary). The PROTOTYPE'S styles.css
// MUST include the matching color rules — see the "Domino Button type overrides"
// block in the flow-wizard prototype's styles.css for the resolved tokens.
var Button = (function () {
  var antTypeMap = { primary: 'primary', secondary: 'default', tertiary: 'default', link: 'link' };

  function DominoButton(props) {
    var dominoType = props.type || 'primary';
    var rest = Object.assign({}, props, { 'data-domino-component': 'Button' });
    rest.type = antTypeMap[dominoType] || 'default';
    if (dominoType === 'secondary' || dominoType === 'tertiary') {
      rest.className = ((rest.className || '') + ' domino-btn-' + dominoType).trim();
    }
    if (rest.color === 'danger') { rest.danger = true; delete rest.color; }
    var children = rest.children;
    delete rest.children;
    return h(AntButton, rest, children);
  }
  DominoButton.displayName = 'Button';
  return DominoButton;
})();

// Real: import { Tag } from '@domino/base-components'
// Domino uses type: 'success'|'danger'|'warning'|'user-generated'
// instead of antd's color prop.
var Tag = (function () {
  var typeToColor = { success: 'green', danger: 'red', warning: 'gold', 'user-generated': 'default' };

  function DominoTag(props) {
    var rest = Object.assign({}, props, { 'data-domino-component': 'Tag' });
    if (rest.type && typeToColor[rest.type]) {
      rest.color = typeToColor[rest.type];
      delete rest.type;
    }
    var children = rest.children;
    delete rest.children;
    return h(AntTag, rest, children);
  }
  DominoTag.displayName = 'Tag';
  return DominoTag;
})();

// Real: import { Select } from '@domino/base-components'
// Wraps antd Select with prop defaults that differ from antd:
//   - No checkmark on selected items (menuItemSelectedIcon = empty)
//   - No dropdown inline padding
//   - Taller dropdown (400px vs 256px)
//   - showSearch enabled by default
// Visual overrides (border color, selected bg, etc.) are in domino-overrides.css.
var Select = (function () {
  function DominoSelect(props) {
    var rest = Object.assign({
      showSearch: true,
      listHeight: 400,
      menuItemSelectedIcon: h('span'),
      dropdownStyle: Object.assign({ paddingInline: 0 }, props.dropdownStyle || {}),
    }, props, { 'data-domino-component': 'Select' });
    var children = rest.children;
    delete rest.children;
    return h(AntSelect, rest, children);
  }
  DominoSelect.displayName = 'Select';
  return DominoSelect;
})();

// ============================================================
// ADD SIMPLE ALIASES BELOW — populated by the agent via discovery.
// ============================================================
