/**
 * Domino Component Stand-ins — Lightweight implementations of complex
 * @domino/base-components that have no single antd CDN equivalent.
 *
 * These match the REAL component's prop API so prototype code reads
 * identically to production code. On migration, just swap the import.
 *
 * Depends on: React, antd (loaded via CDN), domino-components.js aliases.
 */

// ==================== TopNavBar ====================
// Real: import { TopNavBar } from '@domino/base-components'
// Dark charcoal navigation bar with logo, horizontal menus, search, notifications.
// Source: base-components/src/TopNavBar/styles.ts
//   background: colors.neutralDark700 (#2E2E38)
//   text: palette.textPrimaryLight (#FFFFFF)
//   hover: colors.neutralDark400 (#65657B)
//   selected: colors.neutralDark500 (#535365)
//   height: 44px

var TopNavBar = (function () {
  var h = React.createElement;

  var headerStyle = {
    height: 44,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    color: '#FFFFFF',
    padding: '0 90px 0 24px', /* right padding reserves space for Dev Tools toolbar */
    background: '#2E2E38',
    flexShrink: 0,
    zIndex: 100,
  };

  var sectionStyle = {
    display: 'flex',
    alignItems: 'center',
    gap: 0,
  };

  var logoWrapperStyle = {
    marginRight: 16,
    lineHeight: '12px',
    display: 'flex',
    alignItems: 'center',
  };

  var menuItemStyle = function (isSelected) {
    return {
      display: 'inline-flex',
      alignItems: 'center',
      height: 28,
      padding: '0 8px',
      margin: '0 4px',
      borderRadius: 2,
      fontSize: 13,
      color: '#FFFFFF',
      cursor: 'pointer',
      background: isSelected ? '#535365' : 'transparent',
      transition: 'background 0.15s',
      whiteSpace: 'nowrap',
      userSelect: 'none',
    };
  };

  var searchWrapperStyle = {
    display: 'flex',
    alignItems: 'center',
    margin: '0 16px',
  };

  var notifStyle = {
    margin: '0 4px',
    padding: '6px 8px',
    borderRadius: 2,
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
  };

  function TopNavBarComponent(props) {
    var selectedKeys = props.selectedKeys || [];

    var leftItems = (props.left || []).map(function (item) {
      return h('span', {
        key: item.key,
        style: menuItemStyle(selectedKeys.indexOf(item.key) !== -1),
        className: 'domino-nav-item',
      }, item.label);
    });

    var rightItems = (props.right || []).map(function (item) {
      return h('span', {
        key: item.key,
        style: menuItemStyle(selectedKeys.indexOf(item.key) !== -1),
        className: 'domino-nav-item',
      }, item.label);
    });

    return h('nav', { 'data-domino-component': 'TopNavBar', style: { flexShrink: 0 } },
      h('div', { style: headerStyle },
        h('div', { style: sectionStyle },
          h('div', { style: logoWrapperStyle }, props.logo),
          h('div', { style: { display: 'flex', alignItems: 'center' } }, leftItems)
        ),
        h('div', { style: sectionStyle },
          props.searchPlaceholder && h('div', { style: searchWrapperStyle }, props.searchPlaceholder),
          h('div', { style: { display: 'flex', alignItems: 'center' } }, rightItems),
          props.loginButonPlaceholder,
          props.notifications && h('div', { style: notifStyle, className: 'domino-nav-item' }, props.notifications)
        )
      )
    );
  }

  TopNavBarComponent.displayName = 'TopNavBar';
  return TopNavBarComponent;
})();


// ==================== SideBar ====================
// Real: import { SideBar } from '@domino/base-components'
// White sidebar with light-purple header, vertical menu, collapse toggle.
// Source: base-components/src/SideBar/styles.ts
//   body bg: palette.bg (#FFFFFF)
//   header bg: palette.bgPrimary (#F0EEFC)
//   header section: palette.primary (#543FDE), fontSizes.small (14px)
//   header name: palette.textPrimary (#2E2E38), fontSizes.medium (16px)
//   header tag: palette.textPrimary, fontSizes.tiny (12px), yellow100 bg (#FAF6D7)
//   width: 200px expanded / 70px collapsed
//   height: calc(100vh - 44px)
//   shadow: 0px 4px 10px 0px rgba(208, 205, 225, 0.15)

var SideBar = (function () {
  var h = React.createElement;

  var sidebarStyle = function (collapsed) {
    return {
      width: collapsed ? 70 : 200,
      height: 'calc(100vh - 44px)',
      display: 'flex',
      flexDirection: 'column',
      justifyContent: 'space-between',
      background: '#FFFFFF',
      paddingBottom: 8,
      boxShadow: '0px 4px 10px 0px rgba(208, 205, 225, 0.15)',
      flexShrink: 0,
      overflow: 'hidden',
      transition: 'width 0.2s ease',
    };
  };

  var headerStyle = function (collapsed) {
    return {
      background: '#F0EEFC',
      padding: collapsed ? 0 : 16,
      height: collapsed ? 0 : 120,
      flexShrink: 0,
      overflow: 'hidden',
      transition: 'padding 0.2s, height 0.2s, opacity 0.2s',
      opacity: collapsed ? 0 : 1,
    };
  };

  var sectionLabelStyle = { color: '#543FDE', fontSize: 14 };
  var nameStyle = { color: '#2E2E38', fontSize: 16, height: 20, margin: '8px 0', fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' };
  var tagStyle = { display: 'inline-block', color: '#2E2E38', fontSize: 12, background: '#FAF6D7', padding: '2px 8px', borderRadius: 4, height: 24, lineHeight: '20px' };

  var menuWrapperStyle = { flex: 1, overflowY: 'auto' };

  var menuItemBaseStyle = {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    padding: '8px 16px',
    fontSize: 13,
    color: '#65657B',
    cursor: 'pointer',
    transition: 'color 0.15s, background 0.15s',
    borderRadius: 0,
    userSelect: 'none',
  };

  var collapseStyle = function (collapsed) {
    return {
      display: 'flex',
      justifyContent: collapsed ? 'center' : 'flex-end',
      padding: 16,
      cursor: 'pointer',
    };
  };

  function SideBarComponent(props) {
    var collapsed = props.collapsed || false;
    var selectedKeys = props.selectedKeys || [];

    var menuItems = (props.items || []).map(function (item) {
      var isSelected = selectedKeys.indexOf(item.key) !== -1;
      var style = Object.assign({}, menuItemBaseStyle, {
        color: isSelected ? '#543FDE' : '#65657B',
        fontWeight: isSelected ? 600 : 400,
        background: isSelected ? 'transparent' : 'transparent',
      });
      return h('div', {
        key: item.key,
        style: style,
        className: 'domino-sidebar-item' + (isSelected ? ' selected' : ''),
        onClick: function () { props.onClick && props.onClick({ key: item.key }); },
      },
        item.icon && h('span', { style: { display: 'flex', alignItems: 'center', width: 20, justifyContent: 'center', fontSize: 14 } }, item.icon),
        !collapsed && h('span', null, item.label)
      );
    });

    return h('aside', { 'data-domino-component': 'SideBar', style: sidebarStyle(collapsed) },
      h('div', { style: headerStyle(collapsed) },
        props.section && h('div', { style: sectionLabelStyle }, props.section),
        props.name && h('div', { style: nameStyle }, props.name),
        props.tag && h('div', { style: tagStyle }, props.tag)
      ),
      h('div', { style: menuWrapperStyle }, menuItems),
      h('div', {
        style: collapseStyle(collapsed),
        onClick: props.handleCollapse,
      },
        h('span', { style: { color: '#543FDE', fontSize: 14 } }, collapsed ? '→' : '←')
      )
    );
  }

  SideBarComponent.displayName = 'SideBar';
  return SideBarComponent;
})();


// ==================== Wizard ====================
// Real: StepperContent from @domino/ui + Modal from @domino/base-components
// Source: ui/src/components/StepperContent/ + base-components/src/Modal/
//
// Visual spec (derived from StepperContent.styled-components.tsx):
//   Step indicator colors (24px circles):
//     Active:    bg=#543FDE (lightishBlue)  color=#FFFFFF  border=#543FDE
//     Wait:      bg=#FFFFFF (bg)            color=#543FDE  border=#543FDE
//     Finish:    bg=#30C578 (success)       color=#FFFFFF  border=#30C578
//     Error:     #C20A29 exclamation icon
//   Connecting lines: HIDDEN (display:none in real component)
//   Step titles: ALL #543FDE; active font-weight 600, others 400
//   Descriptions: active=#2E2E38, others=#65657B
//   Steps width: 185px, padding: 20px 0 0 20px
//   Footer: border-top 1px solid #FAFAFA, padding 10px 24px, justify-content flex-end
//   Buttons per step:
//     Step 1: Cancel(tertiary) + Next(primary)
//     Steps 2..N-1: Cancel(tertiary) + Back(secondary) + Next(primary)
//     Last step: Cancel(tertiary) + Back(secondary) + [primaryAction](primary)

var Wizard = (function () {
  var h = React.createElement;
  var { Modal: AntModal } = antd;

  var sizeToWidth = { sm: 400, md: 600, lg: 900, xl: 1200 };

  var containerStyle = { display: 'flex', width: '100%', minHeight: 480 };
  var stepsStyle = { width: 185, padding: '20px 0 0 20px', flexShrink: 0 };
  var dividerStyle = { width: 1, background: '#FAFAFA', flexShrink: 0 };
  var contentStyle = { flexGrow: 1, padding: 20, overflow: 'auto' };
  var footerStyle = { width: '100%', padding: '10px 24px', borderTop: '1px solid #FAFAFA', display: 'flex', justifyContent: 'flex-end', gap: 8 };

  function indicatorStyle(isActive, isCompleted, hasError) {
    var bg, color, border;
    if (hasError) { bg = '#C20A29'; color = '#FFFFFF'; border = '#C20A29'; }
    else if (isCompleted) { bg = '#30C578'; color = '#FFFFFF'; border = '#30C578'; }
    else if (isActive) { bg = '#543FDE'; color = '#FFFFFF'; border = '#543FDE'; }
    else { bg = '#FFFFFF'; color = '#543FDE'; border = '#543FDE'; }
    return {
      width: 24, height: 24, borderRadius: '50%',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      flexShrink: 0, fontSize: 12, fontWeight: 400, textAlign: 'center',
      background: bg, color: color, border: '1px solid ' + border,
      lineHeight: '22px',
    };
  }

  var titleStyle = function (isActive) {
    return { fontSize: 14, fontWeight: isActive ? 600 : 400, color: '#543FDE', margin: 0, lineHeight: '18px', paddingLeft: 16 };
  };

  var descStyle = function (isActive) {
    return { fontSize: 12, fontWeight: 400, color: isActive ? '#2E2E38' : '#65657B', margin: 0, lineHeight: 1.2, marginTop: 2, paddingLeft: 16 };
  };

  var checkSvg = h('svg', { width: 12, height: 12, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 3, strokeLinecap: 'round', strokeLinejoin: 'round' },
    h('polyline', { points: '20 6 9 17 4 12' })
  );

  function WizardComponent(props) {
    var current = props.current || 0;
    var items = props.items || [];
    var isLastStep = current === items.length - 1;
    var isFirstStep = current === 0;

    var handleNext = function () {
      var step = items[current];
      if (step && step.validator) {
        var result = step.validator();
        if (result && result.then) {
          result.then(function (valid) { if (valid) props.onChange(current, current + 1); });
          return;
        }
        if (!result) return;
      }
      props.onChange(current, current + 1);
    };

    var handleStepClick = function (index) {
      if (index === current) return;
      if (index < current) { props.onChange(current, index); return; }
      if (index === current + 1) handleNext();
    };

    var stepList = h('div', { style: { display: 'flex', flexDirection: 'column', gap: 0 } },
      items.map(function (item, i) {
        var isActive = i === current;
        var isCompleted = i < current || item.status === 'finish';
        var hasError = item.status === 'error';
        var isClickable = i <= current + 1 || item.status === 'finish';

        var stepItemStyle = {
          display: 'flex', alignItems: 'flex-start', position: 'relative',
          marginBottom: 10, width: '100%',
          cursor: isClickable ? 'pointer' : 'default', userSelect: 'none',
        };

        return h('div', {
          key: i, style: stepItemStyle,
          onClick: function () { if (isClickable) handleStepClick(i); },
        },
          h('div', { style: indicatorStyle(isActive, isCompleted, hasError) },
            hasError ? '!' : isCompleted ? checkSvg : (i + 1)
          ),
          h('div', { style: { display: 'flex', flexDirection: 'column', justifyContent: 'center', flex: 1 } },
            h('div', { style: titleStyle(isActive) }, item.title),
            h('div', { style: descStyle(isActive) }, item.subtitle || '–')
          )
        );
      })
    );

    var footerButtons = [];
    footerButtons.push(h(Button, {
      key: 'cancel', type: 'tertiary',
      onClick: props.onClose, disabled: props.isLoading,
      'data-test': 'cancel-button',
    }, props.cancelBtnText || 'Cancel'));

    if (!isFirstStep) {
      footerButtons.push(h(Button, {
        key: 'back', type: 'secondary',
        onClick: function () { props.onChange(current, current - 1); },
        disabled: props.isLoading,
        'data-test': 'back-button',
      }, '‹ ', props.backBtnText || 'Back'));
    }

    if (!isLastStep) {
      footerButtons.push(h(Button, {
        key: 'next', type: 'secondary',
        onClick: handleNext,
        disabled: props.isLoading,
        'data-test': 'next-button',
      }, props.nextBtnText || 'Next', ' ›'));
    }

    footerButtons.push(h(Button, {
      key: 'finish', type: 'primary',
      onClick: props.onSubmit,
      loading: props.isLoading,
      disabled: props.finishDisabled,
      'data-test': 'finish-button',
    }, props.finishBtnText || 'Create'));

    var footer = h('div', { style: footerStyle }, footerButtons);

    return h(AntModal, {
      open: props.isOpen,
      onCancel: props.onClose,
      width: props.width || sizeToWidth[props.size || 'lg'] || 900,
      title: props.title,
      footer: footer,
      maskClosable: props.maskClosable !== false,
      bodyStyle: { padding: 0 },
      'data-domino-component': 'Wizard',
    },
      h('div', { style: containerStyle },
        h('div', { style: stepsStyle, 'data-domino-component': 'Wizard.Steps' }, stepList),
        h('div', { style: dividerStyle }),
        h('div', { style: contentStyle, 'data-domino-view-state': 'wizard-step-' + current }, props.children)
      )
    );
  }

  WizardComponent.displayName = 'Wizard';
  return WizardComponent;
})();


// ==================== MetricCard ====================
// Real: import { MetricCard } from '@domino/base-components'

var MetricCard = (function () {
  var h = React.createElement;
  var { Card: AntCard } = antd;
  var valueStyle = { fontSize: 28, fontWeight: 600, color: '#2E2E38', lineHeight: 1.2, marginBottom: 4 };
  var labelStyle = { fontSize: 13, color: '#65657B', fontWeight: 500 };
  function MetricCardComponent(props) {
    var trend = props.trend;
    var trendEl = null;
    if (trend) {
      var isUp = trend > 0;
      trendEl = h('span', { style: { color: isUp ? '#28A464' : '#C20A29', fontSize: 13, fontWeight: 500 } }, (isUp ? '↑ +' : '↓ ') + trend + '%');
    }
    return h(AntCard, { size: 'small', style: props.style, 'data-domino-component': 'MetricCard' },
      h('div', { style: valueStyle }, props.value),
      h('div', { style: labelStyle }, props.label, trendEl ? h('span', null, ' ', trendEl) : null),
      props.children
    );
  }
  MetricCardComponent.displayName = 'MetricCard';
  return MetricCardComponent;
})();


// ==================== ActionDropdown ====================
// Real: import { ActionDropdown } from '@domino/base-components'

var ActionDropdown = (function () {
  var h = React.createElement;
  var { Dropdown, Button: AntButton } = antd;
  function ActionDropdownComponent(props) {
    var menuItems = (props.items || []).map(function (item) {
      return { key: item.key, label: item.label, danger: item.danger, disabled: item.disabled, onClick: item.onClick };
    });
    return h(Dropdown, { menu: { items: menuItems }, trigger: props.trigger || ['click'], placement: props.placement || 'bottomRight', 'data-domino-component': 'ActionDropdown' },
      props.children || h(AntButton, { type: 'text', size: 'small' }, '⋯')
    );
  }
  ActionDropdownComponent.displayName = 'ActionDropdown';
  return ActionDropdownComponent;
})();


// ==================== CopyText ====================
// Real: import { CopyText } from '@domino/base-components'

var CopyText = (function () {
  var h = React.createElement;
  var useState = React.useState;
  function CopyTextComponent(props) {
    var _s = useState(false), copied = _s[0], setCopied = _s[1];
    var handleCopy = function () {
      navigator.clipboard.writeText(props.text || '').then(function () { setCopied(true); setTimeout(function () { setCopied(false); }, 1500); });
    };
    return h('span', { style: Object.assign({ display: 'inline-flex', alignItems: 'center', gap: 6, fontFamily: "'SF Mono', 'Fira Code', monospace", fontSize: 13, color: '#2E2E38' }, props.style), 'data-domino-component': 'CopyText' },
      h('span', null, props.text),
      h('button', { style: { background: 'none', border: 'none', cursor: 'pointer', color: '#65657B', fontSize: 12, padding: '2px 4px', borderRadius: 3 }, onClick: handleCopy, title: 'Copy' }, copied ? '✓' : '⎘')
    );
  }
  CopyTextComponent.displayName = 'CopyText';
  return CopyTextComponent;
})();


// ==================== EllipsisText ====================
// Real: import { EllipsisText } from '@domino/base-components'

var EllipsisText = (function () {
  var h = React.createElement;
  var { Tooltip } = antd;
  function EllipsisTextComponent(props) {
    return h(Tooltip, { title: props.text || props.children },
      h('span', { style: Object.assign({ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'block', maxWidth: props.maxWidth || 200 }, props.style), 'data-domino-component': 'EllipsisText' }, props.text || props.children)
    );
  }
  EllipsisTextComponent.displayName = 'EllipsisText';
  return EllipsisTextComponent;
})();


// ==================== Typography ====================
// Real: import { Typography } from '@domino/base-components'

var Typography = (function () {
  var h = React.createElement;
  var baseFont = { fontFamily: 'Inter, Lato, Helvetica Neue, Arial, sans-serif', color: '#2E2E38' };
  function H1(props) {
    return h('div', Object.assign({}, props, { style: Object.assign({}, baseFont, { fontSize: 24, fontWeight: 600, lineHeight: 1.3 }, props.style), 'data-domino-component': 'Typography.H1' }), props.children);
  }
  function H2(props) {
    return h('div', Object.assign({}, props, { style: Object.assign({}, baseFont, { fontSize: 20, fontWeight: 600, lineHeight: 1.35 }, props.style), 'data-domino-component': 'Typography.H2' }), props.children);
  }
  function H3(props) {
    return h('div', Object.assign({}, props, { style: Object.assign({}, baseFont, { fontSize: 16, fontWeight: 600, lineHeight: 1.4 }, props.style), 'data-domino-component': 'Typography.H3' }), props.children);
  }
  var textTypes = {
    BodyDefault: { fontSize: 14, fontWeight: 400 },
    BodyDefaultStrong: { fontSize: 14, fontWeight: 600 },
    BodySmall: { fontSize: 12, fontWeight: 400 },
    BodySmallStrong: { fontSize: 12, fontWeight: 600 },
    BodyCode: { fontSize: 13, fontWeight: 400, fontFamily: "'SF Mono', 'Fira Code', monospace" },
  };
  function Text(props) {
    var variant = textTypes[props.type] || textTypes.BodyDefault;
    return h('span', Object.assign({}, props, { style: Object.assign({}, baseFont, variant, props.style), 'data-domino-component': 'Typography.Text' }), props.children);
  }
  return { H1: H1, H2: H2, H3: H3, Text: Text };
})();
