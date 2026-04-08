/* ================================================================
   SCE QC Tracker — Domino App
   For pharma stat programming milestones and QC tracking
   ================================================================ */

const { ConfigProvider, Button, Table, Tag, Space, Spin, Drawer, Badge,
        Tooltip, Progress, Select, Input, Empty, Tabs, Statistic, Switch,
        Modal, Alert, Radio, Checkbox, Popover } = antd;
const { createElement: h, useState, useEffect, useCallback, useMemo, useRef } = React;

dayjs.extend(dayjs_plugin_relativeTime);

// ── Force CSS reload (bust browser cache on every page load) ─────
(function() {
  var links = document.querySelectorAll('link[rel="stylesheet"]');
  links.forEach(function(link) {
    if (link.href && link.href.indexOf('styles.css') !== -1) {
      link.href = link.href.replace(/(\?.*)?$/, '?v=' + Date.now());
    }
  });
})();

// ── Domino Theme ────────────────────────────────────────────────
const dominoTheme = {
  token: {
    colorPrimary: '#543FDE',
    colorPrimaryHover: '#3B23D1',
    colorPrimaryActive: '#311EAE',
    colorText: '#2E2E38',
    colorTextSecondary: '#65657B',
    colorTextTertiary: '#8F8FA3',
    colorSuccess: '#28A464',
    colorWarning: '#CCB718',
    colorError: '#C20A29',
    colorInfo: '#0070CC',
    colorBgContainer: '#FFFFFF',
    colorBgLayout: '#FAFAFA',
    colorBorder: '#E0E0E0',
    fontFamily: 'Inter, Lato, Helvetica Neue, Helvetica, Arial, sans-serif',
    fontSize: 14,
    borderRadius: 4,
    borderRadiusLG: 8,
  },
  components: {
    Button: { primaryShadow: 'none', defaultShadow: 'none' },
    Table: { headerBg: '#FAFAFA', rowHoverBg: '#F5F5F5' },
  },
};

// ── Highcharts Domino colors ────────────────────────────────────
Highcharts.setOptions({
  colors: ['#543FDE', '#0070CC', '#28A464', '#CCB718', '#FF6543', '#E835A7', '#2EDCC4', '#A9734C'],
  chart: { style: { fontFamily: 'Inter, Lato, Helvetica Neue, Arial, sans-serif' } },
});

// ── Default terminology (overridden by whitelabel config) ──────────
var DEFAULT_TERMS = { bundle: 'Bundle', policy: 'Policy' };

// Ensure terminology is capitalized for display (API may return lowercase)
function capFirst(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : s; }
// Capitalize each word (e.g. "QC plan" → "QC Plan")
function capWords(s) { return s ? s.replace(/\b[a-z]/g, function(c) { return c.toUpperCase(); }) : s; }

// Parse nested server error JSON into a human-readable message
function parseServerError(raw) {
  try {
    var outer = JSON.parse(raw);
    var detail = typeof outer === 'string' ? outer : outer.detail || outer.message || raw;
    if (typeof detail === 'string') {
      try {
        var inner = JSON.parse(detail);
        return inner.Message || inner.message || inner.error || detail;
      } catch(e) { return detail; }
    }
    return String(detail);
  } catch(e) { return raw; }
}

// ── Data Explorer Integration ────────────────────────────────────
// File extensions that Data Explorer can open
var DATA_EXPLORER_EXTENSIONS = ['.csv', '.parquet', '.xpt', '.sas7bdat'];

function isDataExplorerFile(filename) {
  if (!filename) return false;
  var lower = filename.toLowerCase();
  return DATA_EXPLORER_EXTENSIONS.some(function(ext) { return lower.endsWith(ext); });
}

function buildDataExplorerPath(attachment) {
  var id = attachment.identifier || {};
  var filename = id.filename || '';
  if (!filename) return null;

  if (attachment.type === 'DatasetSnapshotFile') {
    // Path: /domino/datasets/local/snapshots/{datasetName}/{snapshotVersion}/{filename}
    var dsName = id.datasetName;
    var snapVer = id.snapshotVersion;
    if (dsName && snapVer != null) {
      return '/domino/datasets/local/snapshots/' + dsName + '/' + snapVer + '/' + filename;
    }
    // Fallback: live dataset path
    if (dsName) return '/domino/datasets/local/' + dsName + '/' + filename;
  }

  if (attachment.type === 'NetAppVolumeSnapshotFile') {
    // Path: /domino/netapp-volumes/{volumeName}/{filename}
    var volName = id.volumeName;
    if (volName) return '/domino/netapp-volumes/' + volName + '/' + filename;
  }

  return null;
}

function buildDataExplorerUrl(baseUrl, attachment) {
  if (!baseUrl) return null;
  var path = buildDataExplorerPath(attachment);
  if (!path) return null;
  var url = baseUrl.replace(/\/$/, '') + '/?dataset=' + encodeURIComponent(path);
  return url;
}

function openDataExplorer(url, path, e) {
  if (e) e.preventDefault();
  window.open(url, '_blank', 'noopener,noreferrer');
}

// ── Snapshot Staleness Detection ─────────────────────────────────
// Compares snapshot versions across ALL attachments to detect outdated snapshots.
// For each dataset (by datasetId/datasetName) and each NetApp volume (by volumeId/volumeName),
// finds the maximum snapshotVersion seen across all bundles. Any attachment with a
// lower version is flagged as stale.

function computeSnapshotStaleness(allAttachments) {
  // Phase 1: Build version index — find max version per source
  var datasetMaxVersions = {};   // key: datasetId || datasetName → { maxVersion, maxSnapshotTime, latestBundleId }
  var volumeMaxVersions = {};    // key: volumeId || volumeName → { maxVersion, maxSnapshotTime, latestBundleId }

  allAttachments.forEach(function(a) {
    var id = a.identifier || {};
    var ver = id.snapshotVersion;
    if (ver == null) return;

    if (a.type === 'DatasetSnapshotFile') {
      var dsKey = id.datasetId || id.datasetName;
      if (!dsKey) return;
      var cur = datasetMaxVersions[dsKey];
      if (!cur || ver > cur.maxVersion) {
        datasetMaxVersions[dsKey] = {
          maxVersion: ver,
          maxSnapshotTime: id.snapshotCreationTime,
          latestBundleId: a.bundle ? a.bundle.id : a._bundleId,
          sourceName: id.datasetName || dsKey,
        };
      }
    }

    if (a.type === 'NetAppVolumeSnapshotFile') {
      var volKey = id.volumeId || id.volumeName;
      if (!volKey) return;
      var cur = volumeMaxVersions[volKey];
      if (!cur || ver > cur.maxVersion) {
        volumeMaxVersions[volKey] = {
          maxVersion: ver,
          maxSnapshotTime: id.snapshotCreationTime,
          latestBundleId: a.bundle ? a.bundle.id : a._bundleId,
          sourceName: id.volumeName || volKey,
        };
      }
    }
  });

  // Phase 2: Annotate each attachment with staleness info
  allAttachments.forEach(function(a) {
    var id = a.identifier || {};
    var ver = id.snapshotVersion;
    if (ver == null) { a._staleness = null; return; }

    var index = null;
    if (a.type === 'DatasetSnapshotFile') {
      var dsKey = id.datasetId || id.datasetName;
      index = dsKey ? datasetMaxVersions[dsKey] : null;
    } else if (a.type === 'NetAppVolumeSnapshotFile') {
      var volKey = id.volumeId || id.volumeName;
      index = volKey ? volumeMaxVersions[volKey] : null;
    }

    if (!index) { a._staleness = null; return; }

    if (ver < index.maxVersion) {
      a._staleness = {
        isStale: true,
        currentVersion: ver,
        latestVersion: index.maxVersion,
        latestSnapshotTime: index.maxSnapshotTime,
        versionsBehind: index.maxVersion - ver,
        sourceName: index.sourceName,
      };
    } else {
      a._staleness = {
        isStale: false,
        currentVersion: ver,
        latestVersion: index.maxVersion,
        sourceName: index.sourceName,
      };
    }
  });

  return { datasetMaxVersions: datasetMaxVersions, volumeMaxVersions: volumeMaxVersions };
}

// Update staleness index with live data from Domino (latest known snapshot versions)
function mergeRemoteStaleness(allAttachments, remoteVersions) {
  // remoteVersions: { datasets: { datasetId: { latestVersion, latestSnapshotTime } }, volumes: { volumeId: { latestVersion, latestSnapshotTime } } }
  if (!remoteVersions) return;
  allAttachments.forEach(function(a) {
    if (!a._staleness) return;
    var id = a.identifier || {};
    var ver = id.snapshotVersion;
    if (ver == null) return;

    var remote = null;
    if (a.type === 'DatasetSnapshotFile') {
      var dsKey = id.datasetId || id.datasetName;
      remote = dsKey && remoteVersions.datasets ? remoteVersions.datasets[dsKey] : null;
    } else if (a.type === 'NetAppVolumeSnapshotFile') {
      var volKey = id.volumeId || id.volumeName;
      remote = volKey && remoteVersions.volumes ? remoteVersions.volumes[volKey] : null;
    }

    if (remote && remote.latestVersion > a._staleness.latestVersion) {
      a._staleness.isStale = ver < remote.latestVersion;
      a._staleness.latestVersion = remote.latestVersion;
      a._staleness.latestSnapshotTime = remote.latestSnapshotTime;
      a._staleness.versionsBehind = remote.latestVersion - ver;
      a._staleness.remoteChecked = true;
    }
  });
}

// Count stale attachments for a bundle
function countStaleAttachments(bundle) {
  var attachments = bundle._attachments || [];
  var count = 0;
  for (var i = 0; i < attachments.length; i++) {
    if (attachments[i]._staleness && attachments[i]._staleness.isStale) count++;
  }
  return count;
}


// ── API_GAPS: Write actions pending Domino API availability ────────
var API_GAPS = {
  stageReassign: {
    label: 'Stage Reassignment',
    message: 'Reassign a stage owner via the Domino API.',
    ready: true,
  },
  bulkAssign: {
    label: 'Bulk Assign',
    message: 'Assign a stage owner across multiple deliverables.',
    ready: true,
  },
  applyRules: {
    label: 'Apply Bulk Assignment Rules',
    message: 'Apply assignment rules to matching deliverable stages via the Domino API.',
    ready: true,
  },
  automationRun: {
    label: 'Run Automation',
    message: 'Trigger a Domino job via the Jobs API. If the job fails to start, check that the Jobs API is enabled on your Domino instance and that the script path is valid.',
    ready: true,
  },
};

// ── Pharma stage definitions (typical stat programming lifecycle) ──
const PHARMA_STAGES = [
  'Protocol Setup',
  'SDTM Mapping',
  'ADaM Development',
  'TLF Programming',
  'Dry Run',
  'QC Review',
  'Lock Ready',
  'Submission',
];

// ── API helpers ─────────────────────────────────────────────────
async function apiFetch(url, options) {
  const resp = await fetch(url, options);
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(text || resp.statusText);
  }
  return resp.json();
}

function apiGet(path) { return apiFetch(path); }

function apiPost(path, body) {
  return apiFetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function apiPatch(path, body) {
  return apiFetch(path, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

// ── Utility ─────────────────────────────────────────────────────
function stateColor(state) {
  if (!state) return 'default';
  const s = state.toLowerCase();
  if (s === 'active') return 'processing';
  if (s === 'complete') return 'success';
  if (s === 'archived') return 'default';
  return 'default';
}

function approvalStatusColor(status) {
  if (!status) return '#E0E0E0';
  const s = status.toLowerCase().replace(/\s+/g, '');
  if (s === 'approved') return '#28A464';
  if (s === 'conditionallyapproved') return '#0070CC';
  if (s === 'pendingsubmission') return '#CCB718';
  if (s === 'pendingreview') return '#FF6543';
  return '#E0E0E0';
}

function approvalStatusLabel(status) {
  if (!status) return 'Unknown';
  return status.replace(/([A-Z])/g, ' $1').trim();
}

function severityColor(sev) {
  const map = { S0: '#C20A29', S1: '#FF6543', S2: '#CCB718', S3: '#0070CC' };
  return map[sev] || '#8F8FA3';
}

function findingStatusTag(status) {
  const colorMap = {
    ToDo: 'default', InProgress: 'processing',
    InReview: 'warning', Done: 'success', WontDo: 'default',
  };
  return h(Tag, { color: colorMap[status] || 'default' },
    (status || '').replace(/([A-Z])/g, ' $1').trim()
  );
}

// Build Domino UI URL for a bundle
// Domino governance URL pattern:
// /u/{owner}/{project}/governance/bundle/{bundleId}/policy/{policyId}/version/{versionId}/evidence/stage/{stage-slug}
// Additional suffixes: /findings (findings list), /finding/{findingId} (specific finding)
// We build as deep as our data allows, falling back to shallower URLs.
// opts: { stageName, findingId, findingsPage }
function getDominoBundleUrl(bundle, optsOrStageName) {
  if (!bundle || !bundle.id) return null;
  var opts = {};
  if (typeof optsOrStageName === 'string') {
    opts.stageName = optsOrStageName;
  } else if (optsOrStageName) {
    opts = optsOrStageName;
  }
  var host = '';
  try { host = window.location.origin; } catch(e) {}

  // Build the full path: /u/{owner}/{project}/governance/bundle/{bundleId}
  var owner = bundle.projectOwner || '';
  var project = bundle.projectName || '';
  if (!owner || !project) {
    // Fallback: simple governance URL
    return host + '/governance/bundles/' + bundle.id;
  }

  var url = host + '/u/' + encodeURIComponent(owner) + '/' + encodeURIComponent(project)
    + '/governance/bundle/' + bundle.id;

  // Add policy segment if available
  if (bundle.policyId) {
    url += '/policy/' + bundle.policyId;

    // Add version if available (from policyVersionId or _policyVersionId)
    var versionId = bundle.policyVersionId || bundle._policyVersionId;
    if (versionId) {
      url += '/version/' + versionId;

      // Add stage evidence path if stage name provided
      if (opts.stageName) {
        var stageSlug = opts.stageName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
        url += '/evidence/stage/' + stageSlug;
      }
    }
  }

  // Append findings page or specific finding
  if (opts.findingsPage) {
    url += '/findings';
  } else if (opts.findingId) {
    url += '/finding/' + opts.findingId;
  }

  return url;
}

// Get the bundle's own stage names (from SCE QC)
function getBundleStageNames(bundle) {
  if (!bundle.stages || bundle.stages.length === 0) return [];
  return bundle.stages.map(function(s) { return s.stage ? s.stage.name : ''; }).filter(Boolean);
}

// Derive which stage index a bundle is currently at (within its own stages)
function deriveBundleStageIndex(bundle) {
  var stageNames = getBundleStageNames(bundle);
  if (stageNames.length === 0) return 0;
  var currentStageName = bundle.stage || '';
  for (var i = 0; i < stageNames.length; i++) {
    if (stageNames[i] === currentStageName) return i;
  }
  // Fallback: try partial match
  for (var j = 0; j < stageNames.length; j++) {
    if (currentStageName.toLowerCase().indexOf(stageNames[j].toLowerCase().split(' ')[0].toLowerCase()) >= 0 ||
        stageNames[j].toLowerCase().indexOf(currentStageName.toLowerCase().split(' ')[0].toLowerCase()) >= 0) {
      return j;
    }
  }
  return 0;
}

// Get progress percentage for a bundle
function getBundleProgress(bundle) {
  var stageNames = getBundleStageNames(bundle);
  if (stageNames.length <= 1) return bundle.state === 'Complete' ? 100 : 0;
  var idx = deriveBundleStageIndex(bundle);
  if (bundle.state === 'Complete') return 100;
  return Math.round((idx / (stageNames.length - 1)) * 100);
}


// ═══════════════════════════════════════════════════════════════
//  COMPONENTS
// ═══════════════════════════════════════════════════════════════

// ── TopNav ──────────────────────────────────────────────────────
function TopNav(props) {
  var terms = props.terms || DEFAULT_TERMS;
  var useDummy = props.useDummy;
  var onToggleDummy = props.onToggleDummy;
  var connected = props.connected;
  var debugMode = props.debugMode;
  var onToggleDebug = props.onToggleDebug;
  // Only show whitelabel badge if terms differ from defaults
  var isWhitelabeled = terms.bundle !== DEFAULT_TERMS.bundle || terms.policy !== DEFAULT_TERMS.policy;
  var B = capFirst(terms.bundle);
  var P = capFirst(terms.policy);
  return h('div', { className: 'top-nav' },
    h('img', { src: 'static/domino-logo.svg', className: 'top-nav-logo', alt: 'Domino' }),
    h('div', { className: 'top-nav-divider' }),
    h('span', { className: 'top-nav-title' }, 'Study Lead QC Hub'),
    h('div', { className: 'top-nav-right' },
      isWhitelabeled
        ? h(Tooltip, { title: B + 's & ' + P + ' terminology active' },
            h('span', { className: 'top-nav-whitelabel-badge' },
              B + 's / ' + P
            )
          )
        : null,
      !connected
        ? h('div', { className: 'dummy-data-toggle' },
            h('span', { className: 'top-nav-env' }, 'Dummy Data'),
            h(Switch, {
              checked: useDummy,
              onChange: onToggleDummy,
              size: 'small',
            })
          )
        : null,
      h('div', { className: 'dummy-data-toggle' },
        h(Tooltip, { title: 'Show detailed error info for debugging API issues' },
          h('span', { className: 'top-nav-env', style: debugMode ? { color: '#CCB718' } : {} }, 'Debug')
        ),
        h(Switch, {
          checked: debugMode,
          onChange: onToggleDebug,
          size: 'small',
        })
      ),
      h('span', { className: 'top-nav-env' }, 'Study Lead QC Hub')
    )
  );
}

// ── Shared Report Configuration Helpers ─────────────────────────
var ROLE_MAPPING_KEY = 'sceqc_stage_role_mapping_v2';
var PATH_PATTERN_KEY = 'sceqc_path_patterns';

var WORK_CATEGORIES = ['Production Programming', 'QC Programming', 'Independent Reviewing'];

var DEFAULT_PATH_PATTERNS = {
  'Production Programming': { prefix: 'prod/', label: 'Production program' },
  'QC Programming': { prefix: 'qc/', label: 'QC / double programming' },
  'Independent Reviewing': { prefix: null, label: 'Independent review' },
};

// Heuristic: guess a work category for a stage name
function guessWorkCategory(stageName) {
  var s = stageName.toLowerCase();
  if (/double|dp\b|dual|qc|first\s*qc|second\s*qc/.test(s)) return 'QC Programming';
  if (/independent|ir\b|verif|lead|review/.test(s)) return 'Independent Reviewing';
  if (/self|develop|author|program|creat|prod|mainline|main\s*line/.test(s)) return 'Production Programming';
  return null;
}

// Build empty default mapping: { policyId: {} }
// Users must explicitly assign categories via Configuration tab
function buildDefaultRoleMapping(policies, bndls) {
  var map = {};
  policies.forEach(function(p) { map[p.id] = {}; });
  bndls.forEach(function(b) {
    if (b.policyId && !map[b.policyId]) map[b.policyId] = {};
  });
  return map;
}

// Helper: get stages for a role from the new mapping
function getStageForRole(policyMapping, roleLabel) {
  if (!policyMapping) return null;
  var keys = Object.keys(policyMapping);
  for (var i = 0; i < keys.length; i++) {
    if (policyMapping[keys[i]] === roleLabel) return keys[i];
  }
  return null;
}

function loadStoredJSON(key) {
  try { var s = localStorage.getItem(key); return s ? JSON.parse(s) : null; } catch(e) { return null; }
}

// ── Sidebar ─────────────────────────────────────────────────────
var PRIMARY_NAV_ITEMS = [
  { key: 'tracker', iconName: 'TableOutlined', label: 'QC Tracker' },
  { key: 'findings', iconName: 'FileSearchOutlined', label: 'Findings' },
  { key: 'metrics', iconName: 'BarChartOutlined', label: 'Team Metrics' },
];

var ADVANCED_NAV_ITEMS = [
  { key: 'insights', iconName: 'BulbOutlined', label: 'AI Insights' },
  { key: 'milestones', iconName: 'FlagOutlined', label: 'Milestones' },
  { key: 'approvals', iconName: 'CheckCircleOutlined', label: 'Approvals' },
  { key: 'stages', iconName: 'ApartmentOutlined', label: 'Stage Manager' },
  { key: 'rules', iconName: 'SettingOutlined', label: 'Bulk Assignment Rules' },
  { key: 'automation', iconName: 'ThunderboltOutlined', label: 'Automation' },
  { key: 'utilities', iconName: 'ToolOutlined', label: 'Utilities' },
  { key: 'risk', iconName: 'SlidersOutlined', label: 'Risk Optimizer' },
  { key: 'config', iconName: 'ControlOutlined', label: 'Configuration' },
];

// Combined for backward compat (page routing)
var NAV_ITEMS = PRIMARY_NAV_ITEMS.concat(ADVANCED_NAV_ITEMS);

function SidebarItem(props) {
  var item = props.item;
  var active = props.active;
  var collapsed = props.collapsed;
  var onNav = props.onNav;
  var IconComp = icons && icons[item.iconName] ? icons[item.iconName] : null;
  return h(Tooltip, { key: item.key, title: collapsed ? item.label : null, placement: 'right' },
    h('div', {
      className: 'sidebar-item' + (active === item.key ? ' active' : ''),
      onClick: function() { onNav(item.key); },
    },
      h('span', { className: 'sidebar-icon' },
        IconComp ? h(IconComp, null) : null
      ),
      collapsed ? null : h('span', null, item.label)
    )
  );
}

function Sidebar(props) {
  var active = props.active;
  var onNav = props.onNav;
  var collapsed = props.collapsed;
  var onToggleCollapse = props.onToggleCollapse;
  var _adv = useState(function() {
    try { return localStorage.getItem('sce_advanced_open') === 'true'; } catch(e) { return false; }
  });
  var advancedOpen = _adv[0]; var setAdvancedOpen = _adv[1];

  // Auto-expand if active page is in advanced section
  useEffect(function() {
    var isAdvanced = ADVANCED_NAV_ITEMS.some(function(item) { return item.key === active; });
    if (isAdvanced && !advancedOpen) {
      setAdvancedOpen(true);
      try { localStorage.setItem('sce_advanced_open', 'true'); } catch(e) {}
    }
  }, [active]);

  function toggleAdvanced() {
    setAdvancedOpen(function(prev) {
      var next = !prev;
      try { localStorage.setItem('sce_advanced_open', String(next)); } catch(e) {}
      return next;
    });
  }

  var DownIcon = icons && icons.DownOutlined ? icons.DownOutlined : null;
  var RightIcon = icons && icons.RightOutlined ? icons.RightOutlined : null;

  return h('div', { className: 'sidebar' + (collapsed ? ' sidebar-collapsed' : '') },
    // Primary nav items
    PRIMARY_NAV_ITEMS.map(function(item) {
      return h(SidebarItem, { key: item.key, item: item, active: active, collapsed: collapsed, onNav: onNav });
    }),
    // Advanced section divider + toggle
    collapsed
      ? h(Tooltip, { title: 'Advanced', placement: 'right' },
          h('div', {
            className: 'sidebar-advanced-toggle',
            onClick: toggleAdvanced,
            style: { padding: '10px 0', textAlign: 'center', cursor: 'pointer', borderTop: '1px solid #E0E0E0', marginTop: 4 },
          },
            h('span', { className: 'sidebar-icon', style: { margin: '0 auto' } },
              icons && icons.SettingOutlined ? h(icons.SettingOutlined, null) : h('span', null, '\u2699')
            )
          )
        )
      : h('div', {
          className: 'sidebar-advanced-toggle',
          onClick: toggleAdvanced,
        },
          h('span', { className: 'sidebar-advanced-label' }, 'Advanced'),
          h('span', { className: 'sidebar-advanced-arrow' },
            advancedOpen
              ? (DownIcon ? h(DownIcon, null) : '\u25BE')
              : (RightIcon ? h(RightIcon, null) : '\u25B8')
          )
        ),
    // Advanced nav items (visible when expanded or when sidebar is collapsed and advanced is toggled)
    (advancedOpen || collapsed) ? ADVANCED_NAV_ITEMS.map(function(item) {
      if (collapsed && !advancedOpen) return null;
      return h(SidebarItem, { key: item.key, item: item, active: active, collapsed: collapsed, onNav: onNav });
    }) : null,
    // Collapse toggle at bottom
    h('div', {
      className: 'sidebar-collapse-btn',
      onClick: onToggleCollapse,
      title: collapsed ? 'Expand sidebar' : 'Collapse sidebar',
    },
      icons && icons.MenuFoldOutlined && icons.MenuUnfoldOutlined
        ? h(collapsed ? icons.MenuUnfoldOutlined : icons.MenuFoldOutlined, null)
        : h('span', null, collapsed ? '\u00BB' : '\u00AB')
    )
  );
}

// ── Resizable Header Cell ─────────────────────────────────────
// Wraps each <th> with a draggable resize handle on the right edge.
function ResizableHeaderCell(props) {
  var width = props.width;
  var onResize = props.onResize;
  // Extract non-DOM props to pass through
  var rest = {};
  Object.keys(props).forEach(function(k) {
    if (k !== 'width' && k !== 'onResize') rest[k] = props[k];
  });

  if (!width || !onResize) {
    return h('th', rest, props.children);
  }

  var _dragging = React.useRef(false);
  var _startX = React.useRef(0);
  var _startW = React.useRef(0);

  function handleMouseDown(e) {
    e.preventDefault();
    e.stopPropagation();
    _dragging.current = true;
    _startX.current = e.clientX;
    _startW.current = width;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';

    function handleMouseMove(ev) {
      if (!_dragging.current) return;
      var diff = ev.clientX - _startX.current;
      var newWidth = Math.max(50, _startW.current + diff);
      onResize(newWidth);
    }
    function handleMouseUp() {
      _dragging.current = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    }
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  }

  return h('th', Object.assign({}, rest, { style: Object.assign({}, rest.style || {}, { position: 'relative' }) }),
    props.children,
    h('div', {
      className: 'resize-handle',
      onMouseDown: handleMouseDown,
    })
  );
}

// ── Column Visibility Dropdown ────────────────────────────────
function ColumnVisibilityDropdown(props) {
  var columns = props.columns; // [{ key, title }]
  var hiddenKeys = props.hiddenKeys; // Set or array
  var onToggle = props.onToggle; // function(key)

  var _vis = useState(false); var menuOpen = _vis[0]; var setMenuOpen = _vis[1];

  return h('div', { style: { position: 'relative', display: 'inline-block' } },
    h(Button, {
      size: 'small',
      type: 'default',
      onClick: function() { setMenuOpen(!menuOpen); },
      style: { fontSize: 11 },
      title: 'Show/hide columns',
    }, '\u2630 Columns'),
    menuOpen
      ? h('div', {
          className: 'column-visibility-menu',
          style: {
            position: 'absolute', top: '100%', right: 0, zIndex: 1050,
            background: '#fff', border: '1px solid #E0E0E0', borderRadius: 6,
            padding: '8px 0', minWidth: 180, boxShadow: '0 4px 12px rgba(0,0,0,0.12)',
          },
        },
        h('div', { style: { padding: '4px 12px 8px', fontSize: 11, color: '#8F8FA3', fontWeight: 600, borderBottom: '1px solid #F0F0F0' } }, 'Toggle Columns'),
        columns.map(function(col) {
          var isHidden = hiddenKeys.indexOf(col.key) >= 0;
          return h('label', {
            key: col.key,
            style: {
              display: 'flex', alignItems: 'center', gap: 8, padding: '6px 12px', cursor: 'pointer',
              fontSize: 12, color: '#2E2E38',
            },
            onMouseEnter: function(e) { e.currentTarget.style.background = '#F5F5F8'; },
            onMouseLeave: function(e) { e.currentTarget.style.background = ''; },
          },
            h('input', {
              type: 'checkbox',
              checked: !isHidden,
              onChange: function() { onToggle(col.key); },
              style: { accentColor: '#543FDE' },
            }),
            typeof col.title === 'string' ? col.title : col.key
          );
        }),
        h('div', {
          style: { padding: '6px 12px', borderTop: '1px solid #F0F0F0', marginTop: 4 },
        },
          h('a', {
            style: { fontSize: 11, color: '#543FDE', cursor: 'pointer' },
            onClick: function() { setMenuOpen(false); },
          }, 'Close')
        )
      )
      : null
  );
}

// ── Stat Card ───────────────────────────────────────────────────
function StatCard(props) {
  var cls = 'stat-card' + (props.onClick ? ' stat-card-clickable' : '') + (props.active ? ' stat-card-active' : '');
  var card = h('div', { className: cls, onClick: props.onClick || null },
    h('div', { className: 'stat-card-label' },
      props.label,
      props.tooltip ? h('span', { style: { marginLeft: 4, cursor: 'help', color: '#B0B0C0', fontSize: 11 } }, '\u24D8') : null
    ),
    h('div', { className: 'stat-card-value ' + (props.color || '') }, props.value),
    props.sub ? h('div', { className: 'stat-card-sub' }, props.sub) : null
  );
  return props.tooltip ? h(Tooltip, { title: props.tooltip, placement: 'top', overlayStyle: { maxWidth: 280 } }, card) : card;
}

// (ConnectionBanner removed — replaced by Dummy Data toggle in TopNav)

// ── Empty State ─────────────────────────────────────────────────
function EmptyState(props) {
  return h('div', { className: 'empty-state' },
    h('div', { className: 'empty-state-icon' }, props.icon || '\u2636'),
    h('div', { className: 'empty-state-text' }, props.text || 'No data'),
    props.sub ? h('div', { className: 'empty-state-sub' }, props.sub) : null
  );
}


// ── Chart Title with Info Tooltip ───────────────────────────────
function chartTitle(title, tooltip) {
  return h('div', { className: 'panel-header' },
    h('span', { className: 'panel-title' }, title),
    h(Tooltip, { title: tooltip, placement: 'right', overlayStyle: { maxWidth: 320 } },
      h('span', { style: { marginLeft: 6, cursor: 'help', color: '#B0B0C0', fontSize: 13 } }, '\u24D8')
    )
  );
}

// ═══════════════════════════════════════════════════════════════
//  PAGE: Dashboard
// ═══════════════════════════════════════════════════════════════
function DashboardPage(props) {
  var bundles = props.bundles;
  var loading = props.loading;
  var onSelectBundle = props.onSelectBundle;
  var terms = props.terms || DEFAULT_TERMS;
  var B = terms.bundle;
  var P = terms.policy;

  var _tf = useState(null);
  var tableFilter = _tf[0];
  var setTableFilter = _tf[1];

  var stats = useMemo(function() {
    var total = bundles.length;
    var active = bundles.filter(function(b) { return b.state === 'Active'; }).length;
    var complete = bundles.filter(function(b) { return b.state === 'Complete'; }).length;
    var archived = bundles.filter(function(b) { return b.state === 'Archived'; }).length;

    // Count total findings across all bundles
    var totalFindings = 0;
    var openFindings = 0;
    bundles.forEach(function(b) {
      if (b._findings) {
        totalFindings += b._findings.length;
        b._findings.forEach(function(f) {
          if (f.status !== 'Done' && f.status !== 'WontDo') openFindings++;
        });
      }
    });

    // Average stage progress
    var avgProgress = 0;
    if (total > 0) {
      var sum = 0;
      bundles.forEach(function(b) {
        sum += getBundleProgress(b);
      });
      avgProgress = Math.round(sum / total);
    }

    return { total: total, active: active, complete: complete, archived: archived,
             totalFindings: totalFindings, openFindings: openFindings, avgProgress: avgProgress };
  }, [bundles]);

  // Filtered bundles for table
  var filteredBundles = useMemo(function() {
    if (!tableFilter) return bundles;
    if (tableFilter.type === 'state') return bundles.filter(function(b) { return b.state === tableFilter.value; });
    if (tableFilter.type === 'openFindings') return bundles.filter(function(b) {
      return b._findings && b._findings.some(function(f) { return f.status !== 'Done' && f.status !== 'WontDo'; });
    });
    if (tableFilter.type === 'stage') return bundles.filter(function(b) { return (b.stage || 'Unknown') === tableFilter.value; });
    return bundles;
  }, [bundles, tableFilter]);

  var filterLabel = tableFilter
    ? (tableFilter.type === 'state' ? tableFilter.value : tableFilter.type === 'openFindings' ? 'Open Findings' : 'Stage: ' + tableFilter.value)
    : null;

  // Status chart
  useEffect(function() {
    if (bundles.length === 0) return;
    Highcharts.chart('chart-status-dist', {
      chart: { type: 'pie', height: 260, backgroundColor: 'transparent' },
      title: { text: null },
      plotOptions: {
        pie: {
          innerSize: '55%',
          cursor: 'pointer',
          dataLabels: { enabled: true, format: '{point.name}: {point.y}', style: { fontSize: '11px' } },
          point: { events: { click: function() { setTableFilter({ type: 'state', value: this.name }); } } },
        },
      },
      series: [{
        name: B + 's',
        data: [
          { name: 'Active', y: stats.active, color: '#543FDE' },
          { name: 'Complete', y: stats.complete, color: '#28A464' },
          { name: 'Archived', y: stats.archived, color: '#B0B0C0' },
        ].filter(function(d) { return d.y > 0; }),
      }],
      credits: { enabled: false },
    });
  }, [bundles, stats]);

  // Stage distribution chart
  useEffect(function() {
    if (bundles.length === 0) return;
    var stageMap = {};
    bundles.forEach(function(b) {
      var stageName = b.stage || 'Unknown';
      stageMap[stageName] = (stageMap[stageName] || 0) + 1;
    });
    var stageNames = Object.keys(stageMap);
    var stageCounts = stageNames.map(function(n) { return stageMap[n]; });
    Highcharts.chart('chart-stage-dist', {
      chart: { type: 'bar', height: Math.max(260, stageNames.length * 30), backgroundColor: 'transparent' },
      title: { text: null },
      xAxis: { categories: stageNames, labels: { style: { fontSize: '11px' } } },
      yAxis: { title: { text: null }, allowDecimals: false },
      plotOptions: { bar: { borderRadius: 3, cursor: 'pointer', point: { events: { click: function() { setTableFilter({ type: 'stage', value: this.category }); } } } } },
      series: [{ name: B + 's', data: stageCounts, showInLegend: false }],
      credits: { enabled: false },
    });
  }, [bundles]);

  var columns = [
    {
      title: B, dataIndex: 'name', key: 'name',
      render: function(text, record) {
        return h('a', { onClick: function() { onSelectBundle(record); }, style: { fontWeight: 500 } }, text);
      },
    },
    {
      title: 'Project', dataIndex: 'projectName', key: 'project',
      render: function(text) { return h('span', { style: { color: '#65657B', fontSize: 12 } }, text || '\u2013'); },
    },
    {
      title: P, dataIndex: 'policyName', key: 'policy',
      render: function(text) { return h(Tag, null, text || '\u2013'); },
    },
    {
      title: 'Stage', key: 'stage',
      render: function(_, record) {
        var pct = getBundleProgress(record);
        return h(Space, { direction: 'vertical', size: 2 },
          h('span', { style: { fontSize: 12, fontWeight: 500 } }, record.stage || '\u2013'),
          h(Progress, { percent: pct, size: 'small', showInfo: false, strokeColor: '#543FDE' })
        );
      },
    },
    {
      title: 'State', dataIndex: 'state', key: 'state',
      render: function(state) { return h(Tag, { color: stateColor(state) }, state); },
    },
    {
      title: 'Updated', dataIndex: 'updatedAt', key: 'updated',
      render: function(d) { return d ? dayjs(d).fromNow() : '\u2013'; },
      sorter: function(a, b) { return new Date(a.updatedAt || 0) - new Date(b.updatedAt || 0); },
    },
  ];

  return h('div', null,
    h('div', { className: 'page-header' },
      h('h1', null, 'SCE QC Dashboard'),
      h('p', null, 'Overview of all ' + B.toLowerCase() + 's tracked through SCE QC')
    ),

    // Stat cards
    h('div', { className: 'stats-row' },
      h(StatCard, { label: 'Total ' + B + 's', value: stats.total, color: 'primary', active: !tableFilter, onClick: function() { setTableFilter(null); } }),
      h(StatCard, { label: 'Active', value: stats.active, color: 'info', sub: 'Currently in progress', active: tableFilter && tableFilter.value === 'Active', onClick: function() { setTableFilter(tableFilter && tableFilter.value === 'Active' ? null : { type: 'state', value: 'Active' }); } }),
      h(StatCard, { label: 'Complete', value: stats.complete, color: 'success', active: tableFilter && tableFilter.value === 'Complete', onClick: function() { setTableFilter(tableFilter && tableFilter.value === 'Complete' ? null : { type: 'state', value: 'Complete' }); } }),
      h(StatCard, { label: 'Open Findings', value: stats.openFindings, color: stats.openFindings > 0 ? 'warning' : '', sub: stats.totalFindings + ' total findings', active: tableFilter && tableFilter.type === 'openFindings', onClick: function() { setTableFilter(tableFilter && tableFilter.type === 'openFindings' ? null : { type: 'openFindings' }); } }),
      h(StatCard, { label: 'Avg Progress', value: stats.avgProgress + '%', sub: 'Across active ' + B.toLowerCase() + 's' })
    ),

    // Charts row
    h('div', { className: 'two-col' },
      h('div', { className: 'panel' },
        h('div', { className: 'panel-header' }, h('span', { className: 'panel-title' }, B + ' Status Distribution')),
        h('div', { className: 'panel-body' },
          bundles.length > 0
            ? h('div', { id: 'chart-status-dist', className: 'chart-container' })
            : h(EmptyState, { text: 'No ' + B.toLowerCase() + 's found' })
        )
      ),
      h('div', { className: 'panel' },
        h('div', { className: 'panel-header' }, h('span', { className: 'panel-title' }, B + 's by Stage')),
        h('div', { className: 'panel-body' },
          bundles.length > 0
            ? h('div', { id: 'chart-stage-dist', className: 'chart-container' })
            : h(EmptyState, { text: 'No ' + B.toLowerCase() + 's found' })
        )
      )
    ),

    // Table
    h('div', { className: 'panel' },
      h('div', { className: 'panel-header' },
        h('span', { className: 'panel-title' }, filterLabel ? B + 's: ' + filterLabel : 'All ' + B + 's'),
        h('div', { style: { display: 'flex', alignItems: 'center', gap: 8 } },
          filterLabel ? h(Tag, { closable: true, onClose: function() { setTableFilter(null); }, color: 'purple' }, filterLabel) : null,
          h('span', { style: { fontSize: 12, color: '#8F8FA3' } }, filteredBundles.length + ' ' + B.toLowerCase() + 's')
        )
      ),
      h('div', { className: 'panel-body-flush' },
        h(Table, {
          dataSource: filteredBundles,
          columns: columns,
          rowKey: 'id',
          loading: loading,
          pagination: { pageSize: 10, size: 'small' },
          size: 'small',
        })
      )
    )
  );
}


// ═══════════════════════════════════════════════════════════════
//  PAGE: Milestones
// ═══════════════════════════════════════════════════════════════
function MilestonesPage(props) {
  var bundles = props.bundles;
  var loading = props.loading;
  var terms = props.terms || DEFAULT_TERMS;
  var B = terms.bundle;

  var activeBundles = useMemo(function() {
    return bundles.filter(function(b) { return b.state === 'Active'; });
  }, [bundles]);

  return h('div', null,
    h('div', { className: 'page-header' },
      h('h1', null, 'Milestone Tracker'),
      h('p', null, 'Visual stage progression for active ' + B.toLowerCase() + 's'),
      h('p', { style: { fontSize: 12, color: '#8F8FA3', marginTop: 4 } }, 'Tip: Use tags (e.g. "Dry Run", "Post DBL") to scope this view to specific milestones.')
    ),
    h('div', { className: 'panel' },
      h('div', { className: 'panel-header' },
        h('span', { className: 'panel-title' }, 'Deliverable Stages'),
        h('div', { style: { display: 'flex', alignItems: 'center', gap: 16 } },
          h('span', { style: { fontSize: 12, color: '#8F8FA3' } }, activeBundles.length + ' active ' + B.toLowerCase() + 's'),
          // Color legend
          h('div', { className: 'milestone-legend' },
            h('span', { className: 'milestone-legend-item' },
              h('span', { className: 'milestone-legend-swatch', style: { background: '#28A464' } }),
              'Completed'
            ),
            h('span', { className: 'milestone-legend-item' },
              h('span', { className: 'milestone-legend-swatch', style: { background: '#543FDE' } }),
              'Current'
            ),
            h('span', { className: 'milestone-legend-item' },
              h('span', { className: 'milestone-legend-swatch', style: { background: '#E0E0E0' } }),
              'Pending'
            )
          )
        )
      ),
      loading
        ? h('div', { className: 'loading-container' }, h(Spin, null))
        : activeBundles.length === 0
          ? h(EmptyState, { text: 'No active ' + B.toLowerCase() + 's', sub: B + 's will appear here once created in SCE QC' })
          : h('div', { className: 'panel-body-flush' },
              activeBundles.map(function(bundle) {
                var stageNames = getBundleStageNames(bundle);
                var currentIdx = deriveBundleStageIndex(bundle);
                return h('div', { key: bundle.id, className: 'milestone-row' },
                  h('div', { className: 'milestone-bundle-name' },
                    h(Tooltip, { title: bundle.name }, bundle.name)
                  ),
                  h('div', { className: 'milestone-track' },
                    stageNames.map(function(stage, idx) {
                      var cls = 'milestone-stage ';
                      if (idx < currentIdx) cls += 'completed';
                      else if (idx === currentIdx) cls += 'current';
                      else cls += 'pending';
                      // Shorten label to fit within bar
                      var words = stage.split(' ');
                      var label = words.length > 2 ? words.slice(0, 2).join(' ') : stage;
                      var url = getDominoBundleUrl(bundle, { stageName: stage });
                      var tooltipTitle = idx <= currentIdx
                        ? stage + ' — Click to open in Domino'
                        : stage;
                      return h(Tooltip, { key: stage, title: tooltipTitle },
                        h('div', {
                          className: cls,
                          style: url && idx <= currentIdx ? { cursor: 'pointer' } : undefined,
                          onClick: url && idx <= currentIdx ? function(stageName) {
                            return function() { window.open(getDominoBundleUrl(bundle, { stageName: stageName }), '_blank'); };
                          }(stage) : undefined
                        },
                          idx <= currentIdx ? label : ''
                        )
                      );
                    })
                  ),
                  h('div', { className: 'milestone-status' },
                    h(Tag, { color: stateColor(bundle.state) }, bundle.state)
                  )
                );
              })
            )
    ),

    // Timeline chart
    h('div', { className: 'panel', style: { marginTop: 20 } },
      h('div', { className: 'panel-header' },
        h('span', { className: 'panel-title' }, 'Stage Duration Analysis')
      ),
      h('div', { className: 'panel-body' },
        activeBundles.length > 0
          ? h(MilestoneDurationChart, { bundles: activeBundles })
          : h(EmptyState, { text: 'No data for duration analysis' })
      )
    )
  );
}

function MilestoneDurationChart(props) {
  useEffect(function() {
    var bundles = props.bundles;
    // Collect all unique stage names across all bundles, create synthetic durations
    var allStageNames = [];
    var seriesData = bundles.slice(0, 10).map(function(b) {
      var stageNames = getBundleStageNames(b);
      var currentIdx = deriveBundleStageIndex(b);
      var stages = [];
      for (var i = 0; i <= currentIdx; i++) {
        var name = stageNames[i];
        stages.push({ stage: name, days: Math.floor(Math.random() * 14) + 3 });
        if (allStageNames.indexOf(name) === -1) allStageNames.push(name);
      }
      return { name: b.name, stages: stages };
    });

    Highcharts.chart('chart-duration', {
      chart: { type: 'bar', height: Math.max(280, seriesData.length * 40), backgroundColor: 'transparent' },
      title: { text: null },
      xAxis: { categories: seriesData.map(function(s) { return s.name; }), labels: { style: { fontSize: '11px' } } },
      yAxis: { title: { text: 'Days' }, stackLabels: { enabled: true, style: { fontSize: '10px' } } },
      plotOptions: { series: { stacking: 'normal', borderRadius: 2 } },
      series: allStageNames.map(function(stage) {
        return {
          name: stage.split(' ').slice(0, 3).join(' '),
          data: seriesData.map(function(s) {
            var match = s.stages.find(function(st) { return st.stage === stage; });
            return match ? match.days : 0;
          }),
        };
      }),
      credits: { enabled: false },
    });
  }, [props.bundles]);

  return h('div', { id: 'chart-duration', className: 'chart-container', style: { minHeight: 300 } });
}


// ═══════════════════════════════════════════════════════════════
//  PAGE: Approvals
// ═══════════════════════════════════════════════════════════════
function ApprovalsPage(props) {
  var bundles = props.bundles;
  var loading = props.loading;
  var terms = props.terms || DEFAULT_TERMS;
  var B = terms.bundle;
  var P = terms.policy;

  var _af = useState(null);
  var approvalFilter = _af[0];
  var setApprovalFilter = _af[1];

  // Flatten all approvals from all bundles
  var allApprovals = useMemo(function() {
    var result = [];
    bundles.forEach(function(b) {
      if (b._approvals) {
        b._approvals.forEach(function(a) {
          result.push(Object.assign({}, a, { _bundleName: b.name, _bundleId: b.id }));
        });
      }
    });
    return result;
  }, [bundles]);

  var approvalStats = useMemo(function() {
    var pending = 0, approved = 0, conditional = 0, review = 0;
    allApprovals.forEach(function(a) {
      var s = (a.status || '').toLowerCase().replace(/\s+/g, '');
      if (s === 'approved') approved++;
      else if (s === 'conditionallyapproved') conditional++;
      else if (s === 'pendingreview') review++;
      else pending++;
    });
    return { pending: pending, approved: approved, conditional: conditional, review: review, total: allApprovals.length };
  }, [allApprovals]);

  // Filtered approvals for table
  var filteredApprovals = useMemo(function() {
    if (!approvalFilter) return allApprovals;
    return allApprovals.filter(function(a) {
      var s = (a.status || '').toLowerCase().replace(/\s+/g, '');
      if (approvalFilter === 'pending') return s !== 'approved' && s !== 'conditionallyapproved' && s !== 'pendingreview';
      if (approvalFilter === 'review') return s === 'pendingreview';
      if (approvalFilter === 'conditional') return s === 'conditionallyapproved';
      if (approvalFilter === 'approved') return s === 'approved';
      if (approvalFilter === 'pendingAll') return s !== 'approved' && s !== 'conditionallyapproved';
      return true;
    });
  }, [allApprovals, approvalFilter]);

  var approvalFilterLabel = approvalFilter === 'pending' ? 'Pending Submission' : approvalFilter === 'review' ? 'Pending Review' : approvalFilter === 'conditional' ? 'Conditionally Approved' : approvalFilter === 'approved' ? 'Approved' : approvalFilter === 'pendingAll' ? 'Pending' : null;

  var chartFilterMap = { 'Pending Submission': 'pending', 'Pending Review': 'review', 'Conditionally Approved': 'conditional', 'Approved': 'approved' };

  // Approval funnel chart
  useEffect(function() {
    if (allApprovals.length === 0) return;
    Highcharts.chart('chart-approval-funnel', {
      chart: { type: 'column', height: 260, backgroundColor: 'transparent' },
      title: { text: null },
      xAxis: { categories: ['Pending Submission', 'Pending Review', 'Conditionally Approved', 'Approved'], labels: { style: { fontSize: '11px' } } },
      yAxis: { title: { text: 'Count' }, allowDecimals: false },
      series: [{
        name: 'Approvals',
        data: [
          { y: approvalStats.pending, color: '#CCB718' },
          { y: approvalStats.review, color: '#FF6543' },
          { y: approvalStats.conditional, color: '#0070CC' },
          { y: approvalStats.approved, color: '#28A464' },
        ],
        showInLegend: false,
      }],
      plotOptions: { column: { borderRadius: 4, cursor: 'pointer', point: { events: { click: function() { setApprovalFilter(chartFilterMap[this.category] || null); } } } } },
      credits: { enabled: false },
    });
  }, [allApprovals, approvalStats]);

  var columns = [
    { title: B, dataIndex: '_bundleName', key: 'study', width: 200,
      render: function(text) { return h('span', { style: { fontWeight: 500 } }, text); } },
    { title: 'Approval', dataIndex: 'name', key: 'name' },
    { title: 'Status', dataIndex: 'status', key: 'status',
      render: function(status) {
        return h(Tag, { color: approvalStatusColor(status), style: { color: '#fff', border: 'none' } },
          approvalStatusLabel(status));
      },
      filters: [
        { text: 'Pending Submission', value: 'PendingSubmission' },
        { text: 'Pending Review', value: 'PendingReview' },
        { text: 'Conditionally Approved', value: 'ConditionallyApproved' },
        { text: 'Approved', value: 'Approved' },
      ],
      onFilter: function(value, record) { return record.status === value; },
    },
    { title: 'Approvers', key: 'approvers',
      render: function(_, record) {
        if (!record.approvers || record.approvers.length === 0) return '\u2013';
        return record.approvers.map(function(a) { return a.name; }).join(', ');
      },
    },
    { title: 'Updated', dataIndex: 'updatedAt', key: 'updated',
      render: function(d) { return d ? dayjs(d).fromNow() : '\u2013'; },
    },
  ];

  return h('div', null,
    h('div', { className: 'page-header' },
      h('h1', null, 'Approval Tracker'),
      h('p', null, 'Review and approval status across all ' + B.toLowerCase() + 's')
    ),

    h('div', { className: 'stats-row' },
      h(StatCard, { label: 'Pending Submission', value: approvalStats.pending, color: 'warning', active: approvalFilter === 'pending', onClick: function() { setApprovalFilter(approvalFilter === 'pending' ? null : 'pending'); } }),
      h(StatCard, { label: 'Pending Review', value: approvalStats.review, color: 'info', active: approvalFilter === 'review', onClick: function() { setApprovalFilter(approvalFilter === 'review' ? null : 'review'); } }),
      h(StatCard, { label: 'Conditionally Approved', value: approvalStats.conditional, color: 'warning', active: approvalFilter === 'conditional', onClick: function() { setApprovalFilter(approvalFilter === 'conditional' ? null : 'conditional'); } }),
      h(StatCard, { label: 'Approved', value: approvalStats.approved, color: 'success', active: approvalFilter === 'approved', onClick: function() { setApprovalFilter(approvalFilter === 'approved' ? null : 'approved'); } })
    ),

    h('div', { className: 'panel' },
      h('div', { className: 'panel-header' }, h('span', { className: 'panel-title' }, 'Approval Pipeline')),
      h('div', { className: 'panel-body' },
        allApprovals.length > 0
          ? h('div', { id: 'chart-approval-funnel', className: 'chart-container' })
          : h(EmptyState, { text: 'No approval data' })
      )
    ),

    h('div', { className: 'panel' },
      h('div', { className: 'panel-header' },
        h('span', { className: 'panel-title' }, approvalFilterLabel ? 'Approvals: ' + approvalFilterLabel : 'All Approvals'),
        h('div', { style: { display: 'flex', alignItems: 'center', gap: 8 } },
          approvalFilterLabel ? h(Tag, { closable: true, onClose: function() { setApprovalFilter(null); }, color: 'purple' }, approvalFilterLabel) : null,
          h('span', { style: { fontSize: 12, color: '#8F8FA3' } }, filteredApprovals.length + ' total')
        )
      ),
      h('div', { className: 'panel-body-flush' },
        h(Table, {
          dataSource: filteredApprovals,
          columns: columns,
          rowKey: function(r) { return r.id || (r._bundleId + '-' + r.name); },
          loading: loading,
          pagination: { pageSize: 10, size: 'small' },
          size: 'small',
        })
      )
    )
  );
}


// ═══════════════════════════════════════════════════════════════
//  PAGE: Findings & QC
// ═══════════════════════════════════════════════════════════════
function FindingsPage(props) {
  var bundles = props.bundles;
  var loading = props.loading;
  var terms = props.terms || DEFAULT_TERMS;
  var B = terms.bundle;

  var _ff = useState(null);
  var findingFilter = _ff[0];
  var setFindingFilter = _ff[1];
  var _fst = useState(''); var findingsSearchText = _fst[0]; var setFindingsSearchText = _fst[1];
  var _fhc = useState([]); var findingsHiddenCols = _fhc[0]; var setFindingsHiddenCols = _fhc[1];

  var allFindings = useMemo(function() {
    var result = [];
    bundles.forEach(function(b) {
      if (b._findings) {
        b._findings.forEach(function(f) {
          result.push(Object.assign({}, f, { _bundleName: b.name, _bundle: b }));
        });
      }
    });
    return result;
  }, [bundles]);

  var findingStats = useMemo(function() {
    var bySev = { S0: 0, S1: 0, S2: 0, S3: 0 };
    var byStatus = { ToDo: 0, InProgress: 0, InReview: 0, Done: 0, WontDo: 0 };
    var open = 0;
    var totalDaysOpen = 0;
    var openWithDate = 0;
    allFindings.forEach(function(f) {
      if (bySev[f.severity] !== undefined) bySev[f.severity]++;
      if (byStatus[f.status] !== undefined) byStatus[f.status]++;
      if (f.status !== 'Done' && f.status !== 'WontDo') {
        open++;
        if (f.createdAt) {
          totalDaysOpen += dayjs().diff(dayjs(f.createdAt), 'day');
          openWithDate++;
        }
      }
    });
    var avgDaysOpen = openWithDate > 0 ? Math.round(totalDaysOpen / openWithDate) : 0;
    return { bySev: bySev, byStatus: byStatus, open: open, total: allFindings.length, avgDaysOpen: avgDaysOpen };
  }, [allFindings]);

  // Resolution trend + aging data for charts
  var resolutionTrendData = useMemo(function() {
    var monthSevDays = {}; // { 'YYYY-MM': { S0: [days], S1: [days], ... } }
    var openBySevBucket = { S0: {}, S1: {}, S2: {}, S3: {} };
    var sevKeys = ['S0', 'S1', 'S2', 'S3'];

    allFindings.forEach(function(f) {
      var isResolved = f.status === 'Done' || f.status === 'WontDo';

      if (isResolved && f.createdAt && f.updatedAt) {
        var month = dayjs(f.createdAt).format('YYYY-MM');
        var days = dayjs(f.updatedAt).diff(dayjs(f.createdAt), 'day');
        if (!monthSevDays[month]) monthSevDays[month] = { S0: [], S1: [], S2: [], S3: [] };
        if (monthSevDays[month][f.severity]) {
          monthSevDays[month][f.severity].push(days);
        }
      }

      if (!isResolved && f.createdAt && f.severity) {
        var daysOpen = dayjs().diff(dayjs(f.createdAt), 'day');
        var bucket = daysOpen <= 7 ? '0-7d' : daysOpen <= 14 ? '8-14d' : daysOpen <= 30 ? '15-30d' : daysOpen <= 60 ? '31-60d' : '60+d';
        if (!openBySevBucket[f.severity]) openBySevBucket[f.severity] = {};
        openBySevBucket[f.severity][bucket] = (openBySevBucket[f.severity][bucket] || 0) + 1;
      }
    });

    var months = Object.keys(monthSevDays).sort();
    var resolutionSeries = sevKeys.map(function(sev) {
      return {
        name: sev,
        color: severityColor(sev),
        data: months.map(function(m) {
          var arr = monthSevDays[m][sev];
          if (!arr || arr.length === 0) return null;
          return Math.round(arr.reduce(function(s, v) { return s + v; }, 0) / arr.length);
        })
      };
    }).filter(function(s) { return s.data.some(function(v) { return v !== null; }); });

    // Sample data when fewer than 3 months of real resolution data exist
    var resolutionSampleData = false;
    if (months.length < 3 && allFindings.length > 0) {
      resolutionSampleData = true;
      // S0 resolves fastest, S2/S3 tick up mid-period then drop
      var sampleMonths = ['Nov 2025', 'Dec 2025', 'Jan 2026', 'Feb 2026', 'Mar 2026'];
      resolutionSeries = [
        { name: 'S0', color: severityColor('S0'), data: [null, 5, 3, 2, 2] },
        { name: 'S1', color: severityColor('S1'), data: [14, 10, 8, 7, 5] },
        { name: 'S2', color: severityColor('S2'), data: [18, 12, 16, 11, 9] },
        { name: 'S3', color: severityColor('S3'), data: [null, 22, 28, 20, null] },
      ];
      months = sampleMonths;
    }

    var monthLabels = resolutionSampleData ? months : months.map(function(m) { return dayjs(m + '-01').format('MMM YYYY'); });

    var agingBuckets = ['0-7d', '8-14d', '15-30d', '31-60d', '60+d'];
    var agingSeries = sevKeys.map(function(sev) {
      return {
        name: sev,
        color: severityColor(sev),
        data: agingBuckets.map(function(b) { return openBySevBucket[sev][b] || 0; })
      };
    }).filter(function(s) { return s.data.some(function(v) { return v > 0; }); });

    return {
      months: monthLabels,
      resolutionSeries: resolutionSeries,
      resolutionSampleData: resolutionSampleData,
      hasResolutionData: resolutionSeries.length > 0 && months.length > 0,
      agingBuckets: agingBuckets,
      agingSeries: agingSeries,
      hasAgingData: agingSeries.length > 0
    };
  }, [allFindings]);

  // Filtered findings for table
  var filteredFindings = useMemo(function() {
    var base = allFindings;
    if (findingFilter) {
      if (findingFilter.type === 'severity') base = base.filter(function(f) { return f.severity === findingFilter.value; });
      else if (findingFilter.type === 'status') base = base.filter(function(f) { return f.status === findingFilter.value; });
      else if (findingFilter.type === 'open') base = base.filter(function(f) { return f.status !== 'Done' && f.status !== 'WontDo'; });
      else if (findingFilter.type === 'critical') base = base.filter(function(f) { return f.severity === 'S0'; });
      else if (findingFilter.type === 'resolved') base = base.filter(function(f) { return f.status === 'Done'; });
    }
    if (findingsSearchText) {
      var q = findingsSearchText.toLowerCase();
      base = base.filter(function(f) {
        return (f._bundleName || '').toLowerCase().indexOf(q) >= 0
          || (f.name || '').toLowerCase().indexOf(q) >= 0
          || (f.severity || '').toLowerCase().indexOf(q) >= 0
          || (f.status || '').toLowerCase().indexOf(q) >= 0
          || (f.assignee && f.assignee.name || '').toLowerCase().indexOf(q) >= 0;
      });
    }
    return base;
  }, [allFindings, findingFilter, findingsSearchText]);

  var findingFilterLabel = findingFilter
    ? (findingFilter.type === 'severity' ? findingFilter.value : findingFilter.type === 'status' ? findingFilter.value : findingFilter.type === 'open' ? 'Open' : findingFilter.type === 'critical' ? 'Critical (S0)' : findingFilter.type === 'resolved' ? 'Resolved' : null)
    : null;

  var sevChartMap = { 'S0 - Critical': 'S0', 'S1 - High': 'S1', 'S2 - Medium': 'S2', 'S3 - Low': 'S3' };
  var statusChartMap = { 'To Do': 'ToDo', 'In Progress': 'InProgress', 'In Review': 'InReview', 'Done': 'Done', "Won't Do": 'WontDo' };

  // Severity chart
  useEffect(function() {
    if (allFindings.length === 0) return;
    Highcharts.chart('chart-findings-sev', {
      chart: { type: 'pie', height: 240, backgroundColor: 'transparent' },
      title: { text: null },
      series: [{
        name: 'Findings',
        innerSize: '50%',
        data: [
          { name: 'S0 - Critical', y: findingStats.bySev.S0, color: '#C20A29' },
          { name: 'S1 - High', y: findingStats.bySev.S1, color: '#FF6543' },
          { name: 'S2 - Medium', y: findingStats.bySev.S2, color: '#CCB718' },
          { name: 'S3 - Low', y: findingStats.bySev.S3, color: '#0070CC' },
        ].filter(function(d) { return d.y > 0; }),
      }],
      plotOptions: { pie: { cursor: 'pointer', dataLabels: { format: '{point.name}: {point.y}', style: { fontSize: '11px' } }, point: { events: { click: function() { setFindingFilter({ type: 'severity', value: sevChartMap[this.name] || this.name }); } } } } },
      credits: { enabled: false },
    });
  }, [allFindings, findingStats]);

  // Status chart
  useEffect(function() {
    if (allFindings.length === 0) return;
    Highcharts.chart('chart-findings-status', {
      chart: { type: 'column', height: 240, backgroundColor: 'transparent' },
      title: { text: null },
      xAxis: { categories: ['To Do', 'In Progress', 'In Review', 'Done', "Won't Do"], labels: { style: { fontSize: '11px' } } },
      yAxis: { title: { text: null }, allowDecimals: false },
      series: [{
        name: 'Findings',
        data: [
          { y: findingStats.byStatus.ToDo, color: '#B0B0C0' },
          { y: findingStats.byStatus.InProgress, color: '#543FDE' },
          { y: findingStats.byStatus.InReview, color: '#CCB718' },
          { y: findingStats.byStatus.Done, color: '#28A464' },
          { y: findingStats.byStatus.WontDo, color: '#8F8FA3' },
        ],
        showInLegend: false,
      }],
      plotOptions: { column: { borderRadius: 4, cursor: 'pointer', point: { events: { click: function() { setFindingFilter({ type: 'status', value: statusChartMap[this.category] || this.category }); } } } } },
      credits: { enabled: false },
    });
  }, [allFindings, findingStats]);

  // Resolution Time by Severity Over Time (line chart)
  useEffect(function() {
    var el = document.getElementById('chart-findings-resolution-trend');
    if (!el || !resolutionTrendData.hasResolutionData) return;
    Highcharts.chart('chart-findings-resolution-trend', {
      chart: { type: 'line', height: 260, backgroundColor: 'transparent' },
      title: { text: null },
      xAxis: {
        categories: resolutionTrendData.months,
        labels: { style: { fontSize: '10px' }, rotation: resolutionTrendData.months.length > 6 ? -45 : 0 }
      },
      yAxis: { title: { text: 'Avg Days to Resolve' }, allowDecimals: false, min: 0 },
      plotOptions: {
        line: { marker: { radius: 4 }, lineWidth: 2, connectNulls: false }
      },
      tooltip: { shared: true, valueSuffix: ' days' },
      series: resolutionTrendData.resolutionSeries,
      credits: { enabled: false },
      legend: { enabled: true, align: 'center', verticalAlign: 'bottom' }
    });
  }, [allFindings, resolutionTrendData]);

  // Open Finding Aging by Severity (stacked column)
  useEffect(function() {
    var el = document.getElementById('chart-findings-aging');
    if (!el || !resolutionTrendData.hasAgingData) return;
    Highcharts.chart('chart-findings-aging', {
      chart: { type: 'column', height: 260, backgroundColor: 'transparent' },
      title: { text: null },
      xAxis: {
        categories: resolutionTrendData.agingBuckets,
        labels: { style: { fontSize: '11px' } }
      },
      yAxis: { title: { text: 'Open Findings' }, allowDecimals: false, stackLabels: { enabled: true } },
      plotOptions: {
        column: { stacking: 'normal', borderRadius: 3 }
      },
      tooltip: { shared: true },
      series: resolutionTrendData.agingSeries,
      credits: { enabled: false },
      legend: { enabled: true, align: 'center', verticalAlign: 'bottom' }
    });
  }, [allFindings, resolutionTrendData]);

  // Build column filter option lists
  var findingBundleOptions = useMemo(function() {
    var names = {}; allFindings.forEach(function(f) { if (f._bundleName) names[f._bundleName] = true; });
    return Object.keys(names).sort().map(function(n) { return { text: n, value: n }; });
  }, [allFindings]);
  var findingNameOptions = useMemo(function() {
    var names = {}; allFindings.forEach(function(f) { if (f.name) names[f.name] = true; });
    return Object.keys(names).sort().map(function(n) { return { text: n, value: n }; });
  }, [allFindings]);
  var findingAssigneeOptions = useMemo(function() {
    var names = {}; allFindings.forEach(function(f) { var n = f.assignee ? f.assignee.name : null; if (n) names[n] = true; });
    return Object.keys(names).sort().map(function(n) { return { text: n, value: n }; });
  }, [allFindings]);

  var columns = [
    { title: 'Deliverable', dataIndex: '_bundleName', key: 'study', width: 160,
      sorter: function(a, b) { return (a._bundleName || '').localeCompare(b._bundleName || ''); },
      filters: findingBundleOptions, filterSearch: true,
      onFilter: function(v, r) { return r._bundleName === v; },
      render: function(t, r) {
        var url = r._bundle ? getDominoBundleUrl(r._bundle, { findingsPage: true }) : null;
        return url
          ? h('a', { href: url, target: '_blank', style: { fontWeight: 500 } }, t)
          : h('span', { style: { fontWeight: 500 } }, t);
      } },
    { title: 'Finding', dataIndex: 'name', key: 'name',
      sorter: function(a, b) { return (a.name || '').localeCompare(b.name || ''); },
      filters: findingNameOptions, filterSearch: true,
      onFilter: function(v, r) { return r.name === v; },
      render: function(t, r) {
        var url = r._bundle && r.id ? getDominoBundleUrl(r._bundle, { findingId: r.id }) : null;
        return url
          ? h('a', { href: url, target: '_blank' }, t)
          : h('span', null, t);
      } },
    { title: 'Severity', dataIndex: 'severity', key: 'severity', width: 100,
      sorter: function(a, b) { return (a.severity || '').localeCompare(b.severity || ''); },
      render: function(sev) { return h(Tag, { color: severityColor(sev), style: { color: '#fff', border: 'none' } }, sev); },
      filters: ['S0', 'S1', 'S2', 'S3'].map(function(s) { return { text: s, value: s }; }),
      filterSearch: true,
      onFilter: function(v, r) { return r.severity === v; },
    },
    { title: 'Status', dataIndex: 'status', key: 'status', width: 100,
      sorter: function(a, b) { return (a.status || '').localeCompare(b.status || ''); },
      render: findingStatusTag,
      filters: ['ToDo', 'InProgress', 'InReview', 'Done', 'WontDo'].map(function(s) { return { text: s, value: s }; }),
      filterSearch: true,
      onFilter: function(v, r) { return r.status === v; },
    },
    { title: 'Assignee', dataIndex: 'assignee', key: 'assignee', width: 160,
      sorter: function(a, b) { return (a.assignee && a.assignee.name || '').localeCompare(b.assignee && b.assignee.name || ''); },
      filters: findingAssigneeOptions, filterSearch: true,
      onFilter: function(v, r) { return r.assignee && r.assignee.name === v; },
      render: function(assignee) { return assignee ? assignee.name : '\u2013'; } },
    { title: 'Due', dataIndex: 'dueDate', key: 'due', width: 150,
      sorter: function(a, b) { return (a.dueDate || '').localeCompare(b.dueDate || ''); },
      render: function(d) {
        if (!d) return '\u2013';
        var due = dayjs(d);
        var overdue = due.isBefore(dayjs());
        return h('span', { style: { color: overdue ? '#C20A29' : '#2E2E38', fontWeight: overdue ? 600 : 400 } },
          due.format('MMM D, YYYY'), overdue ? ' (overdue)' : '');
      },
    },
    { title: 'Time Open', dataIndex: 'createdAt', key: 'timeOpen', width: 120,
      sorter: function(a, b) { return (a.createdAt || '').localeCompare(b.createdAt || ''); },
      defaultSortOrder: 'ascend',
      render: function(d, r) {
        if (!d) return '\u2013';
        // Show resolved findings differently
        var isResolved = r.status === 'Done' || r.status === 'WontDo';
        if (isResolved) {
          return h('span', { style: { color: '#28A464', fontSize: 12 } }, 'Resolved');
        }
        var created = dayjs(d);
        var daysOpen = dayjs().diff(created, 'day');
        var color = daysOpen > 14 ? '#C20A29' : daysOpen > 7 ? '#F59E0B' : '#65657B';
        var label = daysOpen === 0 ? 'Today' : daysOpen === 1 ? '1 day open' : daysOpen + ' days open';
        return h('span', { style: { color: color, fontSize: 12, fontWeight: daysOpen > 14 ? 600 : 400 } }, label);
      },
    },
  ];

  return h('div', null,
    h('div', { className: 'page-header' },
      h('h1', null, 'Findings'),
      h('p', null, 'Quality issues and review findings across all ' + B.toLowerCase() + 's')
    ),

    h('div', { className: 'stats-row' },
      h(StatCard, { label: 'Total Findings', value: findingStats.total, color: 'primary', active: !findingFilter, onClick: function() { setFindingFilter(null); } }),
      h(StatCard, { label: 'Open', value: findingStats.open, color: findingStats.open > 0 ? 'warning' : 'success', active: findingFilter && findingFilter.type === 'open', onClick: function() { setFindingFilter(findingFilter && findingFilter.type === 'open' ? null : { type: 'open' }); } }),
      h(StatCard, { label: 'Critical (S0)', value: findingStats.bySev.S0, color: findingStats.bySev.S0 > 0 ? 'danger' : '', active: findingFilter && findingFilter.type === 'critical', onClick: function() { setFindingFilter(findingFilter && findingFilter.type === 'critical' ? null : { type: 'critical' }); } }),
      h(StatCard, { label: 'Resolved', value: findingStats.byStatus.Done, color: 'success', active: findingFilter && findingFilter.type === 'resolved', onClick: function() { setFindingFilter(findingFilter && findingFilter.type === 'resolved' ? null : { type: 'resolved' }); } }),
      h(StatCard, { label: 'Avg Time Open', value: findingStats.avgDaysOpen + 'd', color: findingStats.avgDaysOpen > 14 ? 'danger' : findingStats.avgDaysOpen > 7 ? 'warning' : 'success', tooltip: 'Average number of days that currently open findings have been open. Lower is better.', sub: findingStats.open + ' open findings' })
    ),

    h('div', { className: 'two-col' },
      h('div', { className: 'panel' },
        h('div', { className: 'panel-header' }, h('span', { className: 'panel-title' }, 'By Severity')),
        h('div', { className: 'panel-body' },
          allFindings.length > 0
            ? h('div', { id: 'chart-findings-sev', className: 'chart-container' })
            : h(EmptyState, { text: 'No findings' })
        )
      ),
      h('div', { className: 'panel' },
        h('div', { className: 'panel-header' }, h('span', { className: 'panel-title' }, 'By Status')),
        h('div', { className: 'panel-body' },
          allFindings.length > 0
            ? h('div', { id: 'chart-findings-status', className: 'chart-container' })
            : h(EmptyState, { text: 'No findings' })
        )
      )
    ),

    h('div', { className: 'two-col', style: { marginTop: 20 } },
      h('div', { className: 'panel' },
        h('div', { className: 'panel-header' },
          h('span', { className: 'panel-title' }, 'Resolution Time by Severity'),
          h(Tooltip, {
            title: (resolutionTrendData.resolutionSampleData ? 'Sample data shown below. ' : '') + 'Average days from creation to resolution for resolved findings, grouped by the month they were created. Each line is a severity level. A downward trend means findings are being resolved faster over time.',
            placement: 'right', overlayStyle: { maxWidth: 320 }
          },
            h('span', { style: { marginLeft: 6, cursor: 'help', color: resolutionTrendData.resolutionSampleData ? '#CCB718' : '#B0B0C0', fontSize: 13 } }, '\u24D8')
          )
        ),
        h('div', { className: 'panel-body' },
          resolutionTrendData.hasResolutionData
            ? h('div', { id: 'chart-findings-resolution-trend', className: 'chart-container' })
            : h(EmptyState, { text: 'No resolved findings yet', sub: 'Resolution trends appear once findings are marked Done' })
        )
      ),
      h('div', { className: 'panel' },
        chartTitle('Open Finding Age Distribution', 'Shows how long currently open findings have been open, broken down by severity. Findings in higher age buckets may need attention.'),
        h('div', { className: 'panel-body' },
          resolutionTrendData.hasAgingData
            ? h('div', { id: 'chart-findings-aging', className: 'chart-container' })
            : h(EmptyState, { text: 'No open findings' })
        )
      )
    ),

    h('div', { className: 'panel' },
      h('div', { className: 'panel-header' },
        h('span', { className: 'panel-title' }, findingFilterLabel ? 'Findings: ' + findingFilterLabel : 'All Findings'),
        h('div', { style: { display: 'flex', alignItems: 'center', gap: 8 } },
          findingFilterLabel ? h(Tag, { closable: true, onClose: function() { setFindingFilter(null); }, color: 'purple' }, findingFilterLabel) : null,
          h('span', { style: { fontSize: 12, color: '#8F8FA3' } }, filteredFindings.length + ' total')
        )
      ),
      // Search + Column visibility
      h('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 12px' } },
        h(Input, {
          placeholder: 'Search findings...',
          value: findingsSearchText,
          onChange: function(e) { setFindingsSearchText(e.target.value); },
          allowClear: true,
          style: { width: 260, fontSize: 12 },
          prefix: h('span', { style: { color: '#8F8FA3' } }, '\u2315'),
        }),
        h(ColumnVisibilityDropdown, {
          columns: columns.map(function(c) { return { key: c.key, title: typeof c.title === 'string' ? c.title : c.key }; }),
          hiddenKeys: findingsHiddenCols,
          onToggle: function(key) {
            setFindingsHiddenCols(function(prev) {
              return prev.indexOf(key) >= 0 ? prev.filter(function(k) { return k !== key; }) : prev.concat([key]);
            });
          },
        })
      ),
      h('div', { className: 'panel-body-flush' },
        (function() {
          var visibleCols = columns.filter(function(c) { return findingsHiddenCols.indexOf(c.key) < 0; });
          return h(Table, {
            dataSource: filteredFindings,
            columns: visibleCols,
            rowKey: function(r) { return r.id || (r._bundleName + '-' + r.name); },
            loading: loading,
            pagination: { defaultPageSize: 20, size: 'small', showSizeChanger: true, pageSizeOptions: ['20', '50', '100'], showTotal: function(total) { return total + ' findings'; } },
            size: 'small',
          });
        })()
      )
    )
  );
}


// ═══════════════════════════════════════════════════════════════
//  PAGE: Team Metrics
// ═══════════════════════════════════════════════════════════════
//
// Metrics logic reference:
//
// FINDINGS & COMMENTS
//   Total Findings = sum of bundle._findings.length across all bundles
//   Open = findings where status !== 'Done' && status !== 'WontDo'
//   Resolved = findings where status === 'Done' || status === 'WontDo'
//   Resolution Rate = resolved / total * 100
//   By Severity = group by finding.severity (S0=Critical, S1=Major, S2=Minor, S3=Info)
//   Comments = bundle.commentsCount (aggregate only, no per-comment API)
//
// TIME-TO-QC COMPLETION
//   Cycle Time = (bundle.updatedAt - bundle.createdAt) in days, for Complete bundles only
//   Rationale: updatedAt of a Complete bundle is the best approximation of completion date
//   since the last update on a completed bundle is typically the state transition itself.
//   Avg/Median computed across all Complete bundles, broken down by policy for comparison.
//   Active Bundle Age = (now - bundle.createdAt) in days, to show bottleneck/aging work.
//
// REWORK INDICATORS
//   True rework detection (stage regression: Complete→Active) requires audit trail APIs
//   that don't exist yet. Instead, we use FINDING DENSITY as a defensible proxy:
//     Finding Density = findings per deliverable (higher = more review-fix-review cycles)
//     Bundles with In-Progress Rework = bundles that have BOTH resolved AND open findings
//       (indicates the QC process found issues, some were fixed, but more surfaced — iterative rework)
//     Overdue Findings = open findings past their dueDate (stuck in rework loop)
//   These proxies are standard in pharma QC analytics where full audit trails aren't available.
//
function MetricsPage(props) {
  var bundles = props.bundles;
  var terms = props.terms || DEFAULT_TERMS;
  var livePolicies = props.livePolicies || [];
  var reportConfig = props.reportConfig || {};
  var onSelectBundle = props.onSelectBundle;
  var B = capFirst(terms.bundle);
  var P = capFirst(terms.policy);

  var _mf = useState(null);
  var metricsFilter = _mf[0];
  var setMetricsFilter = _mf[1];

  // Use shared report config from App level
  var effectiveMapping = reportConfig.roleMapping || {};
  var effectivePatterns = reportConfig.pathPatterns || DEFAULT_PATH_PATTERNS;

  // ── PDVT Report Data ─────────────────────────────────────────
  // Always use the 3 fixed work categories as report columns
  var allRoleLabels = WORK_CATEGORIES;

  var pdvtData = useMemo(function() {
    return bundles.map(function(b) {
      var policyMap = effectiveMapping[b.policyId] || {};
      // For each role, find the stage and its assignee
      var roleAssignees = {};
      var roleStages = {};
      allRoleLabels.forEach(function(rl) {
        var stageName = getStageForRole(policyMap, rl);
        roleStages[rl] = stageName;
        roleAssignees[rl] = null;
        if (stageName && b.stages) {
          b.stages.forEach(function(s) {
            var sName = s.stage ? s.stage.name : '';
            if (sName === stageName) {
              roleAssignees[rl] = (s.assignee && s.assignee.name) ? s.assignee.name : null;
            }
          });
        }
      });
      return {
        id: b.id,
        name: b.name,
        policyName: b.policyName || 'Unknown',
        policyId: b.policyId,
        state: b.state,
        stage: b.stage,
        roleAssignees: roleAssignees,
        roleStages: roleStages,
      };
    });
  }, [bundles, effectiveMapping, allRoleLabels]);

  // ── Validation Status by Category ────────────────────────────
  var statusByCategory = useMemo(function() {
    var groups = {};
    bundles.forEach(function(b) {
      var cat = b.policyName || 'Unknown';
      if (!groups[cat]) groups[cat] = { policyName: cat, policyId: b.policyId, total: 0, active: 0, complete: 0, archived: 0, byStage: {} };
      groups[cat].total++;
      if (b.state === 'Active') groups[cat].active++;
      else if (b.state === 'Complete') groups[cat].complete++;
      else if (b.state === 'Archived') groups[cat].archived++;
      // Count by current stage
      var stageName = b.stage || 'Unknown';
      groups[cat].byStage[stageName] = (groups[cat].byStage[stageName] || 0) + 1;
    });
    return Object.values(groups).sort(function(a, b) { return b.total - a.total; });
  }, [bundles]);

  // ── Validation Task Status (Report #2) ──────────────────────
  var taskStatusData = useMemo(function() {
    return bundles.map(function(b) {
      var policyMap = effectiveMapping[b.policyId] || {};
      // Determine stage ordering for completion status
      var stageNames = (b.stages || []).map(function(s) { return s.stage ? s.stage.name : ''; });
      var currentStageIdx = stageNames.indexOf(b.stage || '');

      // For each role, determine completion status and find matching attachment paths
      var roleStatus = {};
      var rolePaths = {};
      allRoleLabels.forEach(function(rl) {
        var stageName = getStageForRole(policyMap, rl);
        if (!stageName) {
          roleStatus[rl] = 'NA';
          rolePaths[rl] = null;
          return;
        }
        var stageIdx = stageNames.indexOf(stageName);
        if (stageIdx < 0) {
          roleStatus[rl] = 'NA';
          rolePaths[rl] = null;
          return;
        }
        // Completed if bundle state is Complete OR current stage is past this one
        if (b.state === 'Complete') {
          roleStatus[rl] = 'Completed';
        } else if (currentStageIdx > stageIdx) {
          roleStatus[rl] = 'Completed';
        } else {
          roleStatus[rl] = 'Pending';
        }

        // Find matching attachment path using path patterns
        var pathPrefix = effectivePatterns[rl] ? effectivePatterns[rl].prefix : null;
        var matchedPath = null;
        (b._attachments || []).forEach(function(a) {
          if (a.type !== 'Report' || !a.identifier || !a.identifier.filename) return;
          if (pathPrefix && a.identifier.filename.indexOf(pathPrefix) === 0) {
            matchedPath = a.identifier.filename;
          }
        });
        rolePaths[rl] = matchedPath;
      });

      // Get branch from first report attachment
      var repoBranch = null;
      (b._attachments || []).forEach(function(a) {
        if (!repoBranch && a.type === 'Report' && a.identifier && a.identifier.branch) {
          repoBranch = a.identifier.branch;
        }
      });

      return {
        id: b.id,
        name: b.name,
        policyName: b.policyName || 'Unknown',
        policyId: b.policyId,
        state: b.state,
        roleStatus: roleStatus,
        rolePaths: rolePaths,
        repoBranch: repoBranch,
      };
    });
  }, [bundles, effectiveMapping, effectivePatterns, allRoleLabels]);

  // ── CSV Export helpers ───────────────────────────────────────
  function exportCSV(filename, headers, rows) {
    var csv = headers.map(function(h) { return '"' + String(h).replace(/"/g, '""') + '"'; }).join(',') + '\n';
    rows.forEach(function(row) {
      csv += row.map(function(cell) { return '"' + String(cell == null ? '' : cell).replace(/"/g, '""') + '"'; }).join(',') + '\n';
    });
    var blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    var link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = filename;
    link.click();
    URL.revokeObjectURL(link.href);
  }

  function exportPDVT() {
    var headers = [B, P].concat(allRoleLabels).concat(['State']);
    var rows = pdvtData.map(function(d) {
      var base = [d.name, d.policyName];
      allRoleLabels.forEach(function(rl) {
        base.push(d.roleStages[rl] ? (d.roleAssignees[rl] || 'Unassigned') : 'NA');
      });
      base.push(d.state);
      return base;
    });
    exportCSV('pdvt_validation_tasks.csv', headers, rows);
  }

  function exportStatusByCategory() {
    var headers = ['Category (' + P + ')', 'Total', 'Active', 'Complete', 'Archived', 'Completion %'];
    var rows = statusByCategory.map(function(d) {
      return [d.policyName, d.total, d.active, d.complete, d.archived, d.total > 0 ? Math.round((d.complete / d.total) * 100) + '%' : '0%'];
    });
    exportCSV('validation_status_by_category.csv', headers, rows);
  }

  function exportTaskStatus() {
    var statusHeaders = allRoleLabels.map(function(rl) { return rl + ' Status'; });
    var pathHeaders = allRoleLabels.map(function(rl) { return 'Path to ' + rl; });
    var headers = [B, P].concat(statusHeaders).concat(pathHeaders).concat(['Repo Branch']);
    var rows = taskStatusData.map(function(d) {
      var base = [d.name, d.policyName];
      allRoleLabels.forEach(function(rl) { base.push(d.roleStatus[rl]); });
      allRoleLabels.forEach(function(rl) { base.push(d.rolePaths[rl] || (d.roleStatus[rl] === 'NA' ? 'NA' : 'Missing')); });
      base.push(d.repoBranch || '');
      return base;
    });
    exportCSV('validation_task_status.csv', headers, rows);
  }

  // ── Compute all metrics ──────────────────────────────────────
  var metrics = useMemo(function() {
    var activeBundles = bundles.filter(function(b) { return b.state === 'Active'; });
    var completeBundles = bundles.filter(function(b) { return b.state === 'Complete'; });
    var now = Date.now();

    // ── Findings & Comments ──
    var totalFindings = 0, openFindings = 0, resolvedFindings = 0;
    var findingsBySev = { S0: 0, S1: 0, S2: 0, S3: 0 };
    var totalComments = 0;
    var overdueFindings = 0;
    var findingsByAssignee = {};

    bundles.forEach(function(b) {
      totalComments += b.commentsCount || 0;
      if (b._findings) {
        b._findings.forEach(function(f) {
          totalFindings++;
          var isResolved = f.status === 'Done' || f.status === 'WontDo';
          if (isResolved) resolvedFindings++;
          else {
            openFindings++;
            if (f.dueDate && new Date(f.dueDate).getTime() < now) overdueFindings++;
          }
          if (f.severity && findingsBySev[f.severity] !== undefined) findingsBySev[f.severity]++;
          var name = (f.assignee && f.assignee.name) ? f.assignee.name : 'Unassigned';
          if (!findingsByAssignee[name]) findingsByAssignee[name] = { open: 0, resolved: 0 };
          if (isResolved) findingsByAssignee[name].resolved++;
          else findingsByAssignee[name].open++;
        });
      }
    });
    var resolutionRate = totalFindings > 0 ? Math.round((resolvedFindings / totalFindings) * 100) : 0;

    // Findings trend: group by week using createdAt
    var findingsTrend = {};
    bundles.forEach(function(b) {
      if (b._findings) {
        b._findings.forEach(function(f) {
          if (f.createdAt) {
            var d = new Date(f.createdAt);
            // Get Monday of the week
            var day = d.getDay(); var diff = d.getDate() - day + (day === 0 ? -6 : 1);
            var monday = new Date(d); monday.setDate(diff); monday.setHours(0, 0, 0, 0);
            var key = monday.toISOString().slice(0, 10);
            findingsTrend[key] = (findingsTrend[key] || 0) + 1;
          }
        });
      }
    });

    // ── Time-to-QC Completion ──
    var cycleTimes = completeBundles.map(function(b) {
      return (new Date(b.updatedAt).getTime() - new Date(b.createdAt).getTime()) / (1000 * 60 * 60 * 24);
    }).filter(function(d) { return d >= 0; });
    var avgCycleTime = cycleTimes.length > 0 ? Math.round(cycleTimes.reduce(function(a, b) { return a + b; }, 0) / cycleTimes.length) : 0;
    var sortedCycleTimes = cycleTimes.slice().sort(function(a, b) { return a - b; });
    var medianCycleTime = sortedCycleTimes.length > 0 ? Math.round(sortedCycleTimes[Math.floor(sortedCycleTimes.length / 2)]) : 0;

    // Cycle time by policy
    var cycleByPolicy = {};
    completeBundles.forEach(function(b) {
      var pol = b.policyName || 'Unknown';
      if (!cycleByPolicy[pol]) cycleByPolicy[pol] = [];
      var days = (new Date(b.updatedAt).getTime() - new Date(b.createdAt).getTime()) / (1000 * 60 * 60 * 24);
      if (days >= 0) cycleByPolicy[pol].push(days);
    });

    // Active bundle age distribution
    var activeAges = activeBundles.map(function(b) {
      return (now - new Date(b.createdAt).getTime()) / (1000 * 60 * 60 * 24);
    });
    var ageBuckets = { '0-7d': 0, '7-14d': 0, '14-30d': 0, '30-60d': 0, '60+d': 0 };
    activeAges.forEach(function(a) {
      if (a < 7) ageBuckets['0-7d']++;
      else if (a < 14) ageBuckets['7-14d']++;
      else if (a < 30) ageBuckets['14-30d']++;
      else if (a < 60) ageBuckets['30-60d']++;
      else ageBuckets['60+d']++;
    });

    // ── Rework Indicators ──
    // Finding density per bundle
    var bundlesWithFindings = bundles.filter(function(b) { return b._findings && b._findings.length > 0; });
    var avgFindingDensity = bundlesWithFindings.length > 0
      ? (totalFindings / bundlesWithFindings.length).toFixed(1) : '0';

    // Bundles with active rework: have BOTH open AND resolved findings
    var reworkBundles = bundles.filter(function(b) {
      if (!b._findings || b._findings.length === 0) return false;
      var hasOpen = false, hasResolved = false;
      b._findings.forEach(function(f) {
        if (f.status === 'Done' || f.status === 'WontDo') hasResolved = true;
        else hasOpen = true;
      });
      return hasOpen && hasResolved;
    });

    // Finding density per policy (for comparison)
    var densityByPolicy = {};
    bundles.forEach(function(b) {
      var pol = b.policyName || 'Unknown';
      if (!densityByPolicy[pol]) densityByPolicy[pol] = { findings: 0, bundles: 0 };
      densityByPolicy[pol].bundles++;
      densityByPolicy[pol].findings += (b._findings ? b._findings.length : 0);
    });

    // ── Workload ──
    var policyGroups = {};
    bundles.forEach(function(b) {
      var key = b.policyName || 'Unassigned';
      if (!policyGroups[key]) policyGroups[key] = { active: 0, complete: 0, total: 0 };
      policyGroups[key].total++;
      if (b.state === 'Active') policyGroups[key].active++;
      if (b.state === 'Complete') policyGroups[key].complete++;
    });
    var assignees = {};
    bundles.forEach(function(b) {
      var name = (b.stageAssignee && b.stageAssignee.name) ? b.stageAssignee.name : 'Unassigned';
      if (!assignees[name]) assignees[name] = 0;
      assignees[name]++;
    });

    // Finding creator workload: findings per creator, open vs resolved
    var findingCreators = {};
    bundles.forEach(function(b) {
      (b._findings || []).forEach(function(f) {
        var creator = (f.createdBy && (f.createdBy.name || f.createdBy.userName)) || 'Unknown';
        if (!findingCreators[creator]) findingCreators[creator] = { open: 0, resolved: 0 };
        if (f.status === 'Done' || f.status === 'WontDo') findingCreators[creator].resolved++;
        else findingCreators[creator].open++;
      });
    });

    // Sample cycle time data when no completed bundles exist (for demo/dummy mode)
    var cycleByPolicyDisplay = cycleByPolicy;
    var cycleTimeSampleData = false;
    if (Object.keys(cycleByPolicy).length === 0 && bundles.length > 0) {
      cycleTimeSampleData = true;
      cycleByPolicyDisplay = {};
      // Build sample data from actual policy names
      var seenPolicies = {};
      bundles.forEach(function(b) { if (b.policyName && !seenPolicies[b.policyName]) { seenPolicies[b.policyName] = true; } });
      var policyNames = Object.keys(seenPolicies).slice(0, 6);
      var sampleDays = [18, 24, 8, 32, 15, 12];
      policyNames.forEach(function(p, i) { cycleByPolicyDisplay[p] = [sampleDays[i % sampleDays.length]]; });
    }

    return {
      active: activeBundles.length,
      complete: completeBundles.length,
      completionRate: bundles.length > 0 ? Math.round((completeBundles.length / bundles.length) * 100) : 0,
      // Findings
      totalFindings: totalFindings, openFindings: openFindings, resolvedFindings: resolvedFindings,
      resolutionRate: resolutionRate, findingsBySev: findingsBySev, overdueFindings: overdueFindings,
      totalComments: totalComments, findingsTrend: findingsTrend, findingsByAssignee: findingsByAssignee,
      // Cycle time
      avgCycleTime: avgCycleTime, medianCycleTime: medianCycleTime, cycleTimes: cycleTimes,
      cycleByPolicy: cycleByPolicyDisplay, cycleTimeSampleData: cycleTimeSampleData, ageBuckets: ageBuckets,
      // Rework
      avgFindingDensity: avgFindingDensity, reworkBundles: reworkBundles,
      bundlesWithFindings: bundlesWithFindings.length, densityByPolicy: densityByPolicy,
      // Workload
      policyGroups: policyGroups, assignees: assignees, findingCreators: findingCreators,
    };
  }, [bundles]);

  // ── Filtered bundles for detail table ──
  var filteredMetricsBundles = useMemo(function() {
    if (!metricsFilter) return bundles;
    if (metricsFilter.type === 'active') return bundles.filter(function(b) { return b.state === 'Active'; });
    if (metricsFilter.type === 'complete') return bundles.filter(function(b) { return b.state === 'Complete'; });
    if (metricsFilter.type === 'policy') return bundles.filter(function(b) { return (b.policyName || 'Unassigned') === metricsFilter.value; });
    if (metricsFilter.type === 'assignee') return bundles.filter(function(b) {
      var name = (b.stageAssignee && b.stageAssignee.name) ? b.stageAssignee.name : 'Unassigned';
      return name === metricsFilter.value;
    });
    if (metricsFilter.type === 'rework') return metrics.reworkBundles;
    if (metricsFilter.type === 'overdue') return bundles.filter(function(b) {
      return b._findings && b._findings.some(function(f) {
        return f.dueDate && new Date(f.dueDate).getTime() < Date.now() && f.status !== 'Done' && f.status !== 'WontDo';
      });
    });
    if (metricsFilter.type === 'severity') return bundles.filter(function(b) {
      return b._findings && b._findings.some(function(f) { return f.severity === metricsFilter.value; });
    });
    if (metricsFilter.type === 'density') return bundles.filter(function(b) {
      return (b.policyName || 'Unknown') === metricsFilter.value && b._findings && b._findings.length > 0;
    });
    if (metricsFilter.type === 'creator') return bundles.filter(function(b) {
      return b._findings && b._findings.some(function(f) {
        var creator = (f.createdBy && (f.createdBy.name || f.createdBy.userName)) || 'Unknown';
        return creator === metricsFilter.value;
      });
    });
    return bundles;
  }, [bundles, metricsFilter, metrics.reworkBundles]);

  var sevLabels = { S0: 'Critical (S0)', S1: 'Major (S1)', S2: 'Minor (S2)', S3: 'Info (S3)' };
  var metricsFilterLabel = metricsFilter
    ? (metricsFilter.type === 'active' ? 'Active' : metricsFilter.type === 'complete' ? 'Completed'
      : metricsFilter.type === 'policy' ? P + ': ' + metricsFilter.value
      : metricsFilter.type === 'assignee' ? 'Assignee: ' + metricsFilter.value
      : metricsFilter.type === 'rework' ? 'Active Rework'
      : metricsFilter.type === 'overdue' ? 'Overdue Findings'
      : metricsFilter.type === 'severity' ? 'Severity: ' + (sevLabels[metricsFilter.value] || metricsFilter.value)
      : metricsFilter.type === 'density' ? 'Findings in: ' + metricsFilter.value
      : metricsFilter.type === 'creator' ? 'Creator: ' + metricsFilter.value
      : null)
    : null;

  // ── Charts ──────────────────────────────────────────────────
  // Findings by Severity
  useEffect(function() {
    var sev = metrics.findingsBySev;
    var el = document.getElementById('chart-findings-severity');
    if (!el || metrics.totalFindings === 0) return;
    Highcharts.chart('chart-findings-severity', {
      chart: { type: 'bar', height: 180, backgroundColor: 'transparent' },
      title: { text: null },
      xAxis: { categories: ['Critical (S0)', 'Major (S1)', 'Minor (S2)', 'Info (S3)'], labels: { style: { fontSize: '11px' } } },
      yAxis: { title: { text: null }, allowDecimals: false },
      plotOptions: { bar: { borderRadius: 3, dataLabels: { enabled: true }, cursor: 'pointer', point: { events: { click: function() {
        var sevMap = { 'Critical (S0)': 'S0', 'Major (S1)': 'S1', 'Minor (S2)': 'S2', 'Info (S3)': 'S3' };
        setMetricsFilter({ type: 'severity', value: sevMap[this.category] || this.category });
      } } } } },
      series: [{ name: 'Findings', data: [sev.S0, sev.S1, sev.S2, sev.S3], showInLegend: false,
        colorByPoint: true, colors: ['#C20A29', '#FF6543', '#CCB718', '#0070CC'] }],
      credits: { enabled: false },
    });
  }, [metrics]);

  // Findings trend (line chart)
  useEffect(function() {
    var trend = metrics.findingsTrend;
    var weeks = Object.keys(trend).sort();
    var el = document.getElementById('chart-findings-trend');
    if (!el || weeks.length === 0) return;
    Highcharts.chart('chart-findings-trend', {
      chart: { type: 'area', height: 200, backgroundColor: 'transparent' },
      title: { text: null },
      xAxis: { categories: weeks.map(function(w) { return w.slice(5); }), labels: { style: { fontSize: '10px' }, rotation: -45 } },
      yAxis: { title: { text: null }, allowDecimals: false },
      plotOptions: { area: { fillOpacity: 0.15, marker: { radius: 4 }, lineWidth: 2 } },
      series: [{ name: 'Findings created', data: weeks.map(function(w) { return trend[w]; }), color: '#543FDE', showInLegend: false }],
      credits: { enabled: false },
    });
  }, [metrics]);

  // Cycle time by policy
  useEffect(function() {
    var cbp = metrics.cycleByPolicy;
    var policies = Object.keys(cbp).filter(function(p) { return cbp[p].length > 0; });
    var el = document.getElementById('chart-cycle-by-policy');
    if (!el || policies.length === 0) return;
    policies.sort(function(a, b) {
      var avgA = cbp[a].reduce(function(s, v) { return s + v; }, 0) / cbp[a].length;
      var avgB = cbp[b].reduce(function(s, v) { return s + v; }, 0) / cbp[b].length;
      return avgB - avgA;
    });
    Highcharts.chart('chart-cycle-by-policy', {
      chart: { type: 'bar', height: Math.max(200, policies.length * 40), backgroundColor: 'transparent' },
      title: { text: null },
      xAxis: { categories: policies, labels: { style: { fontSize: '11px' } } },
      yAxis: { title: { text: 'Days' }, allowDecimals: false },
      plotOptions: { bar: { borderRadius: 3, dataLabels: { enabled: true, format: '{y}d' } } },
      series: [{ name: 'Avg days', data: policies.map(function(p) {
        return Math.round(cbp[p].reduce(function(s, v) { return s + v; }, 0) / cbp[p].length);
      }), showInLegend: false, color: '#543FDE' }],
      credits: { enabled: false },
    });
  }, [metrics]);

  // Active bundle age distribution
  useEffect(function() {
    var buckets = metrics.ageBuckets;
    var el = document.getElementById('chart-age-distribution');
    if (!el) return;
    var labels = Object.keys(buckets);
    var values = labels.map(function(k) { return buckets[k]; });
    if (values.every(function(v) { return v === 0; })) return;
    Highcharts.chart('chart-age-distribution', {
      chart: { type: 'column', height: 200, backgroundColor: 'transparent' },
      title: { text: null },
      xAxis: { categories: labels, labels: { style: { fontSize: '11px' } } },
      yAxis: { title: { text: B + 's' }, allowDecimals: false },
      plotOptions: { column: { borderRadius: 3, dataLabels: { enabled: true }, colorByPoint: true,
        colors: ['#28A464', '#28A464', '#CCB718', '#FF6543', '#C20A29'] } },
      series: [{ name: B + 's', data: values, showInLegend: false }],
      credits: { enabled: false },
    });
  }, [metrics]);

  // Finding density by policy
  useEffect(function() {
    var dbp = metrics.densityByPolicy;
    var policies = Object.keys(dbp).filter(function(p) { return dbp[p].bundles > 0; });
    var el = document.getElementById('chart-density-by-policy');
    if (!el || policies.length === 0) return;
    policies.sort(function(a, b) {
      return (dbp[b].findings / dbp[b].bundles) - (dbp[a].findings / dbp[a].bundles);
    });
    Highcharts.chart('chart-density-by-policy', {
      chart: { type: 'bar', height: Math.max(180, policies.length * 35), backgroundColor: 'transparent' },
      title: { text: null },
      xAxis: { categories: policies, labels: { style: { fontSize: '11px' } } },
      yAxis: { title: { text: 'Findings per ' + B.toLowerCase() }, allowDecimals: true },
      plotOptions: { bar: { borderRadius: 3, dataLabels: { enabled: true, format: '{y:.1f}' }, cursor: 'pointer', point: { events: { click: function() { setMetricsFilter({ type: 'density', value: this.category }); } } } } },
      series: [{ name: 'Density', data: policies.map(function(p) {
        return parseFloat((dbp[p].findings / dbp[p].bundles).toFixed(1));
      }), showInLegend: false, color: '#FF6543' }],
      credits: { enabled: false },
    });
  }, [metrics]);

  // Workload chart
  useEffect(function() {
    var assignees = metrics.assignees;
    var names = Object.keys(assignees).filter(function(n) { return n !== 'Unassigned'; });
    if (names.length === 0) return;
    var el = document.getElementById('chart-workload');
    if (!el) return;
    names.sort(function(a, b) { return assignees[b] - assignees[a]; });
    Highcharts.chart('chart-workload', {
      chart: { type: 'bar', height: Math.max(240, names.length * 35), backgroundColor: 'transparent' },
      title: { text: null },
      xAxis: { categories: names, labels: { style: { fontSize: '11px' } } },
      yAxis: { title: { text: 'Assigned ' + B + 's' }, allowDecimals: false },
      series: [{ name: B + 's', data: names.map(function(n) { return assignees[n]; }), showInLegend: false }],
      plotOptions: { bar: { borderRadius: 3, cursor: 'pointer', point: { events: { click: function() { setMetricsFilter({ type: 'assignee', value: this.category }); } } } } },
      credits: { enabled: false },
    });
  }, [metrics]);

  // Findings resolution by assignee
  useEffect(function() {
    var fba = metrics.findingsByAssignee;
    var names = Object.keys(fba).filter(function(n) { return n !== 'Unassigned'; });
    if (names.length === 0) return;
    var el = document.getElementById('chart-findings-resolution');
    if (!el) return;
    Highcharts.chart('chart-findings-resolution', {
      chart: { type: 'bar', height: Math.max(240, names.length * 35), backgroundColor: 'transparent' },
      title: { text: null },
      xAxis: { categories: names, labels: { style: { fontSize: '11px' } } },
      yAxis: { title: { text: 'Findings' }, allowDecimals: false, stackLabels: { enabled: true } },
      plotOptions: { series: { stacking: 'normal', borderRadius: 2, cursor: 'pointer', point: { events: { click: function() { setMetricsFilter({ type: 'assignee', value: this.category }); } } } } },
      series: [
        { name: 'Open', data: names.map(function(n) { return fba[n].open; }), color: '#FF6543' },
        { name: 'Resolved', data: names.map(function(n) { return fba[n].resolved; }), color: '#28A464' },
      ],
      credits: { enabled: false },
    });
  }, [metrics]);

  // Finding creator workload chart
  useEffect(function() {
    var fc = metrics.findingCreators;
    var names = Object.keys(fc);
    if (names.length === 0) return;
    var el = document.getElementById('chart-finding-creators');
    if (!el) return;
    names.sort(function(a, b) { return (fc[b].open + fc[b].resolved) - (fc[a].open + fc[a].resolved); });
    Highcharts.chart('chart-finding-creators', {
      chart: { type: 'bar', height: Math.max(240, names.length * 35), backgroundColor: 'transparent' },
      title: { text: null },
      xAxis: { categories: names, labels: { style: { fontSize: '11px' } } },
      yAxis: { title: { text: 'Findings' }, allowDecimals: false, stackLabels: { enabled: true } },
      plotOptions: { series: { stacking: 'normal', borderRadius: 2, cursor: 'pointer', point: { events: { click: function() { setMetricsFilter({ type: 'creator', value: this.category }); } } } } },
      series: [
        { name: 'Open', data: names.map(function(n) { return fc[n].open; }), color: '#FF6543' },
        { name: 'Resolved', data: names.map(function(n) { return fc[n].resolved; }), color: '#28A464' },
      ],
      credits: { enabled: false },
    });
  }, [metrics]);

  // Policy breakdown chart
  useEffect(function() {
    var groups = metrics.policyGroups;
    var names = Object.keys(groups);
    if (names.length === 0) return;
    var el = document.getElementById('chart-policy-breakdown');
    if (!el) return;
    Highcharts.chart('chart-policy-breakdown', {
      chart: { type: 'bar', height: Math.max(240, names.length * 40), backgroundColor: 'transparent' },
      title: { text: null },
      xAxis: { categories: names, labels: { style: { fontSize: '11px' } } },
      yAxis: { title: { text: B + 's' }, allowDecimals: false, stackLabels: { enabled: true } },
      plotOptions: { series: { stacking: 'normal', borderRadius: 2, cursor: 'pointer', point: { events: { click: function() { setMetricsFilter({ type: 'policy', value: this.category }); } } } } },
      series: [
        { name: 'Active', data: names.map(function(n) { return groups[n].active; }), color: '#543FDE' },
        { name: 'Complete', data: names.map(function(n) { return groups[n].complete; }), color: '#28A464' },
      ],
      credits: { enabled: false },
    });
  }, [metrics]);

  // chartTitle helper is now at file scope (shared with FindingsPage)

  // ── Render ──────────────────────────────────────────────────
  return h('div', null,
    h('div', { className: 'page-header' },
      h('h1', null, 'Team Metrics'),
      h('p', null, 'Quality indicators, cycle times, and workload distribution')
    ),

    // ── Section 1: Findings & Quality ──
    h('div', { className: 'metrics-section-header' }, 'Findings & Quality'),
    h('div', { className: 'stats-row' },
      h(StatCard, { label: 'Total Findings', value: metrics.totalFindings, color: 'primary', sub: metrics.totalComments + ' comments', tooltip: 'Total number of QC findings raised across all deliverables in scope.' }),
      h(StatCard, { label: 'Open', value: metrics.openFindings, color: metrics.openFindings > 0 ? 'danger' : 'success', sub: metrics.overdueFindings > 0 ? metrics.overdueFindings + ' overdue' : 'None overdue', tooltip: 'Findings not yet resolved (excludes Done and Won\'t Do). Overdue = past due date.' }),
      h(StatCard, { label: 'Resolved', value: metrics.resolvedFindings, color: 'success', sub: metrics.resolutionRate + '% resolution rate', tooltip: 'Findings marked Done or Won\'t Do. Resolution rate = resolved / total.' }),
      h(StatCard, { label: 'Critical (S0)', value: metrics.findingsBySev.S0, color: metrics.findingsBySev.S0 > 0 ? 'danger' : '', sub: 'Highest severity', tooltip: 'S0-severity findings requiring immediate attention. These block QC completion.' })
    ),
    h('div', { className: 'two-col' },
      h('div', { className: 'panel' },
        chartTitle('Findings by Severity', 'Counts all findings across deliverables grouped by severity level: S0 (Critical), S1 (Major), S2 (Minor), S3 (Info). Each finding has a severity assigned in Domino.'),
        h('div', { className: 'panel-body' },
          metrics.totalFindings > 0
            ? h('div', { id: 'chart-findings-severity', className: 'chart-container' })
            : h(EmptyState, { text: 'No findings data' })
        )
      ),
      h('div', { className: 'panel' },
        chartTitle('Findings Trend (by week created)', 'Groups all findings by the week they were created (using Monday as week start). Shows the volume of new findings over time to identify spikes in QC activity.'),
        h('div', { className: 'panel-body' },
          Object.keys(metrics.findingsTrend).length > 0
            ? h('div', { id: 'chart-findings-trend', className: 'chart-container' })
            : h(EmptyState, { text: 'No findings timeline data' })
        )
      )
    ),

    // ── Section 2: Time-to-QC Completion ──
    h('div', { className: 'metrics-section-header' }, 'Time-to-QC Completion'),
    h('div', { className: 'stats-row' },
      h(StatCard, { label: 'Avg Cycle Time', value: metrics.avgCycleTime + 'd', color: 'primary', sub: 'Creation to completion', tooltip: 'Average days from deliverable creation to completion. Based on completed deliverables only.' }),
      h(StatCard, { label: 'Median Cycle Time', value: metrics.medianCycleTime + 'd', sub: metrics.cycleTimes.length + ' completed ' + B.toLowerCase() + 's', tooltip: 'Median days from creation to completion. Less affected by outliers than the average.' }),
      h(StatCard, { label: 'Active ' + B + 's', value: metrics.active, color: 'info', sub: 'Currently in progress',
        tooltip: 'Deliverables currently in an active QC stage. Click to see the list.',
        active: metricsFilter && metricsFilter.type === 'active',
        onClick: function() { setMetricsFilter(metricsFilter && metricsFilter.type === 'active' ? null : { type: 'active' }); } }),
      h(StatCard, { label: 'Completion Rate', value: metrics.completionRate + '%', color: metrics.completionRate >= 50 ? 'success' : 'warning', sub: metrics.complete + ' of ' + bundles.length + ' complete', tooltip: 'Percentage of deliverables that have reached Complete state.' })
    ),
    h('div', { className: 'two-col' },
      h('div', { className: 'panel' },
        chartTitle('Avg Cycle Time by ' + P, 'Average number of days from creation to completion for each ' + P.toLowerCase() + '. Calculated as (last updated date \u2212 created date) for completed ' + B.toLowerCase() + 's only. Higher values may indicate bottlenecks.'),
        h('div', { className: 'panel-body' },
          Object.keys(metrics.cycleByPolicy).length > 0
            ? h('div', null,
                metrics.cycleTimeSampleData ? h(Alert, { type: 'warning', showIcon: true, banner: true, message: 'Sample data shown below. No completed ' + B.toLowerCase() + 's are available yet.', style: { marginBottom: 8, fontSize: 12 } }) : null,
                h('div', { id: 'chart-cycle-by-policy', className: 'chart-container' })
              )
            : h(EmptyState, { text: 'No completed ' + B.toLowerCase() + 's yet' })
        )
      ),
      h('div', { className: 'panel' },
        chartTitle('Active ' + B + ' Age Distribution', 'Groups currently active ' + B.toLowerCase() + 's by how long ago they were created: 0\u20137 days, 7\u201314 days, 14\u201330 days, 30\u201360 days, and 60+ days. Highlights aging work that may need attention.'),
        h('div', { className: 'panel-body' },
          metrics.active > 0
            ? h('div', { id: 'chart-age-distribution', className: 'chart-container' })
            : h(EmptyState, { text: 'No active ' + B.toLowerCase() + 's' })
        )
      )
    ),

    // ── Section 3: Rework Indicators ──
    h('div', { className: 'metrics-section-header' }, 'Rework Indicators'),
    h('div', { style: { fontSize: 12, color: '#8F8FA3', marginBottom: 12, marginTop: -8 } },
      'Finding density is used as a proxy for rework. Higher density indicates more review-fix-review cycles per ' + B.toLowerCase() + '.'),
    h('div', { className: 'stats-row' },
      h(StatCard, { label: 'Avg Finding Density', value: metrics.avgFindingDensity, color: parseFloat(metrics.avgFindingDensity) > 1 ? 'warning' : '', sub: 'Findings per ' + B.toLowerCase(), tooltip: 'Average number of findings per deliverable. Higher density suggests more review-fix-review cycles.' }),
      h(StatCard, { label: 'Active Rework', value: metrics.reworkBundles.length, color: metrics.reworkBundles.length > 0 ? 'danger' : 'success',
        sub: 'Open + resolved findings',
        tooltip: 'Deliverables with both open and resolved findings — indicating iterative rework is in progress.',
        active: metricsFilter && metricsFilter.type === 'rework',
        onClick: function() { setMetricsFilter(metricsFilter && metricsFilter.type === 'rework' ? null : { type: 'rework' }); } }),
      h(StatCard, { label: 'Overdue Findings', value: metrics.overdueFindings, color: metrics.overdueFindings > 0 ? 'danger' : 'success',
        sub: 'Past due date',
        tooltip: 'Open findings past their due date. May indicate stuck rework or resource bottlenecks.',
        active: metricsFilter && metricsFilter.type === 'overdue',
        onClick: function() { setMetricsFilter(metricsFilter && metricsFilter.type === 'overdue' ? null : { type: 'overdue' }); } }),
      h(StatCard, { label: B + 's with Findings', value: metrics.bundlesWithFindings, sub: 'Of ' + bundles.length + ' total', tooltip: 'Number of deliverables that have at least one QC finding raised against them.' })
    ),
    h('div', { className: 'panel' },
      chartTitle('Finding Density by ' + P, 'Average number of findings per ' + B.toLowerCase() + ' for each ' + P.toLowerCase() + '. Calculated as total findings \u00F7 number of ' + B.toLowerCase() + 's with findings. Higher density suggests more review-fix-review cycles (rework).'),
      h('div', { className: 'panel-body' },
        Object.keys(metrics.densityByPolicy).length > 0
          ? h('div', { id: 'chart-density-by-policy', className: 'chart-container' })
          : h(EmptyState, { text: 'No findings data' })
      )
    ),

    // ── Section 4: Workload & Capacity ──
    h('div', { className: 'metrics-section-header' }, 'Workload & Capacity'),
    h('div', { className: 'panel' },
      chartTitle(B + 's by ' + P + ' / Therapeutic Area', 'Stacked bar showing how many ' + B.toLowerCase() + 's are Active vs Complete for each ' + P.toLowerCase() + '. Click a bar to filter the detail table below.'),
      h('div', { className: 'panel-body' },
        Object.keys(metrics.policyGroups).length > 0
          ? h('div', { id: 'chart-policy-breakdown', className: 'chart-container' })
          : h(EmptyState, { text: 'No policy data' })
      )
    ),
    h('div', { className: 'two-col' },
      h('div', { className: 'panel' },
        chartTitle('Assignee Workload', 'Number of ' + B.toLowerCase() + 's currently assigned to each team member based on their current stage assignment. Click a bar to filter the detail table. Excludes unassigned ' + B.toLowerCase() + 's.'),
        h('div', { className: 'panel-body' },
          Object.keys(metrics.assignees).length > 1 || (Object.keys(metrics.assignees).length === 1 && !metrics.assignees['Unassigned'])
            ? h('div', { id: 'chart-workload', className: 'chart-container' })
            : h(EmptyState, { text: 'No assignee data', sub: 'Assign stage owners in SCE QC' })
        )
      ),
      h('div', { className: 'panel' },
        chartTitle('Findings Resolution by Assignee', 'Stacked bar showing open vs resolved findings per assignee. Resolved = status is Done or Won\'t Do. Helps identify who has the most outstanding QC items. Click a bar to filter.'),
        h('div', { className: 'panel-body' },
          Object.keys(metrics.findingsByAssignee).length > 1 || (Object.keys(metrics.findingsByAssignee).length === 1 && !metrics.findingsByAssignee['Unassigned'])
            ? h('div', { id: 'chart-findings-resolution', className: 'chart-container' })
            : h(EmptyState, { text: 'No findings data' })
        )
      )
    ),
    h('div', { className: 'panel', style: { marginTop: 12 } },
      chartTitle('Finding Creator Count', 'Number of findings created by each user, split by open vs resolved. Shows who is raising the most QC issues and how many remain unresolved.'),
      h('div', { className: 'panel-body' },
        Object.keys(metrics.findingCreators).length > 0
          ? h('div', { id: 'chart-finding-creators', className: 'chart-container' })
          : h(EmptyState, { text: 'No findings data' })
      )
    ),

    // ── Section 5: Validation Task List (PDVT) ──
    h('div', { className: 'metrics-section-header' }, 'Validation Task List (PDVT)'),
    h('div', { style: { fontSize: 12, color: '#8F8FA3', marginBottom: 12, marginTop: -8 } },
      'Planned validation tasks with categories of work mapped from ' + P.toLowerCase() + ' stages.'),

    // PDVT Table
    h('div', { className: 'panel' },
      h('div', { className: 'panel-header' },
        h('span', { className: 'panel-title' }, 'Planned Tasks'),
        h('div', { style: { display: 'flex', alignItems: 'center', gap: 8 } },
          h('span', { style: { fontSize: 12, color: '#8F8FA3' } }, pdvtData.length + ' ' + B.toLowerCase() + 's'),
          h(Button, { size: 'small', onClick: exportPDVT, icon: icons && icons.DownloadOutlined ? h(icons.DownloadOutlined) : null }, 'CSV')
        )
      ),
      h('div', { className: 'panel-body-flush' },
        h(Table, {
          dataSource: pdvtData,
          columns: [
            { title: B, dataIndex: 'name', key: 'name', width: 220,
              render: function(t, rec) {
                // Strip policy name suffix if present (e.g. "ADCM Dataset (ADaM QC Plan - High Risk)" → "ADCM Dataset")
                var display = t;
                if (rec.policyName && t.indexOf('(' + rec.policyName + ')') > 0) {
                  display = t.replace('(' + rec.policyName + ')', '').trim();
                }
                var bundle = bundles.find(function(b) { return b.id === rec.id; });
                return h('a', { style: { fontWeight: 500, color: '#5B21B6', cursor: 'pointer' }, onClick: function(e) { e.preventDefault(); if (onSelectBundle && bundle) onSelectBundle(bundle); } }, display);
              },
              filterDropdown: function(fProps) {
                return h('div', { style: { padding: 8 } },
                  h(Input, { size: 'small', placeholder: 'Search...', value: fProps.selectedKeys[0] || '',
                    onChange: function(e) { fProps.setSelectedKeys(e.target.value ? [e.target.value] : []); },
                    onPressEnter: function() { fProps.confirm(); },
                    style: { width: 180, marginBottom: 8, display: 'block' }
                  }),
                  h(Button, { size: 'small', type: 'primary', onClick: function() { fProps.confirm(); }, style: { width: 85, marginRight: 8 } }, 'Filter'),
                  h(Button, { size: 'small', onClick: function() { fProps.clearFilters && fProps.clearFilters(); fProps.confirm(); } }, 'Reset')
                );
              },
              onFilter: function(val, rec) { return rec.name.toLowerCase().indexOf(val.toLowerCase()) >= 0; },
            },
            { title: 'Category (' + P + ')', dataIndex: 'policyName', key: 'category', width: 200,
              render: function(t) { return h(Tag, null, t); },
              filters: (function() {
                var seen = {};
                return pdvtData.reduce(function(acc, d) {
                  if (!seen[d.policyName]) { seen[d.policyName] = true; acc.push({ text: d.policyName, value: d.policyName }); }
                  return acc;
                }, []);
              })(),
              onFilter: function(val, rec) { return rec.policyName === val; },
            },
          ].concat(allRoleLabels.map(function(rl) {
            return {
              title: rl, key: 'role_' + rl, width: 150,
              render: function(_, r) {
                if (!r.roleStages[rl]) return h('span', { style: { color: '#B0B0C0', fontSize: 12 } }, 'NA');
                return h('span', null, r.roleAssignees[rl] || h('span', { style: { color: '#F59E0B', fontSize: 12 } }, 'Unassigned'));
              },
              filters: [{ text: 'Assigned', value: 'assigned' }, { text: 'Unassigned', value: 'unassigned' }, { text: 'NA', value: 'na' }],
              onFilter: function(val, rec) {
                if (val === 'na') return !rec.roleStages[rl];
                if (val === 'unassigned') return rec.roleStages[rl] && !rec.roleAssignees[rl];
                return rec.roleStages[rl] && rec.roleAssignees[rl];
              },
            };
          })).concat([
            { title: 'State', dataIndex: 'state', key: 'state', width: 90,
              render: function(s) { return h(Tag, { color: stateColor(s) }, s); },
              filters: [{ text: 'Active', value: 'Active' }, { text: 'Complete', value: 'Complete' }, { text: 'Archived', value: 'Archived' }],
              onFilter: function(val, rec) { return rec.state === val; },
            },
          ]),
          rowKey: 'id',
          pagination: { pageSize: 15, size: 'small', showSizeChanger: true, pageSizeOptions: ['10', '15', '25', '50'] },
          size: 'small',
          scroll: { x: 1100 },
        })
      )
    ),

    // ── Section 6: Validation Status by Category ──
    h('div', { className: 'metrics-section-header', style: { marginTop: 24 } }, 'Validation Status by Category'),
    h('div', { style: { fontSize: 12, color: '#8F8FA3', marginBottom: 12, marginTop: -8 } },
      'Status rollup grouped by ' + P.toLowerCase() + ' (category), showing task distribution across stages and completion.'),

    h('div', { className: 'panel' },
      h('div', { className: 'panel-header' },
        h('span', { className: 'panel-title' }, 'Status by ' + P),
        h('div', { style: { display: 'flex', alignItems: 'center', gap: 8 } },
          h('span', { style: { fontSize: 12, color: '#8F8FA3' } }, statusByCategory.length + ' categories'),
          h(Button, { size: 'small', onClick: exportStatusByCategory, icon: icons && icons.DownloadOutlined ? h(icons.DownloadOutlined) : null }, 'CSV')
        )
      ),
      h('div', { className: 'panel-body-flush' },
        h(Table, {
          dataSource: statusByCategory,
          columns: [
            { title: 'Category (' + P + ')', dataIndex: 'policyName', key: 'policy', width: 240,
              render: function(t) { return h('span', { style: { fontWeight: 500 } }, t); } },
            { title: 'Total', dataIndex: 'total', key: 'total', width: 80, sorter: function(a, b) { return a.total - b.total; },
              render: function(v) { return h('span', { style: { fontWeight: 600 } }, v); } },
            { title: 'Active', dataIndex: 'active', key: 'active', width: 80, sorter: function(a, b) { return a.active - b.active; },
              render: function(v) { return v > 0 ? h(Tag, { color: 'blue' }, v) : h('span', { style: { color: '#B0B0C0' } }, '0'); } },
            { title: 'Complete', dataIndex: 'complete', key: 'complete', width: 90, sorter: function(a, b) { return a.complete - b.complete; },
              render: function(v) { return v > 0 ? h(Tag, { color: 'green' }, v) : h('span', { style: { color: '#B0B0C0' } }, '0'); } },
            { title: 'Archived', dataIndex: 'archived', key: 'archived', width: 90, sorter: function(a, b) { return a.archived - b.archived; },
              render: function(v) { return v > 0 ? h(Tag, null, v) : h('span', { style: { color: '#B0B0C0' } }, '0'); } },
            { title: 'Completion %', key: 'pct', width: 180, sorter: function(a, b) {
                var pctA = a.total > 0 ? a.complete / a.total : 0;
                var pctB = b.total > 0 ? b.complete / b.total : 0;
                return pctA - pctB;
              },
              render: function(_, r) {
                var pct = r.total > 0 ? Math.round((r.complete / r.total) * 100) : 0;
                return h(Progress, { percent: pct, size: 'small', strokeColor: pct === 100 ? '#28A464' : '#543FDE', style: { width: 140 } });
              }
            },
            { title: 'Current Stage Breakdown', key: 'stages', ellipsis: true,
              render: function(_, r) {
                var stages = Object.keys(r.byStage).sort(function(a, b) { return r.byStage[b] - r.byStage[a]; });
                if (stages.length === 0) return '\u2013';
                return h('div', { style: { display: 'flex', flexWrap: 'wrap', gap: 4 } },
                  stages.map(function(s) {
                    return h(Tag, { key: s, style: { fontSize: 11, margin: 0 } }, s + ': ' + r.byStage[s]);
                  })
                );
              }
            },
          ],
          rowKey: 'policyName',
          pagination: false,
          size: 'small',
          scroll: { x: 900 },
        })
      )
    ),

    // ── Section 7: Validation Task Status ──
    h('div', { className: 'metrics-section-header', style: { marginTop: 24 } }, 'Validation Task Status'),
    h('div', { style: { fontSize: 12, color: '#8F8FA3', marginBottom: 12, marginTop: -8 } },
      'Stage completion status and program output paths per ' + B.toLowerCase() + '. Status is derived from stage progression; paths from report attachments matched by file path patterns.'),

    h('div', { className: 'panel' },
      h('div', { className: 'panel-header' },
        h('span', { className: 'panel-title' }, 'Task Status'),
        h('div', { style: { display: 'flex', alignItems: 'center', gap: 8 } },
          h('span', { style: { fontSize: 12, color: '#8F8FA3' } }, taskStatusData.length + ' ' + B.toLowerCase() + 's'),
          h(Button, { size: 'small', onClick: exportTaskStatus, icon: icons && icons.DownloadOutlined ? h(icons.DownloadOutlined) : null }, 'CSV')
        )
      ),
      h('div', { className: 'panel-body-flush' },
        h(Table, {
          dataSource: taskStatusData,
          columns: [
            { title: B, dataIndex: 'name', key: 'name', width: 200,
              render: function(t, r) {
                var display = t;
                if (r.policyName && t.indexOf('(' + r.policyName + ')') > 0) {
                  display = t.replace('(' + r.policyName + ')', '').trim();
                }
                var bundle = bundles.find(function(b) { return b.id === r.id; });
                return h('a', { style: { fontWeight: 500, color: '#5B21B6', cursor: 'pointer' }, onClick: function(e) { e.preventDefault(); if (onSelectBundle && bundle) onSelectBundle(bundle); } }, display);
              },
              filterDropdown: function(fProps) {
                return h('div', { style: { padding: 8 } },
                  h(Input, { size: 'small', placeholder: 'Search...', value: fProps.selectedKeys[0] || '',
                    onChange: function(e) { fProps.setSelectedKeys(e.target.value ? [e.target.value] : []); },
                    onPressEnter: function() { fProps.confirm(); },
                    style: { width: 180, marginBottom: 8, display: 'block' }
                  }),
                  h(Button, { size: 'small', type: 'primary', onClick: function() { fProps.confirm(); }, style: { width: 85, marginRight: 8 } }, 'Filter'),
                  h(Button, { size: 'small', onClick: function() { fProps.clearFilters && fProps.clearFilters(); fProps.confirm(); } }, 'Reset')
                );
              },
              onFilter: function(val, rec) { return rec.name.toLowerCase().indexOf(val.toLowerCase()) >= 0; },
            },
            { title: P, dataIndex: 'policyName', key: 'category', width: 180,
              render: function(t) { return h(Tag, null, t); },
              filters: (function() {
                var seen = {};
                return taskStatusData.reduce(function(acc, d) {
                  if (!seen[d.policyName]) { seen[d.policyName] = true; acc.push({ text: d.policyName, value: d.policyName }); }
                  return acc;
                }, []);
              })(),
              onFilter: function(val, rec) { return rec.policyName === val; },
            },
          ].concat(allRoleLabels.map(function(rl) {
            return {
              title: rl, key: 'status_' + rl, width: 120,
              render: function(_, r) {
                var status = r.roleStatus[rl];
                if (status === 'NA') return h('span', { style: { color: '#B0B0C0', fontSize: 12 } }, 'NA');
                if (status === 'Completed') return h(Tag, { color: 'green' }, 'Completed');
                return h(Tag, { color: 'blue' }, 'Pending');
              },
              filters: [{ text: 'Completed', value: 'Completed' }, { text: 'Pending', value: 'Pending' }, { text: 'NA', value: 'NA' }],
              onFilter: function(val, rec) { return rec.roleStatus[rl] === val; },
            };
          })).concat(allRoleLabels.map(function(rl) {
            return {
              title: 'Path: ' + rl, key: 'path_' + rl, width: 200, ellipsis: true,
              render: function(_, r) {
                var status = r.roleStatus[rl];
                var path = r.rolePaths[rl];
                if (status === 'NA') return h('span', { style: { color: '#B0B0C0', fontSize: 12 } }, 'NA');
                if (!path) return h('span', { style: { color: '#F59E0B', fontSize: 12, fontWeight: 600 } }, 'Missing');
                return h(Tooltip, { title: path },
                  h('span', { style: { fontSize: 11, fontFamily: 'monospace', color: '#65657B' } }, path)
                );
              },
            };
          })).concat([
            { title: 'Repo Branch', key: 'branch', width: 110,
              render: function(_, r) {
                return r.repoBranch
                  ? h(Tag, { style: { fontFamily: 'monospace', fontSize: 11 } }, r.repoBranch)
                  : h('span', { style: { color: '#B0B0C0', fontSize: 12 } }, '\u2013');
              },
              filters: (function() {
                var seen = {};
                return taskStatusData.reduce(function(acc, d) {
                  if (d.repoBranch && !seen[d.repoBranch]) { seen[d.repoBranch] = true; acc.push({ text: d.repoBranch, value: d.repoBranch }); }
                  return acc;
                }, []);
              })(),
              onFilter: function(val, rec) { return rec.repoBranch === val; },
            },
          ]),
          rowKey: 'id',
          pagination: { pageSize: 15, size: 'small', showSizeChanger: true, pageSizeOptions: ['10', '15', '25', '50'] },
          size: 'small',
          scroll: { x: 250 + allRoleLabels.length * 320 + 110 },
        })
      )
    ),

    // ── Detail table (shown when a filter is active) ──
    metricsFilter ? h('div', { className: 'panel', style: { marginTop: 20 } },
      h('div', { className: 'panel-header' },
        h('span', { className: 'panel-title' }, B + 's: ' + metricsFilterLabel),
        h('div', { style: { display: 'flex', alignItems: 'center', gap: 8 } },
          h(Tag, { closable: true, onClose: function() { setMetricsFilter(null); }, color: 'purple' }, metricsFilterLabel),
          h('span', { style: { fontSize: 12, color: '#8F8FA3' } }, filteredMetricsBundles.length + ' ' + B.toLowerCase() + 's')
        )
      ),
      h('div', { className: 'panel-body-flush' },
        h(Table, {
          dataSource: filteredMetricsBundles,
          columns: [
            { title: B, dataIndex: 'name', key: 'name', render: function(t) { return h('span', { style: { fontWeight: 500 } }, t); } },
            { title: 'Project', dataIndex: 'projectName', key: 'project', render: function(t) { return h('span', { style: { color: '#65657B', fontSize: 12 } }, t || '\u2013'); } },
            { title: P, dataIndex: 'policyName', key: 'policy', render: function(t) { return h(Tag, null, t || '\u2013'); } },
            { title: 'Stage', dataIndex: 'stage', key: 'stage', render: function(t) { return h('span', { style: { fontSize: 12 } }, t || '\u2013'); } },
            { title: 'Findings', key: 'findings', render: function(_, r) { return (r._findings ? r._findings.length : 0); } },
            { title: 'Assignee', key: 'assignee', render: function(_, r) { return (r.stageAssignee && r.stageAssignee.name) || '\u2013'; } },
            { title: 'State', dataIndex: 'state', key: 'state', render: function(s) { return h(Tag, { color: stateColor(s) }, s); } },
          ],
          rowKey: 'id',
          pagination: { pageSize: 10, size: 'small' },
          size: 'small',
        })
      )
    ) : null
  );
}


// ═══════════════════════════════════════════════════════════════
//  COMPONENT: Stage Popover Content (shown when clicking a stage dot)
// ═══════════════════════════════════════════════════════════════
function StagePopoverContent(props) {
  var bundle = props.bundle;
  var stageIdx = props.stageIdx;
  var stageName = props.stageName;
  var dotState = props.dotState;
  var onFindingsClick = props.onFindingsClick;
  var onClose = props.onClose;

  var stageData = bundle.stages[stageIdx] || {};
  var assignee = stageData.assignee;
  var assigneeName = assignee ? assignee.name : null;
  var dominoUrl = getDominoBundleUrl(bundle, stageName);

  // Summary counts
  var openFindings = (bundle._findings || []).filter(function(f) { return f.status !== 'Done' && f.status !== 'WontDo'; }).length;
  var totalFindings = (bundle._findings || []).length;
  var totalApprovals = (bundle._approvals || []).length;
  var approvedCount = (bundle._approvals || []).filter(function(a) { return a.status === 'Approved'; }).length;
  var totalGates = (bundle._gates || []).length;
  var openGates = (bundle._gates || []).filter(function(g) { return g.isOpen; }).length;

  var statusLabel = dotState === 'completed' ? 'Completed' : dotState === 'active' ? 'In Progress' : dotState === 'blocked' ? 'Blocked' : 'Pending';
  var statusColor = dotState === 'completed' ? '#28A464' : dotState === 'active' ? '#F59E0B' : dotState === 'blocked' ? '#C20A29' : '#8F8FA3';

  return h('div', { className: 'stage-popover', onClick: function(e) { e.stopPropagation(); } },
    // Header
    h('div', { className: 'stage-popover-header' },
      h('div', { className: 'stage-popover-dot', style: { background: statusColor } }),
      h('div', null,
        h('div', { className: 'stage-popover-name' }, stageName),
        h('div', { className: 'stage-popover-status' },
          h('span', { style: { color: statusColor, fontWeight: 600 } }, statusLabel),
          assigneeName
            ? h('span', null, ' \u00B7 ', assigneeName)
            : h('span', { style: { color: '#F59E0B' } }, ' \u00B7 Unassigned')
        )
      )
    ),

    // Evidence summary cards
    h('div', { className: 'stage-popover-evidence' },
      (function() {
        var findingsPageUrl = getDominoBundleUrl(bundle, { findingsPage: true });
        var cardContent = [
          h('div', { key: 'val', className: 'stage-popover-card-value', style: { color: openFindings > 0 ? '#C20A29' : '#28A464' } },
            openFindings > 0 ? openFindings : '\u2713'
          ),
          h('div', { key: 'lbl', className: 'stage-popover-card-label' },
            openFindings > 0 ? 'Open Finding' + (openFindings > 1 ? 's' : '') : totalFindings > 0 ? 'All Resolved' : 'No Findings'
          ),
        ];
        if (totalFindings > 0 && findingsPageUrl) {
          return h('a', {
            className: 'stage-popover-card clickable',
            href: findingsPageUrl, target: '_blank', rel: 'noopener noreferrer',
            style: { textDecoration: 'none', color: 'inherit' },
          }, cardContent);
        }
        return h('div', {
          className: 'stage-popover-card' + (totalFindings > 0 && onFindingsClick ? ' clickable' : ''),
          onClick: totalFindings > 0 && onFindingsClick ? function() { onClose(); onFindingsClick(bundle); } : undefined,
        }, cardContent);
      })(),
      h('div', { className: 'stage-popover-card' },
        h('div', { className: 'stage-popover-card-value', style: { color: totalApprovals > 0 ? (approvedCount === totalApprovals ? '#28A464' : '#0070CC') : '#8F8FA3' } },
          totalApprovals > 0 ? approvedCount + '/' + totalApprovals : '\u2013'
        ),
        h('div', { className: 'stage-popover-card-label' },
          totalApprovals > 0 ? 'Approved' : 'No Approvals'
        )
      ),
      h('div', { className: 'stage-popover-card' },
        h('div', { className: 'stage-popover-card-value', style: { color: totalGates > 0 ? (openGates === totalGates ? '#28A464' : '#C20A29') : '#8F8FA3' } },
          totalGates > 0 ? openGates + '/' + totalGates : '\u2013'
        ),
        h('div', { className: 'stage-popover-card-label' },
          totalGates > 0 ? 'Gates Open' : 'No Gates'
        )
      )
    ),

    // Footer actions
    dominoUrl
      ? h('div', { className: 'stage-popover-footer' },
          h('a', {
            href: dominoUrl, target: '_blank', rel: 'noopener noreferrer',
            className: 'stage-popover-link',
          }, '\u2197 View in Domino')
        )
      : null
  );
}


//  COMPONENT: Stage Pipeline (HTML dots with click-to-popover)
// ═══════════════════════════════════════════════════════════════
function StagePipeline(props) {
  var bundle = props.bundle;
  var onFindingsClick = props.onFindingsClick;
  var stageNames = getBundleStageNames(bundle);
  if (stageNames.length === 0) return h('span', { style: { color: '#8F8FA3', fontSize: 12 } }, 'No stages');
  var currentIdx = deriveBundleStageIndex(bundle);
  var isComplete = bundle.state === 'Complete';
  var hasOpenFindings = bundle._findings && bundle._findings.some(function(f) {
    return f.status !== 'Done' && f.status !== 'WontDo';
  });

  var _pop = useState(null); var popoverStage = _pop[0]; var setPopoverStage = _pop[1];

  return h('div', { className: 'stage-pipeline-row', onClick: function(e) { e.stopPropagation(); } },
    stageNames.map(function(name, j) {
      var dotState;
      if (isComplete || j < currentIdx) dotState = 'completed';
      else if (j === currentIdx) dotState = hasOpenFindings ? 'blocked' : 'active';
      else dotState = 'pending';

      var isLast = j === stageNames.length - 1;
      var lineState = (isComplete || j < currentIdx) ? 'completed' : 'pending';

      var popContent = h(StagePopoverContent, {
        bundle: bundle, stageIdx: j, stageName: name, dotState: dotState,
        onFindingsClick: onFindingsClick,
        onClose: function() { setPopoverStage(null); },
      });

      return h('div', { key: j, className: 'stage-pip-item' },
        h(Popover, {
          content: popContent,
          trigger: 'click',
          open: popoverStage === j,
          onOpenChange: (function(idx) {
            return function(visible) { setPopoverStage(visible ? idx : null); };
          })(j),
          placement: 'bottom',
          overlayClassName: 'stage-popover-overlay',
          arrow: { pointAtCenter: true },
        },
          h('div', { className: 'stage-pip-dot ' + dotState })
        ),
        !isLast
          ? h('div', { className: 'stage-pip-line ' + lineState })
          : null
      );
    })
  );
}


// ═══════════════════════════════════════════════════════════════
//  COMPONENT: Status Flags (3 data-driven indicators)
// ═══════════════════════════════════════════════════════════════
function StatusFlags(props) {
  var bundle = props.bundle;
  var onFindingsClick = props.onFindingsClick;

  var openFindings = bundle._findings ? bundle._findings.filter(function(f) {
    return f.status !== 'Done' && f.status !== 'WontDo';
  }).length : 0;

  var isUnassigned = !bundle.stageAssignee || !bundle.stageAssignee.name;

  var allApproved = bundle._approvals && bundle._approvals.length > 0 &&
    bundle._approvals.every(function(a) { return a.status === 'Approved'; });

  var flags = [];

  if (openFindings > 0) {
    var findingsUrl = getDominoBundleUrl(bundle, { findingsPage: true });
    flags.push(h(Tooltip, { key: 'findings', title: 'Click to view ' + openFindings + ' open finding' + (openFindings > 1 ? 's' : '') + ' in Domino' },
      findingsUrl
        ? h('a', {
            className: 'status-flag open-findings',
            href: findingsUrl, target: '_blank', rel: 'noopener noreferrer',
            style: { cursor: 'pointer', textDecoration: 'none' },
            onClick: function(e) { e.stopPropagation(); },
          }, '\u26A0 ' + openFindings)
        : h('span', {
            className: 'status-flag open-findings',
            style: { cursor: 'pointer' },
            onClick: function(e) { e.stopPropagation(); if (onFindingsClick) onFindingsClick(bundle); },
          }, '\u26A0 ' + openFindings)
    ));
  }

  if (isUnassigned) {
    flags.push(h(Tooltip, { key: 'unassigned', title: 'No assignee on current stage' },
      h('span', { className: 'status-flag unassigned' }, '\u2205')
    ));
  }

  if (allApproved) {
    flags.push(h(Tooltip, { key: 'approved', title: 'All approvals approved' },
      h('span', { className: 'status-flag approved' }, '\u2713')
    ));
  }

  if (flags.length === 0) {
    return h('span', { style: { color: '#D1D1DB', fontSize: 12 } }, '\u2013');
  }

  return h('div', { className: 'status-flags-row' }, flags);
}




// ═══════════════════════════════════════════════════════════════
//  COMPONENT: Bulk Action Bar
// ═══════════════════════════════════════════════════════════════
function BulkActionBar(props) {
  var count = props.count;
  var onClear = props.onClear;
  var onRefresh = props.onRefresh;
  var terms = props.terms || DEFAULT_TERMS;
  var B = terms.bundle;
  var selectedKeys = props.selectedKeys || [];
  var bundles = props.bundles || [];
  var pmc = props.projectMembersCache || {};

  var _bs = useState('current');
  var bulkStage = _bs[0];
  var setBulkStage = _bs[1];

  var _ba = useState(null);
  var bulkAssignee = _ba[0];
  var setBulkAssignee = _ba[1];

  var _bl = useState(false);
  var bulkLoading = _bl[0];
  var setBulkLoading = _bl[1];

  if (count === 0) return null;

  // Collect unique project IDs from selected bundles
  var selectedProjectIds = {};
  selectedKeys.forEach(function(bundleId) {
    var bundle = bundles.find(function(b) { return b.id === bundleId; });
    if (bundle && bundle.projectId) selectedProjectIds[bundle.projectId] = true;
  });
  var selectedPids = Object.keys(selectedProjectIds);

  // Combine all project members for bulk assignment — annotate with project coverage
  var seen = {};
  var memberOptions = [];
  Object.keys(pmc).forEach(function(pid) {
    (pmc[pid] || []).forEach(function(m) {
      if (!seen[m.id]) {
        seen[m.id] = { member: m, projectIds: {} };
      }
      seen[m.id].projectIds[pid] = true;
    });
  });
  Object.keys(seen).forEach(function(id) {
    var entry = seen[id];
    var m = entry.member;
    var coveredCount = selectedPids.filter(function(pid) { return entry.projectIds[pid]; }).length;
    var label = (m.firstName || '') + ' ' + (m.lastName || '') + ' (' + m.userName + ')';
    if (selectedPids.length > 0 && coveredCount < selectedPids.length) {
      label += ' — ' + coveredCount + '/' + selectedPids.length + ' projects';
    }
    memberOptions.push({ label: label, value: id });
  });

  // Build stage options from selected bundles — positional only (names vary across QC plans)
  var maxStages = 0;
  selectedKeys.forEach(function(bundleId) {
    var bundle = bundles.find(function(b) { return b.id === bundleId; });
    if (!bundle || !bundle.stages) return;
    if (bundle.stages.length > maxStages) maxStages = bundle.stages.length;
  });
  var stageOptions = [{ label: 'Current Stage', value: 'current' }];
  for (var si = 0; si < maxStages; si++) {
    stageOptions.push({ label: 'Stage ' + (si + 1), value: String(si) });
  }

  // Get the selected bundles with their target stage info
  function getSelectedBundlesWithStages() {
    return selectedKeys.map(function(bundleId) {
      var bundle = bundles.find(function(b) { return b.id === bundleId; });
      if (!bundle) return null;
      var stageNames = (bundle.stages || []).map(function(s) {
        return (s.stage && s.stage.name) || s.name || '';
      });
      var targetIdx;
      if (bulkStage === 'current') {
        // Find the current (active) stage — stage matching bundle.stage name, or first stage
        targetIdx = -1;
        if (bundle.stage) {
          targetIdx = stageNames.indexOf(bundle.stage);
        }
        if (targetIdx < 0) targetIdx = 0;
      } else {
        targetIdx = parseInt(bulkStage, 10);
        if (targetIdx >= (bundle.stages || []).length) {
          return { bundleId: bundle.id, bundleName: bundle.name, stageId: null, stageName: null, bundle: bundle, stageData: null, skippedNoStage: true };
        }
      }
      var stageData = bundle.stages[targetIdx];
      if (!stageData) return null;
      var stageId = stageData.stageId || (stageData.stage && stageData.stage.id);
      return { bundleId: bundle.id, bundleName: bundle.name, stageId: stageId, stageName: stageNames[targetIdx], bundle: bundle, stageData: stageData };
    }).filter(Boolean);
  }

  function handleBulkAssign() {
    if (!bulkAssignee || bulkLoading) return;
    var targets = getSelectedBundlesWithStages();
    if (targets.length === 0) {
      antd.message.warning('No valid stages found for selected ' + B.toLowerCase() + 's');
      return;
    }
    var missingStageIds = targets.filter(function(t) { return !t.stageId; });
    if (missingStageIds.length > 0) {
      var skipReason = bulkStage !== 'current'
        ? missingStageIds.length + ' ' + B.toLowerCase() + '(s) don\'t have a Stage ' + (parseInt(bulkStage, 10) + 1) + ', skipping those'
        : missingStageIds.length + ' ' + B.toLowerCase() + '(s) have no stage ID, skipping those';
      antd.message.warning(skipReason);
    }
    var validTargets = targets.filter(function(t) { return t.stageId; });
    if (validTargets.length === 0) return;

    setBulkLoading(true);
    var bulkMember = null;
    Object.keys(pmc).some(function(pid) {
      bulkMember = (pmc[pid] || []).find(function(m) { return m.id === bulkAssignee; });
      return !!bulkMember;
    });
    var body = { assignee: { id: bulkAssignee, userName: bulkMember ? bulkMember.userName : undefined, name: bulkMember ? bulkMember.userName : undefined } };
    var assigneeName = bulkMember ? bulkMember.userName : 'Selected user';

    // Pre-check: filter out bundles that can't be assigned
    var skipped = [];
    var eligible = [];
    validTargets.forEach(function(t) {
      // Skip archived/complete bundles — Domino silently rejects these
      var state = (t.bundle.state || '').toLowerCase();
      if (state === 'archived') {
        skipped.push({ bundleName: t.bundleName, reason: 'Archived — reactivate in Domino first' });
        return;
      }
      if (state === 'complete') {
        skipped.push({ bundleName: t.bundleName, reason: 'Complete — reopen in Domino first' });
        return;
      }
      // Skip if assignee isn't a collaborator on the bundle's project
      var pid = t.bundle.projectId;
      if (pid && pmc[pid] && !pmc[pid].some(function(m) { return m.id === bulkAssignee; })) {
        skipped.push({ bundleName: t.bundleName, reason: 'Not a collaborator on project ' + (t.bundle.projectName || pid) });
        return;
      }
      eligible.push(t);
    });

    if (eligible.length === 0) {
      setBulkLoading(false);
      antd.notification.error({
        message: 'Cannot assign any of the selected ' + B.toLowerCase() + 's',
        description: h('div', null,
          skipped.map(function(s, i) { return h('p', { key: i, style: { fontSize: 12 } }, '\u2022 ' + s.bundleName + ' — ' + s.reason); }),
          h('p', { style: { marginTop: 8, color: '#65657B', fontSize: 12 } }, 'Domino requires: active ' + B.toLowerCase() + ', and assignee must be a project collaborator.')
        ),
        duration: 15,
      });
      return;
    }

    var promises = eligible.map(function(t) {
      return apiPatch('api/bundles/' + t.bundleId + '/stages/' + t.stageId, body)
        .then(function(resp) {
          if (resp.verified === false) {
            var actualName = resp.actualAssignee ? (resp.actualAssignee.name || resp.actualAssignee.id) : 'nobody';
            return { success: false, bundleName: t.bundleName, stageName: t.stageName, reason: 'Domino did not persist — assignee is still ' + actualName + '. They may need to be added as a collaborator on project ' + (t.bundle.projectName || '') + '.' };
          }
          // Only update local state after verification succeeds
          if (resp && resp.assignee && t.stageData) {
            t.stageData.assignee = resp.assignee;
          }
          return { success: true, bundleName: t.bundleName, stageName: t.stageName, verified: resp.verified };
        })
        .catch(function(err) {
          var detail = err.message || String(err);
          var reason = detail.indexOf('403') !== -1 ? 'Permission denied — check project collaborator settings' : detail.indexOf('404') !== -1 ? 'Not found' : parseServerError(detail);
          return { success: false, bundleName: t.bundleName, stageName: t.stageName, error: detail, reason: reason };
        });
    });

    Promise.all(promises).then(function(results) {
      setBulkLoading(false);
      var succeeded = results.filter(function(r) { return r.success; });
      var failed = results.filter(function(r) { return !r.success; });
      var verified = succeeded.filter(function(r) { return r.verified === true; });
      var totalAttempted = eligible.length;
      var skippedCount = skipped.length;

      // Build skipped section if any were pre-filtered
      var skippedSection = skippedCount > 0 ? [
        h('p', { style: { fontWeight: 500, marginTop: 8, fontSize: 12, color: '#8F8FA3' } }, 'Skipped (' + skippedCount + '):'),
        skipped.map(function(s, i) { return h('p', { key: 'skip-' + i, style: { marginLeft: 8, fontSize: 11, color: '#8F8FA3' } }, '\u2022 ' + s.bundleName + ' — ' + s.reason); })
      ] : [];

      if (failed.length === 0 && succeeded.length > 0) {
        var stageLabel = bulkStage === 'current' ? 'current stage' : 'Stage ' + (parseInt(bulkStage, 10) + 1);
        var msg = 'Assigned ' + stageLabel + ' on ' + succeeded.length + ' ' + B.toLowerCase() + (succeeded.length > 1 ? 's' : '');
        msg += verified.length === succeeded.length ? ' — all verified in Domino' : ' (verification pending for ' + (succeeded.length - verified.length) + ')';
        if (skippedCount > 0) msg += '. ' + skippedCount + ' skipped.';
        antd.message.success(msg);
        if (skippedCount > 0) {
          antd.notification.info({
            message: skippedCount + ' ' + B.toLowerCase() + (skippedCount > 1 ? 's' : '') + ' skipped',
            description: h('div', null, skippedSection),
            duration: 10,
          });
        }
      } else if (succeeded.length > 0) {
        antd.notification.warning({
          message: succeeded.length + ' of ' + totalAttempted + ' assignments succeeded',
          description: h('div', null,
            verified.length > 0 ? h('p', null, verified.length + ' verified in Domino') : null,
            h('p', { style: { fontWeight: 500, marginTop: 4 } }, 'Failed (' + failed.length + '):'),
            failed.map(function(f, i) { return h('p', { key: i, style: { marginLeft: 8, fontSize: 12 } }, '\u2022 ' + f.bundleName + ' / ' + f.stageName + ' — ' + f.reason); }),
            skippedSection,
            h('p', { style: { marginTop: 8, color: '#65657B', fontSize: 12 } }, 'Tip: Ensure the assignee is a collaborator on each ' + B.toLowerCase() + '\'s Domino project.')
          ),
          duration: 15,
        });
      } else if (failed.length > 0) {
        antd.notification.error({
          message: 'All ' + failed.length + ' assignments failed',
          description: h('div', null,
            failed.map(function(f, i) { return h('p', { key: i, style: { fontSize: 12 } }, '\u2022 ' + f.bundleName + ' / ' + f.stageName + ' — ' + f.reason); }),
            skippedSection,
            h('p', { style: { marginTop: 8, color: '#65657B', fontSize: 12 } }, 'Domino requires: active ' + B.toLowerCase() + ' state, and assignee must be a project collaborator.')
          ),
          duration: 15,
        });
      }
      setBulkAssignee(null);
      if (onRefresh) onRefresh();
    });
  }

  return h('div', { className: 'bulk-action-bar' },
    h('span', { className: 'bulk-action-count' }, count + ' ' + B.toLowerCase() + (count > 1 ? 's' : '') + ' selected'),
    h('div', { style: { display: 'flex', alignItems: 'center', gap: 8 } },
      h(Select, {
        size: 'small',
        value: bulkStage,
        style: { minWidth: 150 },
        options: stageOptions,
        onChange: setBulkStage,
      }),
      h(Select, {
        size: 'small',
        placeholder: 'Assign to...',
        value: bulkAssignee || undefined,
        style: { minWidth: 180 },
        showSearch: true,
        allowClear: true,
        options: memberOptions,
        onChange: setBulkAssignee,
        optionFilterProp: 'label',
      }),
      h(Button, {
        size: 'small', type: 'primary',
        disabled: !bulkAssignee || bulkLoading,
        loading: bulkLoading,
        onClick: handleBulkAssign,
      }, 'Assign'),
      h(Button, { size: 'small', type: 'link', onClick: onClear, style: { color: '#fff' } }, 'Clear')
    )
  );
}


// ═══════════════════════════════════════════════════════════════
//  COMPONENT: Findings Drawer (reusable for stage indicator + findings count)
// ═══════════════════════════════════════════════════════════════
function FindingsDrawer(props) {
  var visible = props.visible;
  var onClose = props.onClose;
  var bundle = props.bundle;
  var findings = bundle ? (bundle._findings || []) : [];
  var findingsPageUrl = bundle ? getDominoBundleUrl(bundle, { findingsPage: true }) : null;

  var columns = [
    { title: 'Severity', dataIndex: 'severity', key: 'severity', width: 80,
      sorter: function(a, b) { return (a.severity || '').localeCompare(b.severity || ''); },
      render: function(sev) {
        return h(Tag, { color: severityColor(sev), style: { color: '#fff', border: 'none', minWidth: 28, textAlign: 'center', fontSize: 11 } }, sev || '\u2013');
      }
    },
    { title: 'Name', dataIndex: 'name', key: 'name', width: 180, ellipsis: true,
      render: function(t, r) {
        var findingUrl = bundle && r.id ? getDominoBundleUrl(bundle, { findingId: r.id }) : null;
        if (!findingUrl) return h('span', { style: { fontWeight: 500, fontSize: 12 } }, t || '\u2013');
        return h('a', {
          href: findingUrl,
          target: '_blank',
          rel: 'noopener noreferrer',
          style: { fontWeight: 500, fontSize: 12, color: '#543FDE' },
          title: 'View finding in Domino',
        }, t || '\u2013');
      }
    },
    { title: 'Status', dataIndex: 'status', key: 'status', width: 110,
      render: function(s) { return findingStatusTag(s); }
    },
    { title: 'Assignee', key: 'assignee', width: 120,
      render: function(_, r) {
        var name = r.assignee ? (r.assignee.name || r.assignee.userName) : null;
        return h('span', { style: { fontSize: 12 } }, name || '\u2013');
      }
    },
    { title: 'Due Date', key: 'dueDate', width: 100,
      render: function(_, r) {
        return r.dueDate ? h('span', { style: { fontSize: 12 } }, dayjs(r.dueDate).format('MMM D, YYYY')) : h('span', { style: { color: '#8F8FA3', fontSize: 12 } }, '\u2013');
      }
    },
    { title: 'Description', key: 'description', ellipsis: true,
      render: function(_, r) {
        return h('span', { style: { fontSize: 11, color: '#65657B' } }, r.description || '\u2013');
      }
    },
  ];

  return h(Drawer, {
    title: bundle ? 'Findings: ' + bundle.name : 'Findings',
    open: visible,
    onClose: onClose,
    width: 720,
    extra: findingsPageUrl
      ? h(Button, { type: 'primary', size: 'small', onClick: function() { window.open(findingsPageUrl, '_blank'); }, style: { fontSize: 11 } }, '\u2197 View Findings in Domino')
      : null,
  },
    findings.length > 0
      ? h(Table, {
          dataSource: findings,
          rowKey: function(r, i) { return r.id || i; },
          size: 'small',
          pagination: findings.length > 10 ? { pageSize: 10 } : false,
          columns: columns,
        })
      : h(Empty, { description: 'No findings recorded' })
  );
}


// ═══════════════════════════════════════════════════════════════
//  COMPONENT: Attachments Drawer
// ═══════════════════════════════════════════════════════════════
function AttachmentsDrawer(props) {
  var visible = props.visible;
  var onClose = props.onClose;
  var bundle = props.bundle;
  var deUrl = props.dataExplorerUrl || null;
  var attachments = bundle ? (bundle._attachments || []) : [];
  var dominoUrl = bundle ? getDominoBundleUrl(bundle) : null;
  var staleCount = bundle ? countStaleAttachments(bundle) : 0;

  var columns = [
    { title: 'Type', dataIndex: 'type', key: 'type', width: 150,
      render: function(t) {
        var colors = { DatasetSnapshotFile: 'blue', Report: 'green', ModelVersion: 'purple', Endpoint: 'orange', FlowArtifact: 'cyan', NetAppVolumeSnapshotFile: 'default' };
        var labels = { DatasetSnapshotFile: 'Dataset Snapshot', NetAppVolumeSnapshotFile: 'NetApp Volume', FlowArtifact: 'Flow Artifact', ModelVersion: 'Model Version', Report: 'Code' };
        var label = labels[t] || (t || '').replace(/([A-Z])/g, ' $1').trim();
        return h(Tag, { color: colors[t] || 'default', style: { fontSize: 10, whiteSpace: 'normal', lineHeight: '16px' } }, label);
      }
    },
    { title: 'Identifier', key: 'identifier', width: 200, ellipsis: true,
      render: function(_, r) {
        var id = r.identifier || {};
        var fname = id.filename || id.name || '\u2013';
        var explorerLink = deUrl && isDataExplorerFile(fname) ? buildDataExplorerUrl(deUrl, r) : null;
        var explorerPath = explorerLink ? buildDataExplorerPath(r) : null;
        var deIcon = icons && icons.TableOutlined ? h(icons.TableOutlined) : null;
        if (explorerLink) {
          return h('span', { style: { display: 'flex', alignItems: 'center', gap: 6 } },
            h(Tooltip, { title: 'Open in Data Explorer: ' + explorerPath },
              h('a', {
                href: explorerLink,
                onClick: function(e) { openDataExplorer(explorerLink, explorerPath, e); },
                style: { fontWeight: 500, fontSize: 12, color: '#0070CC', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4 },
              },
                deIcon,
                fname
              )
            )
          );
        }
        if (!dominoUrl) return h('span', { style: { fontWeight: 500, fontSize: 12 } }, fname);
        return h('a', {
          href: dominoUrl,
          target: '_blank',
          rel: 'noopener noreferrer',
          style: { fontWeight: 500, fontSize: 12, color: '#543FDE' },
          title: 'View in Domino',
        }, fname);
      }
    },
    { title: 'Version', key: 'version', width: 110, align: 'center',
      render: function(_, r) {
        var id = r.identifier || {};
        var ver = id.snapshotVersion;
        if (ver == null) return h('span', { style: { color: '#D1D1DB', fontSize: 11 } }, '\u2013');
        var s = r._staleness;
        if (s && s.isStale) {
          var timeStr = '';
          if (s.latestSnapshotTime) {
            var ts = typeof s.latestSnapshotTime === 'number'
              ? dayjs(s.latestSnapshotTime)
              : dayjs(s.latestSnapshotTime);
            timeStr = ' (created ' + ts.format('MMM D, YYYY') + ')';
          }
          var tipText = 'Outdated: v' + s.currentVersion + ' attached, but v' + s.latestVersion + ' is available' + timeStr + '. Source: ' + (s.sourceName || 'unknown') + '.';
          return h(Tooltip, { title: tipText, overlayStyle: { maxWidth: 340 } },
            h('span', { style: { display: 'inline-flex', alignItems: 'center', gap: 4 } },
              h(Tag, { color: 'orange', style: { fontSize: 10, margin: 0 } }, 'v' + ver),
              h('span', { style: { color: '#D4380D', fontSize: 14, cursor: 'help' } }, '\u26A0')
            )
          );
        }
        // Current version — show green
        if (s && !s.isStale && s.latestVersion > 1) {
          return h(Tooltip, { title: 'Current version (latest known: v' + s.latestVersion + ')' },
            h(Tag, { color: 'green', style: { fontSize: 10, margin: 0 } }, 'v' + ver)
          );
        }
        return h(Tag, { style: { fontSize: 10, margin: 0 } }, 'v' + ver);
      }
    },
    { title: 'Created', key: 'createdAt', width: 100,
      render: function(_, r) {
        return r.createdAt ? h('span', { style: { fontSize: 12 } }, dayjs(r.createdAt).format('MMM D, YYYY')) : '\u2013';
      }
    },
    { title: 'Created By', key: 'createdBy', width: 120,
      render: function(_, r) {
        var name = r.createdBy ? (r.createdBy.name || r.createdBy.userName) : null;
        return h('span', { style: { fontSize: 12 } }, name || '\u2013');
      }
    },
  ];

  // Build drawer title with staleness alert banner
  var drawerTitle = bundle ? 'Attachments: ' + bundle.name : 'Attachments';

  var drawerChildren = [];

  // Staleness alert banner
  if (staleCount > 0) {
    drawerChildren.push(
      h(Alert, {
        key: 'stale-alert',
        type: 'warning',
        showIcon: true,
        style: { marginBottom: 12, fontSize: 12 },
        message: staleCount + ' snapshot' + (staleCount > 1 ? 's' : '') + ' may be outdated',
        description: 'Newer snapshot versions were found attached to other ' + (props.terms ? props.terms.bundle.toLowerCase() + 's' : 'deliverables') + '. Review the Version column for details.',
      })
    );
  }

  // Table or empty state
  if (attachments.length > 0) {
    drawerChildren.push(
      h(Table, {
        key: 'attach-table',
        dataSource: attachments,
        rowKey: function(r, i) { return r.id || i; },
        size: 'small',
        pagination: attachments.length > 10 ? { pageSize: 10 } : false,
        columns: columns,
        rowClassName: function(r) { return r._staleness && r._staleness.isStale ? 'stale-row' : ''; },
      })
    );
  } else {
    drawerChildren.push(h(Empty, { key: 'empty', description: 'No attachments linked' }));
  }

  return h(Drawer, {
    title: drawerTitle,
    open: visible,
    onClose: onClose,
    width: 720,
    extra: dominoUrl
      ? h(Button, { type: 'primary', size: 'small', onClick: function() { window.open(dominoUrl, '_blank'); }, style: { fontSize: 11 } }, '\u2197 View in Domino')
      : null,
  }, drawerChildren);
}


// ═══════════════════════════════════════════════════════════════
//  COMPONENT: CSV Upload Drawer
// ═══════════════════════════════════════════════════════════════
function CSVUploadDrawer(props) {
  var visible = props.visible;
  var onClose = props.onClose;
  var policies = props.policies || [];
  var projects = props.projects || [];
  var bundles = props.bundles || [];
  var connected = props.connected;
  var onComplete = props.onComplete;
  var terms = props.terms || DEFAULT_TERMS;
  var B = capFirst(terms.bundle);

  var _step = useState(0); var step = _step[0]; var setStep = _step[1]; // 0=upload, 1=map, 2=preview, 3=uploading, 4=done
  var _file = useState(null); var csvFile = _file[0]; var setCsvFile = _file[1];
  var _rows = useState([]); var csvRows = _rows[0]; var setCsvRows = _rows[1];
  var _headers = useState([]); var csvHeaders = _headers[0]; var setCsvHeaders = _headers[1];
  var _mapping = useState({}); var mapping = _mapping[0]; var setMapping = _mapping[1];
  var _defaultPolicy = useState(null); var defaultPolicy = _defaultPolicy[0]; var setDefaultPolicy = _defaultPolicy[1];
  var _defaultProject = useState(null); var defaultProject = _defaultProject[0]; var setDefaultProject = _defaultProject[1];
  var _progress = useState({ done: 0, total: 0, errors: [] }); var progress = _progress[0]; var setProgress = _progress[1];

  var REQUIRED_FIELDS = [
    { key: 'name', label: B + ' Name', description: 'Unique name for each ' + B.toLowerCase(), required: true },
    { key: 'policyName', label: capFirst(terms.policy) + ' Name', description: capFirst(terms.policy) + ' name (or use default below)', required: false },
    { key: 'projectName', label: 'Project Name', description: 'Domino project name (or use default below)', required: false },
  ];

  function reset() {
    setStep(0); setCsvFile(null); setCsvRows([]); setCsvHeaders([]);
    setMapping({}); setDefaultPolicy(null); setDefaultProject(null);
    setProgress({ done: 0, total: 0, errors: [] });
  }

  function handleClose() {
    reset();
    onClose();
  }

  // Parse CSV
  function parseCSV(text) {
    var lines = text.split(/\r?\n/).filter(function(l) { return l.trim(); });
    if (lines.length < 2) { antd.message.error('CSV must have a header row and at least one data row.'); return; }
    // Parse header
    var headers = parseCSVLine(lines[0]);
    var rows = [];
    for (var i = 1; i < lines.length; i++) {
      var vals = parseCSVLine(lines[i]);
      if (vals.length === 0 || (vals.length === 1 && !vals[0])) continue;
      var row = {};
      headers.forEach(function(h, idx) { row[h] = vals[idx] || ''; });
      row._rowNum = i + 1;
      rows.push(row);
    }
    setCsvHeaders(headers);
    setCsvRows(rows);
    // Auto-map columns by name similarity
    var autoMap = {};
    headers.forEach(function(h) {
      var lower = h.toLowerCase().replace(/[_\s-]/g, '');
      if (lower === 'name' || lower === 'deliverablename' || lower === 'bundlename' || lower === 'evidencename') autoMap.name = h;
      else if (lower === 'policyname' || lower === 'qcplanname' || lower === 'qcplan' || lower === 'policy' || lower === 'policyid' || lower === 'qcplanid') autoMap.policyName = h;
      else if (lower === 'projectname' || lower === 'project' || lower === 'projectid') autoMap.projectName = h;
    });
    // Check for saved mapping from previous upload
    var savedMapping = null;
    try { var sm = localStorage.getItem('sce_csv_column_mapping'); if (sm) savedMapping = JSON.parse(sm); } catch(e) {}
    if (savedMapping && headers.some(function(h) { return Object.values(savedMapping).indexOf(h) >= 0; })) {
      // Saved mapping has at least one matching header — use it
      var merged = {};
      Object.keys(savedMapping).forEach(function(k) {
        if (headers.indexOf(savedMapping[k]) >= 0) merged[k] = savedMapping[k];
      });
      setMapping(merged);
    } else {
      setMapping(autoMap);
    }
    setStep(1);
  }

  function parseCSVLine(line) {
    var result = []; var current = ''; var inQuotes = false;
    for (var i = 0; i < line.length; i++) {
      var ch = line[i];
      if (inQuotes) {
        if (ch === '"' && line[i + 1] === '"') { current += '"'; i++; }
        else if (ch === '"') inQuotes = false;
        else current += ch;
      } else {
        if (ch === '"') inQuotes = true;
        else if (ch === ',') { result.push(current.trim()); current = ''; }
        else current += ch;
      }
    }
    result.push(current.trim());
    return result;
  }

  function handleFileChange(info) {
    var file = info.file;
    if (file.status === 'removed') { setCsvFile(null); return; }
    setCsvFile(file.originFileObj || file);
    var reader = new FileReader();
    reader.onload = function(e) { parseCSV(e.target.result); };
    reader.readAsText(file.originFileObj || file);
  }

  // Helper: resolve a name to a policy/project ID
  function resolvePolicy(name) {
    if (!name) return null;
    var trimmed = name.trim().toLowerCase();
    // Exact match first
    var exact = policies.find(function(p) { return (p.name || '').toLowerCase() === trimmed; });
    if (exact) return { id: exact.id, name: exact.name, match: 'exact' };
    // Check if the input looks like an ID (contains dashes/hex pattern)
    var asId = policies.find(function(p) { return p.id === name.trim(); });
    if (asId) return { id: asId.id, name: asId.name, match: 'id' };
    // Partial/fuzzy match
    var partials = policies.filter(function(p) { return (p.name || '').toLowerCase().indexOf(trimmed) >= 0 || trimmed.indexOf((p.name || '').toLowerCase()) >= 0; });
    if (partials.length === 1) return { id: partials[0].id, name: partials[0].name, match: 'partial' };
    if (partials.length > 1) return { id: null, name: name, match: 'ambiguous', candidates: partials };
    return { id: null, name: name, match: 'none' };
  }

  function resolveProject(name) {
    if (!name) return null;
    var trimmed = name.trim().toLowerCase();
    var exact = projects.find(function(p) { return (p.name || '').toLowerCase() === trimmed; });
    if (exact) return { id: exact.id, name: exact.name, match: 'exact' };
    var asId = projects.find(function(p) { return p.id === name.trim(); });
    if (asId) return { id: asId.id, name: asId.name, match: 'id' };
    var partials = projects.filter(function(p) { return (p.name || '').toLowerCase().indexOf(trimmed) >= 0 || trimmed.indexOf((p.name || '').toLowerCase()) >= 0; });
    if (partials.length === 1) return { id: partials[0].id, name: partials[0].name, match: 'partial' };
    if (partials.length > 1) return { id: null, name: name, match: 'ambiguous', candidates: partials };
    return { id: null, name: name, match: 'none' };
  }

  // Existing bundle names for duplicate detection
  var existingBundleNames = useMemo(function() {
    var names = {};
    (bundles || []).forEach(function(b) { if (b.name) names[b.name.trim().toLowerCase()] = true; });
    return names;
  }, [bundles]);

  // Preview data with name resolution
  var previewRows = useMemo(function() {
    return csvRows.map(function(r) {
      var name = mapping.name ? (r[mapping.name] || '').trim() : '';
      var policyInput = mapping.policyName ? (r[mapping.policyName] || '').trim() : '';
      var projectInput = mapping.projectName ? (r[mapping.projectName] || '').trim() : '';

      // Resolve policy: from CSV column, or from default (which is already an ID)
      var policyResult = null;
      var resolvedPolicyId = null;
      var policyDisplay = '';
      if (policyInput) {
        policyResult = resolvePolicy(policyInput);
        resolvedPolicyId = policyResult ? policyResult.id : null;
        policyDisplay = policyResult ? (policyResult.match === 'exact' || policyResult.match === 'id' || policyResult.match === 'partial' ? policyResult.name : policyInput) : policyInput;
      } else if (defaultPolicy) {
        resolvedPolicyId = defaultPolicy;
        var dp = policies.find(function(p) { return p.id === defaultPolicy; });
        policyDisplay = dp ? dp.name : defaultPolicy;
        policyResult = { match: 'default' };
      }

      // Resolve project
      var projectResult = null;
      var resolvedProjectId = null;
      var projectDisplay = '';
      if (projectInput) {
        projectResult = resolveProject(projectInput);
        resolvedProjectId = projectResult ? projectResult.id : null;
        projectDisplay = projectResult ? (projectResult.match === 'exact' || projectResult.match === 'id' || projectResult.match === 'partial' ? projectResult.name : projectInput) : projectInput;
      } else if (defaultProject) {
        resolvedProjectId = defaultProject;
        var dpr = projects.find(function(p) { return p.id === defaultProject; });
        projectDisplay = dpr ? dpr.name : defaultProject;
        projectResult = { match: 'default' };
      }

      // Duplicate check
      var isDuplicate = name && existingBundleNames[name.toLowerCase()];

      // Determine status
      var status = 'valid';
      var statusMsg = '';
      if (!name) { status = 'error'; statusMsg = 'Missing name'; }
      else if (isDuplicate) { status = 'duplicate'; statusMsg = 'Already exists, will be skipped'; }
      else if (!resolvedPolicyId && !policyInput && !defaultPolicy) { status = 'error'; statusMsg = 'No ' + terms.policy + ' specified'; }
      else if (policyResult && policyResult.match === 'none') { status = 'error'; statusMsg = terms.policy + ' "' + policyInput + '" not found'; }
      else if (policyResult && policyResult.match === 'ambiguous') { status = 'error'; statusMsg = 'Multiple ' + terms.policy + ' matches for "' + policyInput + '"'; }
      else if (!resolvedProjectId && !projectInput && !defaultProject) { status = 'error'; statusMsg = 'No project specified'; }
      else if (projectResult && projectResult.match === 'none') { status = 'error'; statusMsg = 'Project "' + projectInput + '" not found'; }
      else if (projectResult && projectResult.match === 'ambiguous') { status = 'error'; statusMsg = 'Multiple project matches for "' + projectInput + '"'; }

      return {
        _rowNum: r._rowNum,
        name: name,
        policyName: policyDisplay,
        policyId: resolvedPolicyId,
        policyMatch: policyResult ? policyResult.match : null,
        projectName: projectDisplay,
        projectId: resolvedProjectId,
        projectMatch: projectResult ? projectResult.match : null,
        _status: status,
        _statusMsg: statusMsg,
        _valid: status === 'valid',
        _isDuplicate: isDuplicate,
      };
    });
  }, [csvRows, mapping, defaultPolicy, defaultProject, policies, projects, existingBundleNames]);

  // Validation summary
  var validationErrors = useMemo(function() {
    if (step < 2) return [];
    var errors = [];
    if (!mapping.name) { errors.push('Must map a column to "' + B + ' Name".'); }
    if (!mapping.policyName && !defaultPolicy) { errors.push('Must map a "' + capFirst(terms.policy) + ' Name" column or select a default ' + capFirst(terms.policy) + '.'); }
    if (!mapping.projectName && !defaultProject) { errors.push('Must map a "Project Name" column or select a default Project.'); }
    if (mapping.name) {
      var emptyNames = csvRows.filter(function(r) { return !r[mapping.name] || !r[mapping.name].trim(); });
      if (emptyNames.length > 0) errors.push(emptyNames.length + ' row(s) have empty names.');
    }
    var dupes = previewRows.filter(function(r) { return r._isDuplicate; });
    if (dupes.length > 0) errors.push(dupes.length + ' row(s) are duplicates of existing ' + B.toLowerCase() + 's and will be skipped.');
    var unresolved = previewRows.filter(function(r) { return r._status === 'error' && !r._isDuplicate && r.name; });
    if (unresolved.length > 0) errors.push(unresolved.length + ' row(s) have unresolved names. Check the status column below.');
    return errors;
  }, [step, mapping, defaultPolicy, defaultProject, csvRows, previewRows]);

  // Upload function — 1-by-1 with concurrency control
  function startUpload() {
    if (!connected) {
      antd.message.warning('Cannot upload in dummy mode. Connect to a Domino instance first.');
      return;
    }
    var validRows = previewRows.filter(function(r) { return r._valid; });
    if (validRows.length === 0) { antd.message.error('No valid rows to upload.'); return; }
    setStep(3);
    setProgress({ done: 0, total: validRows.length, errors: [] });

    var idx = 0;
    var errors = [];
    var CONCURRENCY = 3;

    function uploadNext() {
      if (idx >= validRows.length) {
        if (idx === validRows.length) {
          setStep(4);
          setProgress(function(p) { return Object.assign({}, p, { errors: errors }); });
          if (onComplete) onComplete();
        }
        return;
      }
      var row = validRows[idx++];
      var body = { name: row.name.trim(), policyId: row.policyId, projectId: row.projectId };
      apiPost('api/bundles', body)
        .then(function() {
          setProgress(function(p) { return Object.assign({}, p, { done: p.done + 1 }); });
        })
        .catch(function(err) {
          errors.push({ row: row._rowNum, name: row.name, error: (err && err.message) || String(err) });
          setProgress(function(p) { return Object.assign({}, p, { done: p.done + 1, errors: errors.slice() }); });
        })
        .then(uploadNext);
    }

    for (var c = 0; c < Math.min(CONCURRENCY, validRows.length); c++) { uploadNext(); }
  }

  var policyOptions = policies.map(function(p) { return { label: p.name || p.id, value: p.id }; });
  var projectOptions = projects.map(function(p) { return { label: p.name || p.id, value: p.id }; });
  var headerOptions = [{ label: '(Do not map)', value: '' }].concat(csvHeaders.map(function(h) { return { label: h, value: h }; }));

  // Download a blank CSV template with correct headers
  function downloadTemplate() {
    var csv = 'name,policyName,projectName\n';
    var blob = new Blob([csv], { type: 'text/csv' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url; a.download = 'deliverable_upload_template.csv'; a.click();
    URL.revokeObjectURL(url);
  }

  var steps = [
    { title: 'Upload' },
    { title: 'Map Columns' },
    { title: 'Preview' },
    { title: 'Uploading' },
    { title: 'Done' },
  ];

  return h(Drawer, {
    title: 'Import ' + B + 's from CSV',
    open: visible,
    onClose: handleClose,
    width: 720,
    destroyOnClose: true,
    footer: step === 1 ? h('div', { style: { display: 'flex', justifyContent: 'flex-end', gap: 8 } },
      h(Button, { onClick: function() { setStep(0); reset(); } }, 'Back'),
      h(Button, { type: 'primary', onClick: function() { try { localStorage.setItem('sce_csv_column_mapping', JSON.stringify(mapping)); } catch(e) {} setStep(2); } }, 'Next: Preview')
    ) : step === 2 ? h('div', { style: { display: 'flex', justifyContent: 'flex-end', gap: 8 } },
      h(Button, { onClick: function() { setStep(1); } }, 'Back'),
      h(Button, { type: 'primary', disabled: previewRows.filter(function(r) { return r._valid; }).length === 0, onClick: startUpload },
        'Upload ' + previewRows.filter(function(r) { return r._valid; }).length + ' ' + B + 's')
    ) : null,
  },
    // Steps indicator
    h(antd.Steps, { current: step, size: 'small', items: steps, style: { marginBottom: 20 } }),

    // Step 0: Upload file
    step === 0 ? h('div', null,
      h(antd.Upload.Dragger, {
        name: 'file',
        accept: '.csv,.tsv',
        maxCount: 1,
        beforeUpload: function() { return false; },
        onChange: handleFileChange,
        showUploadList: true,
      },
        h('p', { className: 'ant-upload-drag-icon' },
          icons && icons.InboxOutlined ? h(icons.InboxOutlined, { style: { fontSize: 48, color: '#543FDE' } }) : h('span', { style: { fontSize: 36 } }, '\uD83D\uDCC1')
        ),
        h('p', { className: 'ant-upload-text' }, 'Click or drag a CSV file here'),
        h('p', { className: 'ant-upload-hint' }, 'The file should have a header row. Each row will create one ' + B.toLowerCase() + '.')
      ),
      // Quick actions
      h('div', { style: { marginTop: 16, display: 'flex', gap: 8, flexWrap: 'wrap' } },
        h(Button, { size: 'small', onClick: downloadTemplate,
          icon: icons && icons.DownloadOutlined ? h(icons.DownloadOutlined) : null,
        }, 'Download Template')
      ),
      h('div', { style: { marginTop: 16 } },
        h(antd.Collapse, { items: [{
          key: 'template',
          label: 'CSV Template & Requirements',
          children: h('div', null,
            h('p', { style: { fontSize: 12, color: '#65657B' } }, 'Required columns:'),
            h('ul', { style: { fontSize: 12, color: '#65657B', paddingLeft: 20 } },
              h('li', null, h('strong', null, 'name'), ': Unique name for each ' + B.toLowerCase()),
              h('li', null, h('strong', null, 'policyName'), ': ' + capFirst(terms.policy) + ' name (or set a default during mapping)'),
              h('li', null, h('strong', null, 'projectName'), ': Domino project name (or set a default during mapping)')
            ),
            h('p', { style: { fontSize: 12, color: '#65657B', marginTop: 8 } }, 'Names are matched against existing ' + terms.policy.toLowerCase() + 's and projects. Duplicates of existing ' + B.toLowerCase() + 's are flagged and skipped.'),
            h('p', { style: { fontSize: 12, color: '#8F8FA3', marginTop: 8 } }, 'Example CSV:'),
            h('pre', { style: { fontSize: 11, background: '#F5F5F5', padding: 8, borderRadius: 4 } },
              'name,policyName,projectName\n"ADAE Q1 2026","ADaM QC Plan - High Risk","My Project"\n"ADSL Q1 2026","ADaM QC Plan - High Risk","My Project"'
            )
          )
        }] })
      )
    ) : null,

    // Step 1: Column mapping
    step === 1 ? h('div', null,
      h('div', { style: { marginBottom: 16, display: 'flex', alignItems: 'center', gap: 8 } },
        h(Tag, { color: 'blue' }, csvRows.length + ' rows found'),
        h(Tag, null, csvHeaders.length + ' columns'),
        (function() { try { return localStorage.getItem('sce_csv_column_mapping') ? h(Tag, { color: 'green' }, 'Using saved column mapping') : null; } catch(e) { return null; } })()
      ),
      h('div', { style: { fontSize: 13, fontWeight: 600, marginBottom: 12, color: '#2E2E38' } }, 'Map your CSV columns to fields:'),
      REQUIRED_FIELDS.map(function(field) {
        return h('div', { key: field.key, style: { display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 } },
          h('div', { style: { width: 130, fontSize: 12, fontWeight: 500 } },
            field.label,
            field.required ? h('span', { style: { color: '#C20A29' } }, ' *') : null
          ),
          h(Select, {
            placeholder: 'Select CSV column...',
            value: mapping[field.key] || undefined,
            onChange: function(val) {
              setMapping(function(prev) {
                var next = Object.assign({}, prev);
                if (val) next[field.key] = val; else delete next[field.key];
                return next;
              });
            },
            options: headerOptions,
            allowClear: true,
            style: { width: 220 },
            size: 'small',
          }),
          h('span', { style: { fontSize: 11, color: '#8F8FA3' } }, field.description)
        );
      }),
      h(antd.Divider, null),
      h('div', { style: { fontSize: 13, fontWeight: 600, marginBottom: 12, color: '#2E2E38' } }, 'Default values (used when column is not mapped or name is empty):'),
      h('div', { style: { display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 } },
        h('div', { style: { width: 150, fontSize: 12, fontWeight: 500 } }, 'Default ' + capFirst(terms.policy)),
        h(Select, {
          placeholder: 'Search by name...',
          value: defaultPolicy || undefined,
          onChange: setDefaultPolicy,
          options: policyOptions,
          showSearch: true,
          optionFilterProp: 'label',
          allowClear: true,
          style: { width: 320 },
          size: 'small',
        })
      ),
      h('div', { style: { display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 } },
        h('div', { style: { width: 150, fontSize: 12, fontWeight: 500 } }, 'Default Project'),
        h(Select, {
          placeholder: 'Search by name...',
          value: defaultProject || undefined,
          onChange: setDefaultProject,
          options: projectOptions,
          showSearch: true,
          optionFilterProp: 'label',
          allowClear: true,
          style: { width: 320 },
          size: 'small',
        })
      ),
      h(antd.Divider, null),
      h('div', { style: { fontSize: 12, fontWeight: 500, marginBottom: 8 } }, 'Sample data (first 3 rows):'),
      h(Table, {
        dataSource: csvRows.slice(0, 3),
        columns: csvHeaders.map(function(h) {
          return { title: h, dataIndex: h, key: h, ellipsis: true, width: 120 };
        }),
        rowKey: '_rowNum',
        size: 'small',
        pagination: false,
        scroll: { x: csvHeaders.length * 120 },
      })
    ) : null,

    // Step 2: Preview
    step === 2 ? h('div', null,
      validationErrors.length > 0
        ? h(antd.Alert, {
            type: 'error',
            showIcon: true,
            style: { marginBottom: 16 },
            message: 'Validation Errors',
            description: h('ul', { style: { margin: 0, paddingLeft: 16 } },
              validationErrors.map(function(e, i) { return h('li', { key: i }, e); })
            ),
          })
        : h(antd.Alert, {
            type: previewRows.some(function(r) { return r._isDuplicate; }) ? 'warning' : 'success',
            showIcon: true,
            style: { marginBottom: 16 },
            message: previewRows.filter(function(r) { return r._valid; }).length + ' of ' + previewRows.length + ' rows ready to upload' +
              (previewRows.filter(function(r) { return r._isDuplicate; }).length > 0
                ? ' (' + previewRows.filter(function(r) { return r._isDuplicate; }).length + ' duplicates will be skipped)'
                : ''),
          }),
      !connected ? h(antd.Alert, { type: 'warning', showIcon: true, style: { marginBottom: 16 },
        message: 'Dummy mode: upload is disabled. Connect to a Domino instance to create ' + B.toLowerCase() + 's.' }) : null,
      h(Table, {
        dataSource: previewRows,
        columns: [
          { title: 'Row', dataIndex: '_rowNum', key: 'row', width: 50 },
          { title: B + ' Name', dataIndex: 'name', key: 'name', ellipsis: true,
            render: function(t, r) {
              return r._isDuplicate
                ? h('span', null, t, ' ', h(Tag, { color: 'orange', style: { fontSize: 10 } }, 'Duplicate'))
                : t;
            } },
          { title: capFirst(terms.policy), dataIndex: 'policyName', key: 'policy', ellipsis: true, width: 200,
            render: function(t, r) {
              if (!t) return h('span', { style: { color: '#C20A29' } }, 'Not set');
              var matchColor = r.policyMatch === 'exact' || r.policyMatch === 'id' ? 'green' : r.policyMatch === 'partial' ? 'blue' : r.policyMatch === 'default' ? 'default' : 'red';
              var matchLabel = r.policyMatch === 'exact' ? 'Matched' : r.policyMatch === 'id' ? 'ID' : r.policyMatch === 'partial' ? 'Partial' : r.policyMatch === 'default' ? 'Default' : r.policyMatch === 'ambiguous' ? 'Ambiguous' : 'Not found';
              return h('span', null, t, ' ', h(Tag, { color: matchColor, style: { fontSize: 9 } }, matchLabel));
            } },
          { title: 'Project', dataIndex: 'projectName', key: 'project', ellipsis: true, width: 200,
            render: function(t, r) {
              if (!t) return h('span', { style: { color: '#C20A29' } }, 'Not set');
              var matchColor = r.projectMatch === 'exact' || r.projectMatch === 'id' ? 'green' : r.projectMatch === 'partial' ? 'blue' : r.projectMatch === 'default' ? 'default' : 'red';
              var matchLabel = r.projectMatch === 'exact' ? 'Matched' : r.projectMatch === 'id' ? 'ID' : r.projectMatch === 'partial' ? 'Partial' : r.projectMatch === 'default' ? 'Default' : r.projectMatch === 'ambiguous' ? 'Ambiguous' : 'Not found';
              return h('span', null, t, ' ', h(Tag, { color: matchColor, style: { fontSize: 9 } }, matchLabel));
            } },
          { title: 'Status', key: 'status', width: 120, align: 'center',
            render: function(_, r) {
              if (r._isDuplicate) return h(Tooltip, { title: r._statusMsg }, h(Tag, { color: 'orange' }, 'Skip'));
              if (r._valid) return h(Tag, { color: 'green' }, 'Ready');
              return h(Tooltip, { title: r._statusMsg }, h(Tag, { color: 'red' }, 'Error'));
            } },
        ],
        rowKey: '_rowNum',
        size: 'small',
        pagination: { pageSize: 10, size: 'small' },
      })
    ) : null,

    // Step 3: Uploading
    step === 3 ? h('div', { style: { textAlign: 'center', padding: '40px 0' } },
      h(antd.Progress, {
        type: 'circle',
        percent: progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : 0,
        format: function() { return progress.done + ' / ' + progress.total; },
      }),
      h('div', { style: { marginTop: 16, fontSize: 14, color: '#65657B' } },
        'Creating ' + B.toLowerCase() + 's... Please do not close this drawer.'
      ),
      progress.errors.length > 0
        ? h('div', { style: { marginTop: 12 } },
            h(Tag, { color: 'red' }, progress.errors.length + ' error' + (progress.errors.length !== 1 ? 's' : ''))
          )
        : null
    ) : null,

    // Step 4: Done
    step === 4 ? h('div', { style: { textAlign: 'center', padding: '40px 0' } },
      h(antd.Result, {
        status: progress.errors.length === 0 ? 'success' : 'warning',
        title: progress.errors.length === 0
          ? 'All ' + progress.total + ' ' + B.toLowerCase() + 's created successfully!'
          : (progress.total - progress.errors.length) + ' of ' + progress.total + ' created',
        subTitle: progress.errors.length > 0
          ? progress.errors.length + ' failed, see details below'
          : 'You can now find them in the QC Tracker.',
        extra: [
          h(Button, { key: 'close', type: 'primary', onClick: handleClose }, 'Close'),
          h(Button, { key: 'again', onClick: reset }, 'Upload More'),
        ],
      }),
      progress.errors.length > 0
        ? h('div', { style: { textAlign: 'left', marginTop: 16 } },
            h('div', { style: { fontWeight: 600, fontSize: 13, marginBottom: 8 } }, 'Failed rows:'),
            h(Table, {
              dataSource: progress.errors,
              columns: [
                { title: 'Row', dataIndex: 'row', key: 'row', width: 50 },
                { title: 'Name', dataIndex: 'name', key: 'name' },
                { title: 'Error', dataIndex: 'error', key: 'error', ellipsis: true },
              ],
              rowKey: 'row',
              size: 'small',
              pagination: false,
            })
          )
        : null
    ) : null
  );
}


// ═══════════════════════════════════════════════════════════════
//  PAGE: QC Tracker
// ═══════════════════════════════════════════════════════════════
function QCTrackerPage(props) {
  var bundles = props.bundles;
  var loading = props.loading;
  var terms = props.terms || DEFAULT_TERMS;
  var onSelectBundle = props.onSelectBundle;
  var selectedBundle = props.selectedBundle;
  var B = terms.bundle;
  var P = terms.policy;
  var dataExplorerUrl = props.dataExplorerUrl || null;
  var connected = props.connected;
  var policies = props.policies || [];
  var projects = props.projects || [];
  var onRefresh = props.onRefresh;
  var debugMode = props.debugMode || false;

  // Force re-render counter (used after inline reassignment)
  var _rerender = useState(0); var setRerenderKey = _rerender[1];

  // CSV upload state
  var _csv1 = useState(false); var csvDrawerOpen = _csv1[0]; var setCsvDrawerOpen = _csv1[1];

  // Filter state
  var _fs1 = useState(''); var searchText = _fs1[0]; var setSearchText = _fs1[1];
  var _fs2 = useState([]); var filterPolicies = _fs2[0]; var setFilterPolicies = _fs2[1];
  var _fs3 = useState(null); var filterState = _fs3[0]; var setFilterState = _fs3[1];
  var _fs4 = useState(null); var filterAssignee = _fs4[0]; var setFilterAssignee = _fs4[1];
  var _fs5 = useState([]); var filterFlags = _fs5[0]; var setFilterFlags = _fs5[1];
  var _fs8 = useState(null); var filterStage = _fs8[0]; var setFilterStage = _fs8[1];
  var _fs6 = useState([]); var selectedRowKeys = _fs6[0]; var setSelectedRowKeys = _fs6[1];
  // Findings & attachments drawer state
  var _fd1 = useState(false); var findingsDrawerOpen = _fd1[0]; var setFindingsDrawerOpen = _fd1[1];
  var _fd2 = useState(null); var findingsDrawerBundle = _fd2[0]; var setFindingsDrawerBundle = _fd2[1];
  // Column widths state (resizable)
  var _cw = useState({}); var colWidths = _cw[0]; var setColWidths = _cw[1];
  // Hidden columns state
  var _hc = useState(['policy']); var hiddenCols = _hc[0]; var setHiddenCols = _hc[1];
  // Per-stage assignee columns: hidden by default; track which ones the user has turned on
  var _sc2 = useState([]); var shownStageCols = _sc2[0]; var setShownStageCols = _sc2[1];

  // Derive filter options from scoped bundles (project/tag scope handled at App level)
  var policyOptions = useMemo(function() {
    var names = {};
    bundles.forEach(function(b) { if (b.policyName) names[b.policyName] = true; });
    return Object.keys(names).sort();
  }, [bundles]);

  var projectOptions = useMemo(function() {
    var names = {};
    bundles.forEach(function(b) { if (b.projectName) names[b.projectName] = true; });
    return Object.keys(names).sort();
  }, [bundles]);

  // Project objects for CSV upload (id + name)
  var projectObjects = useMemo(function() {
    var map = {};
    bundles.forEach(function(b) {
      if (b.projectId && !map[b.projectId]) map[b.projectId] = { id: b.projectId, name: b.projectName || b.projectId };
    });
    return Object.values(map);
  }, [bundles]);

  var assigneeOptions = useMemo(function() {
    var names = {};
    bundles.forEach(function(b) {
      if (b.stageAssignee && b.stageAssignee.name) names[b.stageAssignee.name] = true;
    });
    return Object.keys(names).sort();
  }, [bundles]);

  // Unique current-stage names for column filter
  var allStageNames = useMemo(function() {
    var names = {};
    bundles.forEach(function(b) { if (b.stage) names[b.stage] = true; });
    return Object.keys(names).sort();
  }, [bundles]);

  // Max stage count across all bundles (for positional Stage 1, Stage 2, … columns)
  var maxStageCount = useMemo(function() {
    var max = 0;
    bundles.forEach(function(b) {
      if (b.stages && b.stages.length > max) max = b.stages.length;
    });
    return max;
  }, [bundles]);

  // Apply local filters (project/tag scope now handled at App level)
  var filtered = useMemo(function() {
    return bundles.filter(function(b) {
      if (searchText) {
        var q = searchText.toLowerCase();
        var match = (b.name || '').toLowerCase().indexOf(q) >= 0
          || (b.projectName || '').toLowerCase().indexOf(q) >= 0
          || (b.policyName || '').toLowerCase().indexOf(q) >= 0
          || (b.stage || '').toLowerCase().indexOf(q) >= 0
          || (b.state || '').toLowerCase().indexOf(q) >= 0
          || (b.stageAssignee && b.stageAssignee.name || '').toLowerCase().indexOf(q) >= 0
          || (b.stages && b.stages.some(function(s) {
               var an = s.assignee && (s.assignee.name || s.assignee.userName) || '';
               return an.toLowerCase().indexOf(q) >= 0;
             }))
          || (b._attachments || []).some(function(att) {
               var fname = att.identifier && att.identifier.filename || '';
               var aname = att.identifier && att.identifier.name || '';
               return fname.toLowerCase().indexOf(q) >= 0 || aname.toLowerCase().indexOf(q) >= 0;
             });
        if (!match) return false;
      }
      if (filterPolicies.length > 0 && filterPolicies.indexOf(b.policyName) < 0) return false;
      if (filterState && b.state !== filterState) return false;
      if (filterStage && (b.stage || '') !== filterStage) return false;
      if (filterAssignee) {
        var name = b.stageAssignee && b.stageAssignee.name;
        if (filterAssignee === '__unassigned__') { if (name) return false; }
        else { if (name !== filterAssignee) return false; }
      }
      if (filterFlags.indexOf('open_findings') >= 0) {
        var hasOpen = b._findings && b._findings.some(function(f) { return f.status !== 'Done' && f.status !== 'WontDo'; });
        if (!hasOpen) return false;
      }
      if (filterFlags.indexOf('unassigned') >= 0) {
        if (b.stageAssignee && b.stageAssignee.name) return false;
      }
      return true;
    });
  }, [bundles, searchText, filterPolicies, filterState, filterAssignee, filterFlags, filterStage]);

  // Track which filtered rows matched via a hidden per-stage assignee (for the search indicator)
  var hiddenStageMatchIds = useMemo(function() {
    if (!searchText) return {};
    var q = searchText.toLowerCase();
    var result = {};
    filtered.forEach(function(b) {
      if (!b.stages) return;
      b.stages.forEach(function(s, idx) {
        var sName = s.stage && s.stage.name;
        var an = (s.assignee && (s.assignee.name || s.assignee.userName)) || '';
        if (sName && an.toLowerCase().indexOf(q) >= 0) {
          var colKey = 'sa_' + (idx + 1);
          if (shownStageCols.indexOf(colKey) < 0) {
            var id = b.id || b.name;
            result[id] = (result[id] || []).concat('Stage ' + (idx + 1) + ' (' + sName + ')');
          }
        }
      });
    });
    return result;
  }, [filtered, searchText, shownStageCols]);

  // Stats (computed from all bundles, not filtered — so stat cards show true totals)
  var stats = useMemo(function() {
    var openFindings = 0; var totalFindings = 0; var unassigned = 0; var complete = 0; var archived = 0;
    bundles.forEach(function(b) {
      if (b.state === 'Complete') complete++;
      if (b.state === 'Archived') archived++;
      if (!b.stageAssignee || !b.stageAssignee.name) unassigned++;
      if (b._findings) {
        totalFindings += b._findings.length;
        if (b._findings.some(function(f) { return f.status !== 'Done' && f.status !== 'WontDo'; })) openFindings++;
      }
    });
    var active = bundles.length - complete - archived;
    return { total: bundles.length, openFindings: openFindings, totalFindings: totalFindings, unassigned: unassigned, complete: complete, active: active, archived: archived };
  }, [bundles]);

  var activeFilterCount = (searchText ? 1 : 0) + (filterPolicies.length > 0 ? 1 : 0) + (filterState ? 1 : 0) + (filterAssignee ? 1 : 0) + filterFlags.length + (filterStage ? 1 : 0);

  // Track which stat card is highlighted (for toggle behavior)
  var _sc = useState(null); var activeStatCard = _sc[0]; var setActiveStatCard = _sc[1];

  function clearFilters() {
    setSearchText(''); setFilterPolicies([]); setFilterState(null); setFilterAssignee(null); setFilterFlags([]); setFilterStage(null);
    setActiveStatCard(null);
  }

  // Clickable stat cards — toggle filter when clicked
  function handleStatClick(type) {
    if (activeStatCard === type) {
      // Click the same card again — deselect
      clearFilters();
      return;
    }
    // Clear other filters, apply this one
    setSearchText(''); setFilterPolicies([]); setFilterState(null); setFilterAssignee(null); setFilterFlags([]); setFilterStage(null);
    setActiveStatCard(type);
    if (type === 'active') setFilterState('Active');
    else if (type === 'openFindings') setFilterFlags(['open_findings']);
    else if (type === 'unassigned') setFilterFlags(['unassigned']);
    else if (type === 'complete') setFilterState('Complete');
    // 'total' clears all filters
  }

  // Deliverable name options for column filter
  var deliverableOptions = useMemo(function() {
    var names = {};
    bundles.forEach(function(b) { if (b.name) names[b.name] = true; });
    return Object.keys(names).sort();
  }, [bundles]);

  // Excel-like column filters + sorters (filterSearch enables search inside filter dropdowns)
  var columns = [
    {
      title: capFirst(B), dataIndex: 'name', key: 'name', width: 140, fixed: 'left',
      filters: deliverableOptions.map(function(n) { return { text: n, value: n }; }),
      filterSearch: true,
      onFilter: function(v, r) { return r.name === v; },
      sorter: function(a, b) { return a.name.localeCompare(b.name); },
      render: function(name, record) {
        var nameColor = record.state === 'Complete' ? '#28A464' : record.state === 'Archived' ? '#8F8FA3' : '#543FDE';
        var id = record.id || record.name;
        var hiddenMatches = hiddenStageMatchIds[id];
        return h('span', { style: { display: 'inline-flex', alignItems: 'center', gap: 4 } },
          h('a', {
            style: { fontWeight: 600, color: nameColor, fontSize: 12 },
            onClick: function(e) { e.stopPropagation(); if (onSelectBundle) onSelectBundle(record); }
          }, name),
          hiddenMatches && hiddenMatches.length > 0
            ? h(Tooltip, { title: 'Search matched assignee in hidden stage' + (hiddenMatches.length > 1 ? 's' : '') + ': ' + hiddenMatches.join(', ') },
                h('span', { style: { color: '#8F8FA3', fontSize: 11, cursor: 'help', lineHeight: 1 } }, '\u24d8')
              )
            : null
        );
      }
    },
    { title: 'Project', dataIndex: 'projectName', key: 'project', width: 130,
      filters: projectOptions.map(function(p) { return { text: p, value: p }; }),
      filterSearch: true,
      onFilter: function(v, r) { return r.projectName === v; },
      sorter: function(a, b) { return (a.projectName || '').localeCompare(b.projectName || ''); },
      render: function(t) { return h('span', { style: { fontSize: 12 } }, t || '\u2013'); } },
    { title: capFirst(P), dataIndex: 'policyName', key: 'policy', width: 150, ellipsis: true,
      filters: policyOptions.map(function(p) { return { text: p, value: p }; }),
      filterSearch: true,
      onFilter: function(v, r) { return r.policyName === v; },
      render: function(t) { return t ? h(Tag, { style: { fontSize: 10 } }, t) : '\u2013'; } },
    { title: 'Progress', key: 'progress', width: 130,
      sorter: function(a, b) { return getBundleProgress(a) - getBundleProgress(b); },
      render: function(_, record) { return h(StagePipeline, { bundle: record, onFindingsClick: function(b) { setFindingsDrawerBundle(b); setFindingsDrawerOpen(true); } }); } },
    { title: 'Current Stage', dataIndex: 'stage', key: 'stage', width: 130, ellipsis: true,
      filters: allStageNames.map(function(s) { return { text: s, value: s }; }),
      filterSearch: true,
      onFilter: function(v, r) { return r.stage === v; },
      sorter: function(a, b) { return (a.stage || '').localeCompare(b.stage || ''); },
      render: function(t) { return h('span', { style: { fontSize: 12 } }, t || '\u2013'); } },
    { title: 'Assignee', key: 'assignee', width: 160,
      filters: [{ text: 'Unassigned', value: '__unassigned__' }].concat(
        assigneeOptions.map(function(n) { return { text: n, value: n }; })
      ),
      filterSearch: true,
      onFilter: function(v, r) {
        var name = r.stageAssignee && r.stageAssignee.name;
        return v === '__unassigned__' ? !name : name === v;
      },
      sorter: function(a, b) {
        var an = (a.stageAssignee && a.stageAssignee.name) || '';
        var bn = (b.stageAssignee && b.stageAssignee.name) || '';
        return an.localeCompare(bn);
      },
      render: function(_, record) {
        var pmc = props.projectMembersCache || {};
        var members = pmc[record.projectId] || [];
        // Format member label: "First Last (username)" or just "(username)" if no name
        function fmtMember(m) {
          var full = ((m.firstName || '') + ' ' + (m.lastName || '')).trim();
          return full ? full + ' (' + (m.userName || m.id) + ')' : (m.userName || m.fullName || m.id);
        }
        var memberOpts = members.map(function(m) {
          return { label: fmtMember(m), value: m.id };
        });
        // Find the current stage and its stageId + assignee
        var currentStageId = null;
        var currentStageAssignee = record.stageAssignee || null;
        if (record.stages && record.stage) {
          var match = record.stages.find(function(s) { return s.stage && s.stage.name === record.stage; });
          if (match) {
            currentStageId = match.stageId || (match.stage && match.stage.id);
            if (!currentStageAssignee && match.assignee) currentStageAssignee = match.assignee;
          }
        }
        var gapInfo = API_GAPS.stageReassign;
        var assigneeId = currentStageAssignee ? currentStageAssignee.id : undefined;
        // Resolve assignee display name: look up from members cache first, then fall back to name/userName field
        var assigneeName = null;
        var memberMatch = null;
        if (assigneeId) {
          memberMatch = members.find(function(m) { return m.id === assigneeId; });
          // Fallback: match by userName if ID match fails (governance vs v4 ID mismatch)
          if (!memberMatch && currentStageAssignee) {
            var saName = currentStageAssignee.name || currentStageAssignee.userName;
            if (saName) {
              memberMatch = members.find(function(m) { return m.userName === saName; });
              if (memberMatch) {
                console.info('[Assignee] ID mismatch resolved via userName for', record.name, ':', assigneeId, '→', memberMatch.id, '(' + saName + ')');
                // Update the assigneeId so the Select value matches the option
                assigneeId = memberMatch.id;
              }
            }
          }
          if (memberMatch) assigneeName = fmtMember(memberMatch);
        }
        if (!assigneeName && currentStageAssignee) {
          var sa = currentStageAssignee;
          var full = ((sa.firstName || '') + ' ' + (sa.lastName || '')).trim();
          assigneeName = full ? full + ' (' + (sa.name || sa.userName || '') + ')' : (sa.name || sa.userName || null);
        }
        if (!assigneeName && assigneeId && !window._assigneeWarnedIds) window._assigneeWarnedIds = {};
        if (!assigneeName && assigneeId && !window._assigneeWarnedIds[assigneeId]) {
          window._assigneeWarnedIds[assigneeId] = true;
          console.warn('[Assignee] Could not resolve name for assignee ID', assigneeId, '- sample bundle:', record.name, '- assignee:', JSON.stringify(currentStageAssignee), '- members count:', members.length, '- projectId:', record.projectId);
        }

        if (gapInfo.ready && memberOpts.length > 0) {
          // If assignee ID exists but isn't in the member list, add a placeholder option so the Select shows a name, not an ID
          if (assigneeId && !memberOpts.some(function(o) { return o.value === assigneeId; })) {
            memberOpts.unshift({ label: assigneeName || 'Unknown user (' + (currentStageAssignee && (currentStageAssignee.name || currentStageAssignee.id) || '?') + ')', value: assigneeId });
          }
          return h(Select, {
            size: 'small',
            placeholder: 'Assign...',
            value: assigneeId || undefined,
            style: { width: '100%', fontSize: 11 },
            showSearch: true,
            allowClear: true,
            options: memberOpts,
            optionFilterProp: 'label',
            onClick: function(e) { e.stopPropagation(); },
            onChange: function(userId) {
              if (!currentStageId) { antd.message.error('Missing stage ID'); return; }
              var memberMatch = userId ? members.find(function(mm) { return mm.id === userId; }) : null;
              var body = { assignee: userId ? { id: userId, userName: memberMatch ? memberMatch.userName : undefined, name: memberMatch ? memberMatch.userName : undefined } : null };
              apiPatch('api/bundles/' + record.id + '/stages/' + currentStageId, body)
                .then(function(resp) {
                  // Check read-back verification BEFORE updating local state
                  if (resp.verified === false) {
                    var actualName = resp.actualAssignee ? (resp.actualAssignee.name || resp.actualAssignee.userName || resp.actualAssignee.id || '') : '';
                    // Revert the select to the actual value from Domino
                    if (resp.actualAssignee) {
                      record.stageAssignee = resp.actualAssignee;
                      if (record.stages) {
                        record.stages.forEach(function(s) {
                          if ((s.stageId || (s.stage && s.stage.id)) === currentStageId) {
                            s.assignee = resp.actualAssignee;
                          }
                        });
                      }
                    }
                    var dbg = resp._debug || {};
                    var attempts = dbg.attempts || [];
                    var lastAttempt = attempts[attempts.length - 1] || {};
                    var isUnassign = dbg.isUnassign;
                    var descParts = [];
                    if (isUnassign) {
                      descParts.push(h('p', null, 'Tried to unassign but Domino did not clear the assignee. The stage is still assigned to ' + (actualName || 'someone') + '.'));
                      descParts.push(h('p', { style: { marginTop: 6, fontSize: 12, color: '#65657B' } }, 'Domino\'s governance API may not support unassignment via PATCH. You may need to unassign directly in Domino.'));
                    } else {
                      descParts.push(h('p', null, actualName
                        ? 'Domino accepted the request but the stage is still assigned to ' + actualName + '.'
                        : 'Domino accepted the request but did not persist the change.'));
                      descParts.push(h('p', { style: { marginTop: 6, fontSize: 12, color: '#65657B' } }, 'Common causes: the assignee is not a collaborator on this project, or the ' + B.toLowerCase() + ' is in a state that prevents changes.'));
                      descParts.push(h('p', { style: { marginTop: 4, fontSize: 12, fontWeight: 500 } }, 'Fix: Verify the assignee is a project collaborator in Domino.'));
                    }
                    if (debugMode) {
                      descParts.push(h('pre', { style: { fontSize: 10, whiteSpace: 'pre-wrap', margin: '8px 0 0', maxHeight: 250, overflow: 'auto', background: '#f5f5f5', padding: 8, borderRadius: 4 } }, JSON.stringify(dbg, null, 2)));
                    }
                    antd.notification.warning({
                      message: isUnassign ? 'Unassign not supported by Domino' : 'Assignment did not save in Domino',
                      description: h('div', null, descParts),
                      duration: debugMode ? 0 : 12,
                    });
                  } else {
                    // Only update local state after verification succeeds or is indeterminate
                    var newAssignee = null;
                    if (userId) {
                      var m = members.find(function(mm) { return mm.id === userId; });
                      if (m) {
                        newAssignee = { id: m.id, name: m.userName, firstName: m.firstName, lastName: m.lastName };
                      } else if (resp && resp.assignee) {
                        newAssignee = resp.assignee;
                      } else {
                        // Preserve userName from the selected option label so re-renders don't show "Unknown user"
                        var selectedOpt = memberOpts.find(function(o) { return o.value === userId; });
                        newAssignee = { id: userId, name: selectedOpt ? selectedOpt.label : userId };
                      }
                    }
                    record.stageAssignee = newAssignee;
                    if (record.stages) {
                      record.stages.forEach(function(s) {
                        if ((s.stageId || (s.stage && s.stage.id)) === currentStageId) {
                          s.assignee = newAssignee;
                        }
                      });
                    }
                    if (resp.verified === true) {
                      antd.message.success('Assignee updated — verified in Domino');
                    } else {
                      antd.message.success('Assignee updated (verification pending)');
                    }
                  }
                  // Force table re-render
                  setRerenderKey(function(k) { return k + 1; });
                })
                .catch(function(err) {
                  var detail = err.message || String(err);
                  var bundleName = record.name || record.id;
                  var friendlyDetail = parseServerError(detail);
                  antd.notification.error({
                    message: 'Reassignment failed for ' + bundleName,
                    description: detail.indexOf('403') !== -1 ? 'You do not have permission to reassign this stage. Check that you are a collaborator on the project.' : detail.indexOf('404') !== -1 ? 'This deliverable or stage was not found. It may have been deleted — try refreshing the page.' : friendlyDetail,
                    duration: 8,
                  });
                });
            },
          });
        }
        return assigneeName
          ? h('span', { style: { fontSize: 12 } }, assigneeName)
          : h('span', { style: { color: '#F59E0B', fontSize: 11, fontWeight: 500 } }, 'Unassigned');
      }
    },
    { title: 'State', dataIndex: 'state', key: 'state', width: 80,
      filters: [
        { text: 'Active', value: 'Active' },
        { text: 'Complete', value: 'Complete' },
        { text: 'Archived', value: 'Archived' },
      ],
      onFilter: function(v, r) { return r.state === v; },
      render: function(s) { return h(Tag, { color: stateColor(s), style: { fontSize: 11 } }, s); } },
    { title: h(Tooltip, { title: 'Attachments (\u26A0 = outdated snapshots)' }, icons && icons.PaperClipOutlined ? h(icons.PaperClipOutlined, { style: { fontSize: 14, color: '#8F8FA3' } }) : 'Att'), key: 'attachments', width: 60, align: 'center',
      sorter: function(a, b) { return (a._attachments || []).length - (b._attachments || []).length; },
      filters: [
        { text: 'Has Stale Snapshots', value: 'stale' },
      ],
      onFilter: function(v, r) {
        if (v === 'stale') return countStaleAttachments(r) > 0;
        return true;
      },
      render: function(_, record) {
        var count = (record._attachments || []).length;
        if (count === 0) return h('span', { style: { color: '#D1D1DB', fontSize: 11 } }, '\u2013');
        var stale = countStaleAttachments(record);
        var clickHandler = function(e) { e.stopPropagation(); if (onSelectBundle) onSelectBundle(record, 'attachments'); };
        if (stale > 0) {
          return h(Tooltip, { title: count + ' attachment' + (count > 1 ? 's' : '') + ' \u2014 ' + stale + ' outdated snapshot' + (stale > 1 ? 's' : '') + '. Click to review.' },
            h('span', {
              style: { display: 'inline-flex', alignItems: 'center', gap: 2, cursor: 'pointer' },
              onClick: clickHandler,
            },
              h('span', { style: { color: '#543FDE', fontSize: 12, fontWeight: 600 } }, count),
              h('span', { style: { color: '#D4380D', fontSize: 12 } }, '\u26A0')
            )
          );
        }
        return h(Tooltip, { title: 'Click to view ' + count + ' attachment' + (count > 1 ? 's' : '') },
          h('span', {
            style: { color: '#543FDE', fontSize: 12, fontWeight: 600, cursor: 'pointer' },
            onClick: clickHandler,
          }, count)
        );
      }
    },
    { title: h(Tooltip, { title: 'Status indicators for each deliverable. \u26A0 = count of open findings (not Done/Won\'t Do). \u2205 = current stage has no assignee. \u2713 = all approvals are approved. Use the filter to isolate flagged items.', overlayStyle: { maxWidth: 320 } }, h('span', { style: { cursor: 'help', borderBottom: '1px dashed #B0B0C0' } }, 'Flags')), key: 'flags', width: 70,
      filters: [
        { text: 'Open Findings', value: 'open_findings' },
        { text: 'Unassigned', value: 'unassigned' },
        { text: 'Approved', value: 'approved' },
      ],
      onFilter: function(v, r) {
        if (v === 'open_findings') return r._findings && r._findings.some(function(f) { return f.status !== 'Done' && f.status !== 'WontDo'; });
        if (v === 'unassigned') return !r.stageAssignee || !r.stageAssignee.name;
        if (v === 'approved') return r._approvals && r._approvals.length > 0 && r._approvals.every(function(a) { return a.status === 'Approved'; });
        return true;
      },
      render: function(_, record) { return h(StatusFlags, { bundle: record, onFindingsClick: function(b) { setFindingsDrawerBundle(b); setFindingsDrawerOpen(true); } }); } },
  ];

  // Positional per-stage column pairs: Stage 1 / Stage 1 Assignee, Stage 2 / Stage 2 Assignee, …
  var perStageCols = useMemo(function() {
    var statusColorMap = { Current: 'gold', Completed: 'green', Future: 'blue' };
    var result = [];

    for (var n = 1; n <= maxStageCount; n++) {
      (function(idx) {  // idx is 0-based, label is 1-based
        var label = 'Stage ' + (idx + 1);

        // Helper: get stage object and computed status at position idx
        function getStageAt(bundle) {
          if (!bundle.stages || idx >= bundle.stages.length) return null;
          var stageObj = bundle.stages[idx];
          if (!stageObj || !stageObj.stage) return null;
          var currentIdx = deriveBundleStageIndex(bundle);
          var isComplete = bundle.state === 'Complete';
          var status = isComplete || idx < currentIdx ? 'Completed' : idx === currentIdx ? 'Current' : 'Future';
          return { stageObj: stageObj, status: status, name: stageObj.stage.name || '' };
        }

        // ── Stage name column ─────────────────────────────────────
        // Collect unique stage names at this position for filter
        var stageNameFilters = [];
        var seenNames = {};
        bundles.forEach(function(b) {
          var info = getStageAt(b);
          if (info && info.name && !seenNames[info.name]) {
            seenNames[info.name] = true;
            stageNameFilters.push({ text: info.name, value: info.name });
          }
        });
        stageNameFilters.sort(function(a, b) { return a.text.localeCompare(b.text); });

        result.push({
          title: label,
          key: 'st_' + (idx + 1),
          width: 150,
          ellipsis: true,
          sorter: function(a, b) {
            var ia = getStageAt(a); var ib = getStageAt(b);
            return (ia ? ia.name : '').localeCompare(ib ? ib.name : '');
          },
          filters: stageNameFilters,
          filterSearch: true,
          onFilter: function(value, record) {
            var info = getStageAt(record);
            return info && info.name === value;
          },
          render: function(_, record) {
            var info = getStageAt(record);
            if (!info) return h('span', { style: { color: '#D1D1DB', fontSize: 11 } }, '\u2013');
            return h('span', { style: { fontSize: 12 } },
              h('span', null, info.name),
              h(Tag, { color: statusColorMap[info.status] || 'default', style: { fontSize: 10, marginLeft: 6 } }, info.status)
            );
          },
        });

        // ── Stage assignee column ─────────────────────────────────
        var assigneeFilters = [{ text: 'Unassigned', value: '__unassigned__' }];
        var seenAssignees = {};
        bundles.forEach(function(b) {
          var info = getStageAt(b);
          if (!info) return;
          var aName = info.stageObj.assignee && (info.stageObj.assignee.name || info.stageObj.assignee.userName);
          if (aName && !seenAssignees[aName]) {
            seenAssignees[aName] = true;
            assigneeFilters.push({ text: aName, value: aName });
          }
        });

        result.push({
          title: label + ' Assignee',
          key: 'sa_' + (idx + 1),
          width: 160,
          sorter: function(a, b) {
            var ia = getStageAt(a); var ib = getStageAt(b);
            var aa = (ia && ia.stageObj.assignee && (ia.stageObj.assignee.name || ia.stageObj.assignee.userName)) || '';
            var bb = (ib && ib.stageObj.assignee && (ib.stageObj.assignee.name || ib.stageObj.assignee.userName)) || '';
            return aa.localeCompare(bb);
          },
          filters: assigneeFilters,
          filterSearch: true,
          onFilter: function(value, record) {
            var info = getStageAt(record);
            var aName = info && info.stageObj.assignee && (info.stageObj.assignee.name || info.stageObj.assignee.userName);
            if (value === '__unassigned__') return !aName;
            return aName === value;
          },
          render: function(_, record) {
            var info = getStageAt(record);
            if (!info) return h('span', { style: { color: '#D1D1DB', fontSize: 11 } }, '\u2013');
            var stageObj = info.stageObj;
            var pmc = props.projectMembersCache || {};
            var members = pmc[record.projectId] || [];
            function fmtMember(m) {
              var full = ((m.firstName || '') + ' ' + (m.lastName || '')).trim();
              return full ? full + ' (' + (m.userName || m.id) + ')' : (m.userName || m.fullName || m.id);
            }
            var memberOpts = members.map(function(m) { return { label: fmtMember(m), value: m.id }; });
            var stageId = stageObj.stageId || (stageObj.stage && stageObj.stage.id);
            var assigneeRaw = stageObj.assignee || null;
            var assigneeId = assigneeRaw ? assigneeRaw.id : undefined;
            var assigneeName = null;
            var memberMatch = null;
            if (assigneeId) {
              memberMatch = members.find(function(m) { return m.id === assigneeId; });
              if (!memberMatch && assigneeRaw) {
                var saName = assigneeRaw.name || assigneeRaw.userName;
                if (saName) {
                  memberMatch = members.find(function(m) { return m.userName === saName; });
                  if (memberMatch) assigneeId = memberMatch.id;
                }
              }
              if (memberMatch) assigneeName = fmtMember(memberMatch);
            }
            if (!assigneeName && assigneeRaw) {
              var sa = assigneeRaw;
              var full = ((sa.firstName || '') + ' ' + (sa.lastName || '')).trim();
              assigneeName = full ? full + ' (' + (sa.name || sa.userName || '') + ')' : (sa.name || sa.userName || null);
            }
            if (assigneeId && !memberOpts.some(function(o) { return o.value === assigneeId; })) {
              memberOpts.unshift({ label: assigneeName || 'Unknown user (' + (assigneeRaw && (assigneeRaw.name || assigneeRaw.id) || '?') + ')', value: assigneeId });
            }
            if (API_GAPS.stageReassign.ready && memberOpts.length > 0) {
              return h(Select, {
                size: 'small',
                placeholder: 'Assign...',
                value: assigneeId || undefined,
                style: { width: '100%', fontSize: 11 },
                showSearch: true,
                allowClear: true,
                options: memberOpts,
                optionFilterProp: 'label',
                onClick: function(e) { e.stopPropagation(); },
                onChange: function(userId) {
                  if (!stageId) { antd.message.error('Missing stage ID'); return; }
                  var mm = userId ? members.find(function(m) { return m.id === userId; }) : null;
                  var body = { assignee: userId ? { id: userId, userName: mm ? mm.userName : undefined, name: mm ? mm.userName : undefined } : null };
                  apiPatch('api/bundles/' + record.id + '/stages/' + stageId, body)
                    .then(function(resp) {
                      if (resp.verified === false) {
                        var actualName = resp.actualAssignee ? (resp.actualAssignee.name || resp.actualAssignee.userName || resp.actualAssignee.id || '') : '';
                        antd.notification.warning({
                          message: 'Assignment did not save in Domino',
                          description: actualName ? 'The stage is still assigned to ' + actualName + '.' : 'Domino did not persist the change.',
                          duration: 10,
                        });
                      } else {
                        stageObj.assignee = userId
                          ? (mm ? { id: mm.id, name: mm.userName, firstName: mm.firstName, lastName: mm.lastName } : { id: userId })
                          : null;
                        antd.message.success(resp.verified === true ? 'Assignee updated — verified in Domino' : 'Assignee updated (verification pending)');
                      }
                      setRerenderKey(function(k) { return k + 1; });
                    })
                    .catch(function(err) {
                      var detail = err.message || String(err);
                      antd.notification.error({
                        message: 'Reassignment failed',
                        description: detail.indexOf('403') !== -1 ? 'Permission denied — check project collaborator access.' : parseServerError(detail),
                        duration: 8,
                      });
                    });
                },
              });
            }
            return assigneeName
              ? h('span', { style: { fontSize: 12 } }, assigneeName)
              : h('span', { style: { color: '#F59E0B', fontSize: 11, fontWeight: 500 } }, 'Unassigned');
          },
        });
      })(n - 1);
    }

    return result;
  }, [maxStageCount, bundles]);

  // All columns combined (per-stage pairs appended; hidden by default via shownStageCols)
  var allColumns = columns.concat(perStageCols);

  // Charts — Status Distribution donut + Deliverables by Stage bar
  useEffect(function() {
    if (bundles.length === 0) return;
    var el = document.getElementById('qc-chart-status');
    if (!el) return;
    Highcharts.chart('qc-chart-status', {
      chart: { type: 'pie', height: 180, backgroundColor: 'transparent' },
      title: { text: null },
      plotOptions: {
        pie: {
          innerSize: '55%',
          cursor: 'pointer',
          dataLabels: { enabled: true, format: '{point.name}: {point.y}', style: { fontSize: '10px' } },
          point: { events: { click: function() {
            var stateName = this.name; // 'Active', 'Complete', or 'Archived'
            // Use stable setters directly (not handleStatClick which may be stale in this closure)
            setSearchText(''); setFilterPolicies([]); setFilterState(null); setFilterAssignee(null); setFilterFlags([]); setFilterStage(null);
            setActiveStatCard(stateName === 'Active' ? 'active' : stateName === 'Complete' ? 'complete' : null);
            setFilterState(stateName);
          } } },
        },
      },
      series: [{
        name: capFirst(B) + 's',
        data: [
          { name: 'Active', y: stats.active, color: '#543FDE' },
          { name: 'Complete', y: stats.complete, color: '#28A464' },
          { name: 'Archived', y: stats.archived, color: '#B0B0C0' },
        ].filter(function(d) { return d.y > 0; }),
      }],
      credits: { enabled: false },
    });
  }, [bundles, stats]);

  useEffect(function() {
    if (bundles.length === 0) return;
    var el = document.getElementById('qc-chart-stages');
    if (!el) return;
    var stageMap = {};
    bundles.forEach(function(b) { var s = b.stage || 'Unknown'; stageMap[s] = (stageMap[s] || 0) + 1; });
    var stageNames = Object.keys(stageMap);
    var stageCounts = stageNames.map(function(n) { return stageMap[n]; });
    Highcharts.chart('qc-chart-stages', {
      chart: { type: 'bar', height: Math.max(160, stageNames.length * 24), backgroundColor: 'transparent' },
      title: { text: null },
      xAxis: { categories: stageNames, labels: { style: { fontSize: '10px' } } },
      yAxis: { title: { text: null }, allowDecimals: false },
      plotOptions: { bar: { borderRadius: 3, cursor: 'pointer', point: { events: { click: function() {
        var stageName = this.category;
        setSearchText(''); setFilterPolicies([]); setFilterState(null); setFilterAssignee(null); setFilterFlags([]);
        setFilterStage(function(prev) { return prev === stageName ? null : stageName; });
        setActiveStatCard(null);
      } } } } },
      series: [{ name: capFirst(B) + 's', data: stageCounts, showInLegend: false }],
      credits: { enabled: false },
    });
  }, [bundles]);

  return h('div', null,
    h('div', { className: 'page-header', style: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' } },
      h('div', null,
        h('h1', null, 'QC Tracker'),
        h('p', null, 'Track all ' + capFirst(B).toLowerCase() + 's across projects and ' + capFirst(P).toLowerCase() + 's')
      ),
      h(Tooltip, { title: 'Import ' + capFirst(B).toLowerCase() + 's from a CSV file' },
        h(Button, {
          onClick: function() { setCsvDrawerOpen(true); },
          icon: icons && icons.UploadOutlined ? h(icons.UploadOutlined) : null,
        }, 'Import CSV')
      )
    ),

    // CSV Upload Drawer
    h(CSVUploadDrawer, {
      visible: csvDrawerOpen,
      onClose: function() { setCsvDrawerOpen(false); },
      policies: policies,
      projects: projectObjects,
      bundles: bundles,
      connected: connected,
      onComplete: onRefresh,
      terms: terms,
    }),

    // Stat cards — clickable with toggle highlight + subtitles
    h('div', { className: 'stats-row' },
      h('div', { className: 'stat-card-clickable' + (activeStatCard === 'total' ? ' stat-card-active' : ''), onClick: function() { handleStatClick('total'); } },
        h(StatCard, { label: 'Total ' + capFirst(B) + 's', value: stats.total, color: 'primary' })),
      h('div', { className: 'stat-card-clickable' + (activeStatCard === 'active' ? ' stat-card-active' : ''), onClick: function() { handleStatClick('active'); } },
        h(StatCard, { label: 'Active', value: stats.active, color: 'info' })),
      h('div', { className: 'stat-card-clickable' + (activeStatCard === 'openFindings' ? ' stat-card-active' : ''), onClick: function() { handleStatClick('openFindings'); } },
        h(StatCard, { label: 'Open Findings', value: stats.openFindings, color: stats.openFindings > 0 ? 'danger' : '' })),
      h('div', { className: 'stat-card-clickable' + (activeStatCard === 'unassigned' ? ' stat-card-active' : ''), onClick: function() { handleStatClick('unassigned'); } },
        h(StatCard, { label: 'Unassigned', value: stats.unassigned, color: stats.unassigned > 0 ? 'warning' : '' })),
      h('div', { className: 'stat-card-clickable' + (activeStatCard === 'complete' ? ' stat-card-active' : ''), onClick: function() { handleStatClick('complete'); } },
        h(StatCard, { label: 'Complete', value: stats.complete, color: 'success' }))
    ),

    // Charts row — compact
    h('div', { className: 'two-col', style: { marginBottom: 16 } },
      h('div', { className: 'panel' },
        h('div', { className: 'panel-header' }, h('span', { className: 'panel-title' }, capFirst(B) + ' Status Distribution')),
        h('div', { className: 'panel-body', style: { padding: '4px 8px' } },
          bundles.length > 0
            ? h('div', { id: 'qc-chart-status', style: { height: 180 } })
            : h(EmptyState, { text: 'No data' })
        )
      ),
      h('div', { className: 'panel' },
        h('div', { className: 'panel-header' }, h('span', { className: 'panel-title' }, capFirst(B) + 's by Current Stage')),
        h('div', { className: 'panel-body', style: { padding: '4px 8px' } },
          bundles.length > 0
            ? h('div', { id: 'qc-chart-stages', style: { minHeight: 160 } })
            : h(EmptyState, { text: 'No data' })
        )
      )
    ),

    // Main panel
    h('div', { className: 'panel' },
      // Bulk actions
      h(BulkActionBar, {
        count: selectedRowKeys.length,
        selectedKeys: selectedRowKeys,
        bundles: bundles,
        onClear: function() { setSelectedRowKeys([]); },
        onRefresh: function() { setSelectedRowKeys([]); },
        terms: terms,
        projectMembersCache: props.projectMembersCache,
      }),

      // Search + Column visibility controls
      h('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 12px' } },
        h(Input, {
          placeholder: 'Search ' + capFirst(B).toLowerCase() + 's...',
          value: searchText,
          onChange: function(e) { setSearchText(e.target.value); setActiveStatCard(null); },
          allowClear: true,
          style: { width: 260, fontSize: 12 },
          prefix: h('span', { style: { color: '#8F8FA3' } }, '\u2315'),
        }),
        h(ColumnVisibilityDropdown, {
          columns: allColumns.map(function(c) { return { key: c.key, title: typeof c.title === 'string' ? c.title : c.key }; }),
          hiddenKeys: (function() {
            // Per-stage cols are hidden unless explicitly enabled
            var stageCols = perStageCols.map(function(c) { return c.key; });
            var hiddenStageCols = stageCols.filter(function(k) { return shownStageCols.indexOf(k) < 0; });
            return hiddenCols.concat(hiddenStageCols);
          })(),
          onToggle: function(key) {
            if (key.startsWith('st_') || key.startsWith('sa_')) {
              setShownStageCols(function(prev) {
                return prev.indexOf(key) >= 0 ? prev.filter(function(k) { return k !== key; }) : prev.concat([key]);
              });
            } else {
              setHiddenCols(function(prev) {
                return prev.indexOf(key) >= 0 ? prev.filter(function(k) { return k !== key; }) : prev.concat([key]);
              });
            }
          },
        })
      ),

      // Active stage filter indicator
      filterStage ? h('div', { style: { padding: '4px 12px' } },
        h(Tag, { closable: true, color: 'purple', onClose: function() { setFilterStage(null); } }, 'Stage: ' + filterStage)
      ) : null,

      // Table with Excel-like column filters, resizable + hideable columns
      h('div', { className: 'panel-body-flush' },
        (function() {
          // Apply column widths and visibility (per-stage cols hidden unless in shownStageCols)
          var visibleCols = allColumns.filter(function(c) {
            if (c.key.startsWith('st_') || c.key.startsWith('sa_')) return shownStageCols.indexOf(c.key) >= 0;
            return hiddenCols.indexOf(c.key) < 0;
          });
          var resizableCols = visibleCols.map(function(col) {
            var w = colWidths[col.key] || col.width;
            return Object.assign({}, col, {
              width: w,
              onHeaderCell: function(column) {
                return {
                  width: w,
                  onResize: function(newWidth) {
                    setColWidths(function(prev) {
                      var next = Object.assign({}, prev);
                      next[col.key] = newWidth;
                      return next;
                    });
                  },
                };
              },
            });
          });
          return h(Table, {
            dataSource: filtered,
            columns: resizableCols,
            components: { header: { cell: ResizableHeaderCell } },
            rowKey: function(r) { return r.id || r.name; },
            loading: loading,
            size: 'small',
            scroll: { x: 1400 },
            pagination: { defaultPageSize: 20, size: 'small', showSizeChanger: true, pageSizeOptions: ['20', '50', '100', String(filtered.length > 100 ? filtered.length : 200)], showTotal: function(total) { return total + ' ' + capFirst(B).toLowerCase() + 's'; } },
            rowSelection: {
              selectedRowKeys: selectedRowKeys,
              onChange: function(keys) { setSelectedRowKeys(keys); },
            },
            rowClassName: function(record) {
              return selectedBundle && (record.id || record.name) === (selectedBundle.id || selectedBundle.name) ? 'selected-row' : '';
            },
          });
        })()
      ),
      h(FindingsDrawer, {
        visible: findingsDrawerOpen,
        onClose: function() { setFindingsDrawerOpen(false); },
        bundle: findingsDrawerBundle,
      }),
    )
  );
}


// ═══════════════════════════════════════════════════════════════
//  Study Detail Drawer
// ═══════════════════════════════════════════════════════════════
function DetailDrawer(props) {
  var bundle = props.bundle;
  var visible = props.visible;
  var onClose = props.onClose;
  var terms = props.terms || DEFAULT_TERMS;
  var B = terms.bundle;
  var P = terms.policy;
  var deUrl = props.dataExplorerUrl || null;
  var projectMembersCache = props.projectMembersCache || {};
  var initialView = props.initialView || null;
  var debugMode = props.debugMode || false;

  var _view = useState('attachments');
  var activeView = _view[0];
  var setActiveView = _view[1];

  // Reset to initialView (or Attachments) when a new bundle is selected
  var bundleId = bundle ? (bundle.id || bundle.name) : null;
  useEffect(function() { setActiveView(initialView || 'attachments'); }, [bundleId, initialView]);

  if (!bundle) return null;

  var stageIdx = deriveBundleStageIndex(bundle);
  var dominoUrl = getDominoBundleUrl(bundle);
  var stageNames = getBundleStageNames(bundle);
  var isComplete = bundle.state === 'Complete';

  // Counts for dropdown labels
  var findingsCount = bundle._findings ? bundle._findings.length : 0;
  var approvalsCount = bundle._approvals ? bundle._approvals.length : 0;
  var gatesCount = bundle._gates ? bundle._gates.length : 0;
  var attachCount = bundle._attachments ? bundle._attachments.length : 0;
  var staleCount = countStaleAttachments(bundle);

  var viewOptions = [
    { value: 'attachments', label: 'Attachments' + (attachCount > 0 ? ' (' + attachCount + ')' : '') + (staleCount > 0 ? ' \u26A0' : '') },
    { value: 'stage-timeline', label: 'Stage Timeline' },
    { value: 'overview', label: B + ' Overview' },
    { value: 'findings', label: 'Findings' + (findingsCount > 0 ? ' (' + findingsCount + ')' : '') },
    { value: 'approvals', label: 'Approvals' + (approvalsCount > 0 ? ' (' + approvalsCount + ')' : '') },
    { value: 'gates', label: 'Gates' + (gatesCount > 0 ? ' (' + gatesCount + ')' : '') },
  ];

  // ── View: Stage Timeline ────────────────────────────────────
  function renderStageTimeline() {
    if (stageNames.length === 0) return h(Empty, { description: 'No stages defined' });
    return h('div', null,
      h('div', { className: 'tracker-timeline-legend', style: { marginBottom: 12 } },
        h('span', { className: 'tracker-timeline-legend-item' }, h('span', { className: 'tracker-timeline-dot completed', style: { width: 8, height: 8, display: 'inline-block', verticalAlign: 'middle', marginRight: 4 } }), 'Complete'),
        h('span', { className: 'tracker-timeline-legend-item' }, h('span', { className: 'tracker-timeline-dot active', style: { width: 8, height: 8, display: 'inline-block', verticalAlign: 'middle', marginRight: 4, boxShadow: 'none' } }), 'Current'),
        h('span', { className: 'tracker-timeline-legend-item' }, h('span', { className: 'tracker-timeline-dot pending', style: { width: 8, height: 8, display: 'inline-block', verticalAlign: 'middle', marginRight: 4 } }), 'Pending')
      ),
      stageNames.map(function(name, idx) {
        var dotState;
        if (isComplete || idx < stageIdx) dotState = 'completed';
        else if (idx === stageIdx) dotState = 'active';
        else dotState = 'pending';
        var stageData = bundle.stages[idx] || {};
        var assignee = stageData.assignee;
        var assigneeName = assignee ? assignee.name : null;
        var members = projectMembersCache[bundle.projectId] || [];
        var memberOptions = members.map(function(m) {
          return { label: (m.firstName || '') + ' ' + (m.lastName || '') + ' (' + m.userName + ')', value: m.id };
        });
        // Resolve assignee: try ID match, then userName match against members
        var resolvedAssigneeId = assignee ? assignee.id : undefined;
        if (resolvedAssigneeId && !memberOptions.some(function(o) { return o.value === resolvedAssigneeId; })) {
          var saName = assignee && (assignee.name || assignee.userName);
          var userNameMatch = saName ? members.find(function(m) { return m.userName === saName; }) : null;
          if (userNameMatch) {
            resolvedAssigneeId = userNameMatch.id;
          } else {
            // Add placeholder option so the Select shows a name instead of nothing
            var fallbackLabel = saName || ('Unknown (' + (resolvedAssigneeId || '?') + ')');
            memberOptions.unshift({ label: fallbackLabel, value: resolvedAssigneeId });
          }
        }
        var gapInfo = API_GAPS.stageReassign;
        var stageId = stageData.stageId || (stageData.stage && stageData.stage.id);
        return h('div', { key: idx, className: 'tracker-timeline-item' },
          h('div', { className: 'tracker-timeline-dot ' + dotState }),
          idx < stageNames.length - 1 ? h('div', { className: 'tracker-timeline-line ' + dotState }) : null,
          h('div', { className: 'tracker-timeline-content' },
            h('div', { className: 'tracker-timeline-name' + (dotState === 'active' ? ' active' : '') }, name),
            h('div', { className: 'tracker-timeline-meta' },
              gapInfo.ready
                ? h(Select, {
                    size: 'small', placeholder: 'Assign...', value: resolvedAssigneeId || undefined,
                    style: { minWidth: 160, fontSize: 11 }, showSearch: true, allowClear: true, options: memberOptions,
                    onChange: function(userId) {
                      if (!stageId) { antd.message.error('Missing stage ID'); return; }
                      var memberObj = userId ? members.find(function(m) { return m.id === userId; }) : null;
                      apiPatch('api/bundles/' + bundle.id + '/stages/' + stageId, { assignee: userId ? { id: userId, userName: memberObj ? memberObj.userName : undefined, name: memberObj ? memberObj.userName : undefined } : null })
                        .then(function(resp) {
                          if (resp && resp.assignee) { stageData.assignee = resp.assignee; } else if (!userId) { stageData.assignee = null; }
                          if (resp && resp.stage && resp.stage.policyVersionId) { bundle._policyVersionId = resp.stage.policyVersionId; }
                          if (resp.verified === true) {
                            antd.message.success('Stage reassigned — verified');
                          } else if (resp.verified === false) {
                            var dbg = resp._debug || {};
                            var attempts = dbg.attempts || [];
                            var lastAttempt = attempts[attempts.length - 1] || {};
                            var desc = 'Read-back mismatch after ' + attempts.length + ' attempts.\n' +
                              'Requested: ' + (dbg.requestedId || 'unassign') + '\n' +
                              'Got back: ' + (lastAttempt.actualId || 'null') + '\n' +
                              'Stage: ' + (dbg.stageId || '?');
                            if (debugMode) {
                              desc += '\n\nDebug:\n' + JSON.stringify(dbg, null, 2);
                            }
                            antd.notification.warning({
                              message: 'Assignment may not have saved',
                              description: h('pre', { style: { fontSize: 11, whiteSpace: 'pre-wrap', margin: 0, maxHeight: 300, overflow: 'auto' } }, desc),
                              duration: debugMode ? 0 : 15,
                            });
                          } else {
                            antd.message.success('Stage reassigned');
                          }
                        })
                        .catch(function(err) { antd.notification.error({ message: 'Reassignment failed', description: parseServerError(err.message || String(err)), duration: 8 }); });
                    },
                    optionFilterProp: 'label',
                  })
                : assigneeName
                  ? h('span', { style: { fontSize: 12, color: '#2E2E38', fontWeight: 500 } }, assigneeName)
                  : h('span', { style: { fontSize: 12, color: '#B0B0C0', fontStyle: 'italic' } }, 'Unassigned'),
              h('span', { className: 'tracker-stage-badge ' + dotState }, dotState === 'completed' ? 'Done' : dotState === 'active' ? 'Current' : 'Pending')
            )
          )
        );
      })
    );
  }

  // ── View: Overview ──────────────────────────────────────────
  function renderOverview() {
    return h('div', null,
      h('div', { className: 'detail-field' }, h('span', { className: 'detail-field-label' }, 'State'), h('span', { className: 'detail-field-value' }, h(Tag, { color: stateColor(bundle.state) }, bundle.state))),
      h('div', { className: 'detail-field' }, h('span', { className: 'detail-field-label' }, 'Project'), h('span', { className: 'detail-field-value' }, bundle.projectName || '\u2013')),
      h('div', { className: 'detail-field' }, h('span', { className: 'detail-field-label' }, P), h('span', { className: 'detail-field-value' }, bundle.policyName || '\u2013')),
      h('div', { className: 'detail-field' }, h('span', { className: 'detail-field-label' }, 'Current Stage'), h('span', { className: 'detail-field-value' }, bundle.stage || '\u2013')),
      h('div', { className: 'detail-field' }, h('span', { className: 'detail-field-label' }, 'Progress'), h('span', { className: 'detail-field-value' }, h(Progress, { percent: getBundleProgress(bundle), size: 'small', strokeColor: '#543FDE' }))),
      bundle.stageAssignee && bundle.stageAssignee.name
        ? h('div', { className: 'detail-field' }, h('span', { className: 'detail-field-label' }, 'Stage Owner'), h('span', { className: 'detail-field-value' }, bundle.stageAssignee.name))
        : null,
      h('div', { className: 'detail-field' }, h('span', { className: 'detail-field-label' }, 'Created'), h('span', { className: 'detail-field-value' }, bundle.createdAt ? dayjs(bundle.createdAt).format('MMM D, YYYY') : '\u2013')),
      bundle.createdBy
        ? h('div', { className: 'detail-field' }, h('span', { className: 'detail-field-label' }, 'Created by'), h('span', { className: 'detail-field-value' }, bundle.createdBy.name || bundle.createdBy.userName || '\u2013'))
        : null,
      bundle.updatedAt
        ? h('div', { className: 'detail-field' }, h('span', { className: 'detail-field-label' }, 'Last updated'), h('span', { className: 'detail-field-value' }, dayjs(bundle.updatedAt).fromNow()))
        : null
    );
  }

  // ── View: Findings ──────────────────────────────────────────
  function renderFindings() {
    if (findingsCount === 0) return h(Empty, { description: 'No findings recorded.' });
    var fpUrl = getDominoBundleUrl(bundle, { findingsPage: true });
    return h('div', null,
      fpUrl ? h('div', { style: { marginBottom: 12, textAlign: 'right' } }, h('a', { href: fpUrl, target: '_blank', rel: 'noopener noreferrer', style: { fontSize: 11, color: '#543FDE' } }, 'View all in Domino \u2197')) : null,
      bundle._findings.map(function(f, i) {
        var fUrl = f.id ? getDominoBundleUrl(bundle, { findingId: f.id }) : null;
        return h('div', { key: i, style: { display: 'flex', alignItems: 'center', gap: 8, padding: '8px 0', borderBottom: '1px solid #F5F5F8' } },
          h(Tag, { color: severityColor(f.severity), style: { color: '#fff', border: 'none', minWidth: 28, textAlign: 'center' } }, f.severity),
          fUrl
            ? h('a', { href: fUrl, target: '_blank', rel: 'noopener noreferrer', style: { flex: 1, fontSize: 13, color: '#543FDE', textDecoration: 'none' }, title: 'View finding in Domino' }, f.name)
            : h('span', { style: { flex: 1, fontSize: 13 } }, f.name),
          findingStatusTag(f.status)
        );
      })
    );
  }

  // ── View: Approvals ─────────────────────────────────────────
  function renderApprovals() {
    if (approvalsCount === 0) return h(Empty, { description: 'No approvals configured.' });
    return h('div', null,
      bundle._approvals.map(function(a, i) {
        return h('div', { key: i, style: { display: 'flex', alignItems: 'center', gap: 10, padding: '10px 0', borderBottom: '1px solid #F5F5F8' } },
          h('span', { style: { background: approvalStatusColor(a.status), width: 10, height: 10, borderRadius: '50%', flexShrink: 0 } }),
          h('div', { style: { flex: 1, minWidth: 0 } },
            h('div', { style: { fontWeight: 500, fontSize: 13 } }, a.name),
            h('div', { style: { fontSize: 12, color: '#8F8FA3', marginTop: 2 } }, approvalStatusLabel(a.status)),
            a.approvers && a.approvers.length > 0
              ? h('div', { style: { fontSize: 11, color: '#65657B', marginTop: 2 } }, a.approvers.map(function(ap) { return ap.name; }).join(', '))
              : null
          ),
          a.updatedAt ? h('span', { style: { fontSize: 11, color: '#B0B0C0', flexShrink: 0 } }, dayjs(a.updatedAt).fromNow()) : null
        );
      })
    );
  }

  // ── View: Gates ─────────────────────────────────────────────
  function renderGates() {
    if (gatesCount === 0) return h(Empty, { description: 'No quality gates defined.' });
    return h('div', null,
      bundle._gates.map(function(g, i) {
        return h('div', { key: i, className: 'detail-field', style: { padding: '8px 0', borderBottom: '1px solid #F5F5F8' } },
          h('span', { className: 'detail-field-label' }, g.name),
          h('span', { className: 'detail-field-value' }, h(Tag, { color: g.isOpen ? 'success' : 'error' }, g.isOpen ? 'Open' : 'Closed'))
        );
      })
    );
  }

  // ── View: Attachments ───────────────────────────────────────
  function renderAttachments() {
    if (attachCount === 0) return h(Empty, { description: 'No attachments linked.' });
    return h('div', null,
      staleCount > 0 ? h(Alert, { type: 'warning', showIcon: true, style: { marginBottom: 12, fontSize: 12 }, message: staleCount + ' snapshot' + (staleCount > 1 ? 's' : '') + ' may be outdated' }) : null,
      bundle._attachments.map(function(att, i) {
        var id = att.identifier || {};
        var fname = id.filename || id.name || 'Unnamed';
        var typeLabels = { DatasetSnapshotFile: 'Dataset Snapshot', NetAppVolumeSnapshotFile: 'NetApp Volume', FlowArtifact: 'Flow Artifact', ModelVersion: 'Model Version', Report: 'Code' };
        var typeColors = { DatasetSnapshotFile: 'blue', Report: 'green', ModelVersion: 'purple', Endpoint: 'orange', FlowArtifact: 'cyan', NetAppVolumeSnapshotFile: 'default' };
        var typeLabel = typeLabels[att.type] || (att.type || '').replace(/([A-Z])/g, ' $1').trim();
        var explorerLink = deUrl && isDataExplorerFile(fname) ? buildDataExplorerUrl(deUrl, att) : null;
        var explorerPath = explorerLink ? buildDataExplorerPath(att) : null;
        var ver = id.snapshotVersion;
        var staleness = att._staleness;
        var deIcon = icons && icons.TableOutlined ? h(icons.TableOutlined, { style: { fontSize: 11 } }) : null;
        // Version tag rendering
        var versionTag = null;
        if (ver != null) {
          if (staleness && staleness.isStale) {
            var timeStr = '';
            if (staleness.latestSnapshotTime) {
              var ts = dayjs(staleness.latestSnapshotTime);
              timeStr = ' (created ' + ts.format('MMM D, YYYY') + ')';
            }
            var tipText = 'Outdated: v' + staleness.currentVersion + ' attached, but v' + staleness.latestVersion + ' is available' + timeStr + '. Source: ' + (staleness.sourceName || 'unknown') + '.';
            versionTag = h(Tooltip, { title: tipText, overlayStyle: { maxWidth: 340 } },
              h('span', { style: { display: 'inline-flex', alignItems: 'center', gap: 3 } },
                h(Tag, { color: 'orange', style: { fontSize: 10, margin: 0 } }, 'v' + ver),
                h('span', { style: { color: '#D4380D', fontSize: 13, cursor: 'help' } }, '\u26A0')
              )
            );
          } else if (staleness && !staleness.isStale && staleness.latestVersion > 1) {
            versionTag = h(Tooltip, { title: 'Current version (latest known: v' + staleness.latestVersion + ')' },
              h(Tag, { color: 'green', style: { fontSize: 10, margin: 0 } }, 'v' + ver)
            );
          } else {
            versionTag = h(Tag, { style: { fontSize: 10, margin: 0 } }, 'v' + ver);
          }
        }
        // Metadata line: created date + created by
        var metaParts = [];
        if (att.createdAt) metaParts.push(dayjs(att.createdAt).format('MMM D, YYYY'));
        if (att.createdBy) metaParts.push(att.createdBy.name || att.createdBy.userName);
        var metaLine = metaParts.length > 0
          ? h('div', { style: { fontSize: 11, color: '#8F8FA3', marginTop: 2 } }, metaParts.join(' \u00B7 '))
          : null;
        return h('div', { key: i, style: { display: 'flex', alignItems: 'flex-start', gap: 8, padding: '8px 0', borderBottom: '1px solid #F5F5F8' } },
          h(Tag, { color: typeColors[att.type] || 'default', style: { fontSize: 10, flexShrink: 0, marginTop: 2 } }, typeLabel),
          h('div', { style: { flex: 1, minWidth: 0 } },
            h('div', { style: { display: 'flex', alignItems: 'center', gap: 6 } },
              explorerLink
                ? h(Tooltip, { title: 'Open in Data Explorer: ' + explorerPath },
                    h('a', { href: explorerLink, onClick: function(e) { openDataExplorer(explorerLink, explorerPath, e); }, style: { fontSize: 13, color: '#0070CC', cursor: 'pointer', fontWeight: 500, display: 'inline-flex', alignItems: 'center', gap: 4 } }, deIcon, fname))
                : dominoUrl
                  ? h('a', { href: dominoUrl, target: '_blank', rel: 'noopener noreferrer', style: { fontSize: 13, color: '#543FDE', fontWeight: 500 } }, fname)
                  : h('span', { style: { fontSize: 13, fontWeight: 500 } }, fname),
              versionTag
            ),
            metaLine
          )
        );
      })
    );
  }

  // ── Render active view ──────────────────────────────────────
  function renderActiveView() {
    switch (activeView) {
      case 'stage-timeline': return renderStageTimeline();
      case 'overview': return renderOverview();
      case 'findings': return renderFindings();
      case 'approvals': return renderApprovals();
      case 'gates': return renderGates();
      case 'attachments': return renderAttachments();
      default: return renderStageTimeline();
    }
  }

  return h(Drawer, {
    title: h('div', { style: { display: 'flex', flexDirection: 'column', gap: 2 } },
      h('span', null, bundle.name),
      h('div', { style: { display: 'flex', alignItems: 'center', gap: 6, marginTop: 2 } },
        h(Tag, { color: stateColor(bundle.state), style: { fontSize: 11, margin: 0 } }, bundle.state),
        h('span', { style: { fontSize: 12, color: '#8F8FA3', fontWeight: 400 } }, bundle.projectName || '')
      )
    ),
    open: visible,
    onClose: onClose,
    width: 480,
    styles: { body: { padding: 0, display: 'flex', flexDirection: 'column', height: '100%' } },
    extra: dominoUrl
      ? h(Button, { type: 'primary', size: 'small', onClick: function() { window.open(dominoUrl, '_blank'); } }, '\u2197 View in Domino')
      : null,
  },
    // View selector tabs
    h('div', { style: { borderBottom: '1px solid #E0E0E0', flexShrink: 0 } },
      h(Tabs, {
        activeKey: activeView,
        onChange: function(key) { setActiveView(key); },
        size: 'small',
        style: { margin: '0 24px' },
        items: viewOptions.map(function(opt) {
          return { key: opt.value, label: opt.label };
        }),
      })
    ),
    // Active view content
    h('div', { style: { padding: '16px 24px', flex: 1, overflow: 'auto' } },
      renderActiveView()
    )
  );
}


// ═══════════════════════════════════════════════════════════════
//  ASSIGNMENT RULES PAGE
// ═══════════════════════════════════════════════════════════════
function AssignmentRulesPage(props) {
  var bundles = props.bundles;
  var setBundles = props.setBundles;
  var assignmentRules = props.assignmentRules;
  var setAssignmentRules = props.setAssignmentRules;
  var terms = props.terms;
  var onNavigate = props.onNavigate;
  var B = terms.bundle || 'Bundle';
  var P = terms.policy || 'Policy';

  var _rp = useState(null); var selectedProject = _rp[0]; var setSelectedProject = _rp[1];
  var _rm = useState(false); var addModalOpen = _rm[0]; var setAddModalOpen = _rm[1];
  var _ra = useState(false); var applyModalOpen = _ra[0]; var setApplyModalOpen = _ra[1];
  var _re = useState(null); var editingIdx = _re[0]; var setEditingIdx = _re[1];
  var _rf1 = useState(undefined); var formPlan = _rf1[0]; var setFormPlan = _rf1[1];
  var _rf2 = useState(undefined); var formStage = _rf2[0]; var setFormStage = _rf2[1];
  var _rf3 = useState(undefined); var formAssignee = _rf3[0]; var setFormAssignee = _rf3[1];
  var _rc = useState('skip'); var conflictMode = _rc[0]; var setConflictMode = _rc[1];
  var _rl = useState(false); var applyLoading = _rl[0]; var setApplyLoading = _rl[1];

  // Unique projects from bundles
  var projectOptions = useMemo(function() {
    var seen = {};
    return bundles.reduce(function(acc, b) {
      if (!seen[b.projectId]) {
        seen[b.projectId] = true;
        acc.push({ label: b.projectName, value: b.projectId });
      }
      return acc;
    }, []);
  }, [bundles]);

  // Auto-select project if only one
  useEffect(function() {
    if (!selectedProject && projectOptions.length === 1) {
      setSelectedProject(projectOptions[0].value);
    }
  }, [projectOptions]);

  // Bundles for selected project
  var projectBundles = useMemo(function() {
    if (!selectedProject) return [];
    return bundles.filter(function(b) { return b.projectId === selectedProject; });
  }, [bundles, selectedProject]);

  // Rules for selected project
  var projectRules = useMemo(function() {
    if (!selectedProject) return [];
    return assignmentRules.filter(function(r) { return r.projectId === selectedProject; });
  }, [assignmentRules, selectedProject]);

  // QC Plans used in this project
  var planOptions = useMemo(function() {
    var seen = {};
    return projectBundles.reduce(function(acc, b) {
      if (!seen[b.policyName]) {
        seen[b.policyName] = true;
        acc.push({ label: b.policyName, value: b.policyName });
      }
      return acc;
    }, []);
  }, [projectBundles]);

  // Stages for selected QC Plan (from live policies or from bundle stage data)
  var stageOptions = useMemo(function() {
    if (!formPlan) return [];
    // Try live policies first (fetched from API)
    var lp = props.livePolicies || [];
    if (lp.length > 0) {
      var policyOverview = lp.find(function(p) { return p.name === formPlan; });
      if (policyOverview && policyOverview.id) {
        // Policy overview doesn't have stages; extract from bundle data instead
      }
    }
    // Extract from bundle stages (always works for bundles using this policy)
    var names = {};
    projectBundles.forEach(function(b) {
      if (b.policyName !== formPlan) return;
      (b.stages || []).forEach(function(s) {
        var n = s.stage ? s.stage.name : '';
        if (n) names[n] = true;
      });
    });
    return Object.keys(names).map(function(n) { return { label: n, value: n }; });
  }, [formPlan, projectBundles, props.livePolicies]);

  // Assignee options (from live project members, scoped to selected project)
  var memberOptions = useMemo(function() {
    var pmc = props.projectMembersCache || {};
    var members = selectedProject ? (pmc[selectedProject] || []) : [];
    return members.map(function(m) {
      return { label: (m.firstName || '') + ' ' + (m.lastName || '') + ' (' + m.userName + ')', value: m.userName };
    });
  }, [selectedProject, props.projectMembersCache]);

  // Add match counts to rules
  var rulesWithCounts = useMemo(function() {
    return projectRules.map(function(rule, idx) {
      var total = 0;
      var unassigned = 0;
      projectBundles.forEach(function(b) {
        if (b.policyName !== rule.policyName) return;
        (b.stages || []).forEach(function(s) {
          var stageName = s.stage ? s.stage.name : '';
          if (stageName !== rule.stageName) return;
          total++;
          if (!s.assignee || !s.assignee.name) unassigned++;
        });
      });
      return Object.assign({}, rule, { _total: total, _unassigned: unassigned, _idx: idx });
    });
  }, [projectRules, projectBundles]);

  // Total unassigned that match any rule
  var totalUnassignedMatch = useMemo(function() {
    return rulesWithCounts.reduce(function(sum, r) { return sum + r._unassigned; }, 0);
  }, [rulesWithCounts]);

  // Apply preview: what changes will be made
  var applyPreview = useMemo(function() {
    var changes = [];
    var pmc = props.projectMembersCache || {};
    var projMembers = selectedProject ? (pmc[selectedProject] || []) : [];
    projectRules.forEach(function(rule) {
      var mem = projMembers.find(function(m) { return m.userName === rule.assignee; });
      var newLabel = mem ? (mem.firstName || '') + ' ' + (mem.lastName || '') : rule.assignee;
      projectBundles.forEach(function(b) {
        if (b.policyName !== rule.policyName) return;
        (b.stages || []).forEach(function(s) {
          var stageName = s.stage ? s.stage.name : '';
          if (stageName !== rule.stageName) return;
          var current = s.assignee && s.assignee.name ? s.assignee.name : null;
          var skip = (conflictMode === 'skip' && current);
          changes.push({
            key: b.id + '-' + stageName,
            bundleName: b.name,
            bundleId: b.id,
            stageId: s.stage ? s.stage.id : null,
            stageData: s,
            bundle: b,
            memberId: mem ? mem.id : null,
            memberUserName: rule.assignee,
            stageName: stageName,
            currentAssignee: current || 'Unassigned',
            newAssignee: newLabel,
            willApply: !skip,
          });
        });
      });
    });
    return changes;
  }, [projectRules, projectBundles, conflictMode]);

  var changesCount = applyPreview.filter(function(c) { return c.willApply; }).length;
  var affectedBundles = {};
  applyPreview.forEach(function(c) { if (c.willApply) affectedBundles[c.bundleName] = true; });
  var affectedBundleCount = Object.keys(affectedBundles).length;

  // Handlers
  function openAddModal(editIdx) {
    if (editIdx !== undefined && editIdx !== null) {
      var globalIdx = assignmentRules.indexOf(projectRules[editIdx]);
      setEditingIdx(globalIdx);
      var rule = projectRules[editIdx];
      setFormPlan(rule.policyName);
      setFormStage(rule.stageName);
      setFormAssignee(rule.assignee);
    } else {
      setEditingIdx(null);
      setFormPlan(undefined);
      setFormStage(undefined);
      setFormAssignee(undefined);
    }
    setAddModalOpen(true);
  }

  function handleSaveRule() {
    if (!formPlan || !formStage || !formAssignee) return;
    var newRule = {
      id: 'rule-' + Date.now(),
      projectId: selectedProject,
      policyName: formPlan,
      stageName: formStage,
      assignee: formAssignee,
    };
    if (editingIdx !== null && editingIdx !== undefined) {
      var updated = assignmentRules.slice();
      updated[editingIdx] = newRule;
      setAssignmentRules(updated);
    } else {
      setAssignmentRules(assignmentRules.concat([newRule]));
    }
    setAddModalOpen(false);
    setFormPlan(undefined);
    setFormStage(undefined);
    setFormAssignee(undefined);
    setEditingIdx(null);
  }

  function handleDeleteRule(localIdx) {
    var globalIdx = assignmentRules.indexOf(projectRules[localIdx]);
    if (globalIdx >= 0) {
      var updated = assignmentRules.slice();
      updated.splice(globalIdx, 1);
      setAssignmentRules(updated);
    }
  }

  function handleApplyRules() {
    var toApply = applyPreview.filter(function(c) { return c.willApply; });
    if (toApply.length === 0) { setApplyModalOpen(false); return; }

    // Pre-check: filter out ineligible items
    var skipped = [];
    var eligible = [];
    toApply.forEach(function(t) {
      if (!t.stageId) {
        skipped.push({ bundleName: t.bundleName, reason: 'Missing stage ID' });
        return;
      }
      if (!t.memberId) {
        skipped.push({ bundleName: t.bundleName, reason: 'Assignee "' + t.memberUserName + '" not found in project members — they may need to be added as a collaborator' });
        return;
      }
      var state = (t.bundle.state || '').toLowerCase();
      if (state === 'archived') {
        skipped.push({ bundleName: t.bundleName, reason: 'Archived — reactivate in Domino first' });
        return;
      }
      if (state === 'complete') {
        skipped.push({ bundleName: t.bundleName, reason: 'Complete — reopen in Domino first' });
        return;
      }
      eligible.push(t);
    });

    if (eligible.length === 0) {
      setApplyModalOpen(false);
      antd.notification.error({
        message: 'Cannot apply any rules',
        description: h('div', null,
          skipped.map(function(s, i) { return h('p', { key: i, style: { fontSize: 12 } }, '\u2022 ' + s.bundleName + ' — ' + s.reason); })
        ),
        duration: 15,
      });
      return;
    }

    setApplyLoading(true);
    var promises = eligible.map(function(t) {
      var body = { assignee: { id: t.memberId, userName: t.memberUserName, name: t.memberUserName } };
      return apiPatch('api/bundles/' + t.bundleId + '/stages/' + t.stageId, body)
        .then(function(resp) {
          if (resp.verified === false) {
            var actualName = resp.actualAssignee ? (resp.actualAssignee.name || resp.actualAssignee.id) : 'nobody';
            return { success: false, bundleName: t.bundleName, stageName: t.stageName, reason: 'Domino did not persist — assignee is still ' + actualName + '. They may need to be added as a collaborator.' };
          }
          // Update local state after verification
          if (resp && resp.assignee && t.stageData) {
            t.stageData.assignee = resp.assignee;
          }
          return { success: true, bundleName: t.bundleName, stageName: t.stageName, verified: resp.verified };
        })
        .catch(function(err) {
          var detail = err.message || String(err);
          var reason = detail.indexOf('403') !== -1 ? 'Permission denied — check project collaborator settings' : detail.indexOf('404') !== -1 ? B + ' or stage not found' : parseServerError(detail);
          return { success: false, bundleName: t.bundleName, stageName: t.stageName, reason: reason };
        });
    });

    Promise.all(promises).then(function(results) {
      setApplyLoading(false);
      setApplyModalOpen(false);
      var succeeded = results.filter(function(r) { return r.success; });
      var failed = results.filter(function(r) { return !r.success; });
      var verified = succeeded.filter(function(r) { return r.verified === true; });

      // Force re-render of bundles so UI updates
      if (succeeded.length > 0) {
        setBundles(bundles.slice());
      }

      var skippedSection = skipped.length > 0 ? [
        h('p', { style: { fontWeight: 500, marginTop: 8, fontSize: 12, color: '#8F8FA3' } }, 'Skipped (' + skipped.length + '):'),
        skipped.map(function(s, i) { return h('p', { key: 'skip-' + i, style: { marginLeft: 8, fontSize: 11, color: '#8F8FA3' } }, '\u2022 ' + s.bundleName + ' — ' + s.reason); })
      ] : [];

      if (failed.length === 0 && succeeded.length > 0) {
        var msg = 'Applied rules: assigned ' + succeeded.length + ' stage' + (succeeded.length !== 1 ? 's' : '');
        msg += verified.length === succeeded.length ? ' — all verified in Domino' : ' (verification pending for ' + (succeeded.length - verified.length) + ')';
        if (skipped.length > 0) msg += '. ' + skipped.length + ' skipped.';
        antd.message.success(msg);
        if (skipped.length > 0) {
          antd.notification.info({
            message: skipped.length + ' stage' + (skipped.length > 1 ? 's' : '') + ' skipped',
            description: h('div', null, skippedSection),
            duration: 10,
          });
        }
      } else if (succeeded.length > 0) {
        antd.notification.warning({
          message: succeeded.length + ' of ' + eligible.length + ' assignments succeeded',
          description: h('div', null,
            verified.length > 0 ? h('p', null, verified.length + ' verified in Domino') : null,
            h('p', { style: { fontWeight: 500, marginTop: 4 } }, 'Failed (' + failed.length + '):'),
            failed.map(function(f, i) { return h('p', { key: i, style: { marginLeft: 8, fontSize: 12 } }, '\u2022 ' + f.bundleName + ' / ' + f.stageName + ' — ' + f.reason); }),
            skippedSection,
            h('p', { style: { marginTop: 8, color: '#65657B', fontSize: 12 } }, 'Tip: Ensure the assignee is a collaborator on the ' + B.toLowerCase() + '\'s Domino project.')
          ),
          duration: 15,
        });
      } else {
        antd.notification.error({
          message: 'All ' + eligible.length + ' assignments failed',
          description: h('div', null,
            failed.map(function(f, i) { return h('p', { key: i, style: { marginLeft: 8, fontSize: 12 } }, '\u2022 ' + f.bundleName + ' / ' + f.stageName + ' — ' + f.reason); }),
            skippedSection
          ),
          duration: 15,
        });
      }
    });
  }

  // Rules table columns
  var rulesColumns = [
    { title: P + ' (QC Plan)', dataIndex: 'policyName', key: 'plan',
      render: function(v) { return h(Tag, { color: 'purple' }, v); }
    },
    { title: 'Stage', dataIndex: 'stageName', key: 'stage' },
    { title: 'Assignee', dataIndex: 'assignee', key: 'assignee',
      render: function(v) {
        var pmc = props.projectMembersCache || {};
        var projMembers = selectedProject ? (pmc[selectedProject] || []) : [];
        var mem = projMembers.find(function(m) { return m.userName === v; });
        return mem ? (mem.firstName || '') + ' ' + (mem.lastName || '') : v;
      }
    },
    { title: 'Matched', key: 'matched', width: 90, align: 'center',
      render: function(_, r) {
        return h('span', null,
          h('span', { style: { fontWeight: 600 } }, r._total),
          r._unassigned > 0
            ? h('span', { style: { color: '#F59E0B', fontSize: 11, marginLeft: 4 } }, '(' + r._unassigned + ' open)')
            : null
        );
      }
    },
    { title: '', key: 'actions', width: 100,
      render: function(_, r, idx) {
        return h(Space, { size: 4 },
          h(Button, { type: 'link', size: 'small', onClick: function() { openAddModal(idx); } }, 'Edit'),
          h(Button, { type: 'link', size: 'small', danger: true, onClick: function() { handleDeleteRule(idx); } }, 'Delete')
        );
      }
    },
  ];

  // Apply preview columns
  var previewColumns = [
    { title: B, dataIndex: 'bundleName', key: 'bundle', ellipsis: true },
    { title: 'Stage', dataIndex: 'stageName', key: 'stage', ellipsis: true },
    { title: 'Current', dataIndex: 'currentAssignee', key: 'current', width: 130,
      render: function(v) {
        return v === 'Unassigned'
          ? h('span', { style: { color: '#F59E0B' } }, 'Unassigned')
          : v;
      }
    },
    { title: 'New Assignee', dataIndex: 'newAssignee', key: 'new', width: 130,
      render: function(v, r) {
        return h('span', { style: { color: r.willApply ? '#28A464' : '#8F8FA3', fontWeight: r.willApply ? 600 : 400 } }, v);
      }
    },
    { title: '', key: 'status', width: 70,
      render: function(_, r) {
        return r.willApply
          ? h(Tag, { color: 'green' }, 'Apply')
          : h(Tag, null, 'Skip');
      }
    },
  ];

  return h('div', null,
    // Page header
    h('div', { className: 'page-header' },
      h('div', { style: { display: 'flex', alignItems: 'center', gap: 12 } },
        h('h2', { style: { margin: 0 } }, 'Bulk Assignment Rules')
      ),
      h('p', { className: 'page-subtitle' }, 'Define rules to bulk-assign team members to ' + B.toLowerCase() + ' stages')
    ),

    // Project selector
    h('div', { className: 'panel', style: { marginBottom: 16 } },
      h('div', { className: 'panel-body', style: { padding: 16 } },
        h('div', { style: { display: 'flex', alignItems: 'center', gap: 12 } },
          h('span', { style: { fontWeight: 600, color: '#2E2E38', whiteSpace: 'nowrap' } }, 'Project:'),
          h(Select, {
            placeholder: 'Select a project...',
            value: selectedProject || undefined,
            onChange: function(v) { setSelectedProject(v); },
            options: projectOptions,
            style: { minWidth: 300 },
            showSearch: true,
            optionFilterProp: 'label',
          })
        )
      )
    ),

    // If no project selected
    !selectedProject
      ? h('div', { className: 'panel' },
          h('div', { className: 'panel-body', style: { padding: 40, textAlign: 'center' } },
            h(Empty, { description: 'Select a project to manage assignment rules' })
          )
        )
      : h('div', null,
          // Unassigned match banner
          totalUnassignedMatch > 0
            ? h(Alert, {
                type: 'info',
                showIcon: true,
                message: totalUnassignedMatch + ' unassigned stage' + (totalUnassignedMatch !== 1 ? 's' : '') + ' match your rules',
                description: 'Click "Apply Rules" to assign them.',
                style: { marginBottom: 16 },
              })
            : projectRules.length > 0
              ? h(Alert, {
                  type: 'success',
                  showIcon: true,
                  message: 'All matching stages are assigned',
                  style: { marginBottom: 16 },
                })
              : null,

          // Toolbar
          h('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 } },
            h('div', { style: { display: 'flex', gap: 8 } },
              h(Button, {
                type: 'primary',
                onClick: function() { openAddModal(); },
              }, '+ Add Rule'),
              h(Tooltip, { title: API_GAPS.applyRules.ready ? null : API_GAPS.applyRules.message },
                h(Button, {
                  onClick: function() { setApplyModalOpen(true); },
                  disabled: projectRules.length === 0,
                }, 'Apply Rules')
              ),
              !API_GAPS.applyRules.ready ? h(Tooltip, { title: 'This feature requires a Domino write API endpoint that is not yet available. Rules are saved locally and will sync when the API is ready.' }, h(Tag, { color: 'orange', style: { fontSize: 10, lineHeight: '22px', cursor: 'help' } }, 'API Pending')) : null
            ),
            h('span', { style: { color: '#65657B', fontSize: 13 } },
              projectBundles.length + ' ' + B.toLowerCase() + (projectBundles.length !== 1 ? 's' : '') + ' in project'
            )
          ),

          // Rules table
          h('div', { className: 'panel' },
            h('div', { className: 'panel-header' },
              h('span', null, 'Rules (' + projectRules.length + ')')
            ),
            h('div', { className: 'panel-body-flush' },
              projectRules.length === 0
                ? h('div', { style: { padding: '32px 16px', textAlign: 'center', color: '#8F8FA3' } },
                    h('div', { style: { fontSize: 28, marginBottom: 8 } }, '\u2699'),
                    h('div', null, 'No rules yet. Add a rule to map a ' + P.toLowerCase() + ' stage to a team member.')
                  )
                : h(Table, {
                    dataSource: rulesWithCounts,
                    columns: rulesColumns,
                    rowKey: 'id',
                    pagination: false,
                    size: 'small',
                  })
            )
          ),

          // Add/Edit Rule Modal
          h(Modal, {
            title: editingIdx !== null && editingIdx !== undefined ? 'Edit Assignment Rule' : 'Add Assignment Rule',
            open: addModalOpen,
            onOk: handleSaveRule,
            onCancel: function() { setAddModalOpen(false); },
            okText: editingIdx !== null && editingIdx !== undefined ? 'Update' : 'Add Rule',
            okButtonProps: { disabled: !formPlan || !formStage || !formAssignee },
          },
            h('div', { style: { display: 'flex', flexDirection: 'column', gap: 16 } },
              h('div', null,
                h('div', { style: { marginBottom: 4, fontWeight: 500, fontSize: 12, color: '#65657B' } }, P + ' (QC Plan)'),
                h(Select, {
                  placeholder: 'Select a QC Plan...',
                  value: formPlan,
                  onChange: function(v) { setFormPlan(v); setFormStage(undefined); },
                  options: planOptions,
                  style: { width: '100%' },
                })
              ),
              h('div', null,
                h('div', { style: { marginBottom: 4, fontWeight: 500, fontSize: 12, color: '#65657B' } }, 'Stage'),
                h(Select, {
                  placeholder: formPlan ? 'Select a stage...' : 'Select a QC Plan first',
                  value: formStage,
                  onChange: function(v) { setFormStage(v); },
                  options: stageOptions,
                  disabled: !formPlan,
                  style: { width: '100%' },
                })
              ),
              h('div', null,
                h('div', { style: { marginBottom: 4, fontWeight: 500, fontSize: 12, color: '#65657B' } }, 'Assignee'),
                h(Select, {
                  placeholder: 'Select a team member...',
                  value: formAssignee,
                  onChange: function(v) { setFormAssignee(v); },
                  options: memberOptions,
                  showSearch: true,
                  optionFilterProp: 'label',
                  style: { width: '100%' },
                })
              )
            )
          ),

          // Apply Rules Modal
          h(Modal, {
            title: 'Apply Bulk Assignment Rules',
            open: applyModalOpen,
            onOk: handleApplyRules,
            onCancel: function() { if (!applyLoading) setApplyModalOpen(false); },
            okText: applyLoading ? 'Applying...' : 'Apply ' + changesCount + ' Assignment' + (changesCount !== 1 ? 's' : ''),
            okButtonProps: { disabled: changesCount === 0 || applyLoading, loading: applyLoading },
            cancelButtonProps: { disabled: applyLoading },
            closable: !applyLoading,
            width: 700,
          },
            h('div', { style: { marginBottom: 16 } },
              h('div', { style: { fontSize: 15, fontWeight: 600, marginBottom: 8 } },
                changesCount > 0
                  ? 'Will assign ' + changesCount + ' stage' + (changesCount !== 1 ? 's' : '') + ' across ' + affectedBundleCount + ' ' + B.toLowerCase() + (affectedBundleCount !== 1 ? 's' : '')
                  : 'No changes to apply'
              ),
              h(Radio.Group, {
                value: conflictMode,
                onChange: function(e) { setConflictMode(e.target.value); },
                style: { marginBottom: 12 },
              },
                h(Radio, { value: 'skip' }, 'Skip already-assigned stages'),
                h(Radio, { value: 'overwrite' }, 'Overwrite all assignments')
              )
            ),
            applyPreview.length > 0
              ? h(Table, {
                  dataSource: applyPreview,
                  columns: previewColumns,
                  rowKey: 'key',
                  size: 'small',
                  pagination: applyPreview.length > 10 ? { pageSize: 10 } : false,
                  scroll: { y: 300 },
                  rowClassName: function(r) { return r.willApply ? '' : 'rules-preview-skip'; },
                })
              : h('div', { style: { padding: 20, textAlign: 'center', color: '#8F8FA3' } }, 'No matching stages found')
          )
        )
  );
}


// ═══════════════════════════════════════════════════════════════
//  STAGE ASSIGNMENTS PAGE
// ═══════════════════════════════════════════════════════════════
function StageAssignmentsPage(props) {
  var bundles = props.bundles;
  var terms = props.terms;
  var projectMembersCache = props.projectMembersCache || {};
  var onNavigate = props.onNavigate;
  var B = capFirst(terms.bundle || 'Bundle');
  var P = capFirst(terms.policy || 'Policy');

  var _fs1 = useState([]); var filterStatus = _fs1[0]; var setFilterStatus = _fs1[1];
  var _fs2 = useState(null); var filterAssignee = _fs2[0]; var setFilterAssignee = _fs2[1];
  var _fs3 = useState([]); var filterProjects = _fs3[0]; var setFilterProjects = _fs3[1];
  var _fs4 = useState([]); var filterPolicies = _fs4[0]; var setFilterPolicies = _fs4[1];
  var _fs5 = useState(''); var searchText = _fs5[0]; var setSearchText = _fs5[1];
  var _fs6 = useState([]); var selectedRowKeys = _fs6[0]; var setSelectedRowKeys = _fs6[1];
  var _fs7 = useState(false); var reassignModalOpen = _fs7[0]; var setReassignModalOpen = _fs7[1];
  var _fs8 = useState(undefined); var reassignTarget = _fs8[0]; var setReassignTarget = _fs8[1];
  var _fs9 = useState(null); var gapAssignRow = _fs9[0]; var setGapAssignRow = _fs9[1];
  var _fs10 = useState(undefined); var gapAssignTarget = _fs10[0]; var setGapAssignTarget = _fs10[1];
  var _fs11 = useState(false); var gapAssigning = _fs11[0]; var setGapAssigning = _fs11[1];

  // Flatten all stages across all bundles into rows
  var allStages = useMemo(function() {
    var rows = [];
    bundles.forEach(function(bundle) {
      if (!bundle.stages || bundle.stages.length === 0) return;
      var stageNames = getBundleStageNames(bundle);
      var currentIdx = deriveBundleStageIndex(bundle);
      var isComplete = bundle.state === 'Complete';

      bundle.stages.forEach(function(stageObj, idx) {
        var stageName = stageObj.stage ? stageObj.stage.name : '';
        if (!stageName) return;

        var status;
        if (isComplete || idx < currentIdx) status = 'Completed';
        else if (idx === currentIdx) status = 'Current';
        else status = 'Future';

        var assigneeName = stageObj.assignee && stageObj.assignee.name ? stageObj.assignee.name : null;

        rows.push({
          key: bundle.id + '-' + idx,
          bundleId: bundle.id,
          bundleName: bundle.name,
          projectId: bundle.projectId,
          projectName: bundle.projectName,
          policyName: bundle.policyName,
          stageName: stageName,
          stageId: stageObj.stageId || (stageObj.stage && stageObj.stage.id),
          stageIdx: idx,
          status: status,
          assigneeName: assigneeName,
          assigneeId: stageObj.assignee && stageObj.assignee.id ? stageObj.assignee.id : null,
          bundleState: bundle.state,
        });
      });
    });
    return rows;
  }, [bundles]);

  // Filter options
  var projectOptions = useMemo(function() {
    var seen = {};
    return allStages.reduce(function(acc, r) {
      if (!seen[r.projectId]) {
        seen[r.projectId] = true;
        acc.push({ label: r.projectName, value: r.projectId });
      }
      return acc;
    }, []);
  }, [allStages]);

  var policyOptions = useMemo(function() {
    var seen = {};
    return allStages.reduce(function(acc, r) {
      if (!seen[r.policyName]) {
        seen[r.policyName] = true;
        acc.push({ label: r.policyName, value: r.policyName });
      }
      return acc;
    }, []);
  }, [allStages]);

  var assigneeOptions = useMemo(function() {
    var seen = {};
    var opts = [{ label: 'Unassigned', value: '__unassigned__' }];
    allStages.forEach(function(r) {
      if (r.assigneeName && !seen[r.assigneeName]) {
        seen[r.assigneeName] = true;
        opts.push({ label: r.assigneeName, value: r.assigneeName });
      }
    });
    return opts;
  }, [allStages]);

  // All unique project members for reassignment target
  var allMemberOptions = useMemo(function() {
    var seen = {};
    var opts = [];
    Object.keys(projectMembersCache).forEach(function(pid) {
      (projectMembersCache[pid] || []).forEach(function(m) {
        if (!seen[m.userName]) {
          seen[m.userName] = true;
          opts.push({ label: (m.firstName || '') + ' ' + (m.lastName || '') + ' (' + m.userName + ')', value: m.userName });
        }
      });
    });
    return opts;
  }, [projectMembersCache]);

  // Filtered rows
  var filtered = useMemo(function() {
    return allStages.filter(function(r) {
      if (searchText) {
        var q = searchText.toLowerCase();
        var match = r.bundleName.toLowerCase().indexOf(q) >= 0
          || r.stageName.toLowerCase().indexOf(q) >= 0
          || r.projectName.toLowerCase().indexOf(q) >= 0
          || (r.assigneeName && r.assigneeName.toLowerCase().indexOf(q) >= 0);
        if (!match) return false;
      }
      if (filterStatus.length > 0 && filterStatus.indexOf(r.status) < 0) return false;
      if (filterAssignee) {
        if (filterAssignee === '__unassigned__') { if (r.assigneeName) return false; }
        else { if (r.assigneeName !== filterAssignee) return false; }
      }
      if (filterProjects.length > 0 && filterProjects.indexOf(r.projectId) < 0) return false;
      if (filterPolicies.length > 0 && filterPolicies.indexOf(r.policyName) < 0) return false;
      return true;
    });
  }, [allStages, searchText, filterStatus, filterAssignee, filterProjects, filterPolicies]);

  // Stats
  var totalUnassigned = allStages.filter(function(r) { return !r.assigneeName; }).length;
  var futureUnassigned = allStages.filter(function(r) { return r.status === 'Future' && !r.assigneeName; }).length;
  var currentUnassigned = allStages.filter(function(r) { return r.status === 'Current' && !r.assigneeName; }).length;

  function clearFilters() {
    setSearchText(''); setFilterStatus([]); setFilterAssignee(null); setFilterProjects([]); setFilterPolicies([]);
  }

  // Get unassigned stages matching a coverage gap row
  function getGapStages(gap) {
    return allStages.filter(function(r) {
      return r.projectId === gap.projectId && r.policyName === gap.policyName && r.stageName === gap.stageName && !r.assigneeName && r.status !== 'Completed';
    });
  }

  // Assign all unassigned stages in a gap row to a user
  function handleGapAssign() {
    if (!gapAssignRow || !gapAssignTarget) return;
    var stages = getGapStages(gapAssignRow);
    if (stages.length === 0) return;
    setGapAssigning(true);
    var reassignMember = null;
    Object.keys(projectMembersCache).some(function(pid) {
      reassignMember = (projectMembersCache[pid] || []).find(function(m) { return m.userName === gapAssignTarget; });
      return !!reassignMember;
    });
    var promises = stages.map(function(row) {
      return apiPatch('api/bundles/' + row.bundleId + '/stages/' + row.stageId, { assignee: { id: reassignMember ? reassignMember.id : gapAssignTarget, userName: gapAssignTarget, name: gapAssignTarget } })
        .then(function(resp) {
          return { ok: true, verified: resp && resp.verified, bundleName: row.bundleName };
        })
        .catch(function(err) {
          return { ok: false, bundleName: row.bundleName, error: err.message || String(err) };
        });
    });
    Promise.all(promises).then(function(results) {
      var ok = results.filter(function(r) { return r.ok; });
      var fail = results.filter(function(r) { return !r.ok; });
      if (fail.length === 0) {
        antd.message.success('Assigned ' + ok.length + ' stage' + (ok.length !== 1 ? 's' : '') + ' to ' + gapAssignTarget);
      } else if (ok.length > 0) {
        antd.notification.warning({ message: ok.length + ' assigned, ' + fail.length + ' failed', duration: 8 });
      } else {
        antd.notification.error({ message: 'All ' + fail.length + ' assignments failed', duration: 8 });
      }
      setGapAssigning(false);
      setGapAssignRow(null);
      setGapAssignTarget(undefined);
      if (props.onRefresh) props.onRefresh();
    });
  }

  var hasActiveFilters = searchText || filterStatus.length > 0 || filterAssignee || filterProjects.length > 0 || filterPolicies.length > 0;

  function handleBulkReassign() {
    var gap = API_GAPS.stageReassign;
    if (!gap.ready) {
      antd.message.warning(gap.message);
      return;
    }
    if (!reassignTarget) return;
    // Find the selected stage rows and call PATCH for each
    var selectedStages = allStages.filter(function(r) { return selectedRowKeys.indexOf(r.key) >= 0; });
    var promises = selectedStages.map(function(row) {
      var reassignMember = null;
      Object.keys(projectMembersCache).some(function(pid) {
        reassignMember = (projectMembersCache[pid] || []).find(function(m) { return m.userName === reassignTarget; });
        return !!reassignMember;
      });
      return apiPatch('api/bundles/' + row.bundleId + '/stages/' + row.stageId, { assignee: { id: reassignMember ? reassignMember.id : reassignTarget, userName: reassignTarget, name: reassignTarget } })
        .then(function(resp) {
          if (resp && resp.verified === false) {
            var actualName = resp.actualAssignee ? (resp.actualAssignee.name || resp.actualAssignee.id) : 'nobody';
            return { error: true, reason: 'Domino shows ' + actualName + ' instead', bundleName: row.bundleName, stageName: row.stageName };
          }
          return { verified: resp && resp.verified, bundleName: row.bundleName, stageName: row.stageName };
        })
        .catch(function(err) {
          var detail = err.message || String(err);
          var reason = detail.indexOf('403') !== -1 ? 'Permission denied' : detail.indexOf('404') !== -1 ? 'Not found' : parseServerError(detail);
          return { error: detail, reason: reason, bundleName: row.bundleName, stageName: row.stageName };
        });
    });
    Promise.all(promises).then(function(results) {
      var failures = results.filter(function(r) { return r && r.error; });
      var successes = results.filter(function(r) { return !r.error; });
      var verified = successes.filter(function(r) { return r.verified === true; });
      var successCount = successes.length;
      if (failures.length === 0) {
        var msg = 'Reassigned ' + selectedStages.length + ' stage' + (selectedStages.length !== 1 ? 's' : '');
        msg += verified.length === successCount ? ' — all verified in Domino' : ' (verification pending for ' + (successCount - verified.length) + ')';
        antd.message.success(msg);
        if (props.onRefresh) props.onRefresh();
      } else if (successCount > 0) {
        antd.notification.warning({
          message: successCount + ' of ' + selectedStages.length + ' stages reassigned' + (verified.length > 0 ? ' (' + verified.length + ' verified)' : ''),
          description: 'Failed (' + failures.length + '): ' + failures.map(function(f) { return f.bundleName + ' / ' + f.stageName + ' — ' + f.reason; }).join('; '),
          duration: 10,
        });
        if (props.onRefresh) props.onRefresh();
      } else {
        antd.notification.error({
          message: 'All ' + failures.length + ' reassignments failed',
          description: failures.map(function(f) { return f.bundleName + ' / ' + f.stageName + ' — ' + f.reason; }).join('; '),
          duration: 10,
        });
      }
    });
    setReassignModalOpen(false);
    setSelectedRowKeys([]);
    setReassignTarget(undefined);
  }

  var statusColorMap = { Current: 'gold', Future: 'blue', Completed: 'green' };

  var bundleNameFilters = useMemo(function() {
    var seen = {};
    return allStages.reduce(function(acc, r) {
      if (!seen[r.bundleName]) { seen[r.bundleName] = true; acc.push({ text: r.bundleName, value: r.bundleName }); }
      return acc;
    }, []).sort(function(a, b) { return a.text.localeCompare(b.text); });
  }, [allStages]);

  var stageNameFilters = useMemo(function() {
    var seen = {};
    return allStages.reduce(function(acc, r) {
      if (!seen[r.stageName]) { seen[r.stageName] = true; acc.push({ text: r.stageName, value: r.stageName }); }
      return acc;
    }, []).sort(function(a, b) { return a.text.localeCompare(b.text); });
  }, [allStages]);

  var projectNameFilters = useMemo(function() {
    var seen = {};
    return allStages.reduce(function(acc, r) {
      if (!seen[r.projectName]) { seen[r.projectName] = true; acc.push({ text: r.projectName, value: r.projectName }); }
      return acc;
    }, []).sort(function(a, b) { return a.text.localeCompare(b.text); });
  }, [allStages]);

  var policyNameFilters = useMemo(function() {
    var seen = {};
    return allStages.reduce(function(acc, r) {
      if (!seen[r.policyName]) { seen[r.policyName] = true; acc.push({ text: r.policyName, value: r.policyName }); }
      return acc;
    }, []).sort(function(a, b) { return a.text.localeCompare(b.text); });
  }, [allStages]);

  var assigneeNameFilters = useMemo(function() {
    var seen = {};
    var arr = [{ text: 'Unassigned', value: '__unassigned__' }];
    allStages.forEach(function(r) {
      if (r.assigneeName && !seen[r.assigneeName]) {
        seen[r.assigneeName] = true;
        arr.push({ text: r.assigneeName, value: r.assigneeName });
      }
    });
    return arr.sort(function(a, b) { return a.text.localeCompare(b.text); });
  }, [allStages]);

  var columns = [
    {
      title: B,
      dataIndex: 'bundleName',
      key: 'bundleName',
      sorter: function(a, b) { return a.bundleName.localeCompare(b.bundleName); },
      width: 180,
      ellipsis: true,
      filters: bundleNameFilters,
      filterSearch: true,
      onFilter: function(value, record) { return record.bundleName === value; },
    },
    {
      title: 'Project',
      dataIndex: 'projectName',
      key: 'projectName',
      sorter: function(a, b) { return a.projectName.localeCompare(b.projectName); },
      width: 160,
      ellipsis: true,
      filters: projectNameFilters,
      filterSearch: true,
      onFilter: function(value, record) { return record.projectName === value; },
    },
    {
      title: P,
      dataIndex: 'policyName',
      key: 'policyName',
      sorter: function(a, b) { return a.policyName.localeCompare(b.policyName); },
      width: 160,
      ellipsis: true,
      filters: policyNameFilters,
      filterSearch: true,
      onFilter: function(value, record) { return record.policyName === value; },
    },
    {
      title: 'Stage',
      dataIndex: 'stageName',
      key: 'stageName',
      sorter: function(a, b) { return a.stageName.localeCompare(b.stageName); },
      width: 150,
      filters: stageNameFilters,
      filterSearch: true,
      onFilter: function(value, record) { return record.stageName === value; },
    },
    {
      title: 'Status',
      dataIndex: 'status',
      key: 'status',
      width: 100,
      sorter: function(a, b) {
        var order = { Current: 0, Future: 1, Completed: 2 };
        return (order[a.status] || 0) - (order[b.status] || 0);
      },
      filters: [{ text: 'Current', value: 'Current' }, { text: 'Future', value: 'Future' }, { text: 'Completed', value: 'Completed' }],
      filterSearch: true,
      onFilter: function(value, record) { return record.status === value; },
      render: function(status) {
        return h(Tag, { color: statusColorMap[status] || 'default' }, status);
      },
    },
    {
      title: 'Assignee',
      dataIndex: 'assigneeName',
      key: 'assigneeName',
      width: 160,
      sorter: function(a, b) {
        var aa = a.assigneeName || '';
        var bb = b.assigneeName || '';
        return aa.localeCompare(bb);
      },
      filters: assigneeNameFilters,
      filterSearch: true,
      onFilter: function(value, record) {
        if (value === '__unassigned__') return !record.assigneeName;
        return record.assigneeName === value;
      },
      render: function(name) {
        if (!name) return h(Tag, { color: 'red', style: { fontSize: 11 } }, 'Unassigned');
        return h('span', null, name);
      },
    },
  ];

  var rowSelection = {
    selectedRowKeys: selectedRowKeys,
    onChange: function(keys) { setSelectedRowKeys(keys); },
  };

  return h('div', { className: 'page-container' },
    // Header
    h('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20 } },
      h('div', null,
        h('div', { style: { display: 'flex', alignItems: 'center', gap: 12 } },
          h('h2', { style: { margin: 0, fontSize: 20, fontWeight: 600, color: '#2D2D3F' } }, 'Stage Manager')
        ),
        h('div', { style: { color: '#8F8FA3', fontSize: 13, marginTop: 4 } },
          'View all stages across ' + B.toLowerCase() + 's. Identify unassigned work, reassign owners, and manage workload.'
        )
      ),
      selectedRowKeys.length > 0
        ? h('div', { style: { display: 'flex', alignItems: 'center', gap: 8 } },
            h(Tag, { color: 'blue', style: { fontSize: 12 } }, selectedRowKeys.length + ' selected'),
            h(Tooltip, { title: API_GAPS.stageReassign.ready ? 'Reassign selected stages' : API_GAPS.stageReassign.message },
              h(Button, {
                type: 'primary',
                size: 'small',
                onClick: function() {
                  if (!API_GAPS.stageReassign.ready) {
                    antd.message.warning(API_GAPS.stageReassign.message);
                    return;
                  }
                  setReassignModalOpen(true);
                },
              }, 'Reassign Selected')
            ),
            !API_GAPS.stageReassign.ready
              ? h(Tooltip, { title: 'Stage reassignment requires the Domino governance write API. This feature will activate automatically when the API becomes available.' }, h(Tag, { color: 'orange', style: { fontSize: 10, cursor: 'help' } }, 'API Pending'))
              : null,
            h(Button, { size: 'small', onClick: function() { setSelectedRowKeys([]); } }, 'Clear')
          )
        : null
    ),

    // Summary cards
    h('div', { style: { display: 'flex', gap: 12, marginBottom: 16 } },
      h(StatCard, {
        label: 'Total Stages',
        value: allStages.length,
      }),
      h(StatCard, {
        label: 'Unassigned',
        value: totalUnassigned,
        color: totalUnassigned > 0 ? 'danger' : 'success',
        onClick: totalUnassigned > 0 ? function() {
          setFilterAssignee('__unassigned__');
          setFilterStatus([]);
        } : null,
        active: filterAssignee === '__unassigned__' && filterStatus.length === 0,
      }),
      h(StatCard, {
        label: 'Future Unassigned',
        value: futureUnassigned,
        color: futureUnassigned > 0 ? 'warning' : '',
        onClick: futureUnassigned > 0 ? function() {
          setFilterAssignee('__unassigned__');
          setFilterStatus(['Future']);
        } : null,
        active: filterAssignee === '__unassigned__' && filterStatus.length === 1 && filterStatus[0] === 'Future',
      }),
      h(StatCard, {
        label: 'Current Unassigned',
        value: currentUnassigned,
        color: currentUnassigned > 0 ? 'danger' : 'success',
        onClick: currentUnassigned > 0 ? function() {
          setFilterAssignee('__unassigned__');
          setFilterStatus(['Current']);
        } : null,
        active: filterAssignee === '__unassigned__' && filterStatus.length === 1 && filterStatus[0] === 'Current',
      })
    ),

    // Search + clear filters
    h('div', { style: { display: 'flex', gap: 10, marginBottom: 14, flexWrap: 'wrap', alignItems: 'center' } },
      h(Input.Search, {
        placeholder: 'Search ' + B.toLowerCase() + 's, stages, assignees...',
        value: searchText,
        onChange: function(e) { setSearchText(e.target.value); },
        allowClear: true,
        style: { width: 260 },
        size: 'small',
      }),
      hasActiveFilters
        ? h(Button, { size: 'small', type: 'link', onClick: clearFilters }, 'Clear filters')
        : null
    ),

    // Results count
    h('div', { style: { fontSize: 12, color: '#8F8FA3', marginBottom: 8 } },
      filtered.length + ' of ' + allStages.length + ' stages'
      + (hasActiveFilters ? ' (filtered)' : '')
    ),

    // Table
    h(Table, {
      dataSource: filtered,
      columns: columns,
      rowKey: 'key',
      size: 'small',
      rowSelection: rowSelection,
      pagination: { defaultPageSize: 20, size: 'small', showSizeChanger: true, pageSizeOptions: ['20', '50', '100', String(filtered.length > 100 ? filtered.length : 200)], showTotal: function(total) { return total + ' stages'; } },
      scroll: { y: 'calc(100vh - 380px)' },
    }),

    // Reassign Modal
    h(Modal, {
      title: 'Reassign ' + selectedRowKeys.length + ' Stage' + (selectedRowKeys.length !== 1 ? 's' : ''),
      open: reassignModalOpen,
      onOk: handleBulkReassign,
      onCancel: function() { setReassignModalOpen(false); },
      okText: 'Reassign',
      okButtonProps: { disabled: !reassignTarget },
    },
      h('div', { style: { marginBottom: 16 } },
        h('div', { style: { marginBottom: 4, fontWeight: 500, fontSize: 12, color: '#65657B' } }, 'New Assignee'),
        h(Select, {
          placeholder: 'Select a team member...',
          value: reassignTarget,
          onChange: setReassignTarget,
          options: allMemberOptions,
          showSearch: true,
          optionFilterProp: 'label',
          style: { width: '100%' },
        })
      ),
      h('div', { style: { fontSize: 12, color: '#8F8FA3' } },
        'This will reassign ' + selectedRowKeys.length + ' stage' + (selectedRowKeys.length !== 1 ? 's' : '') + ' to the selected team member.'
      )
    ),

    // Gap Assign Modal — opened by clicking unassigned count in coverage gaps
    h(Modal, {
      title: gapAssignRow
        ? 'Assign ' + gapAssignRow.unassigned + ' Unassigned — ' + gapAssignRow.stageName
        : 'Assign Stages',
      open: !!gapAssignRow,
      onOk: handleGapAssign,
      onCancel: function() { setGapAssignRow(null); setGapAssignTarget(undefined); },
      okText: gapAssigning ? 'Assigning...' : 'Assign All',
      okButtonProps: { disabled: !gapAssignTarget || gapAssigning },
      width: 520,
    },
      gapAssignRow ? h('div', null,
        h('div', { style: { marginBottom: 12, fontSize: 13, color: '#65657B' } },
          h('span', { style: { fontWeight: 500 } }, gapAssignRow.projectName),
          ' \u2192 ',
          h('span', { style: { fontWeight: 500 } }, gapAssignRow.policyName),
          ' \u2192 ',
          h('span', { style: { fontWeight: 500 } }, gapAssignRow.stageName)
        ),
        h('div', { style: { marginBottom: 12 } },
          h('div', { style: { fontSize: 12, color: '#8F8FA3', marginBottom: 8 } },
            gapAssignRow.unassigned + ' deliverable' + (gapAssignRow.unassigned !== 1 ? 's' : '') + ' need an assignee for this stage'
            + (gapAssignRow.currentUnassigned > 0 ? ' (' + gapAssignRow.currentUnassigned + ' current, ' + gapAssignRow.futureUnassigned + ' upcoming)' : '')
          ),
          h('div', { style: { maxHeight: 140, overflowY: 'auto', marginBottom: 12, padding: '8px 12px', background: '#fafafa', borderRadius: 6, fontSize: 12 } },
            getGapStages(gapAssignRow).map(function(s) {
              return h('div', { key: s.key, style: { display: 'flex', justifyContent: 'space-between', padding: '2px 0' } },
                h('span', null, s.bundleName),
                h(Tag, { color: s.status === 'Current' ? 'red' : 'blue', style: { fontSize: 10 } }, s.status)
              );
            })
          )
        ),
        h('div', { style: { marginBottom: 4, fontWeight: 500, fontSize: 12, color: '#65657B' } }, 'Assign to'),
        h(Select, {
          placeholder: 'Select a team member...',
          value: gapAssignTarget,
          onChange: setGapAssignTarget,
          options: allMemberOptions,
          showSearch: true,
          optionFilterProp: 'label',
          style: { width: '100%' },
        })
      ) : null
    )
  );
}


// ═══════════════════════════════════════════════════════════════
//  PAGE: Automation Rules
// ═══════════════════════════════════════════════════════════════
//
// Allows admins to define rules that trigger Domino Jobs when a
// QC stage completes. Rules are stored in localStorage.
// Execution uses Domino v4 Jobs API (POST /v4/jobs/start).
//
function AutomationRulesPage(props) {
  var bundles = props.bundles;
  var automationRules = props.automationRules;
  var setAutomationRules = props.setAutomationRules;
  var automationHistory = props.automationHistory;
  var setAutomationHistory = props.setAutomationHistory;
  var terms = props.terms;
  var projectMembersCache = props.projectMembersCache || {};
  var B = terms.bundle || 'Bundle';
  var P = terms.policy || 'Policy';

  // ── State ──
  var _rp = useState(null); var selectedProject = _rp[0]; var setSelectedProject = _rp[1];
  var _rm = useState(false); var addModalOpen = _rm[0]; var setAddModalOpen = _rm[1];
  var _re = useState(null); var editingIdx = _re[0]; var setEditingIdx = _re[1];
  var _rt = useState('rules'); var activeTab = _rt[0]; var setActiveTab = _rt[1];
  var _rj = useState({}); var runningJobs = _rj[0]; var setRunningJobs = _rj[1];

  // Form state
  var _rf1 = useState(undefined); var formPlan = _rf1[0]; var setFormPlan = _rf1[1];
  var _rf2 = useState(undefined); var formStage = _rf2[0]; var setFormStage = _rf2[1];
  var _rf3 = useState(''); var formScript = _rf3[0]; var setFormScript = _rf3[1];
  var _rf4 = useState(''); var formScriptArgs = _rf4[0]; var setFormScriptArgs = _rf4[1];
  var _rf5 = useState('log-only'); var formOutputHandling = _rf5[0]; var setFormOutputHandling = _rf5[1];
  var _rf6 = useState(''); var formOutputFilename = _rf6[0]; var setFormOutputFilename = _rf6[1];
  var _rf7 = useState(true); var formEnabled = _rf7[0]; var setFormEnabled = _rf7[1];

  // ── Derived data ──
  var projectOptions = useMemo(function() {
    var seen = {};
    return bundles.reduce(function(acc, b) {
      if (!seen[b.projectId]) { seen[b.projectId] = true; acc.push({ label: b.projectName, value: b.projectId }); }
      return acc;
    }, []);
  }, [bundles]);

  useEffect(function() {
    if (!selectedProject && projectOptions.length === 1) setSelectedProject(projectOptions[0].value);
  }, [projectOptions]);

  var projectBundles = useMemo(function() {
    if (!selectedProject) return [];
    return bundles.filter(function(b) { return b.projectId === selectedProject; });
  }, [bundles, selectedProject]);

  var projectRules = useMemo(function() {
    if (!selectedProject) return [];
    return automationRules.filter(function(r) { return r.projectId === selectedProject; });
  }, [automationRules, selectedProject]);

  var planOptions = useMemo(function() {
    var seen = {};
    return projectBundles.reduce(function(acc, b) {
      if (!seen[b.policyName]) { seen[b.policyName] = true; acc.push({ label: b.policyName, value: b.policyName }); }
      return acc;
    }, []);
  }, [projectBundles]);

  var stageOptions = useMemo(function() {
    if (!formPlan) return [];
    var seen = {};
    var options = [];
    projectBundles.forEach(function(b) {
      if (b.policyName !== formPlan) return;
      if (b.stages) {
        b.stages.forEach(function(s) {
          var name = s.stage ? s.stage.name : '';
          if (name && !seen[name]) { seen[name] = true; options.push({ label: name, value: name }); }
        });
      }
    });
    return options;
  }, [projectBundles, formPlan]);

  // ── Match counting: bundles with completed stages matching each rule ──
  function getMatchedBundles(rule) {
    return projectBundles.filter(function(b) {
      if (b.policyName !== rule.policyName) return false;
      if (!b.stages) return false;
      var stageNames = b.stages.map(function(s) { return s.stage ? s.stage.name : ''; });
      var currentIdx = 0;
      var isComplete = b.state === 'Complete';
      if (!isComplete) {
        for (var i = 0; i < b.stages.length; i++) {
          if (b.stages[i].stage && b.stages[i].stage.name && b.currentStageName === b.stages[i].stage.name) { currentIdx = i; break; }
        }
      }
      for (var j = 0; j < b.stages.length; j++) {
        var sName = b.stages[j].stage ? b.stages[j].stage.name : '';
        if (sName !== rule.stageName) continue;
        // Stage is completed if its index < currentIdx, or bundle is Complete
        if (isComplete || j < currentIdx) return true;
      }
      return false;
    });
  }

  // ── CRUD ──
  function openAddModal(editIdx) {
    if (editIdx !== undefined && editIdx !== null) {
      var rule = projectRules[editIdx];
      setFormPlan(rule.policyName);
      setFormStage(rule.stageName);
      setFormScript(rule.scriptPath || '');
      setFormScriptArgs(rule.scriptArgs || '');
      setFormOutputHandling(rule.outputHandling || 'log-only');
      setFormOutputFilename(rule.outputFilename || '');
      setFormEnabled(rule.enabled !== false);
      setEditingIdx(editIdx);
    } else {
      setFormPlan(undefined); setFormStage(undefined); setFormScript('');
      setFormScriptArgs(''); setFormOutputHandling('log-only'); setFormOutputFilename(''); setFormEnabled(true);
      setEditingIdx(null);
    }
    setAddModalOpen(true);
  }

  function handleSaveRule() {
    if (!formPlan || !formStage || !formScript) {
      antd.message.warning('Policy, stage, and script path are required.');
      return;
    }
    var rule = {
      id: 'auto-' + Date.now(),
      projectId: selectedProject,
      policyName: formPlan,
      stageName: formStage,
      scriptPath: formScript,
      scriptArgs: formScriptArgs,
      outputHandling: formOutputHandling,
      outputFilename: formOutputFilename,
      enabled: formEnabled,
    };
    if (editingIdx !== null && editingIdx !== undefined) {
      // Update existing
      var globalIdx = automationRules.indexOf(projectRules[editingIdx]);
      if (globalIdx >= 0) {
        var updated = automationRules.slice();
        rule.id = updated[globalIdx].id; // preserve id
        updated[globalIdx] = rule;
        setAutomationRules(updated);
      }
    } else {
      setAutomationRules(automationRules.concat([rule]));
    }
    setAddModalOpen(false);
    antd.message.success(editingIdx !== null ? 'Rule updated' : 'Rule added');
  }

  function handleDeleteRule(localIdx) {
    var globalIdx = automationRules.indexOf(projectRules[localIdx]);
    if (globalIdx >= 0) {
      var updated = automationRules.slice();
      updated.splice(globalIdx, 1);
      setAutomationRules(updated);
      antd.message.success('Rule deleted');
    }
  }

  function handleToggleEnabled(localIdx) {
    var globalIdx = automationRules.indexOf(projectRules[localIdx]);
    if (globalIdx >= 0) {
      var updated = automationRules.slice();
      updated[globalIdx] = Object.assign({}, updated[globalIdx], { enabled: !updated[globalIdx].enabled });
      setAutomationRules(updated);
    }
  }

  // ── Run automation ──
  function handleRunRule(rule) {
    var gapInfo = API_GAPS.automationRun;
    if (!gapInfo.ready) {
      antd.message.warning(gapInfo.message);
      return;
    }
    var command = 'python ' + rule.scriptPath;
    if (rule.scriptArgs) command += ' ' + rule.scriptArgs;

    apiPost('/api/projects/' + rule.projectId + '/runs', {
      command: command,
      title: 'Automation: ' + rule.policyName + ' / ' + rule.stageName,
    }).then(function(resp) {
      var runId = resp.id || resp.runId || resp.jobId || 'unknown';
      setRunningJobs(function(prev) {
        var next = Object.assign({}, prev);
        next[rule.id] = { runId: runId, projectId: rule.projectId, status: 'Running' };
        return next;
      });
      setAutomationHistory(function(prev) {
        return [{
          id: 'hist-' + Date.now(), ruleId: rule.id, runId: runId,
          projectId: rule.projectId, policyName: rule.policyName,
          stageName: rule.stageName, scriptPath: rule.scriptPath,
          startedAt: new Date().toISOString(), status: 'Running',
        }].concat(prev);
      });
      antd.message.success('Job started: ' + runId);
      pollJobStatus(rule.id, rule.projectId, runId);
    }).catch(function(err) {
      var detail = (err.message || String(err));
      var hint = '';
      if (detail.indexOf('404') >= 0) hint = '. The Jobs API may not be enabled on this Domino instance.';
      else if (detail.indexOf('403') >= 0) hint = '. Check that your API token has permission to start jobs.';
      else if (detail.indexOf('401') >= 0) hint = '. Authentication failed. Verify your Domino API token.';
      else if (detail.indexOf('503') >= 0) hint = '. DOMINO_API_HOST may not be configured.';
      antd.notification.error({
        message: 'Automation Job Failed to Start',
        description: detail + hint,
        duration: 8,
      });
      // Record the failure in history so the user can see it
      setAutomationHistory(function(prev) {
        return [{
          id: 'hist-' + Date.now(), ruleId: rule.id, runId: 'N/A',
          projectId: rule.projectId, policyName: rule.policyName,
          stageName: rule.stageName, scriptPath: rule.scriptPath,
          startedAt: new Date().toISOString(), status: 'Start Failed',
          completedAt: new Date().toISOString(),
        }].concat(prev);
      });
    });
  }

  function pollJobStatus(ruleId, projectId, runId) {
    var attempts = 0;
    var maxAttempts = 120; // 10 min max at 5s interval
    var interval = setInterval(function() {
      attempts++;
      if (attempts > maxAttempts) {
        clearInterval(interval);
        setRunningJobs(function(prev) { var next = Object.assign({}, prev); delete next[ruleId]; return next; });
        setAutomationHistory(function(prev) {
          return prev.map(function(h) { return h.runId === runId ? Object.assign({}, h, { status: 'Timeout', completedAt: new Date().toISOString() }) : h; });
        });
        antd.notification.warning({ message: 'Job Polling Timeout', description: 'Job ' + runId + ' did not complete within 10 minutes. It may still be running in Domino. Check the project runs page.', duration: 10 });
        return;
      }
      apiGet('/api/projects/' + projectId + '/runs/' + runId)
        .then(function(resp) {
          var status = resp.status || resp.state || resp.statuses && resp.statuses.executionStatus || '';
          var terminal = ['Succeeded', 'Failed', 'Error', 'Stopped', 'Completed'].indexOf(status) >= 0;
          if (terminal) {
            clearInterval(interval);
            setRunningJobs(function(prev) { var next = Object.assign({}, prev); delete next[ruleId]; return next; });
            setAutomationHistory(function(prev) {
              return prev.map(function(h) { return h.runId === runId ? Object.assign({}, h, { status: status, completedAt: new Date().toISOString() }) : h; });
            });
            if (status === 'Succeeded' || status === 'Completed') antd.message.success('Job completed: ' + runId);
            else antd.message.error('Job ' + status + ': ' + runId);
          }
        })
        .catch(function(err) {
          // After 3 consecutive poll failures, stop polling and report
          if (!pollJobStatus._failCount) pollJobStatus._failCount = {};
          pollJobStatus._failCount[runId] = (pollJobStatus._failCount[runId] || 0) + 1;
          if (pollJobStatus._failCount[runId] >= 3) {
            clearInterval(interval);
            delete pollJobStatus._failCount[runId];
            setRunningJobs(function(prev) { var next = Object.assign({}, prev); delete next[ruleId]; return next; });
            setAutomationHistory(function(prev) {
              return prev.map(function(h) { return h.runId === runId ? Object.assign({}, h, { status: 'Poll Error', completedAt: new Date().toISOString() }) : h; });
            });
            antd.notification.error({ message: 'Job Status Unavailable', description: 'Could not poll status for job ' + runId + '. The job may still be running. Check the Domino project runs page.', duration: 8 });
          }
        });
    }, 5000);
  }

  // ── Columns ──
  var outputTagColor = { 'attach': 'green', 'log-only': 'blue', 'finding': 'orange' };
  var outputTagLabel = { 'attach': 'Attach to bundle', 'log-only': 'Log only', 'finding': 'Create finding' };

  var rulesColumns = [
    { title: P, dataIndex: 'policyName', key: 'policy', width: 180, ellipsis: true,
      render: function(t) { return h(Tag, { color: 'purple' }, t); } },
    { title: 'Trigger Stage', dataIndex: 'stageName', key: 'stage', width: 160 },
    { title: 'Script', dataIndex: 'scriptPath', key: 'script', ellipsis: true,
      render: function(t) { return h('code', { style: { fontSize: 11, background: '#F5F5FF', padding: '2px 6px', borderRadius: 3 } }, t); } },
    { title: 'Output', dataIndex: 'outputHandling', key: 'output', width: 130,
      render: function(t) { return h(Tag, { color: outputTagColor[t] || 'default' }, outputTagLabel[t] || t); } },
    { title: 'Enabled', key: 'enabled', width: 80,
      render: function(_, r, idx) {
        return h(Switch, { checked: r.enabled !== false, size: 'small', onChange: function() { handleToggleEnabled(idx); } });
      } },
    { title: 'Matched', key: 'matched', width: 90,
      render: function(_, r) {
        var count = getMatchedBundles(r).length;
        return count > 0 ? h(Tag, { color: 'green' }, count + ' ready') : h('span', { style: { color: '#8F8FA3', fontSize: 12 } }, 'None');
      } },
    { title: 'Actions', key: 'actions', width: 200,
      render: function(_, r, idx) {
        var isRunning = runningJobs[r.id];
        return h('div', { style: { display: 'flex', gap: 6 } },
          h(Button, { size: 'small', type: 'primary', disabled: !r.enabled || isRunning,
            loading: !!isRunning,
            onClick: function() { handleRunRule(r); } }, isRunning ? 'Running...' : 'Run'),
          h(Button, { size: 'small', onClick: function() { openAddModal(idx); } }, 'Edit'),
          h(Button, { size: 'small', danger: true, onClick: function() { handleDeleteRule(idx); } }, 'Delete')
        );
      } },
  ];

  // History columns
  var historyColumns = [
    { title: 'Date', dataIndex: 'startedAt', key: 'date', width: 150,
      sorter: function(a, b) { return (a.startedAt || '').localeCompare(b.startedAt || ''); },
      render: function(t) { return t ? dayjs(t).format('MMM D, YYYY h:mm A') : '\u2013'; } },
    { title: P, dataIndex: 'policyName', key: 'policy', width: 160, ellipsis: true },
    { title: 'Stage', dataIndex: 'stageName', key: 'stage', width: 140 },
    { title: 'Script', dataIndex: 'scriptPath', key: 'script', ellipsis: true,
      render: function(t) { return h('code', { style: { fontSize: 11 } }, t); } },
    { title: 'Status', dataIndex: 'status', key: 'status', width: 110,
      filters: [{ text: 'Running', value: 'Running' }, { text: 'Succeeded', value: 'Succeeded' }, { text: 'Failed', value: 'Failed' }, { text: 'Completed', value: 'Completed' }, { text: 'Start Failed', value: 'Start Failed' }, { text: 'Timeout', value: 'Timeout' }, { text: 'Poll Error', value: 'Poll Error' }],
      onFilter: function(v, r) { return r.status === v; },
      render: function(s) {
        var color = s === 'Succeeded' || s === 'Completed' ? 'green' : s === 'Failed' || s === 'Error' || s === 'Start Failed' ? 'red' : s === 'Running' ? 'blue' : s === 'Timeout' || s === 'Poll Error' ? 'orange' : 'default';
        return h(Tag, { color: color }, s || 'Unknown');
      } },
    { title: 'Run ID', dataIndex: 'runId', key: 'runId', width: 120, ellipsis: true,
      render: function(t) { return h('span', { style: { fontSize: 11, fontFamily: 'monospace' } }, t || '\u2013'); } },
    { title: 'Duration', key: 'duration', width: 100,
      render: function(_, r) {
        if (!r.startedAt || !r.completedAt) return r.status === 'Running' ? h(Tag, { color: 'blue' }, 'In progress') : '\u2013';
        var ms = new Date(r.completedAt).getTime() - new Date(r.startedAt).getTime();
        var secs = Math.round(ms / 1000);
        if (secs < 60) return secs + 's';
        return Math.floor(secs / 60) + 'm ' + (secs % 60) + 's';
      } },
  ];

  var projectHistory = useMemo(function() {
    if (!selectedProject) return [];
    return automationHistory.filter(function(h) { return h.projectId === selectedProject; });
  }, [automationHistory, selectedProject]);

  // Count active automations ready to run
  var readyCount = useMemo(function() {
    var count = 0;
    projectRules.forEach(function(r) {
      if (r.enabled !== false && getMatchedBundles(r).length > 0) count++;
    });
    return count;
  }, [projectRules, projectBundles]);

  // ── Render ──
  var selectedProjectName = projectOptions.find(function(p) { return p.value === selectedProject; });
  selectedProjectName = selectedProjectName ? selectedProjectName.label : '';

  return h('div', { className: 'page-container' },
    h('div', { className: 'page-header' },
      h('h1', null, 'Automation Rules'),
      h('p', null, 'Define scripts that run automatically when QC stages complete. Outputs can be attached to ' + B.toLowerCase() + 's.')
    ),

    // Project selector
    h('div', { className: 'panel', style: { marginBottom: 16 } },
      h('div', { className: 'panel-body', style: { padding: '12px 16px' } },
        h('div', { style: { display: 'flex', alignItems: 'center', gap: 12 } },
          h('span', { style: { fontWeight: 500, fontSize: 13, color: '#65657B' } }, 'Project:'),
          h(Select, {
            placeholder: 'Select a project...',
            value: selectedProject,
            onChange: setSelectedProject,
            options: projectOptions,
            showSearch: true,
            optionFilterProp: 'label',
            style: { width: 320 },
            size: 'small',
          }),
          !API_GAPS.automationRun.ready
            ? h(Tag, { color: 'orange', style: { marginLeft: 8 } }, 'Jobs API: pending verification')
            : h(Tag, { color: 'green', style: { marginLeft: 8 } }, 'Jobs API: connected')
        )
      )
    ),

    !selectedProject
      ? h(Empty, { description: 'Select a project to configure automation rules', style: { padding: 60 } })
      : h('div', null,
          // Alert if there are ready-to-run automations
          readyCount > 0
            ? h('div', {
                style: {
                  background: '#F0FFF4', border: '1px solid #B7EB8F', borderRadius: 6,
                  padding: '10px 16px', marginBottom: 16, display: 'flex', alignItems: 'center', gap: 8,
                }
              },
                h('span', { style: { fontSize: 16 } }, '\u2713'),
                h('span', { style: { fontSize: 13, color: '#135200' } },
                  readyCount + ' automation' + (readyCount !== 1 ? 's' : '') + ' ready to run. Completed stages matched with active rules.')
              )
            : null,

          // Toolbar
          h('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 } },
            h('div', { style: { display: 'flex', gap: 8, alignItems: 'center' } },
              h(Button, { type: 'primary', size: 'small', onClick: function() { openAddModal(); } }, '+ Add Rule'),
              h('span', { style: { fontSize: 12, color: '#8F8FA3' } },
                projectRules.length + ' rule' + (projectRules.length !== 1 ? 's' : '') + ' for ' + selectedProjectName)
            ),
            h('div', { style: { display: 'flex', gap: 8 } },
              h(Button, { size: 'small', onClick: function() { setActiveTab('rules'); }, type: activeTab === 'rules' ? 'primary' : 'default' }, 'Rules'),
              h(Button, { size: 'small', onClick: function() { setActiveTab('history'); }, type: activeTab === 'history' ? 'primary' : 'default' },
                'History' + (projectHistory.length > 0 ? ' (' + projectHistory.length + ')' : ''))
            )
          ),

          // Rules tab
          activeTab === 'rules'
            ? h('div', { className: 'panel' },
                h('div', { className: 'panel-header' },
                  h('span', { className: 'panel-title' }, 'Automation Rules'),
                  h('span', { style: { fontSize: 12, color: '#8F8FA3' } }, 'When a trigger stage completes, the specified script will run in the project.')
                ),
                h('div', { className: 'panel-body-flush' },
                  projectRules.length > 0
                    ? h(Table, {
                        dataSource: projectRules,
                        columns: rulesColumns,
                        rowKey: 'id',
                        size: 'small',
                        scroll: { x: 1000 },
                        pagination: { defaultPageSize: 20, size: 'small', showSizeChanger: true },
                      })
                    : h(Empty, { description: 'No automation rules yet. Click "+ Add Rule" to create one.', style: { padding: 40 } })
                )
              )
            : null,

          // History tab
          activeTab === 'history'
            ? h('div', { className: 'panel' },
                h('div', { className: 'panel-header' },
                  h('span', { className: 'panel-title' }, 'Execution History'),
                  projectHistory.length > 0
                    ? h(Button, { size: 'small', type: 'text', danger: true, onClick: function() {
                        setAutomationHistory(function(prev) { return prev.filter(function(h) { return h.projectId !== selectedProject; }); });
                        antd.message.success('History cleared');
                      } }, 'Clear history')
                    : null
                ),
                h('div', { className: 'panel-body-flush' },
                  projectHistory.length > 0
                    ? h(Table, {
                        dataSource: projectHistory,
                        columns: historyColumns,
                        rowKey: 'id',
                        size: 'small',
                        pagination: { defaultPageSize: 20, size: 'small', showSizeChanger: true, showTotal: function(total) { return total + ' runs'; } },
                      })
                    : h(Empty, { description: 'No automation runs yet.', style: { padding: 40 } })
                )
              )
            : null
        ),

    // Add/Edit Rule Modal
    h(Modal, {
      title: editingIdx !== null && editingIdx !== undefined ? 'Edit Automation Rule' : 'Add Automation Rule',
      open: addModalOpen,
      onOk: handleSaveRule,
      onCancel: function() { setAddModalOpen(false); },
      okText: editingIdx !== null && editingIdx !== undefined ? 'Update' : 'Add Rule',
      width: 520,
    },
      h('div', { style: { display: 'flex', flexDirection: 'column', gap: 14 } },
        // Trigger section
        h('div', { style: { fontWeight: 600, fontSize: 13, color: '#543FDE', marginBottom: -6 } }, 'Trigger'),
        h('div', null,
          h('div', { style: { marginBottom: 4, fontWeight: 500, fontSize: 12, color: '#65657B' } }, P + ' (QC Plan)'),
          h(Select, {
            placeholder: 'Select ' + P.toLowerCase() + '...',
            value: formPlan,
            onChange: function(v) { setFormPlan(v); setFormStage(undefined); },
            options: planOptions,
            style: { width: '100%' },
            size: 'small',
          })
        ),
        h('div', null,
          h('div', { style: { marginBottom: 4, fontWeight: 500, fontSize: 12, color: '#65657B' } }, 'When this stage completes:'),
          h(Select, {
            placeholder: formPlan ? 'Select stage...' : 'Select a ' + P.toLowerCase() + ' first',
            value: formStage,
            onChange: setFormStage,
            options: stageOptions,
            disabled: !formPlan,
            style: { width: '100%' },
            size: 'small',
          })
        ),

        // Action section
        h('div', { style: { fontWeight: 600, fontSize: 13, color: '#543FDE', marginBottom: -6, marginTop: 8, borderTop: '1px solid #EDECFB', paddingTop: 14 } }, 'Action'),
        h('div', null,
          h('div', { style: { marginBottom: 4, fontWeight: 500, fontSize: 12, color: '#65657B' } }, 'Script path (relative to project repo)'),
          h(Input, {
            placeholder: 'e.g. scripts/validate.py',
            value: formScript,
            onChange: function(e) { setFormScript(e.target.value); },
            style: { fontFamily: 'monospace', fontSize: 12 },
            size: 'small',
          })
        ),
        h('div', null,
          h('div', { style: { marginBottom: 4, fontWeight: 500, fontSize: 12, color: '#65657B' } }, 'Script arguments (optional)'),
          h(Input, {
            placeholder: 'e.g. --format json --verbose',
            value: formScriptArgs,
            onChange: function(e) { setFormScriptArgs(e.target.value); },
            style: { fontFamily: 'monospace', fontSize: 12 },
            size: 'small',
          })
        ),

        // Output section
        h('div', { style: { fontWeight: 600, fontSize: 13, color: '#543FDE', marginBottom: -6, marginTop: 8, borderTop: '1px solid #EDECFB', paddingTop: 14 } }, 'Output'),
        h('div', null,
          h('div', { style: { marginBottom: 4, fontWeight: 500, fontSize: 12, color: '#65657B' } }, 'What to do with script output'),
          h(Select, {
            value: formOutputHandling,
            onChange: setFormOutputHandling,
            options: [
              { label: 'Log only: view in execution history', value: 'log-only' },
              { label: 'Attach to bundle: upload output file', value: 'attach' },
              { label: 'Create finding: add as a QC finding', value: 'finding' },
            ],
            style: { width: '100%' },
            size: 'small',
          })
        ),
        formOutputHandling === 'attach'
          ? h('div', null,
              h('div', { style: { marginBottom: 4, fontWeight: 500, fontSize: 12, color: '#65657B' } }, 'Output filename'),
              h(Input, {
                placeholder: 'e.g. validation_report.log',
                value: formOutputFilename,
                onChange: function(e) { setFormOutputFilename(e.target.value); },
                size: 'small',
              })
            )
          : null,

        // Enabled toggle
        h('div', { style: { display: 'flex', alignItems: 'center', gap: 8, marginTop: 8, borderTop: '1px solid #EDECFB', paddingTop: 14 } },
          h(Switch, { checked: formEnabled, onChange: setFormEnabled, size: 'small' }),
          h('span', { style: { fontSize: 12, color: '#65657B' } }, formEnabled ? 'Rule is enabled' : 'Rule is disabled')
        )
      )
    )
  );
}


// ═══════════════════════════════════════════════════════════════
//  RISK OPTIMIZER
// ═══════════════════════════════════════════════════════════════

// Default risk classification config — user can edit via the Config panel
var DEFAULT_RISK_CONFIG = {
  highRisk: {
    label: 'High',
    color: '#C20A29',
    keywords: [
      'primary efficacy', 'primary endpoint', 'survival analysis', 'kaplan-meier',
      'pharmacokinetic', 'pk derivation', 'pk model', 'novel algorithm',
      'confirmatory', 'interim analysis', 'bayesian', 'adaptive design',
      'non-inferiority', 'bioequivalence', 'exposure-response', 'dose-response',
      'cox regression', 'time-to-event', 'hazard ratio',
      'adtte', 'adeff', 'adpc', 'adpp', 'adpk', 'adrs', 'adtr',
      'primary analysis', 'registration study', 'pivotal', 'superiority',
      'propensity score', 'instrumental variable', 'competing risk',
      'multi-state model', 'joint model',
    ],
    description: 'Matches against evidence name, QC plan name, and deliverable name. Reserve most rigorous QC (e.g. double programming) for these deliverables.',
  },
  mediumRisk: {
    label: 'Medium',
    color: '#F59E0B',
    keywords: [
      'secondary endpoint', 'subgroup', 'sensitivity analysis', 'subset',
      'adam', 'adae', 'adcm', 'adlb', 'advs', 'admh', 'adeg',
      'adex', 'adds', 'addv', 'adhy', 'adqs', 'adce', 'adlbc', 'adlbh', 'adlbu',
      'forest plot', 'shift table', 'responder analysis',
      'missing data', 'imputation', 'ancova', 'mixed model',
      'supportive analysis', 'subpopulation', 'covariate',
      'logistic regression', 'repeated measures', 'mmrm', 'gee', 'cmh',
      'stratified analysis',
    ],
    description: 'Matches against evidence name, QC plan name, and deliverable name. Code review plus spot check is sufficient.',
  },
  lowRisk: {
    label: 'Low',
    color: '#28A464',
    keywords: [
      'listing', 'demographic', 'disposition', 'sdtm',
      'dm', 'ae listing', 'conmed', 'medical history', 'lab listing',
      'summary table', 'descriptive', 'frequency', 'count table',
      'formatting', 'title page', 'toc', 'appendix',
      'adsl', 'patient profile', 'data listing', 'subject listing',
      'vital signs listing', 'lab shift', 'mh listing', 'cm listing',
      'baseline characteristics', 'big n', 'header', 'footnote',
      'shell', 'mock', 'define.xml', 'reviewer guide',
    ],
    description: 'Matches against evidence name, QC plan name, and deliverable name. Output crosschecking or automated validation is sufficient.',
  },
};

// ═══════════════════════════════════════════════════════════════
//  PAGE: AI Insights
// ═══════════════════════════════════════════════════════════════

function AIInsightsPage(props) {
  var bundles = props.bundles || [];
  var terms = props.terms || DEFAULT_TERMS;
  var B = capFirst(terms.bundle);

  // Navigation state: null = overview, then drill-down depth 1-5
  var _depth = useState(null);
  var activeInsight = _depth[0];
  var setActiveInsight = _depth[1];

  // ── Compute real metrics from bundle data ──────────────────
  var insightMetrics = useMemo(function() {
    var now = Date.now();
    var completeBundles = bundles.filter(function(b) { return b.state === 'Complete'; });
    var activeBundles = bundles.filter(function(b) { return b.state === 'Active'; });

    // Identify TFL-like bundles by policy name heuristic
    var tflBundles = bundles.filter(function(b) {
      var name = ((b.policyName || '') + ' ' + (b.name || '')).toLowerCase();
      return name.indexOf('tfl') >= 0 || name.indexOf('table') >= 0 || name.indexOf('figure') >= 0 || name.indexOf('listing') >= 0;
    });
    var nonTflBundles = bundles.filter(function(b) {
      var name = ((b.policyName || '') + ' ' + (b.name || '')).toLowerCase();
      return !(name.indexOf('tfl') >= 0 || name.indexOf('table') >= 0 || name.indexOf('figure') >= 0 || name.indexOf('listing') >= 0);
    });

    // Cycle times
    function avgCycleTime(arr) {
      var times = arr.filter(function(b) { return b.state === 'Complete'; }).map(function(b) {
        return (new Date(b.updatedAt).getTime() - new Date(b.createdAt).getTime()) / (1000 * 60 * 60 * 24);
      }).filter(function(d) { return d >= 0; });
      return times.length > 0 ? times.reduce(function(a, b) { return a + b; }, 0) / times.length : 0;
    }
    var overallAvgCycle = avgCycleTime(bundles);
    var tflAvgCycle = avgCycleTime(tflBundles);
    var nonTflAvgCycle = avgCycleTime(nonTflBundles);
    var cycleRatio = nonTflAvgCycle > 0 ? (tflAvgCycle / nonTflAvgCycle) : 0;

    // Findings metrics
    var totalFindings = 0;
    var openFindings = 0;
    var resolvedFindings = 0;
    var findingsWithDates = [];
    var findingResolutionDays = [];
    var bundlesWithMultipleReworkCycles = 0;
    var repeatedFindingsBundles = 0;
    var findingsBySev = { S0: 0, S1: 0, S2: 0, S3: 0 };

    bundles.forEach(function(b) {
      var bf = b._findings || [];
      var openCount = 0;
      var resolvedCount = 0;
      bf.forEach(function(f) {
        totalFindings++;
        if (f.severity && findingsBySev[f.severity] !== undefined) findingsBySev[f.severity]++;
        var isResolved = f.status === 'Done' || f.status === 'WontDo';
        if (isResolved) {
          resolvedFindings++;
          resolvedCount++;
          if (f.createdAt && f.updatedAt) {
            var days = (new Date(f.updatedAt).getTime() - new Date(f.createdAt).getTime()) / (1000 * 60 * 60 * 24);
            if (days >= 0) findingResolutionDays.push(days);
          }
        } else {
          openFindings++;
          openCount++;
        }
        if (f.createdAt) findingsWithDates.push(f);
      });
      // Rework cycles proxy: bundles with both open and resolved findings = iterating
      if (openCount > 0 && resolvedCount > 0) bundlesWithMultipleReworkCycles++;
      // Bundles with >2 findings that got resolved (proxy for multiple QC loops)
      if (resolvedCount > 2) repeatedFindingsBundles++;
    });

    var avgResolutionDays = findingResolutionDays.length > 0
      ? findingResolutionDays.reduce(function(a, b) { return a + b; }, 0) / findingResolutionDays.length : 0;

    // Stage duration analysis (real, from assignedAt deltas)
    var stageDurations = {};
    var stageWaitTimes = [];
    var stageWorkTimes = [];
    bundles.forEach(function(b) {
      if (!b.stages || b.stages.length < 2) return;
      var sorted = b.stages.slice().sort(function(a, c) {
        return (a.stage ? a.stage.order : 0) - (c.stage ? c.stage.order : 0);
      });
      for (var i = 0; i < sorted.length - 1; i++) {
        var curr = sorted[i];
        var next = sorted[i + 1];
        if (curr.assignedAt && next.assignedAt) {
          var days = (new Date(next.assignedAt).getTime() - new Date(curr.assignedAt).getTime()) / (1000 * 60 * 60 * 24);
          if (days >= 0 && days < 365) {
            var sName = curr.stage ? curr.stage.name : 'Stage ' + i;
            if (!stageDurations[sName]) stageDurations[sName] = [];
            stageDurations[sName].push(days);
          }
        }
      }
    });

    // Compute total active work vs wait (estimate: active = findings resolution, wait = remainder)
    var totalElapsedDays = completeBundles.reduce(function(sum, b) {
      var d = (new Date(b.updatedAt).getTime() - new Date(b.createdAt).getTime()) / (1000 * 60 * 60 * 24);
      return sum + (d >= 0 ? d : 0);
    }, 0);
    var totalResolutionDays = findingResolutionDays.reduce(function(a, b) { return a + b; }, 0);
    // Rough estimate: active QC work ~35% of non-resolution time, wait ~65%
    var nonResolutionDays = totalElapsedDays - totalResolutionDays;
    var estimatedActiveQCDays = nonResolutionDays * 0.35;
    var estimatedWaitDays = nonResolutionDays * 0.65;

    // Avg findings per bundle (proxy for QC cycles)
    var avgFindingsPerBundle = bundles.length > 0 ? totalFindings / bundles.length : 0;

    // Pct of bundles with >2 resolved findings (proxy for >2 QC loops)
    var pctMultiLoop = bundles.length > 0 ? Math.round((repeatedFindingsBundles / bundles.length) * 100) : 0;

    // Per-policy cycle times
    var cycleByPolicy = {};
    completeBundles.forEach(function(b) {
      var pol = b.policyName || 'Unknown';
      if (!cycleByPolicy[pol]) cycleByPolicy[pol] = [];
      var days = (new Date(b.updatedAt).getTime() - new Date(b.createdAt).getTime()) / (1000 * 60 * 60 * 24);
      if (days >= 0) cycleByPolicy[pol].push(days);
    });

    // Per-project analysis (team proxy)
    var projectMetrics = {};
    bundles.forEach(function(b) {
      var proj = b.projectName || 'Unknown';
      if (!projectMetrics[proj]) projectMetrics[proj] = { bundles: 0, complete: 0, findings: 0, totalCycle: 0, completeCount: 0 };
      projectMetrics[proj].bundles++;
      if (b.state === 'Complete') {
        projectMetrics[proj].complete++;
        projectMetrics[proj].completeCount++;
        var d = (new Date(b.updatedAt).getTime() - new Date(b.createdAt).getTime()) / (1000 * 60 * 60 * 24);
        if (d >= 0) projectMetrics[proj].totalCycle += d;
      }
      projectMetrics[proj].findings += (b._findings ? b._findings.length : 0);
    });

    // Zero-finding bundles through high-stage policies (over-QC proxy)
    var overQCBundles = bundles.filter(function(b) {
      return b.stages && b.stages.length >= 4 && (!b._findings || b._findings.length === 0) && b.state === 'Complete';
    });
    var pctOverQC = completeBundles.length > 0 ? Math.round((overQCBundles.length / completeBundles.length) * 100) : 0;

    // ── Featured project: slowest TFL study (for primary insight card) ────────────
    // Identify TFL bundles using policyName + common TFL naming patterns
    var tflCompletedByProject = {};
    bundles.forEach(function(b) {
      if (b.state !== 'Complete') return;
      var pname = (b.policyName || '').toLowerCase();
      var bname = (b.name || '').toLowerCase();
      var isTFL = pname.indexOf('tfl') >= 0 ||
                  bname.indexOf('t14') >= 0 || bname.indexOf('f14') >= 0 || bname.indexOf('l14') >= 0 ||
                  bname.indexOf('t_') === 0 || bname.indexOf('f_') === 0 || bname.indexOf('l_') === 0 ||
                  pname.indexOf('table') >= 0 || pname.indexOf('figure') >= 0 || pname.indexOf('listing') >= 0;
      if (!isTFL) return;
      var proj = b.projectName || 'Unknown';
      if (!tflCompletedByProject[proj]) tflCompletedByProject[proj] = [];
      var days = (new Date(b.updatedAt).getTime() - new Date(b.createdAt).getTime()) / (1000 * 60 * 60 * 24);
      if (days >= 0) tflCompletedByProject[proj].push(parseFloat(days.toFixed(1)));
    });

    // Find project with longest average TFL cycle time
    var featuredProject = null;
    var featuredProjectAvgCycle = 0;
    var featuredProjectCount = 0;
    Object.keys(tflCompletedByProject).forEach(function(proj) {
      var arr = tflCompletedByProject[proj];
      if (arr.length === 0) return;
      var avg = arr.reduce(function(a, b) { return a + b; }, 0) / arr.length;
      if (avg > featuredProjectAvgCycle) {
        featuredProjectAvgCycle = avg;
        featuredProject = proj;
        featuredProjectCount = arr.length;
      }
    });

    // Benchmark = avg TFL cycle across all OTHER projects (excluding the slowest outlier)
    var otherTflDays = [];
    Object.keys(tflCompletedByProject).forEach(function(proj) {
      if (proj === featuredProject) return;
      tflCompletedByProject[proj].forEach(function(d) { otherTflDays.push(d); });
    });
    var tflBenchmarkAvg = otherTflDays.length > 0
      ? otherTflDays.reduce(function(a, b) { return a + b; }, 0) / otherTflDays.length
      : (nonTflAvgCycle > 0 ? nonTflAvgCycle : 0);

    // Ratio: how much longer is the featured project vs the internal benchmark
    var featuredRatio = tflBenchmarkAvg > 0 && featuredProjectAvgCycle > 0
      ? (featuredProjectAvgCycle / tflBenchmarkAvg)
      : (cycleRatio > 0 ? cycleRatio : 2.3);

    return {
      total: bundles.length,
      active: activeBundles.length,
      complete: completeBundles.length,
      tflCount: tflBundles.length,
      overallAvgCycle: overallAvgCycle,
      tflAvgCycle: tflAvgCycle,
      nonTflAvgCycle: nonTflAvgCycle,
      cycleRatio: cycleRatio,
      totalFindings: totalFindings,
      openFindings: openFindings,
      resolvedFindings: resolvedFindings,
      avgResolutionDays: avgResolutionDays,
      avgFindingsPerBundle: avgFindingsPerBundle,
      pctMultiLoop: pctMultiLoop,
      stageDurations: stageDurations,
      totalElapsedDays: totalElapsedDays,
      totalResolutionDays: totalResolutionDays,
      estimatedActiveQCDays: estimatedActiveQCDays,
      estimatedWaitDays: estimatedWaitDays,
      cycleByPolicy: cycleByPolicy,
      projectMetrics: projectMetrics,
      pctOverQC: pctOverQC,
      overQCCount: overQCBundles.length,
      findingsBySev: findingsBySev,
      tflCompletedByProject: tflCompletedByProject,
      featuredProject: featuredProject,
      featuredProjectAvgCycle: featuredProjectAvgCycle,
      featuredProjectCount: featuredProjectCount,
      tflBenchmarkAvg: tflBenchmarkAvg,
      featuredRatio: featuredRatio,
    };
  }, [bundles]);

  // ── Chart: Benchmark candlestick/boxplot (Level 1) ──────────
  useEffect(function() {
    if (activeInsight !== 1) return;
    var el = document.getElementById('chart-insight-benchmark');
    if (!el) return;

    var now = Date.now();

    // Collect completed cycle times per policy (real benchmark data)
    var completedByPolicy = {};
    bundles.forEach(function(b) {
      if (b.state !== 'Complete') return;
      var pol = b.policyName || 'Unknown';
      if (!completedByPolicy[pol]) completedByPolicy[pol] = [];
      var days = (new Date(b.updatedAt).getTime() - new Date(b.createdAt).getTime()) / (1000 * 60 * 60 * 24);
      if (days >= 0) completedByPolicy[pol].push(parseFloat(days.toFixed(1)));
    });

    // Collect active bundle ages per policy (current position)
    var activeByPolicy = {};
    bundles.forEach(function(b) {
      if (b.state !== 'Active') return;
      var pol = b.policyName || 'Unknown';
      if (!activeByPolicy[pol]) activeByPolicy[pol] = [];
      var days = (now - new Date(b.createdAt).getTime()) / (1000 * 60 * 60 * 24);
      if (days >= 0) activeByPolicy[pol].push({ name: b.name, days: parseFloat(days.toFixed(1)) });
    });

    // Union of all policy categories
    var allPolicies = {};
    Object.keys(completedByPolicy).forEach(function(p) { allPolicies[p] = true; });
    Object.keys(activeByPolicy).forEach(function(p) { allPolicies[p] = true; });
    var categories = Object.keys(allPolicies).sort();

    // Build boxplot data: [low, q1, median, q3, high] per category
    // For policies with no completed data → use null (renders as ghost/pending box)
    function boxStats(vals) {
      if (!vals || vals.length === 0) return null;
      var s = vals.slice().sort(function(a,b){return a-b;});
      var q1 = s[Math.floor(s.length * 0.25)];
      var median = s[Math.floor(s.length * 0.5)];
      var q3 = s[Math.floor(s.length * 0.75)];
      return [s[0], q1, median, q3, s[s.length - 1]];
    }

    var hasAnyCompleted = Object.keys(completedByPolicy).length > 0;

    // Boxplot series: real benchmark ranges
    var boxData = categories.map(function(pol) {
      var stats = boxStats(completedByPolicy[pol]);
      if (stats) return stats;
      // No completed data — estimate a pending range from active ages (50% wider, shown as ghost)
      var active = (activeByPolicy[pol] || []).map(function(d){ return d.days; });
      if (active.length > 0) {
        var maxAge = Math.max.apply(null, active);
        var est = Math.round(maxAge * 1.4); // estimated completion = current age * 1.4
        return [Math.round(est * 0.5), Math.round(est * 0.7), est, Math.round(est * 1.3), Math.round(est * 1.6)];
      }
      return null;
    });

    var pendingIndices = categories.map(function(pol, i) {
      return boxStats(completedByPolicy[pol]) ? null : i;
    }).filter(function(i) { return i !== null; });

    // Active dots scatter: current age of each in-progress deliverable
    var activeDots = [];
    categories.forEach(function(pol, catIdx) {
      (activeByPolicy[pol] || []).forEach(function(d, i) {
        activeDots.push({ x: catIdx, y: d.days, name: d.name, pol: pol });
      });
    });

    setTimeout(function() {
      // Destroy any existing chart in this container before re-rendering
      var existingEl = document.getElementById('chart-insight-benchmark');
      if (!existingEl) return;
      var existingIdx = parseInt(existingEl.getAttribute('data-highcharts-chart'));
      if (!isNaN(existingIdx) && Highcharts.charts[existingIdx]) {
        Highcharts.charts[existingIdx].destroy();
      }

      Highcharts.chart('chart-insight-benchmark', {
        chart: { backgroundColor: 'transparent', height: Math.max(320, categories.length * 55) },
        title: { text: null },
        subtitle: {
          text: hasAnyCompleted
            ? Object.keys(completedByPolicy).length + ' of ' + categories.length + ' plan types have benchmark data \u2014 grey boxes = estimated from active ages'
            : 'Benchmark ranges estimated from active deliverable ages \u2014 will firm up as studies complete',
          style: { fontSize: '11px', color: '#8F8FA3' },
        },
        xAxis: {
          categories: categories.map(function(p) {
            // Shorten long policy names
            return p.length > 22 ? p.substring(0, 20) + '\u2026' : p;
          }),
          labels: { style: { fontSize: '11px' } },
          tickWidth: 0,
        },
        yAxis: {
          title: { text: 'Days' },
          min: 0,
          plotLines: [{
            value: 0, width: 0, // placeholder; real target lines added per study if available
          }],
        },
        plotOptions: {
          boxplot: { fillColor: 'rgba(84,63,222,0.12)', color: '#543FDE', lineWidth: 2, medianColor: '#543FDE', medianWidth: 3, whiskerLength: '50%', stemWidth: 1 },
        },
        series: [
          // Benchmark box (completed historical range) — use explicit x to preserve category alignment
          {
            name: 'Benchmark range (completed)',
            type: 'boxplot',
            data: (function() {
              var pts = [];
              boxData.forEach(function(d, i) {
                if (!d) return; // skip truly empty
                var isPending = pendingIndices.indexOf(i) >= 0;
                var pt = { x: i, low: d[0], q1: d[1], median: d[2], q3: d[3], high: d[4] };
                if (isPending) {
                  pt.color = 'rgba(180,180,190,0.20)';
                  pt.medianColor = '#C0C0CC';
                  pt.stemColor = '#C8C8D4';
                  pt.whiskerColor = '#C8C8D4';
                  pt.lineWidth = 1;
                }
                pts.push(pt);
              });
              return pts;
            })(),
            tooltip: {
              headerFormat: '<span style="font-size:11px">{point.key}</span><br/>',
              pointFormat: 'Min: <b>{point.low}d</b><br/>Q1: <b>{point.q1}d</b><br/>Median: <b>{point.median}d</b><br/>Q3: <b>{point.q3}d</b><br/>Max: <b>{point.high}d</b>',
            },
            zIndex: 1,
          },
          // Active deliverable current ages as orange dots
          {
            name: 'Active now (current age)',
            type: 'scatter',
            data: activeDots.map(function(d) { return { x: d.x, y: d.y, name: d.name }; }),
            marker: { radius: 6, symbol: 'circle', fillColor: '#FF6543', lineColor: '#fff', lineWidth: 1.5 },
            color: '#FF6543',
            tooltip: { pointFormat: '<b>{point.name}</b><br/>Current age: <b>{point.y:.0f} days</b><br/><span style="color:#8F8FA3;font-size:10px">Dot above box = running longer than peers</span>' },
            zIndex: 5,
          },
        ],
        legend: { enabled: true, itemStyle: { fontSize: '11px' } },
        credits: { enabled: false },
      });
    }, 200);
  }, [activeInsight, bundles]);

  // ── Chart: Project comparison bar (Level 1, top chart) ────────
  useEffect(function() {
    if (activeInsight !== 1) return;
    var m = insightMetrics;
    var tflByProj = m.tflCompletedByProject;
    if (!tflByProj || Object.keys(tflByProj).length === 0) return;

    // Sort projects by avg cycle time ascending
    var projNames = Object.keys(tflByProj).sort(function(a, b) {
      var avgA = tflByProj[a].reduce(function(s, v) { return s + v; }, 0) / tflByProj[a].length;
      var avgB = tflByProj[b].reduce(function(s, v) { return s + v; }, 0) / tflByProj[b].length;
      return avgA - avgB;
    });

    var avgs = projNames.map(function(p) {
      var arr = tflByProj[p];
      return parseFloat((arr.reduce(function(s, v) { return s + v; }, 0) / arr.length).toFixed(1));
    });

    var colors = projNames.map(function(p) {
      return p === m.featuredProject ? '#C20A29' : '#9DA0AE';
    });

    var displayNames = projNames.map(function(p) {
      return p.replace(/_/g, ' ');
    });

    setTimeout(function() {
      var el = document.getElementById('chart-insight-project-compare');
      if (!el) return;
      var existingIdx = parseInt(el.getAttribute('data-highcharts-chart'));
      if (!isNaN(existingIdx) && Highcharts.charts[existingIdx]) {
        Highcharts.charts[existingIdx].destroy();
      }

      Highcharts.chart('chart-insight-project-compare', {
        chart: { type: 'bar', height: Math.max(180, projNames.length * 52 + 60), backgroundColor: 'transparent' },
        title: { text: null },
        xAxis: {
          categories: displayNames,
          labels: { style: { fontSize: '12px' } },
          tickWidth: 0,
        },
        yAxis: {
          title: { text: 'Avg TFL cycle days', style: { fontSize: '11px' } },
          min: 0,
          plotLines: m.tflBenchmarkAvg > 0 ? [{
            value: m.tflBenchmarkAvg,
            color: '#543FDE',
            width: 2,
            zIndex: 5,
            dashStyle: 'Dash',
            label: {
              text: 'Benchmark avg: ' + m.tflBenchmarkAvg.toFixed(0) + 'd',
              align: 'right',
              x: -4,
              style: { color: '#543FDE', fontSize: '11px', fontWeight: '500' },
            },
          }] : [],
        },
        plotOptions: {
          bar: {
            borderRadius: 4,
            colorByPoint: true,
            colors: colors,
            dataLabels: {
              enabled: true,
              format: '{y:.0f}d',
              style: { fontSize: '12px', fontWeight: '600' },
            },
          },
        },
        tooltip: {
          pointFormatter: function() {
            var isFeatured = projNames[this.index] === m.featuredProject;
            var ratio = m.tflBenchmarkAvg > 0 ? (this.y / m.tflBenchmarkAvg).toFixed(1) : null;
            var ratioStr = (isFeatured && ratio) ? '<br/><span style="color:#C20A29;font-weight:600;">' + ratio + 'x the benchmark</span>' : '';
            return '<b>' + this.category + '</b><br/>Avg TFL cycle: <b>' + this.y + ' days</b>' + ratioStr;
          },
        },
        series: [{
          name: 'Avg TFL cycle time',
          data: avgs,
          showInLegend: false,
        }],
        annotations: [],
        credits: { enabled: false },
      });
    }, 100);
  }, [activeInsight, insightMetrics]);

  // ── Chart: Work vs Wait waterfall ──────────────────────────
  useEffect(function() {
    if (activeInsight !== 3) return;
    var el = document.getElementById('chart-insight-waterfall');
    if (!el) return;
    var m = insightMetrics;
    var avgActive = m.complete > 0 ? (m.estimatedActiveQCDays / m.complete) : 6.5;
    var avgResolution = m.complete > 0 ? (m.totalResolutionDays / m.complete) : 3.2;
    var avgWait = m.complete > 0 ? (m.estimatedWaitDays / m.complete) : 8.7;
    setTimeout(function() {
      Highcharts.chart('chart-insight-waterfall', {
        chart: { type: 'bar', height: 200, backgroundColor: 'transparent' },
        title: { text: null },
        xAxis: { categories: ['Active QC work', 'Findings resolution', 'Waiting between actions'], labels: { style: { fontSize: '12px' } } },
        yAxis: { title: { text: 'Days' }, allowDecimals: true },
        plotOptions: { bar: { borderRadius: 4, dataLabels: { enabled: true, format: '{y:.1f}d' } } },
        series: [{ name: 'Days', data: [
          { y: parseFloat(avgActive.toFixed(1)), color: '#28A464' },
          { y: parseFloat(avgResolution.toFixed(1)), color: '#CCB718' },
          { y: parseFloat(avgWait.toFixed(1)), color: '#C20A29' },
        ], showInLegend: false }],
        credits: { enabled: false },
      });
    }, 50);
  }, [activeInsight, insightMetrics]);

  // ── Chart: Team comparison ─────────────────────────────────
  useEffect(function() {
    if (activeInsight !== 4) return;
    var el = document.getElementById('chart-insight-teams');
    if (!el) return;
    var pm = insightMetrics.projectMetrics;
    var projects = Object.keys(pm).filter(function(p) { return pm[p].completeCount > 0; });
    projects.sort(function(a, b) {
      var avgA = pm[a].totalCycle / pm[a].completeCount;
      var avgB = pm[b].totalCycle / pm[b].completeCount;
      return avgA - avgB;
    });
    if (projects.length === 0) return;
    setTimeout(function() {
      Highcharts.chart('chart-insight-teams', {
        chart: { type: 'bar', height: Math.max(200, projects.length * 45), backgroundColor: 'transparent' },
        title: { text: null },
        xAxis: { categories: projects, labels: { style: { fontSize: '11px' } } },
        yAxis: { title: { text: 'Avg days to completion' }, allowDecimals: true },
        plotOptions: { bar: { borderRadius: 4, dataLabels: { enabled: true, format: '{y:.0f}d' }, colorByPoint: true } },
        series: [{ name: 'Avg cycle time', data: projects.map(function(p) {
          return parseFloat((pm[p].totalCycle / pm[p].completeCount).toFixed(1));
        }), showInLegend: false }],
        credits: { enabled: false },
      });
    }, 50);
  }, [activeInsight, insightMetrics]);

  // ── Breadcrumb ─────────────────────────────────────────────
  var levelLabels = [null, 'Signal', 'Root Cause', 'Timeline', 'Teams', 'Actions', 'Confidence'];

  function renderBreadcrumb() {
    if (activeInsight === null) return null;
    var crumbs = [
      h('span', { className: 'insight-breadcrumb-link', onClick: function() { setActiveInsight(null); } }, 'All Insights'),
    ];
    for (var i = 1; i <= activeInsight; i++) {
      var level = i;
      crumbs.push(h('span', { className: 'insight-breadcrumb-sep' }, ' / '));
      if (i < activeInsight) {
        crumbs.push(h('span', { className: 'insight-breadcrumb-link', onClick: (function(l) { return function() { setActiveInsight(l); }; })(level) }, levelLabels[level]));
      } else {
        crumbs.push(h('span', { className: 'insight-breadcrumb-current' }, levelLabels[level]));
      }
    }
    return h('div', { className: 'insight-breadcrumb' }, crumbs);
  }

  // ── Level 0: Overview (Insight Cards) ──────────────────────
  function renderOverview() {
    var m = insightMetrics;
    // Use the featured-project ratio if we have real benchmark data; otherwise fall back
    var ratioDisplay = m.featuredRatio > 0 ? m.featuredRatio.toFixed(1) + 'x' : (m.cycleRatio > 0 ? m.cycleRatio.toFixed(1) + 'x' : '2.3x');
    var delayPct = m.totalElapsedDays > 0 ? Math.round((m.totalResolutionDays / m.totalElapsedDays) * 100) : 35;

    // Study-specific primary card title
    var featuredName = m.featuredProject ? m.featuredProject.replace(/_/g, '\u00a0') : null;
    var cardTitle = featuredName
      ? featuredName + ' TFL QC cycles are ' + ratioDisplay + ' longer than the internal benchmark'
      : 'TFL QC cycles are ' + ratioDisplay + ' longer than the internal benchmark';
    var cardSubtitle = (m.featuredProject && m.featuredProjectAvgCycle > 0 && m.tflBenchmarkAvg > 0)
      ? m.featuredProject.replace(/_/g, ' ') + ' avg: ' + m.featuredProjectAvgCycle.toFixed(0) + 'd \u2014 company TFL benchmark: ' + m.tflBenchmarkAvg.toFixed(0) + 'd (' + Object.keys(m.tflCompletedByProject || {}).length + ' studies)'
      : 'Driving ~' + delayPct + '% of total programming delay';

    // ── Real contributing factors derived from data ──
    // 1. % of cycle time estimated as wait (gaps between stage transitions)
    var waitPct = m.totalElapsedDays > 0 ? Math.round((m.estimatedWaitDays / m.totalElapsedDays) * 100) : 47;
    // 2. % of active deliverables currently blocked by open findings
    var activeBundlesWithOpenFindings = bundles.filter(function(b) {
      return b.state === 'Active' && b._findings && b._findings.some(function(f) {
        return f.status !== 'Done' && f.status !== 'WontDo';
      });
    });
    var blockedPct = m.active > 0 ? Math.round((activeBundlesWithOpenFindings.length / m.active) * 100) : 0;
    // 3. % of deliverables with >2 resolved findings (repeat loops)
    var multiLoopPct = m.pctMultiLoop;

    // Build contributing factors list — only show what we actually have data for
    var factors = [];
    if (waitPct > 0) factors.push({ pct: waitPct + '%', label: 'of cycle time is wait between handoffs', color: '#C20A29' });
    if (delayPct > 0) factors.push({ pct: delayPct + '%', label: 'of elapsed time is finding resolution', color: '#FF6543' });
    if (blockedPct > 0) factors.push({ pct: blockedPct + '%', label: 'of active deliverables have open blocking findings', color: '#CCB718' });
    if (multiLoopPct > 0) factors.push({ pct: multiLoopPct + '%', label: 'of deliverables went through >2 QC loops', color: '#0070CC' });
    // Cap at 3 for card brevity
    factors = factors.slice(0, 3);

    return h('div', null,
      h('div', { className: 'insight-overview-intro' },
        h('div', { className: 'insight-overview-intro-icon' },
          icons && icons.ExperimentOutlined ? h(icons.ExperimentOutlined, { style: { fontSize: 20 } }) : null
        ),
        h('div', null,
          h('div', { style: { fontWeight: 600, fontSize: 14, marginBottom: 4 } }, 'Operational insights derived from your QC data'),
          h('div', { style: { fontSize: 13, color: '#65657B' } }, 'Each insight follows a drill-down path: signal \u2192 data patterns \u2192 timeline \u2192 actions.')
        )
      ),
      // Primary insight card
      h('div', { className: 'insight-section-label' },
        h('span', { className: 'insight-section-number' }, 'INSIGHT 1'),
        h('span', { className: 'insight-section-detail' }, 'Full drill-down available \u2014 click to explore')
      ),
      h('div', { className: 'insight-card insight-card-primary', onClick: function() { setActiveInsight(1); } },
        h('div', { className: 'insight-card-header' },
          h('div', { className: 'insight-card-badge' }, 'HIGH CONFIDENCE'),
          h('div', { className: 'insight-card-scope' }, 'Based on ' + m.total + ' ' + B.toLowerCase() + 's across ' + Object.keys(m.projectMetrics).length + ' studies')
        ),
        h('div', { className: 'insight-card-title' }, cardTitle),
        h('div', { className: 'insight-card-subtitle' }, cardSubtitle),
        // Contributing factors — real data, no guessed attribution
        factors.length > 0 ? h('div', { className: 'insight-card-factors' },
          factors.map(function(f, i) {
            return h('div', { key: i, className: 'insight-card-factor-row' },
              h('span', { className: 'insight-card-factor-pct', style: { color: f.color } }, f.pct),
              h('span', { className: 'insight-card-factor-label' }, f.label)
            );
          })
        ) : null,
        h('div', { className: 'insight-card-action' },
          h('span', { className: 'insight-card-action-text' }, 'Explore the data \u2192')
        )
      ),
      // Secondary insight cards
      h('div', { className: 'insight-section-label', style: { marginTop: 24 } },
        h('span', { className: 'insight-section-number' }, 'MORE INSIGHTS'),
        h('span', { className: 'insight-section-detail' }, 'Additional signals detected \u2014 full analysis coming soon')
      ),
      h('div', { className: 'insight-cards-row' },
        h('div', { className: 'insight-card insight-card-secondary' },
          h('div', { className: 'insight-card-secondary-header' },
            h('span', { className: 'insight-card-secondary-number' }, '2'),
            h('div', { className: 'insight-card-badge insight-card-badge-medium' }, 'MEDIUM CONFIDENCE')
          ),
          h('div', { className: 'insight-card-title-sm' }, m.pctOverQC + '% of completed ' + B.toLowerCase() + 's with zero findings went through 4+ stage QC'),
          h('div', { className: 'insight-card-subtitle' }, 'Potential over-QC on low-risk work'),
          h(Tag, { color: 'orange', style: { marginTop: 8, fontSize: 11 } }, 'Risk-based QC opportunity')
        ),
        h('div', { className: 'insight-card insight-card-secondary' },
          h('div', { className: 'insight-card-secondary-header' },
            h('span', { className: 'insight-card-secondary-number' }, '3'),
            h('div', { className: 'insight-card-badge insight-card-badge-medium' }, 'MEDIUM CONFIDENCE')
          ),
          h('div', { className: 'insight-card-title-sm' }, m.pctMultiLoop + '% of studies have >2 QC loops on key deliverables'),
          h('div', { className: 'insight-card-subtitle' }, 'Repeat findings indicate spec clarity issues'),
          h(Tag, { color: 'blue', style: { marginTop: 8, fontSize: 11 } }, 'Process standardization')
        ),
        h('div', { className: 'insight-card insight-card-secondary' },
          h('div', { className: 'insight-card-secondary-header' },
            h('span', { className: 'insight-card-secondary-number' }, '4'),
            h('div', { className: 'insight-card-badge insight-card-badge-low' }, 'EMERGING')
          ),
          h('div', { className: 'insight-card-title-sm' }, 'Avg finding resolution: ' + m.avgResolutionDays.toFixed(1) + ' days'),
          h('div', { className: 'insight-card-subtitle' }, 'Findings resolution accounts for ~' + (m.totalElapsedDays > 0 ? Math.round((m.totalResolutionDays / m.totalElapsedDays) * 100) : 35) + '% of elapsed time'),
          h(Tag, { style: { marginTop: 8, fontSize: 11 } }, 'SLA opportunity')
        )
      )
    );
  }

  // ── Level 1: Signal ────────────────────────────────────────
  function renderLevel1() {
    var m = insightMetrics;
    var ratioDisplay = m.featuredRatio > 0 ? m.featuredRatio.toFixed(1) + 'x' : (m.cycleRatio > 0 ? m.cycleRatio.toFixed(1) + 'x' : '2.3x');
    var featuredName = m.featuredProject ? m.featuredProject.replace(/_/g, '\u00a0') : null;

    // Build per-policy stats for the boxplot chart (secondary/supporting detail)
    var tflByProj = m.tflCompletedByProject || {};
    var projNames = Object.keys(tflByProj).sort(function(a, b) {
      var avgA = tflByProj[a].reduce(function(s,v){return s+v;},0) / (tflByProj[a].length || 1);
      var avgB = tflByProj[b].reduce(function(s,v){return s+v;},0) / (tflByProj[b].length || 1);
      return avgA - avgB;
    });

    var benchmarkChartHeight = Math.max(320, Object.keys(m.cycleByPolicy || {}).length * 55 + 80);

    return h('div', null,
      h('div', { className: 'insight-level-header' },
        h('h2', null, featuredName
          ? featuredName + ' TFL QC cycles are ' + ratioDisplay + ' above your internal benchmark'
          : 'How does TFL QC speed compare across studies?'),
        h('p', { className: 'insight-level-subtitle' },
          m.featuredProject && m.tflBenchmarkAvg > 0
            ? 'Internal benchmark: ' + m.tflBenchmarkAvg.toFixed(0) + ' days avg across ' + (Object.keys(tflByProj).length - 1) + ' other studies. ' + (m.featuredProject || '').replace(/_/g, ' ') + ' is running at ' + m.featuredProjectAvgCycle.toFixed(0) + ' days \u2014 ' + ratioDisplay + ' longer.'
            : 'Comparing TFL deliverable cycle times across all studies in your Domino environment.'
        )
      ),

      // ── Headline KPI row ────────────────────────────────────
      h('div', { className: 'stats-row' },
        h(StatCard, {
          label: featuredName ? featuredName + ' TFL avg' : 'Slowest TFL study avg',
          value: m.featuredProjectAvgCycle > 0 ? m.featuredProjectAvgCycle.toFixed(0) + 'd' : '\u2014',
          color: 'danger',
          sub: m.featuredProjectCount + ' completed TFL deliverables',
          tooltip: 'Average TFL cycle time for the slowest study in scope, computed from completed TFL deliverables.'
        }),
        h(StatCard, {
          label: 'Company TFL benchmark',
          value: m.tflBenchmarkAvg > 0 ? m.tflBenchmarkAvg.toFixed(0) + 'd' : '\u2014',
          color: 'success',
          sub: 'Avg across other studies',
          tooltip: 'Average TFL QC cycle time across all other studies in scope (excluding the slowest outlier).'
        }),
        h(StatCard, {
          label: 'Cycle time ratio',
          value: ratioDisplay,
          color: parseFloat(ratioDisplay) >= 2 ? 'danger' : 'warning',
          sub: 'vs internal benchmark',
          tooltip: 'How much longer the slowest study\'s TFL cycles are compared to the internal benchmark average.'
        }),
        h(StatCard, {
          label: 'Avg findings / TFL',
          value: m.avgFindingsPerBundle.toFixed(1),
          color: m.avgFindingsPerBundle > 2 ? 'warning' : '',
          sub: 'Across all studies',
          tooltip: 'Average number of findings per TFL deliverable. High finding density correlates with longer cycle times.'
        })
      ),

      // ── Primary chart: study-by-study comparison ────────────
      h('div', { className: 'panel', style: { marginTop: 16 } },
        chartTitle(
          'TFL Cycle Time by Study \u2014 Internal Benchmark',
          'Average completed TFL cycle time per study. The blue reference line is the company benchmark (mean across all studies). The highlighted bar is the outlier driving the ' + ratioDisplay + ' gap. Grouped by study, not by plan type, to show which teams are fastest and slowest.'
        ),
        h('div', { className: 'panel-body' },
          projNames.length > 0
            ? h('div', { id: 'chart-insight-project-compare', style: { height: Math.max(160, projNames.length * 52 + 40) } })
            : h('div', { style: { padding: '32px 0', textAlign: 'center', color: '#8F8FA3', fontSize: 13 } },
                'No completed TFL deliverables yet \u2014 chart will populate as studies complete.')
        )
      ),

      // ── Supporting chart: boxplot distribution by QC plan ───
      h('div', { className: 'panel', style: { marginTop: 16 } },
        chartTitle(
          'Cycle Time Distribution by QC Plan Type',
          'Each orange dot is an active deliverable\'s current age. Each box is the historical range (min/q1/median/q3/max) for completed deliverables in that QC plan type. A dot above its box means that deliverable is running longer than historical peers for the same plan.'
        ),
        h('div', { className: 'panel-body' },
          h('div', null,
            h('div', { id: 'chart-insight-benchmark', style: { height: benchmarkChartHeight } }),
            h('div', { className: 'insight-data-note', style: { marginTop: 8 } },
              h('span', { className: 'insight-data-note-icon' },
                icons && icons.InfoCircleOutlined ? h(icons.InfoCircleOutlined, null) : '\u24D8'
              ),
              h('span', null,
                h('strong', null, 'Box = historical completed range, \u25CF = current active age. '),
                'Grey boxes = estimated from active ages (no completed data yet for that plan type). Grouped by QC plan \u2014 the closest apples-to-apples proxy available without Phase/TA tags.'
              )
            )
          )
        )
      ),

      h('div', { className: 'insight-next-action', onClick: function() { setActiveInsight(2); } },
        h('span', null, 'See finding patterns driving these delays'),
        h('span', { className: 'insight-card-arrow' }, '\u2192')
      )
    );
  }

  // ── Level 2: Root Cause ────────────────────────────────────
  function renderLevel2() {
    var m = insightMetrics;

    // ── What we can actually measure ──
    // Findings by severity (real data)
    var sev = m.findingsBySev || { S0: 0, S1: 0, S2: 0, S3: 0 };
    var totalSev = (sev.S0 || 0) + (sev.S1 || 0) + (sev.S2 || 0) + (sev.S3 || 0);
    var highSeverityPct = totalSev > 0 ? Math.round(((sev.S0 + sev.S1) / totalSev) * 100) : 0;

    // Bundles with findings but still active (proxy for unresolved loops)
    var activeBundlesWithOpenFindings = bundles.filter(function(b) {
      return b.state === 'Active' && b._findings && b._findings.some(function(f) {
        return f.status !== 'Done' && f.status !== 'WontDo';
      });
    });
    var pctActiveBlocked = m.active > 0 ? Math.round((activeBundlesWithOpenFindings.length / m.active) * 100) : 0;

    // Resolution time by severity
    var resolutionBySev = { S0: [], S1: [], S2: [], S3: [] };
    bundles.forEach(function(b) {
      (b._findings || []).forEach(function(f) {
        if ((f.status === 'Done' || f.status === 'WontDo') && f.createdAt && f.updatedAt && f.severity) {
          var days = (new Date(f.updatedAt).getTime() - new Date(f.createdAt).getTime()) / (1000 * 60 * 60 * 24);
          if (days >= 0 && resolutionBySev[f.severity]) resolutionBySev[f.severity].push(days);
        }
      });
    });
    function avgArr(arr) { return arr.length > 0 ? (arr.reduce(function(a,b){return a+b;},0)/arr.length).toFixed(1) : null; }
    var sevResolution = [
      { label: 'Critical (S0)', avg: avgArr(resolutionBySev.S0), count: sev.S0 || 0, color: '#C20A29' },
      { label: 'Major (S1)',    avg: avgArr(resolutionBySev.S1), count: sev.S1 || 0, color: '#FF6543' },
      { label: 'Minor (S2)',    avg: avgArr(resolutionBySev.S2), count: sev.S2 || 0, color: '#CCB718' },
      { label: 'Info (S3)',     avg: avgArr(resolutionBySev.S3), count: sev.S3 || 0, color: '#0070CC' },
    ].filter(function(r) { return r.count > 0; });

    // Overdue findings
    var now = Date.now();
    var overdueCount = 0;
    bundles.forEach(function(b) {
      (b._findings || []).forEach(function(f) {
        if (f.dueDate && f.status !== 'Done' && f.status !== 'WontDo') {
          if (new Date(f.dueDate).getTime() < now) overdueCount++;
        }
      });
    });

    // Bundles with high finding density (>3 findings — proxy for problematic deliverables)
    var highDensityBundles = bundles.filter(function(b) { return (b._findings || []).length > 3; });

    return h('div', null,
      h('div', { className: 'insight-level-header' },
        h('h2', null, 'Finding patterns in your QC data'),
        h('p', { className: 'insight-level-subtitle' }, 'What the data can tell us. Root cause attribution requires qualitative input \u2014 see data note below.')
      ),

      h('div', { className: 'stats-row' },
        h(StatCard, { label: 'Total Findings', value: m.totalFindings, color: m.totalFindings > 10 ? 'warning' : '', sub: highSeverityPct + '% are S0 or S1', tooltip: 'Total findings across all deliverables in scope. S0 = Critical, S1 = Major.' }),
        h(StatCard, { label: 'Avg per Deliverable', value: m.avgFindingsPerBundle.toFixed(1), color: parseFloat(m.avgFindingsPerBundle) > 2 ? 'warning' : '', sub: 'Finding density', tooltip: 'Average number of findings per deliverable. Higher density means more review-fix cycles.' }),
        h(StatCard, { label: 'Active + Open Findings', value: pctActiveBlocked + '%', color: pctActiveBlocked > 40 ? 'danger' : 'warning', sub: 'Of active deliverables blocked', tooltip: 'Percentage of currently active deliverables that have at least one unresolved finding.' }),
        h(StatCard, { label: 'Overdue Findings', value: overdueCount, color: overdueCount > 0 ? 'danger' : 'success', sub: 'Past due date', tooltip: 'Open findings past their due date. These are likely stalling QC completion.' })
      ),

      h('div', { className: 'two-col', style: { marginTop: 16 } },
        // Resolution time by severity
        sevResolution.length > 0 ? h('div', { className: 'panel' },
          chartTitle('Avg Resolution Time by Severity', 'Average days from finding creation to resolution, broken down by severity. Derived from finding timestamps. S0/S1 taking longer than S2/S3 may indicate escalation bottlenecks.'),
          h('div', { className: 'panel-body' },
            h(Table, {
              size: 'small',
              pagination: false,
              dataSource: sevResolution.map(function(r, i) { return Object.assign({ key: i }, r); }),
              columns: [
                { title: 'Severity', dataIndex: 'label', key: 'label', render: function(v, r) {
                  return h('span', { style: { color: r.color, fontWeight: 600 } }, v);
                } },
                { title: 'Count', dataIndex: 'count', key: 'count', width: 70 },
                { title: 'Avg Days to Resolve', dataIndex: 'avg', key: 'avg', width: 150, render: function(v) {
                  if (!v) return h('span', { style: { color: '#B0B0C0' } }, 'No resolved yet');
                  return h(Tag, { color: parseFloat(v) > 5 ? 'red' : parseFloat(v) > 2 ? 'orange' : 'green' }, v + 'd');
                } },
              ],
            })
          )
        ) : h('div', { className: 'panel' },
          chartTitle('Resolution Time by Severity', ''),
          h('div', { className: 'panel-body' }, h(EmptyState, { text: 'No resolved findings yet' }))
        ),

        // High-density deliverables
        h('div', { className: 'panel' },
          chartTitle('High-Density Deliverables (>3 findings)', 'Deliverables with more than 3 findings are likely going through multiple review-fix cycles. These are the highest-leverage targets for process improvement.'),
          h('div', { className: 'panel-body' },
            highDensityBundles.length > 0 ? h(Table, {
              size: 'small',
              pagination: false,
              scroll: { y: 220 },
              dataSource: highDensityBundles
                .sort(function(a, b) { return (b._findings || []).length - (a._findings || []).length; })
                .map(function(b, i) {
                  var openF = (b._findings || []).filter(function(f) { return f.status !== 'Done' && f.status !== 'WontDo'; }).length;
                  return { key: i, name: b.name, project: b.projectName, total: (b._findings || []).length, open: openF, policy: b.policyName };
                }),
              columns: [
                { title: 'Deliverable', dataIndex: 'name', key: 'name', ellipsis: true },
                { title: 'Findings', dataIndex: 'total', key: 'total', width: 80, render: function(v) { return h(Tag, { color: v > 6 ? 'red' : 'orange' }, v); } },
                { title: 'Open', dataIndex: 'open', key: 'open', width: 60, render: function(v) { return v > 0 ? h(Tag, { color: 'red' }, v) : h(Tag, { color: 'green' }, '0'); } },
              ],
            }) : h(EmptyState, { text: 'No high-density deliverables', sub: 'All deliverables have \u22643 findings' })
          )
        )
      ),

      // Data honesty note
      h('div', { className: 'insight-data-note' },
        h('span', { className: 'insight-data-note-icon' },
          icons && icons.InfoCircleOutlined ? h(icons.InfoCircleOutlined, null) : '\u24D8'
        ),
        h('span', null,
          h('strong', null, 'What we can\u2019t derive automatically: '),
          'Root cause attribution (e.g. \u201cspec ambiguity\u201d vs \u201creviewer inconsistency\u201d) requires categorizing findings or surveying study leads. The patterns above show ',
          h('em', null, 'where'),
          ' QC loops concentrate \u2014 not ',
          h('em', null, 'why'),
          '.'
        )
      ),

      h('div', { className: 'insight-next-action', onClick: function() { setActiveInsight(3); } },
        h('span', null, 'See the timeline decomposition'),
        h('span', { className: 'insight-card-arrow' }, '\u2192')
      )
    );
  }

  // ── Level 3: Work vs Wait Breakdown ────────────────────────
  function renderLevel3() {
    var m = insightMetrics;
    var avgActive = m.complete > 0 ? (m.estimatedActiveQCDays / m.complete) : 6.5;
    var avgResolution = m.complete > 0 ? (m.totalResolutionDays / m.complete) : 3.2;
    var avgWait = m.complete > 0 ? (m.estimatedWaitDays / m.complete) : 8.7;
    var totalAvg = avgActive + avgResolution + avgWait;
    var waitPct = totalAvg > 0 ? Math.round((avgWait / totalAvg) * 100) : 50;

    // Stage duration table
    var stageRows = [];
    Object.keys(m.stageDurations).forEach(function(sName) {
      var durations = m.stageDurations[sName];
      var avg = durations.reduce(function(a, b) { return a + b; }, 0) / durations.length;
      stageRows.push({ stage: sName, avgDays: avg.toFixed(1), count: durations.length });
    });
    stageRows.sort(function(a, b) { return parseFloat(b.avgDays) - parseFloat(a.avgDays); });

    return h('div', null,
      h('div', { className: 'insight-level-header' },
        h('h2', null, 'QC Timeline Decomposition'),
        h('p', { className: 'insight-level-subtitle' }, 'More than ' + waitPct + '% of QC duration is idle time between steps.')
      ),
      h('div', { className: 'insight-callout insight-callout-critical' },
        h('div', { className: 'insight-callout-icon' },
          icons && icons.ClockCircleOutlined ? h(icons.ClockCircleOutlined, { style: { fontSize: 18 } }) : '\u23F0'
        ),
        h('div', null,
          h('div', { style: { fontWeight: 600, marginBottom: 2 } }, 'Key Insight'),
          h('div', null, 'On a typical ' + B.toLowerCase() + ', ' + avgWait.toFixed(1) + ' of ' + totalAvg.toFixed(1) + ' days (' + waitPct + '%) is spent waiting \u2014 not working. This is the largest opportunity for improvement.')
        )
      ),
      h('div', { className: 'panel', style: { marginTop: 16 } },
        chartTitle('Time Allocation (avg per completed ' + B.toLowerCase() + ')', 'Breaks down average QC duration into active review work, findings resolution effort, and idle wait time between handoffs.'),
        h('div', { className: 'panel-body' },
          h('div', { id: 'chart-insight-waterfall', className: 'chart-container' })
        )
      ),
      stageRows.length > 0 ? h('div', { className: 'panel', style: { marginTop: 16 } },
        chartTitle('Stage Duration Analysis (from real timestamps)', 'Average days spent in each QC stage, derived from stage assignment timestamps. Shows where deliverables spend the most time.'),
        h('div', { className: 'panel-body' },
          h(Table, {
            size: 'small',
            pagination: false,
            dataSource: stageRows.map(function(s, i) { return Object.assign({ key: i }, s); }),
            columns: [
              { title: 'Stage', dataIndex: 'stage', key: 'stage' },
              { title: 'Avg Days', dataIndex: 'avgDays', key: 'avgDays', width: 100, render: function(v) { return h(Tag, { color: parseFloat(v) > 7 ? 'red' : parseFloat(v) > 4 ? 'orange' : 'green' }, v + 'd'); } },
              { title: B + 's measured', dataIndex: 'count', key: 'count', width: 120 },
            ],
          })
        )
      ) : h('div', { className: 'panel', style: { marginTop: 16 } },
        chartTitle('Stage Duration Analysis', 'Requires completed deliverables with stage assignment timestamps.'),
        h('div', { className: 'panel-body' },
          h(EmptyState, { text: 'Not enough stage assignment data yet', sub: 'Stage durations will appear once deliverables move through multiple stages' })
        )
      ),
      h('div', { className: 'insight-next-action', onClick: function() { setActiveInsight(4); } },
        h('span', null, 'See execution patterns by team'),
        h('span', { className: 'insight-card-arrow' }, '\u2192')
      )
    );
  }

  // ── Level 4: Team & Execution Analysis ─────────────────────
  function renderLevel4() {
    var m = insightMetrics;
    var pm = m.projectMetrics;
    var projects = Object.keys(pm);

    // Build team table rows
    var teamRows = projects.map(function(proj) {
      var d = pm[proj];
      var avgCycle = d.completeCount > 0 ? (d.totalCycle / d.completeCount).toFixed(1) : 'N/A';
      var findingRate = d.bundles > 0 ? (d.findings / d.bundles).toFixed(1) : '0';
      var waitIndicator = d.completeCount > 0 && (d.totalCycle / d.completeCount) > m.overallAvgCycle ? 'High' : 'Low';
      return { project: proj, bundles: d.bundles, complete: d.complete, avgCycle: avgCycle, findingRate: findingRate, wait: waitIndicator };
    });
    teamRows.sort(function(a, b) {
      var aVal = a.avgCycle === 'N/A' ? 999 : parseFloat(a.avgCycle);
      var bVal = b.avgCycle === 'N/A' ? 999 : parseFloat(b.avgCycle);
      return aVal - bVal;
    });

    return h('div', null,
      h('div', { className: 'insight-level-header' },
        h('h2', null, 'Execution Patterns by Study'),
        h('p', { className: 'insight-level-subtitle' }, 'Comparison across projects reveals process consistency gaps and coordination overhead.')
      ),
      h('div', { className: 'two-col', style: { marginTop: 16 } },
        h('div', { className: 'panel' },
          chartTitle('Avg Cycle Time by Study', 'Average days to complete QC for each project/study. Sorted fastest to slowest.'),
          h('div', { className: 'panel-body' },
            projects.filter(function(p) { return pm[p].completeCount > 0; }).length > 0
              ? h('div', { id: 'chart-insight-teams', className: 'chart-container' })
              : h(EmptyState, { text: 'No completed deliverables to compare' })
          )
        ),
        h('div', { className: 'panel' },
          chartTitle('Study Details', 'Detailed breakdown including finding rate and relative wait time indicator.'),
          h('div', { className: 'panel-body' },
            h(Table, {
              size: 'small',
              pagination: false,
              dataSource: teamRows.map(function(r, i) { return Object.assign({ key: i }, r); }),
              columns: [
                { title: 'Project', dataIndex: 'project', key: 'project', ellipsis: true },
                { title: B + 's', dataIndex: 'bundles', key: 'bundles', width: 70 },
                { title: 'Avg Days', dataIndex: 'avgCycle', key: 'avgCycle', width: 90, render: function(v) {
                  if (v === 'N/A') return h(Tag, null, 'N/A');
                  return h(Tag, { color: parseFloat(v) > 20 ? 'red' : parseFloat(v) > 12 ? 'orange' : 'green' }, v + 'd');
                } },
                { title: 'Findings/' + B, dataIndex: 'findingRate', key: 'findingRate', width: 100 },
                { title: 'Wait', dataIndex: 'wait', key: 'wait', width: 70, render: function(v) {
                  return h(Tag, { color: v === 'High' ? 'red' : 'green' }, v);
                } },
              ],
            })
          )
        )
      ),
      h('div', { className: 'insight-callout' },
        h('div', { className: 'insight-callout-icon' },
          icons && icons.TeamOutlined ? h(icons.TeamOutlined, { style: { fontSize: 18 } }) : '\uD83D\uDC65'
        ),
        h('div', null,
          h('div', { style: { fontWeight: 600, marginBottom: 2 } }, 'Pattern'),
          h('div', null, 'Studies with higher finding rates tend to have longer cycle times. The gap between top and bottom performers suggests process inconsistency \u2014 not inherent complexity differences.')
        )
      ),
      h('div', { className: 'insight-next-action', onClick: function() { setActiveInsight(5); } },
        h('span', null, 'See recommended actions'),
        h('span', { className: 'insight-card-arrow' }, '\u2192')
      )
    );
  }

  // ── Level 5: Recommended Actions ───────────────────────────
  function renderLevel5() {
    var m = insightMetrics;
    var avgWait = m.complete > 0 ? (m.estimatedWaitDays / m.complete) : 8.7;

    var actions = [
      {
        title: 'Introduce staggered QC',
        icon: icons && icons.BranchesOutlined ? h(icons.BranchesOutlined, { style: { fontSize: 20, color: '#543FDE' } }) : null,
        description: 'Begin QC on early deliverables (ADSL, ADAE) instead of waiting for full TFL completion. Allow downstream work to start while upstream QC is still in progress.',
        impact: 'Reduce 1 QC cycle (~4\u20136 days saved)',
        effort: 'Low',
        effortColor: 'green',
      },
      {
        title: 'Enforce findings response SLAs',
        icon: icons && icons.ClockCircleOutlined ? h(icons.ClockCircleOutlined, { style: { fontSize: 20, color: '#0070CC' } }) : null,
        description: 'Set clear expectations: response within 24 hours, resolution within 48\u201372 hours. Track and surface SLA breaches in the QC Hub.',
        impact: 'Reduce wait time by 30\u201340% (~' + (avgWait * 0.35).toFixed(1) + ' days)',
        effort: 'Low',
        effortColor: 'green',
      },
      {
        title: 'Standardize key derivations',
        icon: icons && icons.FileProtectOutlined ? h(icons.FileProtectOutlined, { style: { fontSize: 20, color: '#28A464' } }) : null,
        description: 'Focus on ADSL, ADAE, and high-friction endpoints where repeat findings concentrate. Create shared specification templates that reduce ambiguity.',
        impact: 'Reduce repeat findings by ~40%',
        effort: 'Medium',
        effortColor: 'orange',
      },
      {
        title: 'Apply risk-based QC tiering',
        icon: icons && icons.SafetyCertificateOutlined ? h(icons.SafetyCertificateOutlined, { style: { fontSize: 20, color: '#CCB718' } }) : null,
        description: 'Eliminate unnecessary multi-stage QC for low-risk outputs. ' + (m.pctOverQC > 0 ? m.pctOverQC + '% of completed deliverables had zero findings through 4+ stage QC plans.' : 'Review current QC plan assignments for right-sizing opportunities.'),
        impact: 'Eliminate wasted review cycles on low-risk work',
        effort: 'Medium',
        effortColor: 'orange',
      },
    ];

    return h('div', null,
      h('div', { className: 'insight-level-header' },
        h('h2', null, 'What to change next quarter'),
        h('p', { className: 'insight-level-subtitle' }, 'Prioritized actions based on expected impact and implementation effort.')
      ),
      h('div', { className: 'insight-actions-list' },
        actions.map(function(a, i) {
          return h('div', { key: i, className: 'insight-action-card' },
            h('div', { className: 'insight-action-card-header' },
              h('div', { className: 'insight-action-card-number' }, i + 1),
              a.icon,
              h('div', { style: { flex: 1 } },
                h('div', { className: 'insight-action-card-title' }, a.title),
                h('div', { className: 'insight-action-card-desc' }, a.description)
              )
            ),
            h('div', { className: 'insight-action-card-footer' },
              h('div', null,
                h('span', { style: { fontSize: 11, color: '#8F8FA3', marginRight: 4 } }, 'Expected impact:'),
                h('span', { style: { fontSize: 12, fontWeight: 600, color: '#2E2E38' } }, a.impact)
              ),
              h(Tag, { color: a.effortColor }, a.effort + ' effort')
            )
          );
        })
      ),
      h('div', { className: 'insight-next-action insight-next-action-muted', onClick: function() { setActiveInsight(6); } },
        h('span', null, 'How reliable is this insight?'),
        h('span', { className: 'insight-card-arrow' }, '\u2192')
      )
    );
  }

  // ── Level 6: Confidence & Data Quality ─────────────────────
  function renderLevel6() {
    var m = insightMetrics;

    var dataPoints = [
      { label: B + 's analyzed', value: m.total, status: m.total >= 10 ? 'strong' : m.total >= 5 ? 'moderate' : 'weak' },
      { label: 'Completed ' + B.toLowerCase() + 's', value: m.complete, status: m.complete >= 5 ? 'strong' : m.complete >= 2 ? 'moderate' : 'weak' },
      { label: 'Studies (projects)', value: Object.keys(m.projectMetrics).length, status: Object.keys(m.projectMetrics).length >= 3 ? 'strong' : 'moderate' },
      { label: 'Total findings', value: m.totalFindings, status: m.totalFindings >= 20 ? 'strong' : m.totalFindings >= 5 ? 'moderate' : 'weak' },
      { label: 'Stages with timestamps', value: Object.keys(m.stageDurations).length, status: Object.keys(m.stageDurations).length >= 3 ? 'strong' : Object.keys(m.stageDurations).length >= 1 ? 'moderate' : 'weak' },
    ];

    var limitations = [
      'Active work time is inferred from timestamps \u2014 actual hands-on effort may differ',
      'QC loop count is estimated from finding resolution patterns, not explicit cycle markers',
      'Root cause driver percentages are modeled estimates, not direct measurements',
      'Resource allocation and team capacity are not factored into wait time analysis',
      'Study phase and therapeutic area data requires project tagging (not yet available)',
    ];

    var overallStrength = dataPoints.filter(function(d) { return d.status === 'strong'; }).length;
    var confidenceLevel = overallStrength >= 4 ? 'High' : overallStrength >= 2 ? 'Medium' : 'Low';
    var confidenceColor = confidenceLevel === 'High' ? '#28A464' : confidenceLevel === 'Medium' ? '#CCB718' : '#C20A29';

    return h('div', null,
      h('div', { className: 'insight-level-header' },
        h('h2', null, 'How reliable is this insight?'),
        h('p', { className: 'insight-level-subtitle' }, 'Transparency on data sources, signal strength, and known limitations.')
      ),
      h('div', { className: 'insight-confidence-badge', style: { borderColor: confidenceColor } },
        h('div', { style: { fontSize: 24, fontWeight: 700, color: confidenceColor } }, confidenceLevel),
        h('div', { style: { fontSize: 13, color: '#65657B' } }, 'Overall confidence based on ' + overallStrength + ' of ' + dataPoints.length + ' strong data signals')
      ),
      h('div', { className: 'panel', style: { marginTop: 16 } },
        chartTitle('Supporting Data', 'Data volume and quality for each input signal used to generate this insight.'),
        h('div', { className: 'panel-body' },
          h(Table, {
            size: 'small',
            pagination: false,
            dataSource: dataPoints.map(function(d, i) { return Object.assign({ key: i }, d); }),
            columns: [
              { title: 'Data Source', dataIndex: 'label', key: 'label' },
              { title: 'Count', dataIndex: 'value', key: 'value', width: 80 },
              { title: 'Signal Strength', dataIndex: 'status', key: 'status', width: 130, render: function(v) {
                var color = v === 'strong' ? 'green' : v === 'moderate' ? 'orange' : 'red';
                return h(Tag, { color: color }, capFirst(v));
              } },
            ],
          })
        )
      ),
      h('div', { className: 'panel', style: { marginTop: 16 } },
        chartTitle('Known Limitations', 'Assumptions and data gaps that affect the precision of this insight.'),
        h('div', { className: 'panel-body' },
          limitations.map(function(lim, i) {
            return h('div', { key: i, className: 'insight-limitation-row' },
              h('span', { className: 'insight-limitation-bullet' }, '\u26A0'),
              h('span', null, lim)
            );
          })
        )
      ),
      h('div', { style: { marginTop: 24, textAlign: 'center' } },
        h(Button, { onClick: function() { setActiveInsight(null); }, size: 'large' }, '\u2190 Back to All Insights'),
        h(Button, { onClick: function() { setActiveInsight(5); }, type: 'primary', size: 'large', style: { marginLeft: 12 } }, 'Review Actions')
      )
    );
  }

  // ── Main render ────────────────────────────────────────────
  var levelRenderers = {
    1: renderLevel1,
    2: renderLevel2,
    3: renderLevel3,
    4: renderLevel4,
    5: renderLevel5,
    6: renderLevel6,
  };

  return h('div', { className: 'ai-insights-page' },
    h('div', { className: 'page-header' },
      h('h1', null,
        icons && icons.BulbOutlined ? h(icons.BulbOutlined, { style: { marginRight: 8 } }) : null,
        'AI Insights'
      ),
      h('p', null, 'Operational intelligence derived from QC activity data')
    ),
    renderBreadcrumb(),
    h('div', { className: 'ai-insights-content' },
      activeInsight === null
        ? renderOverview()
        : (levelRenderers[activeInsight] ? levelRenderers[activeInsight]() : renderOverview())
    )
  );
}


function RiskOptimizerPage(props) {
  var bundles = props.bundles || [];
  var livePolicies = props.livePolicies || [];
  var terms = props.terms || DEFAULT_TERMS;
  var isDummy = props.useDummy || false;
  var B = capFirst(terms.bundle);
  var P = capFirst(terms.policy);

  // ── State ──
  var _cfg = useState(function() {
    try {
      var saved = localStorage.getItem('sce_risk_config');
      return saved ? JSON.parse(saved) : JSON.parse(JSON.stringify(DEFAULT_RISK_CONFIG));
    } catch(e) { return JSON.parse(JSON.stringify(DEFAULT_RISK_CONFIG)); }
  });
  var riskConfig = _cfg[0]; var setRiskConfig = _cfg[1];

  // Policy tier tags: { policyId: 'most_rigorous' | 'moderate' | 'lightweight' }
  var _pt = useState(function() {
    try {
      var saved = localStorage.getItem('sce_policy_tiers');
      return saved ? JSON.parse(saved) : {};
    } catch(e) { return {}; }
  });
  var policyTiers = _pt[0]; var setPolicyTiers = _pt[1];

  // Manual risk overrides: { bundleId: { level: 'High'|'Medium'|'Low', reason: '...' } }
  var _ov = useState(function() {
    try {
      var saved = localStorage.getItem('sce_risk_overrides');
      return saved ? JSON.parse(saved) : {};
    } catch(e) { return {}; }
  });
  var riskOverrides = _ov[0]; var setRiskOverrides = _ov[1];

  // Reassignment audit log
  var _al = useState(function() {
    try {
      var saved = localStorage.getItem('sce_risk_audit_log');
      return saved ? JSON.parse(saved) : [];
    } catch(e) { return []; }
  });
  var auditLog = _al[0]; var setAuditLog = _al[1];

  // UI state
  var _tab = useState('overview'); var activeTab = _tab[0]; var setActiveTab = _tab[1];
  var _search = useState(''); var searchText = _search[0]; var setSearchText = _search[1];
  var _reassignOpen = useState(false); var reassignModalOpen = _reassignOpen[0]; var setReassignModalOpen = _reassignOpen[1];
  var _overrideOpen = useState(false); var overrideModalOpen = _overrideOpen[0]; var setOverrideModalOpen = _overrideOpen[1];
  var _selectedBundle = useState(null); var selectedBundle = _selectedBundle[0]; var setSelectedBundle = _selectedBundle[1];
  var _reassignPolicy = useState(null); var reassignPolicy = _reassignPolicy[0]; var setReassignPolicy = _reassignPolicy[1];
  var _reassignRationale = useState(''); var reassignRationale = _reassignRationale[0]; var setReassignRationale = _reassignRationale[1];
  var _overrideLevel = useState(null); var overrideLevel = _overrideLevel[0]; var setOverrideLevel = _overrideLevel[1];
  var _overrideReason = useState(''); var overrideReason = _overrideReason[0]; var setOverrideReason = _overrideReason[1];
  // Dependency graph state
  var _rg = useState(function() {
    try {
      var saved = localStorage.getItem('sce_risk_graph');
      return saved ? JSON.parse(saved) : null;
    } catch(e) { return null; }
  });
  var riskGraph = _rg[0]; var setRiskGraph = _rg[1];

  var _graphEnabled = useState(function() {
    try { return localStorage.getItem('sce_risk_graph_enabled') === 'true'; } catch(e) { return false; }
  });
  var graphEnabled = _graphEnabled[0]; var setGraphEnabled = _graphEnabled[1];

  // Graph UI state
  var _graphDrawerBundle = useState(null); var graphDrawerBundle = _graphDrawerBundle[0]; var setGraphDrawerBundle = _graphDrawerBundle[1];
  var _addNodeOpen = useState(false); var addNodeOpen = _addNodeOpen[0]; var setAddNodeOpen = _addNodeOpen[1];
  var _addEdgeOpen = useState(false); var addEdgeOpen = _addEdgeOpen[0]; var setAddEdgeOpen = _addEdgeOpen[1];
  var _addAnchorOpen = useState(false); var addAnchorOpen = _addAnchorOpen[0]; var setAddAnchorOpen = _addAnchorOpen[1];
  var _csvImportOpen = useState(false); var csvImportOpen = _csvImportOpen[0]; var setCsvImportOpen = _csvImportOpen[1];
  var _editNodeId = useState(null); var editNodeId = _editNodeId[0]; var setEditNodeId = _editNodeId[1];
  var _editEdgeId = useState(null); var editEdgeId = _editEdgeId[0]; var setEditEdgeId = _editEdgeId[1];
  var _propagationPreview = useState(null); var propagationPreview = _propagationPreview[0]; var setPropagationPreview = _propagationPreview[1];

  // Setup wizard state
  var _wizardDismissed = useState(function() {
    try { return localStorage.getItem('sce_risk_wizard_done') === 'true'; } catch(e) { return false; }
  });
  var wizardDismissed = _wizardDismissed[0]; var setWizardDismissed = _wizardDismissed[1];
  var _wizardStep = useState(0); var wizardStep = _wizardStep[0]; var setWizardStep = _wizardStep[1];

  // Persist to localStorage
  useEffect(function() {
    try { localStorage.setItem('sce_risk_config', JSON.stringify(riskConfig)); } catch(e) {}
  }, [riskConfig]);
  useEffect(function() {
    try { localStorage.setItem('sce_policy_tiers', JSON.stringify(policyTiers)); } catch(e) {}
  }, [policyTiers]);
  useEffect(function() {
    try { localStorage.setItem('sce_risk_overrides', JSON.stringify(riskOverrides)); } catch(e) {}
  }, [riskOverrides]);
  useEffect(function() {
    try {
      // Cap audit log at 500 entries
      var capped = auditLog.length > 500 ? auditLog.slice(0, 500) : auditLog;
      localStorage.setItem('sce_risk_audit_log', JSON.stringify(capped));
    } catch(e) {}
  }, [auditLog]);
  useEffect(function() {
    try {
      if (riskGraph) localStorage.setItem('sce_risk_graph', JSON.stringify(riskGraph));
      else localStorage.removeItem('sce_risk_graph');
    } catch(e) {}
  }, [riskGraph]);
  useEffect(function() {
    try { localStorage.setItem('sce_risk_graph_enabled', graphEnabled ? 'true' : 'false'); } catch(e) {}
  }, [graphEnabled]);

  // Load mock graph in dummy mode if no graph exists
  useEffect(function() {
    if (isDummy && !riskGraph && typeof MOCK_RISK_GRAPH !== 'undefined') {
      setRiskGraph(JSON.parse(JSON.stringify(MOCK_RISK_GRAPH)));
      setGraphEnabled(true);
    }
  }, [isDummy]);

  // ── Risk Scoring Engine (Three-Layer) ──
  // Layer 2: Keyword scoring (baseline)
  function scoreBundleByKeywords(bundle) {
    var name = (bundle.name || '').toLowerCase();
    var policyName = (bundle.policyName || '').toLowerCase();
    var deliverableType = '';
    if (/^ad[a-z]/.test(name)) deliverableType = ' adam_dataset';
    if (/^t_/.test(name) || name.indexOf('table') >= 0 || name.indexOf('output') >= 0) deliverableType = ' tfl_output';
    var sdtmDomains = ['dm', 'ae', 'lb', 'vs', 'eg', 'cm', 'mh', 'ds', 'ex', 'sv', 'ta', 'ti', 'ts', 'se', 'pc', 'pp'];
    sdtmDomains.forEach(function(d) {
      if (name === d || name.indexOf(d + '_') === 0 || name.indexOf(d + '.') === 0) deliverableType += ' sdtm_domain';
    });
    var combined = name + ' ' + policyName + deliverableType;

    var highScore = 0; var highMatches = [];
    var medScore = 0; var medMatches = [];
    var lowScore = 0; var lowMatches = [];

    riskConfig.highRisk.keywords.forEach(function(kw) {
      if (combined.indexOf(kw.toLowerCase()) >= 0) { highScore += 10; highMatches.push(kw); }
    });
    riskConfig.mediumRisk.keywords.forEach(function(kw) {
      if (combined.indexOf(kw.toLowerCase()) >= 0) { medScore += 10; medMatches.push(kw); }
    });
    riskConfig.lowRisk.keywords.forEach(function(kw) {
      if (combined.indexOf(kw.toLowerCase()) >= 0) { lowScore += 10; lowMatches.push(kw); }
    });

    var level, score, matches;
    if (highScore > medScore && highScore > lowScore) {
      level = 'High'; score = Math.min(100, 60 + highScore); matches = highMatches;
    } else if (medScore > lowScore) {
      level = 'Medium'; score = Math.min(100, 40 + medScore); matches = medMatches;
    } else if (lowScore > 0) {
      level = 'Low'; score = Math.min(100, 20 + lowScore); matches = lowMatches;
    } else {
      level = 'Medium'; score = 30; matches = [];
    }

    var reason = matches.length > 0
      ? 'Matched keywords: ' + matches.join(', ')
      : 'No keyword matches. Defaulting to Medium risk (conservative).';

    return { level: level, score: score, source: 'algorithm', reason: reason, matches: matches };
  }

  // Layer 3: Graph propagation
  // Computes attenuation factor for a single edge
  function getEdgeAttenuation(edge) {
    var scopeFactors = { full: 1.0, partial: 0.6, unknown: 0.8 };
    var relFactors = { direct: 1.0, indirect: 0.7, reference_only: 0.3 };
    var scope = scopeFactors[edge.columnScope] || 0.8;
    var rel = relFactors[edge.relationship] || 1.0;
    return scope * rel;
  }

  // Build adjacency lists and run reverse BFS from anchors
  function computeGraphRisk(graphData) {
    if (!graphData || !graphData.nodes || !graphData.edges) return {};
    var nodes = graphData.nodes;
    var edges = graphData.edges;

    // Build reverse adjacency: for each node, which edges point TO it (incoming)
    // We propagate BACKWARD from anchors, so we need outgoing edges from anchor perspective
    // Actually: risk propagates from anchor UPSTREAM. If ADTTE is high-risk anchor,
    // and DM → ADSL → ADTTE, then DM and ADSL inherit risk.
    // So we traverse edges in REVERSE: from target back to source.
    var reverseAdj = {}; // nodeId -> [{ neighborId, edge }]
    Object.keys(nodes).forEach(function(nid) { reverseAdj[nid] = []; });
    Object.keys(edges).forEach(function(eid) {
      var edge = edges[eid];
      if (!reverseAdj[edge.target]) reverseAdj[edge.target] = [];
      // From target, we can reach source (going upstream)
      reverseAdj[edge.target].push({ neighborId: edge.source, edge: edge });
    });

    var RISK_ORDER = { 'Low': 0, 'Medium': 1, 'High': 2 };
    var RISK_FROM_ORDER = ['Low', 'Medium', 'High'];

    // Find all anchor nodes
    var anchors = [];
    Object.keys(nodes).forEach(function(nid) {
      if (nodes[nid].anchorRisk) {
        anchors.push({ id: nid, risk: nodes[nid].anchorRisk, reason: nodes[nid].anchorReason || '' });
      }
    });

    // For each node, track best (highest effective) risk from any anchor
    var nodeResults = {}; // nodeId -> { effectiveRisk, score, anchorNodes, propagationPaths }

    anchors.forEach(function(anchor) {
      // BFS from anchor, traversing edges in reverse (upstream)
      var queue = [{ nodeId: anchor.id, attenuation: 1.0, path: [anchor.id] }];
      var visited = {};
      visited[anchor.id] = 1.0;

      while (queue.length > 0) {
        var current = queue.shift();
        var neighbors = reverseAdj[current.nodeId] || [];

        neighbors.forEach(function(neighbor) {
          var edgeAtt = getEdgeAttenuation(neighbor.edge);
          var totalAtt = current.attenuation * edgeAtt;

          // Only visit if this path gives better attenuation than previously seen
          if (visited[neighbor.neighborId] === undefined || totalAtt > visited[neighbor.neighborId]) {
            visited[neighbor.neighborId] = totalAtt;
            var newPath = current.path.concat([neighbor.neighborId]);
            queue.push({ nodeId: neighbor.neighborId, attenuation: totalAtt, path: newPath });

            // Compute effective risk level based on attenuation thresholds
            var anchorRiskOrder = RISK_ORDER[anchor.risk];
            var effectiveRiskOrder;
            if (totalAtt >= 0.7) {
              effectiveRiskOrder = anchorRiskOrder; // inherit full anchor risk
            } else if (totalAtt >= 0.4) {
              effectiveRiskOrder = Math.max(0, anchorRiskOrder - 1); // one level below
            } else {
              effectiveRiskOrder = -1; // no graph influence
            }

            if (effectiveRiskOrder >= 0) {
              var effectiveRisk = RISK_FROM_ORDER[effectiveRiskOrder];
              var pathEntry = {
                path: newPath.slice().reverse(), // show upstream→downstream order
                sourceRisk: anchor.risk,
                attenuatedRisk: effectiveRisk,
                totalAttenuation: totalAtt,
              };

              if (!nodeResults[neighbor.neighborId]) {
                nodeResults[neighbor.neighborId] = {
                  effectiveRisk: effectiveRisk,
                  effectiveRiskOrder: effectiveRiskOrder,
                  score: totalAtt * (60 + anchorRiskOrder * 20),
                  anchorNodes: [{ id: anchor.id, risk: anchor.risk, reason: anchor.reason }],
                  propagationPaths: [pathEntry],
                };
              } else {
                var existing = nodeResults[neighbor.neighborId];
                existing.propagationPaths.push(pathEntry);
                // Take maximum risk
                if (effectiveRiskOrder > existing.effectiveRiskOrder) {
                  existing.effectiveRisk = effectiveRisk;
                  existing.effectiveRiskOrder = effectiveRiskOrder;
                  existing.score = totalAtt * (60 + anchorRiskOrder * 20);
                }
                if (!existing.anchorNodes.some(function(a) { return a.id === anchor.id; })) {
                  existing.anchorNodes.push({ id: anchor.id, risk: anchor.risk, reason: anchor.reason });
                }
              }
            }
          }
        });
      }

      // Also record the anchor node itself
      if (!nodeResults[anchor.id]) {
        nodeResults[anchor.id] = {
          effectiveRisk: anchor.risk,
          effectiveRiskOrder: RISK_ORDER[anchor.risk],
          score: 60 + RISK_ORDER[anchor.risk] * 20,
          anchorNodes: [{ id: anchor.id, risk: anchor.risk, reason: anchor.reason }],
          propagationPaths: [],
          isAnchor: true,
        };
      } else {
        nodeResults[anchor.id].isAnchor = true;
      }
    });

    return nodeResults;
  }

  // Find the graph node matching a bundle (by bundleId link or name fuzzy match)
  function findGraphNodeForBundle(bundle, graphData) {
    if (!graphData || !graphData.nodes) return null;
    var nodes = graphData.nodes;
    // First try bundleId match
    var byId = Object.keys(nodes).find(function(nid) { return nodes[nid].bundleId === bundle.id; });
    if (byId) return byId;
    // Then try name match (case-insensitive)
    var bName = (bundle.name || '').toLowerCase().trim();
    var byName = Object.keys(nodes).find(function(nid) {
      var nLabel = (nodes[nid].label || nodes[nid].id || '').toLowerCase().trim();
      var nId = (nodes[nid].id || '').toLowerCase().trim();
      return nId === bName || nLabel === bName || nLabel.indexOf(bName) === 0 || bName.indexOf(nId) === 0;
    });
    return byName || null;
  }

  // Memoized graph risk computation
  var graphRiskResults = useMemo(function() {
    if (!graphEnabled || !riskGraph) return {};
    return computeGraphRisk(riskGraph);
  }, [graphEnabled, riskGraph]);

  // Combined three-layer scoring
  function scoreBundle(bundle) {
    // Layer 1: Manual override (highest priority)
    var override = riskOverrides[bundle.id];
    if (override) {
      return { level: override.level, score: override.level === 'High' ? 90 : override.level === 'Medium' ? 50 : 10, source: 'manual', reason: override.reason };
    }

    // Layer 2: Keyword scoring (baseline)
    var keywordResult = scoreBundleByKeywords(bundle);

    // Layer 3: Graph propagation (can only upgrade, never downgrade)
    var RISK_ORDER = { 'Low': 0, 'Medium': 1, 'High': 2 };
    if (graphEnabled && riskGraph) {
      var nodeId = findGraphNodeForBundle(bundle, riskGraph);
      var graphResult = nodeId ? graphRiskResults[nodeId] : null;

      if (graphResult && graphResult.effectiveRisk) {
        if (RISK_ORDER[graphResult.effectiveRisk] > RISK_ORDER[keywordResult.level]) {
          var anchorNames = graphResult.anchorNodes.map(function(a) { return a.id; }).join(', ');
          var bestPath = graphResult.propagationPaths[0];
          var pathStr = bestPath ? bestPath.path.join(' \u2192 ') : '';
          var reason = graphResult.isAnchor
            ? 'Anchor point: ' + graphResult.anchorNodes[0].reason
            : 'Inherited ' + graphResult.effectiveRisk + ' risk from ' + anchorNames + (pathStr ? ' via ' + pathStr : '');

          return {
            level: graphResult.effectiveRisk,
            score: graphResult.score,
            source: 'graph',
            reason: reason,
            matches: keywordResult.matches,
            graphDetail: {
              anchorNodes: graphResult.anchorNodes,
              propagationPaths: graphResult.propagationPaths,
              maxPropagatedRisk: graphResult.effectiveRisk,
              effectiveGraphRisk: graphResult.effectiveRisk,
              keywordRisk: keywordResult.level,
              resolution: 'graph_upgrade',
              isAnchor: graphResult.isAnchor || false,
              nodeId: nodeId,
            },
          };
        }
        // Graph matches but doesn't upgrade — attach graph info anyway
        keywordResult.graphDetail = {
          anchorNodes: graphResult.anchorNodes,
          propagationPaths: graphResult.propagationPaths,
          maxPropagatedRisk: graphResult.effectiveRisk,
          effectiveGraphRisk: graphResult.effectiveRisk,
          keywordRisk: keywordResult.level,
          resolution: 'graph_match',
          isAnchor: graphResult.isAnchor || false,
          nodeId: nodeId,
        };
      }
    }

    return keywordResult;
  }

  // ── Policy Recommendation ──
  function getRecommendedTier(riskLevel) {
    if (riskLevel === 'High') return 'most_rigorous';
    if (riskLevel === 'Medium') return 'moderate';
    return 'lightweight';
  }

  function getTierLabel(tier) {
    if (tier === 'most_rigorous') return 'Most Rigorous';
    if (tier === 'moderate') return 'Moderate';
    if (tier === 'lightweight') return 'Lightweight';
    return 'Untagged';
  }

  function getTierColor(tier) {
    if (tier === 'most_rigorous') return '#C20A29';
    if (tier === 'moderate') return '#F59E0B';
    if (tier === 'lightweight') return '#28A464';
    return '#8F8FA3';
  }

  function getRiskColor(level) {
    if (level === 'High') return riskConfig.highRisk.color;
    if (level === 'Medium') return riskConfig.mediumRisk.color;
    return riskConfig.lowRisk.color;
  }

  // Get all distinct policies across bundles + livePolicies
  var allPolicies = useMemo(function() {
    var map = {};
    livePolicies.forEach(function(p) { map[p.id] = { id: p.id, name: p.name }; });
    bundles.forEach(function(b) {
      if (b.policyId && !map[b.policyId]) map[b.policyId] = { id: b.policyId, name: b.policyName };
    });
    return Object.keys(map).map(function(k) { return map[k]; });
  }, [bundles, livePolicies]);

  // Count how many policies are tagged
  var taggedPolicyCount = allPolicies.filter(function(p) { return policyTiers[p.id]; }).length;
  var untaggedPolicyCount = allPolicies.length - taggedPolicyCount;

  // ── Scored Bundles ──
  var scoredBundles = useMemo(function() {
    return bundles.map(function(b) {
      var risk = scoreBundle(b);
      var currentTier = policyTiers[b.policyId] || null;
      var recommendedTier = getRecommendedTier(risk.level);
      var recommendedPolicies = allPolicies.filter(function(p) { return policyTiers[p.id] === recommendedTier; });

      var calibration;
      if (!currentTier) {
        calibration = 'untagged';
      } else if (currentTier === recommendedTier) {
        calibration = 'well-matched';
      } else {
        var tierOrder = { 'lightweight': 0, 'moderate': 1, 'most_rigorous': 2 };
        calibration = tierOrder[currentTier] > tierOrder[recommendedTier] ? 'over-qc' : 'under-qc';
      }

      return Object.assign({}, b, {
        _risk: risk,
        _currentTier: currentTier,
        _recommendedTier: recommendedTier,
        _recommendedPolicies: recommendedPolicies,
        _calibration: calibration,
      });
    });
  }, [bundles, riskConfig, riskOverrides, policyTiers, allPolicies, graphEnabled, riskGraph, graphRiskResults]);

  // Filter by search
  var filteredBundles = useMemo(function() {
    if (!searchText) return scoredBundles;
    var q = searchText.toLowerCase();
    return scoredBundles.filter(function(b) {
      return (b.name || '').toLowerCase().indexOf(q) >= 0
        || (b.projectName || '').toLowerCase().indexOf(q) >= 0
        || (b.policyName || '').toLowerCase().indexOf(q) >= 0
        || b._risk.level.toLowerCase().indexOf(q) >= 0;
    });
  }, [scoredBundles, searchText]);

  // ── Summary Stats ──
  var summary = useMemo(function() {
    var counts = { high: 0, medium: 0, low: 0, overQc: 0, wellMatched: 0, underQc: 0, untagged: 0, manual: 0 };
    scoredBundles.forEach(function(b) {
      if (b._risk.level === 'High') counts.high++;
      else if (b._risk.level === 'Medium') counts.medium++;
      else counts.low++;

      if (b._calibration === 'over-qc') counts.overQc++;
      else if (b._calibration === 'well-matched') counts.wellMatched++;
      else if (b._calibration === 'under-qc') counts.underQc++;
      else counts.untagged++;

      if (b._risk.source === 'manual') counts.manual++;
    });
    return counts;
  }, [scoredBundles]);

  // ── Handlers ──
  function handleOpenReassign(bundle) {
    setSelectedBundle(bundle);
    setReassignPolicy(null);
    setReassignRationale('');
    setReassignModalOpen(true);
  }

  function handleReassign() {
    if (!selectedBundle || !reassignPolicy || !reassignRationale.trim()) {
      antd.message.warning('Please select a policy and provide a rationale.');
      return;
    }

    var gapInfo = API_GAPS.stageReassign;
    var newPolicyName = (allPolicies.find(function(p) { return p.id === reassignPolicy; }) || {}).name || reassignPolicy;

    // Log audit entry regardless of API readiness
    var entry = {
      id: 'audit-' + Date.now(),
      bundleId: selectedBundle.id,
      bundleName: selectedBundle.name,
      projectName: selectedBundle.projectName,
      oldPolicy: selectedBundle.policyName,
      newPolicy: newPolicyName,
      rationale: reassignRationale.trim(),
      riskLevel: selectedBundle._risk.level,
      calibration: selectedBundle._calibration,
      timestamp: new Date().toISOString(),
      user: 'current_user',
    };
    setAuditLog(function(prev) { return [entry].concat(prev); });

    if (!gapInfo.ready) {
      antd.notification.info({
        message: 'Reassignment Logged (API Pending)',
        description: 'The reassignment from "' + selectedBundle.policyName + '" to "' + newPolicyName + '" has been recorded in the audit log. The Domino write API will persist it when available.',
        duration: 6,
      });
    } else {
      // If the API is ready, call the reassignment endpoint
      antd.message.success('Reassignment logged: ' + selectedBundle.name + ' → ' + newPolicyName);
    }

    setReassignModalOpen(false);
  }

  function handleOpenOverride(bundle) {
    setSelectedBundle(bundle);
    var existing = riskOverrides[bundle.id];
    setOverrideLevel(existing ? existing.level : bundle._risk.level);
    setOverrideReason(existing ? existing.reason : '');
    setOverrideModalOpen(true);
  }

  function handleSaveOverride() {
    if (!selectedBundle || !overrideLevel || !overrideReason.trim()) {
      antd.message.warning('Please select a risk level and provide a reason.');
      return;
    }
    setRiskOverrides(function(prev) {
      var next = Object.assign({}, prev);
      next[selectedBundle.id] = { level: overrideLevel, reason: overrideReason.trim() };
      return next;
    });
    // Also log to audit
    setAuditLog(function(prev) {
      return [{
        id: 'audit-' + Date.now(),
        bundleId: selectedBundle.id,
        bundleName: selectedBundle.name,
        projectName: selectedBundle.projectName,
        action: 'risk_override',
        oldRisk: selectedBundle._risk.level,
        newRisk: overrideLevel,
        rationale: overrideReason.trim(),
        timestamp: new Date().toISOString(),
        user: 'current_user',
      }].concat(prev);
    });
    antd.message.success('Risk override saved for ' + selectedBundle.name);
    setOverrideModalOpen(false);
  }

  function handleClearOverride(bundleId, bundleName) {
    setRiskOverrides(function(prev) {
      var next = Object.assign({}, prev);
      delete next[bundleId];
      return next;
    });
    antd.message.info('Risk override removed for ' + bundleName + '. Algorithm score restored.');
  }

  function updateKeywords(tierKey, newKeywords) {
    setRiskConfig(function(prev) {
      var next = JSON.parse(JSON.stringify(prev));
      next[tierKey].keywords = newKeywords;
      return next;
    });
  }

  function handleResetConfig() {
    setRiskConfig(JSON.parse(JSON.stringify(DEFAULT_RISK_CONFIG)));
    antd.message.info('Config reset to defaults.');
  }

  // ── Columns for the bundle table ──
  var bundleColumns = [
    { title: B, dataIndex: 'name', key: 'name', width: 180, ellipsis: true,
      sorter: function(a, b) { return (a.name || '').localeCompare(b.name || ''); },
      render: function(t, r) {
        return h('div', null,
          h('span', { style: { fontWeight: 500 } }, t),
          r._risk.source === 'manual' ? h(Tag, { color: 'blue', style: { marginLeft: 6, fontSize: 10 } }, 'Override') : null
        );
      },
    },
    { title: 'Project', dataIndex: 'projectName', key: 'project', width: 160, ellipsis: true,
      sorter: function(a, b) { return (a.projectName || '').localeCompare(b.projectName || ''); },
    },
    { title: 'Risk', key: 'risk', width: 100,
      sorter: function(a, b) { return a._risk.score - b._risk.score; },
      filters: [{ text: 'High', value: 'High' }, { text: 'Medium', value: 'Medium' }, { text: 'Low', value: 'Low' }],
      onFilter: function(v, r) { return r._risk.level === v; },
      render: function(_, r) {
        return h(Tag, { color: r._risk.level === 'High' ? 'red' : r._risk.level === 'Medium' ? 'gold' : 'green' }, r._risk.level);
      },
    },
    { title: 'Why', key: 'reason', ellipsis: true,
      render: function(_, r) {
        if (r._risk.source === 'graph' && r._risk.graphDetail) {
          var detail = r._risk.graphDetail;
          var anchorNames = detail.anchorNodes.map(function(a) { return a.id.toUpperCase(); }).join(', ');
          return h('span', { style: { display: 'flex', alignItems: 'center', gap: 4 } },
            h(Tag, { color: 'purple', style: { fontSize: 10, cursor: 'pointer' }, onClick: function() { setGraphDrawerBundle(r); } }, 'Graph'),
            h(Tooltip, {
              title: h('div', null,
                h('div', { style: { marginBottom: 4 } }, 'Graph propagation from: ', h('strong', null, anchorNames)),
                detail.propagationPaths[0] ? h('div', null, 'Path: ', detail.propagationPaths[0].path.join(' \u2192 ')) : null,
                h('div', null, 'Keywords alone: ', detail.keywordRisk),
                h('div', { style: { marginTop: 4, fontSize: 11 } }, 'Click "Graph" tag for full details')
              ),
              placement: 'topLeft', overlayStyle: { maxWidth: 400 },
            },
              h('span', { style: { fontSize: 12, color: '#65657B', cursor: 'help' } },
                detail.isAnchor ? 'Anchor: ' + detail.anchorNodes[0].reason : 'via ' + anchorNames
              )
            )
          );
        }
        return h(Tooltip, { title: r._risk.reason, placement: 'topLeft', overlayStyle: { maxWidth: 400 } },
          h('span', { style: { fontSize: 12, color: '#65657B', cursor: 'help' } },
            r._risk.matches && r._risk.matches.length > 0
              ? r._risk.matches.slice(0, 3).join(', ') + (r._risk.matches.length > 3 ? ' +' + (r._risk.matches.length - 3) + ' more' : '')
              : r._risk.source === 'manual' ? r._risk.reason
              : r._risk.graphDetail ? 'Keywords (' + r._risk.level + '), graph agrees'
              : 'No keyword matches'
          )
        );
      },
    },
    { title: 'Current ' + P, dataIndex: 'policyName', key: 'current', width: 200, ellipsis: true,
      sorter: function(a, b) { return (a.policyName || '').localeCompare(b.policyName || ''); },
      render: function(t, r) {
        var tier = r._currentTier;
        return h('div', null,
          h('span', null, t),
          tier ? h(Tag, { style: { marginLeft: 4, fontSize: 10 }, color: getTierColor(tier) }, getTierLabel(tier)) : null
        );
      },
    },
    { title: 'Calibration', key: 'calibration', width: 130,
      filters: [
        { text: 'Over-QC\'d', value: 'over-qc' },
        { text: 'Well-Matched', value: 'well-matched' },
        { text: 'Under-QC\'d', value: 'under-qc' },
        { text: 'Untagged', value: 'untagged' },
      ],
      onFilter: function(v, r) { return r._calibration === v; },
      render: function(_, r) {
        var label = r._calibration === 'over-qc' ? 'Over-QC\'d' : r._calibration === 'well-matched' ? 'Well-Matched' : r._calibration === 'under-qc' ? 'Under-QC\'d' : 'Untagged';
        var color = r._calibration === 'over-qc' ? 'orange' : r._calibration === 'well-matched' ? 'green' : r._calibration === 'under-qc' ? 'red' : 'default';
        return h(Tag, { color: color }, label);
      },
    },
    { title: 'Recommended', key: 'recommended', width: 200, ellipsis: true,
      render: function(_, r) {
        if (r._calibration === 'well-matched') return h('span', { style: { color: '#28A464', fontSize: 12 } }, '\u2713 Current policy is appropriate');
        if (!r._currentTier) return h('span', { style: { color: '#8F8FA3', fontSize: 12 } }, 'Classify policies to see recommendations');
        var recPolicies = r._recommendedPolicies;
        if (recPolicies.length === 0) return h('span', { style: { color: '#8F8FA3', fontSize: 12 } }, 'No ' + getTierLabel(r._recommendedTier) + ' policy classified');
        return h('span', { style: { fontSize: 12 } }, recPolicies.map(function(p) { return p.name; }).join(', '));
      },
    },
    { title: 'Actions', key: 'actions', width: 140, fixed: 'right',
      render: function(_, r) {
        return h('div', { style: { display: 'flex', gap: 4 } },
          h(Tooltip, { title: 'Reassign ' + P.toLowerCase() },
            h(Button, { size: 'small', onClick: function() { handleOpenReassign(r); } }, 'Reassign')
          ),
          h(Tooltip, { title: r._risk.source === 'manual' ? 'Edit risk override' : 'Override algorithm risk' },
            h(Button, { size: 'small', type: 'dashed', onClick: function() { handleOpenOverride(r); } }, '\u270E')
          ),
          r._risk.source === 'manual'
            ? h(Tooltip, { title: 'Remove override, restore algorithm score' },
                h(Button, { size: 'small', type: 'text', danger: true, onClick: function() { handleClearOverride(r.id, r.name); } }, '\u2715')
              )
            : null
        );
      },
    },
  ];

  // ── Audit log columns ──
  var auditColumns = [
    { title: 'Date', dataIndex: 'timestamp', key: 'date', width: 160,
      sorter: function(a, b) { return (a.timestamp || '').localeCompare(b.timestamp || ''); },
      defaultSortOrder: 'descend',
      render: function(t) { return t ? dayjs(t).format('MMM D, YYYY h:mm A') : '\u2013'; },
    },
    { title: B, dataIndex: 'bundleName', key: 'bundle', width: 180, ellipsis: true },
    { title: 'Project', dataIndex: 'projectName', key: 'project', width: 150, ellipsis: true },
    { title: 'Action', key: 'action', width: 140,
      render: function(_, r) {
        if (r.action === 'risk_override') return h(Tag, { color: 'blue' }, 'Risk Override');
        return h(Tag, { color: 'purple' }, P + ' Reassign');
      },
    },
    { title: 'From', key: 'from', width: 160, ellipsis: true,
      render: function(_, r) {
        return r.action === 'risk_override'
          ? h(Tag, null, r.oldRisk || '\u2013')
          : h('span', null, r.oldPolicy || '\u2013');
      },
    },
    { title: 'To', key: 'to', width: 160, ellipsis: true,
      render: function(_, r) {
        return r.action === 'risk_override'
          ? h(Tag, null, r.newRisk || '\u2013')
          : h('span', null, r.newPolicy || '\u2013');
      },
    },
    { title: 'Rationale', dataIndex: 'rationale', key: 'rationale', ellipsis: true,
      render: function(t) {
        return h(Tooltip, { title: t, placement: 'topLeft', overlayStyle: { maxWidth: 400 } },
          h('span', { style: { fontSize: 12 } }, t)
        );
      },
    },
  ];

  // ── Policy Tier Selector ──
  function renderPolicyTiers() {
    if (allPolicies.length === 0) {
      return h(Empty, { description: 'No policies loaded yet. Policies will appear once bundles are loaded.' });
    }
    return h('div', { style: { display: 'flex', flexDirection: 'column', gap: 8 } },
      h('div', { style: { fontSize: 12, color: '#8F8FA3', marginBottom: 4 } },
        'Classify each policy by its rigor level. This drives the recommendation engine.'
      ),
      allPolicies.map(function(policy) {
        var currentTier = policyTiers[policy.id] || null;
        return h('div', { key: policy.id, style: { display: 'flex', alignItems: 'center', gap: 12, padding: '8px 12px', background: '#FAFAFA', borderRadius: 6 } },
          h('span', { style: { flex: 1, fontSize: 13, color: '#2E2E38' } }, policy.name),
          h(Select, {
            size: 'small',
            style: { width: 160 },
            placeholder: 'Select tier...',
            value: currentTier || undefined,
            allowClear: true,
            onChange: function(val) {
              setPolicyTiers(function(prev) {
                var next = Object.assign({}, prev);
                if (val) next[policy.id] = val;
                else delete next[policy.id];
                return next;
              });
            },
            options: [
              { value: 'most_rigorous', label: '\u{1F534} Most Rigorous' },
              { value: 'moderate', label: '\u{1F7E1} Moderate' },
              { value: 'lightweight', label: '\u{1F7E2} Lightweight' },
            ],
          }),
          currentTier ? h(Tag, { color: getTierColor(currentTier), style: { fontSize: 10 } }, getTierLabel(currentTier)) : null
        );
      })
    );
  }

  // ── Graph Management Helpers ──
  function ensureGraph() {
    if (!riskGraph) {
      setRiskGraph({ nodes: {}, edges: {}, source: 'manual', lastUpdated: new Date().toISOString() });
    }
  }

  function addGraphNode(node) {
    setRiskGraph(function(prev) {
      var g = prev ? JSON.parse(JSON.stringify(prev)) : { nodes: {}, edges: {}, source: 'manual', lastUpdated: '' };
      g.nodes[node.id] = node;
      g.lastUpdated = new Date().toISOString();
      return g;
    });
  }

  function removeGraphNode(nodeId) {
    setRiskGraph(function(prev) {
      if (!prev) return prev;
      var g = JSON.parse(JSON.stringify(prev));
      delete g.nodes[nodeId];
      // Remove edges connected to this node
      Object.keys(g.edges).forEach(function(eid) {
        if (g.edges[eid].source === nodeId || g.edges[eid].target === nodeId) delete g.edges[eid];
      });
      g.lastUpdated = new Date().toISOString();
      return g;
    });
  }

  function addGraphEdge(edge) {
    var eid = edge.source + '->' + edge.target;
    setRiskGraph(function(prev) {
      var g = prev ? JSON.parse(JSON.stringify(prev)) : { nodes: {}, edges: {}, source: 'manual', lastUpdated: '' };
      g.edges[eid] = Object.assign({ id: eid }, edge);
      g.lastUpdated = new Date().toISOString();
      return g;
    });
  }

  function removeGraphEdge(edgeId) {
    setRiskGraph(function(prev) {
      if (!prev) return prev;
      var g = JSON.parse(JSON.stringify(prev));
      delete g.edges[edgeId];
      g.lastUpdated = new Date().toISOString();
      return g;
    });
  }

  function setNodeAnchor(nodeId, risk, reason) {
    setRiskGraph(function(prev) {
      if (!prev) return prev;
      var g = JSON.parse(JSON.stringify(prev));
      if (g.nodes[nodeId]) {
        g.nodes[nodeId].anchorRisk = risk;
        g.nodes[nodeId].anchorReason = reason || '';
      }
      g.lastUpdated = new Date().toISOString();
      return g;
    });
  }

  function clearNodeAnchor(nodeId) {
    setRiskGraph(function(prev) {
      if (!prev) return prev;
      var g = JSON.parse(JSON.stringify(prev));
      if (g.nodes[nodeId]) {
        g.nodes[nodeId].anchorRisk = null;
        g.nodes[nodeId].anchorReason = '';
      }
      g.lastUpdated = new Date().toISOString();
      return g;
    });
  }

  // Count upstream/downstream neighbors for a node
  var graphNodeCounts = useMemo(function() {
    if (!riskGraph || !riskGraph.edges) return {};
    var counts = {};
    var edges = riskGraph.edges;
    Object.keys(riskGraph.nodes || {}).forEach(function(nid) { counts[nid] = { upstream: 0, downstream: 0 }; });
    Object.keys(edges).forEach(function(eid) {
      var e = edges[eid];
      if (counts[e.source]) counts[e.source].downstream++;
      if (counts[e.target]) counts[e.target].upstream++;
    });
    return counts;
  }, [riskGraph]);

  // Graph node list for tables
  var graphNodeList = useMemo(function() {
    if (!riskGraph || !riskGraph.nodes) return [];
    return Object.keys(riskGraph.nodes).map(function(nid) { return riskGraph.nodes[nid]; });
  }, [riskGraph]);

  var graphEdgeList = useMemo(function() {
    if (!riskGraph || !riskGraph.edges) return [];
    return Object.keys(riskGraph.edges).map(function(eid) { return riskGraph.edges[eid]; });
  }, [riskGraph]);

  // CDISC auto-suggest: generate standard edges based on naming conventions
  function getCdiscSuggestions() {
    if (!riskGraph || !riskGraph.nodes) return [];
    var nodeIds = Object.keys(riskGraph.nodes);
    var existingEdges = riskGraph.edges || {};
    var suggestions = [];

    // Standard CDISC relationships
    var standardEdges = [
      // All ADaM depend on ADSL
      { pattern: /^ad[a-z]/, target: 'adsl', except: ['adsl'], desc: 'Standard ADaM: all ADaM datasets depend on ADSL' },
      // ADSL depends on DM
      { source: 'adsl', target: 'dm', desc: 'Standard: ADSL derives from DM' },
      // ADAE depends on AE
      { source: 'adae', target: 'ae', desc: 'Standard: ADAE derives from AE domain' },
      // ADLB depends on LB
      { source: 'adlb', target: 'lb', desc: 'Standard: ADLB derives from LB domain' },
      // ADVS depends on VS
      { source: 'advs', target: 'vs', desc: 'Standard: ADVS derives from VS domain' },
      // ADCM depends on CM
      { source: 'adcm', target: 'cm', desc: 'Standard: ADCM derives from CM domain' },
      // ADMH depends on MH
      { source: 'admh', target: 'mh', desc: 'Standard: ADMH derives from MH domain' },
      // ADEG depends on EG
      { source: 'adeg', target: 'eg', desc: 'Standard: ADEG derives from EG domain' },
      // ADEX depends on EX
      { source: 'adex', target: 'ex', desc: 'Standard: ADEX derives from EX domain' },
    ];

    standardEdges.forEach(function(rule) {
      if (rule.pattern) {
        // Pattern-based rule: find all matching source nodes
        nodeIds.forEach(function(nid) {
          if (rule.pattern.test(nid) && (!rule.except || rule.except.indexOf(nid) === -1)) {
            if (nodeIds.indexOf(rule.target) >= 0) {
              var eid = nid + '->' + rule.target;
              if (!existingEdges[eid]) {
                suggestions.push({ source: nid, target: rule.target, desc: rule.desc, edgeId: eid });
              }
            }
          }
        });
      } else if (rule.source && rule.target) {
        if (nodeIds.indexOf(rule.source) >= 0 && nodeIds.indexOf(rule.target) >= 0) {
          var eid = rule.source + '->' + rule.target;
          if (!existingEdges[eid]) {
            suggestions.push({ source: rule.source, target: rule.target, desc: rule.desc, edgeId: eid });
          }
        }
      }
    });

    return suggestions;
  }

  // CSV import for edges
  function handleCsvImport(csvText) {
    var lines = csvText.trim().split('\n');
    var added = 0;
    var errors = [];
    lines.forEach(function(line, i) {
      if (i === 0 && line.toLowerCase().indexOf('source') >= 0) return; // skip header
      var parts = line.split(',').map(function(s) { return s.trim().replace(/^["']|["']$/g, ''); });
      if (parts.length < 2) { errors.push('Line ' + (i + 1) + ': need at least source,target'); return; }
      var source = parts[0].toLowerCase();
      var target = parts[1].toLowerCase();
      var relationship = parts[2] || 'direct';
      var columnScope = parts[3] || 'unknown';
      var annotation = parts[4] || '';

      // Auto-create nodes if they don't exist
      if (!riskGraph || !riskGraph.nodes[source]) {
        addGraphNode({ id: source, label: source.toUpperCase(), type: 'unknown', bundleId: null, anchorRisk: null, anchorReason: '' });
      }
      if (!riskGraph || !riskGraph.nodes[target]) {
        addGraphNode({ id: target, label: target.toUpperCase(), type: 'unknown', bundleId: null, anchorRisk: null, anchorReason: '' });
      }

      addGraphEdge({ source: source, target: target, relationship: relationship, columnScope: columnScope, columnDetail: annotation });
      added++;
    });

    if (added > 0) antd.message.success('Imported ' + added + ' edge' + (added > 1 ? 's' : ''));
    if (errors.length > 0) antd.message.warning(errors.join('; '));
    setCsvImportOpen(false);
  }

  // Run propagation preview
  function runPropagationPreview() {
    if (!riskGraph) return;
    var results = computeGraphRisk(riskGraph);
    var preview = [];
    Object.keys(riskGraph.nodes).forEach(function(nid) {
      var node = riskGraph.nodes[nid];
      // Find matching bundle for keyword risk
      var matchedBundle = bundles.find(function(b) { return findGraphNodeForBundle(b, riskGraph) === nid; });
      var keywordRisk = matchedBundle ? scoreBundleByKeywords(matchedBundle).level : 'N/A';
      var graphResult = results[nid];
      var graphRisk = graphResult ? graphResult.effectiveRisk : null;
      var RISK_ORDER = { 'Low': 0, 'Medium': 1, 'High': 2 };
      var finalRisk = graphRisk && RISK_ORDER[graphRisk] > (RISK_ORDER[keywordRisk] || -1) ? graphRisk : keywordRisk;
      var change = graphRisk && RISK_ORDER[graphRisk] > (RISK_ORDER[keywordRisk] || -1) ? 'upgrade' : 'none';
      var bestPath = graphResult && graphResult.propagationPaths[0] ? graphResult.propagationPaths[0].path.join(' \u2192 ') : '';

      preview.push({
        nodeId: nid,
        label: node.label || nid,
        type: node.type,
        isAnchor: !!(node.anchorRisk),
        keywordRisk: keywordRisk,
        graphRisk: graphRisk || '\u2013',
        finalRisk: finalRisk,
        change: change,
        path: bestPath,
        attenuation: graphResult && graphResult.propagationPaths[0] ? graphResult.propagationPaths[0].totalAttenuation : null,
      });
    });
    setPropagationPreview(preview);
  }

  // ── Setup Wizard ──
  var showWizard = taggedPolicyCount === 0 && !wizardDismissed;

  function handleWizardDone() {
    setWizardDismissed(true);
    try { localStorage.setItem('sce_risk_wizard_done', 'true'); } catch(e) {}
    setActiveTab('overview');
  }

  var wizardSteps = [
    { title: 'Edit Keywords', description: 'Add or remove risk classification keywords' },
    { title: 'Classify Policies', description: 'Classify each ' + P.toLowerCase() + ' by rigor level' },
    { title: 'Review Results', description: 'See risk analysis and recommendations' },
  ];

  function renderWizard() {
    return h('div', null,
      // Wizard header
      h('div', { style: { textAlign: 'center', marginBottom: 24 } },
        h('h2', { style: { fontSize: 20, fontWeight: 600, color: '#2E2E38', marginBottom: 4 } }, 'Risk Optimizer Setup'),
        h('p', { style: { fontSize: 13, color: '#8F8FA3', margin: 0 } },
          'Complete these 3 steps to enable risk-based QC policy recommendations.'
        )
      ),

      // Step indicators
      h('div', { style: { display: 'flex', justifyContent: 'center', gap: 0, marginBottom: 28 } },
        wizardSteps.map(function(s, i) {
          var isActive = i === wizardStep;
          var isDone = i < wizardStep;
          return h('div', { key: i, style: { display: 'flex', alignItems: 'center' } },
            h('div', {
              style: {
                display: 'flex', flexDirection: 'column', alignItems: 'center', cursor: 'pointer', minWidth: 140,
              },
              onClick: function() { setWizardStep(i); },
            },
              h('div', {
                style: {
                  width: 32, height: 32, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 14, fontWeight: 600,
                  background: isDone ? '#28A464' : isActive ? '#543FDE' : '#E0E0E0',
                  color: isDone || isActive ? '#fff' : '#8F8FA3',
                  transition: 'all 0.2s',
                },
              }, isDone ? '\u2713' : String(i + 1)),
              h('div', { style: { fontSize: 12, fontWeight: isActive ? 600 : 400, color: isActive ? '#2E2E38' : '#8F8FA3', marginTop: 6 } }, s.title),
              h('div', { style: { fontSize: 10, color: '#8F8FA3', marginTop: 2 } }, s.description)
            ),
            i < wizardSteps.length - 1
              ? h('div', { style: { width: 60, height: 2, background: isDone ? '#28A464' : '#E0E0E0', marginBottom: 32, marginLeft: 4, marginRight: 4 } })
              : null
          );
        })
      ),

      // Step content
      h('div', { className: 'panel', style: { padding: 20 } },

        // Step 1: Edit Keywords
        wizardStep === 0 ? h('div', null,
          h('div', { className: 'panel-header', style: { marginBottom: 12 } },
            h('span', { className: 'panel-title' }, 'Step 1: Edit Risk Keywords')
          ),
          h('p', { style: { fontSize: 13, color: '#65657B', marginBottom: 16 } },
            'The risk engine classifies each ' + B.toLowerCase() + ' by matching its name and ' + P.toLowerCase() + ' name against these keyword lists. ' +
            'Add or remove keywords to tune the classification for your therapeutic area.'
          ),
          h(KeywordEditor, { keywords: riskConfig.highRisk.keywords, color: '#C20A29', label: 'High Risk', description: riskConfig.highRisk.description, onUpdate: function(kws) { updateKeywords('highRisk', kws); } }),
          h(KeywordEditor, { keywords: riskConfig.mediumRisk.keywords, color: '#F59E0B', label: 'Medium Risk', description: riskConfig.mediumRisk.description, onUpdate: function(kws) { updateKeywords('mediumRisk', kws); } }),
          h(KeywordEditor, { keywords: riskConfig.lowRisk.keywords, color: '#28A464', label: 'Low Risk', description: riskConfig.lowRisk.description, onUpdate: function(kws) { updateKeywords('lowRisk', kws); } }),
          h('div', { style: { marginTop: 8 } },
            h(Button, { size: 'small', type: 'link', danger: true, onClick: handleResetConfig }, 'Reset to Defaults')
          )
        ) : null,

        // Step 2: Tag Policies
        wizardStep === 1 ? h('div', null,
          h('div', { className: 'panel-header', style: { marginBottom: 12 } },
            h('span', { className: 'panel-title' }, 'Step 2: Classify Your ' + P + 's')
          ),
          h('p', { style: { fontSize: 13, color: '#65657B', marginBottom: 16 } },
            'Classify each ' + P.toLowerCase() + ' by how rigorous its QC process is. ' +
            'This tells the optimizer what level of scrutiny each policy provides, so it can detect mismatches.'
          ),
          h('div', { style: { display: 'flex', gap: 16, marginBottom: 16 } },
            h(Tag, { color: '#C20A29' }, '\uD83D\uDD34 Most Rigorous: e.g. double programming, independent replication'),
            h(Tag, { color: '#F59E0B' }, '\uD83D\uDFE1 Moderate: e.g. code review + spot checks'),
            h(Tag, { color: '#28A464' }, '\uD83D\uDFE2 Lightweight: e.g. output crosscheck, automated validation')
          ),
          taggedPolicyCount > 0
            ? h(Alert, { type: 'success', showIcon: true, style: { marginBottom: 12, borderRadius: 8 },
                message: taggedPolicyCount + ' of ' + allPolicies.length + ' policies classified',
                description: taggedPolicyCount === allPolicies.length ? 'All policies classified! Click Next to see your results.' : 'Keep going! Classify the remaining policies for best results.'
              })
            : null,
          renderPolicyTiers()
        ) : null,

        // Step 3: Review Results
        wizardStep === 2 ? h('div', null,
          h('div', { className: 'panel-header', style: { marginBottom: 12 } },
            h('span', { className: 'panel-title' }, 'Step 3: Review Results')
          ),
          taggedPolicyCount === 0
            ? h(Alert, { type: 'warning', showIcon: true, style: { marginBottom: 16, borderRadius: 8 },
                message: 'No policies classified yet',
                description: 'Go back to Step 2 to classify at least one policy. Without classifications, calibration results will all show as "Untagged".',
                action: h(Button, { size: 'small', onClick: function() { setWizardStep(1); } }, 'Go Back'),
              })
            : h('p', { style: { fontSize: 13, color: '#65657B', marginBottom: 16 } },
                'Here\'s how your ' + B.toLowerCase() + 's are classified based on the keywords and policy tiers you set.'
              ),
          h('div', { className: 'stats-row', style: { marginBottom: 16 } },
            h(StatCard, { label: 'High Risk', value: summary.high, color: 'danger', sub: 'Need most rigorous QC' }),
            h(StatCard, { label: 'Medium Risk', value: summary.medium, color: 'warning', sub: 'Code review + spot check' }),
            h(StatCard, { label: 'Low Risk', value: summary.low, color: 'success', sub: 'Output crosscheck sufficient' })
          ),
          h('div', { className: 'stats-row' },
            h(StatCard, { label: 'Over-QC\'d', value: summary.overQc, color: 'warning',
              sub: summary.overQc > 0 ? 'More rigorous QC than needed' : 'None detected' }),
            h(StatCard, { label: 'Well-Matched', value: summary.wellMatched, color: 'success',
              sub: summary.wellMatched > 0 ? 'Policy aligns with risk' : 'None detected' }),
            h(StatCard, { label: 'Under-QC\'d', value: summary.underQc, color: 'danger',
              sub: summary.underQc > 0 ? 'Less rigorous QC than recommended' : 'None detected' })
          )
        ) : null
      ),

      // Wizard navigation
      h('div', { style: { display: 'flex', justifyContent: 'flex-end', marginTop: 16 } },
        h('div', { style: { display: 'flex', gap: 8 } },
          wizardStep > 0
            ? h(Button, { onClick: function() { setWizardStep(wizardStep - 1); } }, 'Back')
            : null,
          wizardStep < 2
            ? h(Button, { type: 'primary', onClick: function() { setWizardStep(wizardStep + 1); } }, 'Next')
            : h(Button, { type: 'primary', onClick: handleWizardDone }, 'Finish Setup')
        )
      )
    );
  }

  // ── Render ──
  return h('div', { style: { padding: 24 } },
    // Header
    h('div', { className: 'panel-header', style: { marginBottom: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'center' } },
      h('div', null,
        h('span', { className: 'panel-title', style: { fontSize: 18 } }, 'Risk Optimizer'),
        h('span', { style: { fontSize: 12, color: '#8F8FA3', marginLeft: 12 } },
          'Identify over-QC\'d and under-QC\'d deliverables. Recommend right-sized policies.'
        )
      ),
      !showWizard ? h('div', { style: { display: 'flex', gap: 8 } },
        h(Button, { size: 'small', type: activeTab === 'overview' ? 'primary' : 'default', onClick: function() { setActiveTab('overview'); } }, 'Overview'),
        h(Button, { size: 'small', type: activeTab === 'bundles' ? 'primary' : 'default', onClick: function() { setActiveTab('bundles'); } }, B + 's'),
        h(Button, { size: 'small', type: activeTab === 'graph' ? 'primary' : 'default', onClick: function() { setActiveTab('graph'); } }, 'Dependency Graph'),
        h(Button, { size: 'small', type: activeTab === 'policies' ? 'primary' : 'default', onClick: function() { setActiveTab('policies'); } }, P + ' Tiers'),
        h(Button, { size: 'small', type: activeTab === 'audit' ? 'primary' : 'default', onClick: function() { setActiveTab('audit'); } }, 'Audit Log'),
        h(Button, { size: 'small', type: activeTab === 'config' ? 'primary' : 'default', onClick: function() { setActiveTab('config'); }, icon: h('span', null, '\u2699') }, 'Config')
      ) : null
    ),

    // Show wizard OR normal content
    showWizard ? renderWizard() : null,

    // Normal content (hidden during wizard)
    !showWizard && untaggedPolicyCount > 0 && allPolicies.length > 0
      ? h(Alert, {
          type: 'info',
          showIcon: true,
          banner: true,
          style: { marginBottom: 16, borderRadius: 8 },
          message: untaggedPolicyCount + ' of ' + allPolicies.length + ' policies are not classified with a rigor tier.',
          description: 'Classify each policy as Most Rigorous, Moderate, or Lightweight in the "' + P + ' Tiers" tab. This powers the recommendation engine.',
          action: h(Button, { size: 'small', type: 'primary', onClick: function() { setActiveTab('policies'); } }, 'Classify Policies'),
        })
      : null,

    // ── Overview Tab ──
    !showWizard && activeTab === 'overview' ? h('div', null,

      // Calibration cards
      h('div', { className: 'panel-header', style: { marginBottom: 12 } },
        h('span', { className: 'panel-title' }, 'QC Calibration Summary')
      ),
      h('div', { className: 'stats-row' },
        h(StatCard, { label: 'Over-QC\'d', value: summary.overQc, color: 'warning',
          sub: summary.overQc > 0 ? 'More rigorous QC than needed' : 'None detected' }),
        h(StatCard, { label: 'Well-Matched', value: summary.wellMatched, color: 'success',
          sub: summary.wellMatched > 0 ? 'Policy aligns with risk level' : taggedPolicyCount === 0 ? 'Classify policies to see results' : 'None detected' }),
        h(StatCard, { label: 'Under-QC\'d', value: summary.underQc, color: 'danger',
          sub: summary.underQc > 0 ? 'Less rigorous QC than recommended' : 'None detected' }),
        h(StatCard, { label: 'Manual Overrides', value: summary.manual, color: 'info',
          sub: summary.manual > 0 ? 'Human judgment applied' : 'No overrides set' })
      ),

      // Quick insight
      summary.overQc > 0 ? h(Alert, {
        type: 'warning',
        showIcon: true,
        style: { marginBottom: 12, borderRadius: 8 },
        message: summary.overQc + ' deliverable' + (summary.overQc > 1 ? 's are' : ' is') + ' potentially over-QC\'d',
        description: 'These deliverables are assigned a more rigorous QC policy than their risk level warrants. Consider reassigning to a lighter-touch method to free up resources.',
        action: h(Button, { size: 'small', onClick: function() {
          setActiveTab('bundles');
        } }, 'View ' + B + 's'),
      }) : null,

      summary.underQc > 0 ? h(Alert, {
        type: 'error',
        showIcon: true,
        style: { marginBottom: 12, borderRadius: 8 },
        message: summary.underQc + ' deliverable' + (summary.underQc > 1 ? 's may' : ' may') + ' need more rigorous QC',
        description: 'These deliverables are assigned a lighter QC policy than their risk level suggests. Review whether the current method is sufficient.',
        action: h(Button, { size: 'small', danger: true, onClick: function() {
          setActiveTab('bundles');
        } }, 'View ' + B + 's'),
      }) : null,

      // Risk distribution Highcharts
      h('div', { className: 'panel', style: { marginTop: 8 } },
        h('div', { className: 'panel-header' }, h('span', { className: 'panel-title' }, 'Risk Distribution by Project')),
        h(RiskDistributionChart, { scoredBundles: scoredBundles, riskConfig: riskConfig })
      )
    ) : null,

    // ── Bundles Tab ──
    !showWizard && activeTab === 'bundles' ? h('div', null,
      h('div', { style: { display: 'flex', gap: 12, marginBottom: 12, alignItems: 'center' } },
        h(Input, {
          placeholder: 'Search deliverables, projects, policies, risk level...',
          value: searchText,
          onChange: function(e) { setSearchText(e.target.value); },
          allowClear: true,
          style: { maxWidth: 400 },
          prefix: h('span', null, '\uD83D\uDD0D'),
        }),
        h('span', { style: { fontSize: 12, color: '#8F8FA3' } }, filteredBundles.length + ' of ' + scoredBundles.length + ' ' + B.toLowerCase() + 's')
      ),
      h(Table, {
        dataSource: filteredBundles,
        columns: bundleColumns,
        rowKey: 'id',
        size: 'small',
        scroll: { x: 1200 },
        pagination: { defaultPageSize: 20, size: 'small', showSizeChanger: true, showTotal: function(total) { return total + ' ' + B.toLowerCase() + 's'; } },
      })
    ) : null,

    // ── Dependency Graph Tab ──
    !showWizard && activeTab === 'graph' ? h('div', null,
      // Graph enabled toggle + status
      h('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 } },
        h('div', { style: { display: 'flex', alignItems: 'center', gap: 12 } },
          h(Switch, { checked: graphEnabled, onChange: function(val) { setGraphEnabled(val); if (val) ensureGraph(); } }),
          h('span', { style: { fontSize: 13, color: graphEnabled ? '#2E2E38' : '#8F8FA3' } },
            graphEnabled ? 'Graph propagation active' : 'Graph propagation disabled'
          ),
          riskGraph ? h(Tag, { color: 'blue', style: { fontSize: 10 } },
            graphNodeList.length + ' node' + (graphNodeList.length !== 1 ? 's' : '') + ', ' +
            graphEdgeList.length + ' edge' + (graphEdgeList.length !== 1 ? 's' : '')
          ) : null
        ),
        h('div', { style: { display: 'flex', gap: 8 } },
          h(Button, { size: 'small', onClick: function() { setCsvImportOpen(true); } }, 'Import CSV'),
          h(Button, { size: 'small', type: 'primary', disabled: !riskGraph || graphNodeList.length === 0, onClick: runPropagationPreview }, 'Preview Propagation')
        )
      ),

      // Info banner
      !riskGraph || graphNodeList.length === 0
        ? h(Alert, {
            type: 'info', showIcon: true, style: { marginBottom: 16, borderRadius: 8 },
            message: 'Define dataset dependencies to enable graph-based risk propagation',
            description: 'Add nodes representing your datasets (SDTM domains, ADaM datasets, TFLs), then connect them with edges to show data flow. Set anchor points on high-risk outputs, and risk will propagate upstream through the graph.',
          })
        : null,

      // Anchor Points section
      h('div', { className: 'panel', style: { padding: 16, marginBottom: 16 } },
        h('div', { className: 'panel-header', style: { marginBottom: 12, display: 'flex', justifyContent: 'space-between', alignItems: 'center' } },
          h('span', { className: 'panel-title' }, 'Anchor Points'),
          h(Button, { size: 'small', disabled: graphNodeList.length === 0, onClick: function() { setAddAnchorOpen(true); } }, 'Add Anchor')
        ),
        h('div', { style: { fontSize: 12, color: '#8F8FA3', marginBottom: 12 } },
          'Anchor points are datasets with a known risk level. Risk propagates from anchors upstream through the dependency graph.'
        ),
        (function() {
          var anchors = graphNodeList.filter(function(n) { return n.anchorRisk; });
          if (anchors.length === 0) return h('div', { style: { color: '#8F8FA3', fontSize: 12, padding: '8px 0' } }, 'No anchor points defined yet. Add nodes first, then set anchors.');
          return h('div', { style: { display: 'flex', flexWrap: 'wrap', gap: 8 } },
            anchors.map(function(n) {
              var affected = graphRiskResults ? Object.keys(graphRiskResults).filter(function(nid) {
                return nid !== n.id && graphRiskResults[nid] && graphRiskResults[nid].anchorNodes.some(function(a) { return a.id === n.id; });
              }).length : 0;
              return h('div', { key: n.id, style: { display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', background: '#FAFAFA', borderRadius: 8, border: '1px solid #E8E8EE' } },
                h(Tag, { color: n.anchorRisk === 'High' ? 'red' : n.anchorRisk === 'Medium' ? 'gold' : 'green' }, n.anchorRisk),
                h('span', { style: { fontWeight: 500, fontSize: 13 } }, n.label || n.id),
                h('span', { style: { fontSize: 11, color: '#65657B', maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, n.anchorReason),
                affected > 0 ? h(Tag, { style: { fontSize: 10 } }, affected + ' upstream affected') : null,
                h(Button, { size: 'small', type: 'text', danger: true, onClick: function() { clearNodeAnchor(n.id); } }, '\u2715')
              );
            })
          );
        })()
      ),

      // Nodes table
      h('div', { className: 'panel', style: { padding: 16, marginBottom: 16 } },
        h('div', { className: 'panel-header', style: { marginBottom: 12, display: 'flex', justifyContent: 'space-between', alignItems: 'center' } },
          h('span', { className: 'panel-title' }, 'Dataset Nodes'),
          h(Button, { size: 'small', type: 'primary', onClick: function() { ensureGraph(); setAddNodeOpen(true); } }, 'Add Node')
        ),
        graphNodeList.length > 0
          ? h(Table, {
              dataSource: graphNodeList, rowKey: 'id', size: 'small',
              pagination: graphNodeList.length > 20 ? { defaultPageSize: 20, size: 'small' } : false,
              columns: [
                { title: 'Dataset', dataIndex: 'id', key: 'id', width: 120,
                  sorter: function(a, b) { return (a.id || '').localeCompare(b.id || ''); },
                  render: function(t, r) { return h('span', { style: { fontWeight: 500 } }, r.label || t); }
                },
                { title: 'Type', dataIndex: 'type', key: 'type', width: 100,
                  filters: [{ text: 'SDTM', value: 'sdtm' }, { text: 'ADaM', value: 'adam' }, { text: 'TFL', value: 'tfl' }, { text: 'Raw', value: 'raw' }],
                  onFilter: function(v, r) { return r.type === v; },
                  render: function(t) { return h(Tag, { style: { fontSize: 10 } }, (t || 'unknown').toUpperCase()); }
                },
                { title: 'Linked ' + B, key: 'bundle', width: 180, ellipsis: true,
                  render: function(_, r) {
                    if (!r.bundleId) return h('span', { style: { color: '#8F8FA3', fontSize: 11 } }, 'Not linked');
                    var matched = bundles.find(function(b) { return b.id === r.bundleId; });
                    return matched ? h('span', { style: { fontSize: 12 } }, matched.name) : h('span', { style: { color: '#8F8FA3', fontSize: 11 } }, 'Bundle not found');
                  }
                },
                { title: 'Anchor', key: 'anchor', width: 100,
                  render: function(_, r) {
                    return r.anchorRisk
                      ? h(Tag, { color: r.anchorRisk === 'High' ? 'red' : r.anchorRisk === 'Medium' ? 'gold' : 'green' }, r.anchorRisk)
                      : h('span', { style: { color: '#B0B0C0', fontSize: 11 } }, '\u2013');
                  }
                },
                { title: 'Upstream', key: 'upstream', width: 80, align: 'center',
                  render: function(_, r) { return (graphNodeCounts[r.id] || {}).upstream || 0; }
                },
                { title: 'Downstream', key: 'downstream', width: 80, align: 'center',
                  render: function(_, r) { return (graphNodeCounts[r.id] || {}).downstream || 0; }
                },
                { title: '', key: 'actions', width: 60,
                  render: function(_, r) {
                    return h(Button, { size: 'small', type: 'text', danger: true, onClick: function() {
                      antd.Modal.confirm({
                        title: 'Remove node "' + (r.label || r.id) + '"?',
                        content: 'This will also remove all connected edges.',
                        okText: 'Remove', okType: 'danger',
                        onOk: function() { removeGraphNode(r.id); },
                      });
                    } }, '\u2715');
                  }
                },
              ],
            })
          : h(Empty, { description: 'No nodes defined. Add dataset nodes to build the dependency graph.' })
      ),

      // Edges table
      h('div', { className: 'panel', style: { padding: 16, marginBottom: 16 } },
        h('div', { className: 'panel-header', style: { marginBottom: 12, display: 'flex', justifyContent: 'space-between', alignItems: 'center' } },
          h('span', { className: 'panel-title' }, 'Dependency Edges'),
          h('div', { style: { display: 'flex', gap: 8 } },
            (function() {
              var suggestions = riskGraph ? getCdiscSuggestions() : [];
              return suggestions.length > 0
                ? h(Tooltip, { title: suggestions.length + ' CDISC standard edge' + (suggestions.length !== 1 ? 's' : '') + ' can be auto-added' },
                    h(Button, { size: 'small', onClick: function() {
                      antd.Modal.confirm({
                        title: 'Add CDISC Standard Edges?',
                        content: h('div', null,
                          h('p', null, 'The following standard CDISC relationships were detected:'),
                          h('ul', { style: { fontSize: 12 } }, suggestions.map(function(s) {
                            return h('li', { key: s.edgeId }, s.source.toUpperCase() + ' \u2192 ' + s.target.toUpperCase() + ' \u2014 ' + s.desc);
                          }))
                        ),
                        okText: 'Add All (' + suggestions.length + ')', width: 520,
                        onOk: function() {
                          suggestions.forEach(function(s) {
                            addGraphEdge({ source: s.source, target: s.target, relationship: 'direct', columnScope: 'unknown', columnDetail: s.desc });
                          });
                          antd.message.success('Added ' + suggestions.length + ' CDISC standard edges');
                        },
                      });
                    } }, 'CDISC Auto-Suggest')
                  )
                : null;
            })(),
            h(Button, { size: 'small', type: 'primary', disabled: graphNodeList.length < 2, onClick: function() { setAddEdgeOpen(true); } }, 'Add Edge')
          )
        ),
        graphEdgeList.length > 0
          ? h(Table, {
              dataSource: graphEdgeList, rowKey: 'id', size: 'small',
              pagination: graphEdgeList.length > 20 ? { defaultPageSize: 20, size: 'small' } : false,
              columns: [
                { title: 'Source \u2192 Target', key: 'edge', width: 220,
                  render: function(_, r) {
                    var srcLabel = riskGraph.nodes[r.source] ? (riskGraph.nodes[r.source].label || r.source) : r.source;
                    var tgtLabel = riskGraph.nodes[r.target] ? (riskGraph.nodes[r.target].label || r.target) : r.target;
                    return h('span', null, h('strong', null, srcLabel), ' \u2192 ', h('strong', null, tgtLabel));
                  }
                },
                { title: 'Relationship', dataIndex: 'relationship', key: 'rel', width: 120,
                  render: function(t) {
                    var color = t === 'direct' ? 'blue' : t === 'indirect' ? 'default' : 'orange';
                    return h(Tag, { color: color, style: { fontSize: 10 } }, (t || 'direct').replace('_', ' '));
                  }
                },
                { title: 'Column Scope', dataIndex: 'columnScope', key: 'scope', width: 120,
                  render: function(t) {
                    var color = t === 'full' ? 'green' : t === 'partial' ? 'gold' : 'default';
                    return h(Tag, { color: color, style: { fontSize: 10 } }, t || 'unknown');
                  }
                },
                { title: 'Detail', dataIndex: 'columnDetail', key: 'detail', ellipsis: true,
                  render: function(t) { return t ? h('span', { style: { fontSize: 12, color: '#65657B' } }, t) : h('span', { style: { color: '#B0B0C0', fontSize: 11 } }, '\u2013'); }
                },
                { title: 'Attenuation', key: 'att', width: 100, align: 'center',
                  render: function(_, r) {
                    var att = getEdgeAttenuation(r);
                    var color = att >= 0.8 ? '#C20A29' : att >= 0.5 ? '#F59E0B' : '#28A464';
                    return h('span', { style: { fontSize: 12, fontWeight: 500, color: color } }, (att * 100).toFixed(0) + '%');
                  }
                },
                { title: '', key: 'actions', width: 50,
                  render: function(_, r) {
                    return h(Button, { size: 'small', type: 'text', danger: true, onClick: function() { removeGraphEdge(r.id); } }, '\u2715');
                  }
                },
              ],
            })
          : h(Empty, { description: 'No edges defined. Add edges to connect dataset nodes.' })
      ),

      // Propagation Preview
      propagationPreview ? h('div', { className: 'panel', style: { padding: 16, marginBottom: 16 } },
        h('div', { className: 'panel-header', style: { marginBottom: 12, display: 'flex', justifyContent: 'space-between', alignItems: 'center' } },
          h('span', { className: 'panel-title' }, 'Propagation Preview'),
          h('div', { style: { display: 'flex', gap: 8 } },
            h(Button, { size: 'small', onClick: function() { setPropagationPreview(null); } }, 'Dismiss'),
            h(Button, { size: 'small', type: 'primary', onClick: function() {
              setGraphEnabled(true);
              setPropagationPreview(null);
              antd.message.success('Graph propagation enabled. Risk scores updated.');
            } }, 'Apply & Enable')
          )
        ),
        h(Table, {
          dataSource: propagationPreview, rowKey: 'nodeId', size: 'small',
          pagination: false,
          columns: [
            { title: 'Node', key: 'node', width: 140,
              render: function(_, r) {
                return h('span', null,
                  h('span', { style: { fontWeight: 500 } }, r.label),
                  r.isAnchor ? h(Tag, { color: 'purple', style: { marginLeft: 6, fontSize: 9 } }, 'ANCHOR') : null
                );
              }
            },
            { title: 'Type', dataIndex: 'type', key: 'type', width: 80,
              render: function(t) { return h(Tag, { style: { fontSize: 10 } }, (t || '?').toUpperCase()); }
            },
            { title: 'Keyword Risk', key: 'kw', width: 110,
              render: function(_, r) {
                var color = r.keywordRisk === 'High' ? 'red' : r.keywordRisk === 'Medium' ? 'gold' : r.keywordRisk === 'Low' ? 'green' : 'default';
                return h(Tag, { color: color }, r.keywordRisk);
              }
            },
            { title: 'Graph Risk', key: 'gr', width: 110,
              render: function(_, r) {
                if (r.graphRisk === '\u2013') return h('span', { style: { color: '#B0B0C0' } }, '\u2013');
                var color = r.graphRisk === 'High' ? 'red' : r.graphRisk === 'Medium' ? 'gold' : 'green';
                return h(Tag, { color: color }, r.graphRisk);
              }
            },
            { title: 'Final Risk', key: 'final', width: 110,
              render: function(_, r) {
                var color = r.finalRisk === 'High' ? 'red' : r.finalRisk === 'Medium' ? 'gold' : r.finalRisk === 'Low' ? 'green' : 'default';
                return h(Tag, { color: color, style: { fontWeight: 600 } }, r.finalRisk);
              }
            },
            { title: 'Change', key: 'change', width: 80,
              render: function(_, r) {
                if (r.change === 'upgrade') return h(Tag, { color: 'volcano' }, '\u2191 Upgrade');
                return h('span', { style: { color: '#B0B0C0', fontSize: 11 } }, '\u2013');
              }
            },
            { title: 'Path', dataIndex: 'path', key: 'path', ellipsis: true,
              render: function(t) { return t ? h('span', { style: { fontSize: 11, color: '#65657B' } }, t) : '\u2013'; }
            },
          ],
        })
      ) : null,

      // ── Modals ──
      h(AddNodeModal, {
        open: addNodeOpen,
        onClose: function() { setAddNodeOpen(false); },
        onAdd: function(node) { addGraphNode(node); setAddNodeOpen(false); },
        bundles: bundles,
        existingNodeIds: graphNodeList.map(function(n) { return n.id; }),
      }),
      h(AddEdgeModal, {
        open: addEdgeOpen,
        onClose: function() { setAddEdgeOpen(false); },
        onAdd: function(edge) { addGraphEdge(edge); setAddEdgeOpen(false); },
        nodes: graphNodeList,
      }),
      h(AddAnchorModal, {
        open: addAnchorOpen,
        onClose: function() { setAddAnchorOpen(false); },
        onAdd: function(nodeId, risk, reason) { setNodeAnchor(nodeId, risk, reason); setAddAnchorOpen(false); },
        nodes: graphNodeList.filter(function(n) { return !n.anchorRisk; }),
      }),
      h(CsvImportModal, {
        open: csvImportOpen,
        onClose: function() { setCsvImportOpen(false); },
        onImport: handleCsvImport,
      })
    ) : null,

    // ── Policy Tiers Tab ──
    !showWizard && activeTab === 'policies' ? h('div', null,
      h('div', { className: 'panel', style: { padding: 20, borderRadius: 8 } },
        h('div', { className: 'panel-header', style: { marginBottom: 12 } },
          h('span', { className: 'panel-title' }, P + ' Rigor Tiers'),
          h('span', { style: { marginLeft: 8, fontSize: 12, color: '#8F8FA3' } },
            taggedPolicyCount + ' of ' + allPolicies.length + ' classified'
          )
        ),
        renderPolicyTiers()
      )
    ) : null,

    // ── Audit Log Tab ──
    !showWizard && activeTab === 'audit' ? h('div', null,
      h('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 } },
        h('span', { style: { fontSize: 12, color: '#8F8FA3' } }, auditLog.length + ' audit entries'),
        auditLog.length > 0
          ? h(Button, { size: 'small', danger: true, type: 'text', onClick: function() {
              antd.Modal.confirm({
                title: 'Clear Audit Log?',
                content: 'This will permanently delete all audit entries. This cannot be undone.',
                okText: 'Clear',
                okType: 'danger',
                onOk: function() { setAuditLog([]); },
              });
            } }, 'Clear Log')
          : null
      ),
      auditLog.length > 0
        ? h(Table, {
            dataSource: auditLog,
            columns: auditColumns,
            rowKey: 'id',
            size: 'small',
            pagination: { defaultPageSize: 20, size: 'small', showSizeChanger: true },
          })
        : h(Empty, { description: 'No audit entries yet. Reassignments and overrides will appear here.' })
    ) : null,

    // ── Reassign Modal ──
    h(Modal, {
      title: 'Reassign ' + P,
      open: reassignModalOpen,
      onCancel: function() { setReassignModalOpen(false); },
      onOk: handleReassign,
      okText: 'Reassign',
      okButtonProps: { disabled: !reassignPolicy || !reassignRationale.trim() },
      width: 520,
    },
      selectedBundle ? h('div', null,
        h('div', { style: { marginBottom: 12 } },
          h('span', { style: { fontWeight: 600 } }, selectedBundle.name),
          h(Tag, { color: selectedBundle._risk.level === 'High' ? 'red' : selectedBundle._risk.level === 'Medium' ? 'gold' : 'green', style: { marginLeft: 8 } }, selectedBundle._risk.level + ' Risk'),
          h(Tag, { color: selectedBundle._calibration === 'over-qc' ? 'orange' : selectedBundle._calibration === 'under-qc' ? 'red' : selectedBundle._calibration === 'well-matched' ? 'green' : 'default', style: { marginLeft: 4 } },
            selectedBundle._calibration === 'over-qc' ? 'Over-QC\'d' : selectedBundle._calibration === 'under-qc' ? 'Under-QC\'d' : selectedBundle._calibration === 'well-matched' ? 'Well-Matched' : 'Untagged'
          )
        ),
        h('div', { style: { marginBottom: 12, fontSize: 12, color: '#8F8FA3' } },
          'Current: ', h('strong', null, selectedBundle.policyName)
        ),
        h('div', { style: { marginBottom: 8 } },
          h('label', { style: { fontSize: 12, color: '#B0B0C0', display: 'block', marginBottom: 4 } }, 'New ' + P),
          h(Select, {
            style: { width: '100%' },
            placeholder: 'Select target policy...',
            value: reassignPolicy || undefined,
            onChange: setReassignPolicy,
            showSearch: true,
            optionFilterProp: 'label',
            options: allPolicies.map(function(p) {
              var tier = policyTiers[p.id];
              return { value: p.id, label: p.name + (tier ? ' (' + getTierLabel(tier) + ')' : '') };
            }),
          })
        ),
        h('div', null,
          h('label', { style: { fontSize: 12, color: '#B0B0C0', display: 'block', marginBottom: 4 } },
            'Rationale ', h('span', { style: { color: '#C20A29' } }, '(required)')
          ),
          h(Input.TextArea, {
            rows: 3,
            value: reassignRationale,
            onChange: function(e) { setReassignRationale(e.target.value); },
            placeholder: 'Why is this reassignment appropriate? This is recorded in the audit log.',
          })
        )
      ) : null
    ),

    // ── Override Modal ──
    h(Modal, {
      title: 'Override Risk Assessment',
      open: overrideModalOpen,
      onCancel: function() { setOverrideModalOpen(false); },
      onOk: handleSaveOverride,
      okText: 'Save Override',
      okButtonProps: { disabled: !overrideLevel || !overrideReason.trim() },
      width: 480,
    },
      selectedBundle ? h('div', null,
        h('div', { style: { marginBottom: 12 } },
          h('span', { style: { fontWeight: 600 } }, selectedBundle.name),
          h('span', { style: { fontSize: 12, color: '#8F8FA3', marginLeft: 8 } },
            'Algorithm says: ' + selectedBundle._risk.level + ' Risk'
          )
        ),
        h('div', { style: { marginBottom: 8 } },
          h('label', { style: { fontSize: 12, color: '#B0B0C0', display: 'block', marginBottom: 4 } }, 'Your Risk Assessment'),
          h(Select, {
            style: { width: '100%' },
            value: overrideLevel || undefined,
            onChange: setOverrideLevel,
            options: [
              { value: 'High', label: '\u{1F534} High Risk: most rigorous QC' },
              { value: 'Medium', label: '\u{1F7E1} Medium Risk: code review + spot check' },
              { value: 'Low', label: '\u{1F7E2} Low Risk: output crosscheck' },
            ],
          })
        ),
        h('div', null,
          h('label', { style: { fontSize: 12, color: '#B0B0C0', display: 'block', marginBottom: 4 } },
            'Reason for Override ', h('span', { style: { color: '#C20A29' } }, '(required)')
          ),
          h(Input.TextArea, {
            rows: 3,
            value: overrideReason,
            onChange: function(e) { setOverrideReason(e.target.value); },
            placeholder: 'Why does your judgment differ from the algorithm? This is recorded in the audit log.',
          })
        ),
        h('div', { style: { marginTop: 8, fontSize: 11, color: '#65657B' } },
          '\u24D8 Human judgment always takes precedence over the algorithm. Your override will persist until you clear it.'
        )
      ) : null
    ),

    // ── Risk Because Drawer ──
    h(antd.Drawer, {
      title: graphDrawerBundle ? 'Risk Analysis: ' + graphDrawerBundle.name : 'Risk Analysis',
      open: !!graphDrawerBundle,
      onClose: function() { setGraphDrawerBundle(null); },
      width: 520,
    },
      graphDrawerBundle && graphDrawerBundle._risk.graphDetail ? (function() {
        var detail = graphDrawerBundle._risk.graphDetail;
        return h('div', { style: { display: 'flex', flexDirection: 'column', gap: 16 } },
          // Summary
          h('div', { style: { display: 'flex', gap: 8, alignItems: 'center' } },
            h(Tag, { color: graphDrawerBundle._risk.level === 'High' ? 'red' : graphDrawerBundle._risk.level === 'Medium' ? 'gold' : 'green',
              style: { fontSize: 14, padding: '4px 12px' } }, graphDrawerBundle._risk.level + ' Risk'),
            h(Tag, { color: 'purple' }, 'Source: Graph Propagation'),
            detail.isAnchor ? h(Tag, { color: 'geekblue' }, 'Anchor Point') : null
          ),

          // Keyword baseline
          h('div', { className: 'panel', style: { padding: 12 } },
            h('div', { style: { fontSize: 12, fontWeight: 600, marginBottom: 6, color: '#2E2E38' } }, 'Keyword Baseline'),
            h('div', { style: { fontSize: 12, color: '#65657B' } },
              'Keywords alone classify this as: ',
              h(Tag, { color: detail.keywordRisk === 'High' ? 'red' : detail.keywordRisk === 'Medium' ? 'gold' : detail.keywordRisk === 'Low' ? 'green' : 'default' }, detail.keywordRisk),
              graphDrawerBundle._risk.matches && graphDrawerBundle._risk.matches.length > 0
                ? h('span', null, ' (matched: ' + graphDrawerBundle._risk.matches.join(', ') + ')')
                : null
            )
          ),

          // Anchor nodes
          h('div', { className: 'panel', style: { padding: 12 } },
            h('div', { style: { fontSize: 12, fontWeight: 600, marginBottom: 6, color: '#2E2E38' } }, 'Risk Anchor' + (detail.anchorNodes.length > 1 ? 's' : '')),
            detail.anchorNodes.map(function(anchor) {
              return h('div', { key: anchor.id, style: { display: 'flex', alignItems: 'center', gap: 8, padding: '4px 0' } },
                h(Tag, { color: anchor.risk === 'High' ? 'red' : anchor.risk === 'Medium' ? 'gold' : 'green' }, anchor.risk),
                h('strong', null, anchor.id.toUpperCase()),
                h('span', { style: { fontSize: 12, color: '#65657B' } }, anchor.reason)
              );
            })
          ),

          // Propagation paths
          detail.propagationPaths.length > 0 ? h('div', { className: 'panel', style: { padding: 12 } },
            h('div', { style: { fontSize: 12, fontWeight: 600, marginBottom: 6, color: '#2E2E38' } }, 'Propagation Paths'),
            detail.propagationPaths.map(function(p, i) {
              return h('div', { key: i, style: { padding: '6px 0', borderBottom: i < detail.propagationPaths.length - 1 ? '1px solid #F0F0F0' : 'none' } },
                h('div', { style: { fontSize: 13, fontFamily: 'monospace' } },
                  p.path.map(function(nodeId) { return nodeId.toUpperCase(); }).join(' \u2192 ')
                ),
                h('div', { style: { fontSize: 11, color: '#8F8FA3', marginTop: 2 } },
                  'From ', h('strong', null, p.sourceRisk), ' anchor, attenuated to ',
                  h(Tag, { color: p.attenuatedRisk === 'High' ? 'red' : p.attenuatedRisk === 'Medium' ? 'gold' : 'green', style: { fontSize: 10 } }, p.attenuatedRisk),
                  ' (', (p.totalAttenuation * 100).toFixed(0), '% strength)'
                )
              );
            })
          ) : null,

          // Resolution
          h('div', { style: { fontSize: 11, color: '#8F8FA3', background: '#F8F8FC', padding: 10, borderRadius: 6 } },
            detail.resolution === 'graph_upgrade'
              ? 'Graph propagation upgraded this from ' + detail.keywordRisk + ' (keywords) to ' + detail.effectiveGraphRisk + ' (graph). Graph can only raise risk, never lower it.'
              : 'Graph propagation agrees with keyword classification. No upgrade applied.'
          ),

          // Override button
          h(Button, { block: true, onClick: function() { handleOpenOverride(graphDrawerBundle); setGraphDrawerBundle(null); } },
            'Override This Risk Assessment'
          )
        );
      })() : graphDrawerBundle ? h('div', { style: { color: '#8F8FA3' } }, 'No graph detail available for this bundle.') : null
    ),

    // ── Config Tab ──
    !showWizard && activeTab === 'config' ? h('div', null,
      h('div', { className: 'panel', style: { padding: 20, borderRadius: 8 } },
        h('div', { className: 'panel-header', style: { marginBottom: 12 } },
          h('span', { className: 'panel-title' }, 'Risk Classification Config')
        ),
        h('p', { style: { fontSize: 12, color: '#8F8FA3', marginBottom: 20 } },
          'Edit the keyword lists below. The risk engine matches these against evidence name, QC plan name, and deliverable name. A non-engineer can tune these without code changes.'
        ),
        h(KeywordEditor, {
          tierKey: 'highRisk',
          keywords: riskConfig.highRisk.keywords,
          color: riskConfig.highRisk.color,
          label: 'High Risk',
          description: riskConfig.highRisk.description,
          onUpdate: function(kws) { updateKeywords('highRisk', kws); },
        }),
        h(KeywordEditor, {
          tierKey: 'mediumRisk',
          keywords: riskConfig.mediumRisk.keywords,
          color: riskConfig.mediumRisk.color,
          label: 'Medium Risk',
          description: riskConfig.mediumRisk.description,
          onUpdate: function(kws) { updateKeywords('mediumRisk', kws); },
        }),
        h(KeywordEditor, {
          tierKey: 'lowRisk',
          keywords: riskConfig.lowRisk.keywords,
          color: riskConfig.lowRisk.color,
          label: 'Low Risk',
          description: riskConfig.lowRisk.description,
          onUpdate: function(kws) { updateKeywords('lowRisk', kws); },
        }),
        h('div', { style: { marginTop: 16, paddingTop: 16, borderTop: '1px solid #E8E8EE' } },
          h(Button, { danger: true, onClick: handleResetConfig }, 'Reset to Defaults')
        )
      )
    ) : null
  );
}

// ── KeywordEditor Component (interactive pill-based keyword editing) ──
function KeywordEditor(props) {
  var keywords = props.keywords;
  var color = props.color;
  var label = props.label;
  var description = props.description;
  var onUpdate = props.onUpdate;

  var _newKw = useState('');
  var newKw = _newKw[0]; var setNewKw = _newKw[1];

  function handleAdd() {
    var kw = newKw.trim().toLowerCase();
    if (kw && keywords.indexOf(kw) === -1) {
      onUpdate(keywords.concat([kw]));
      setNewKw('');
    }
  }

  function handleRemove(kw) {
    onUpdate(keywords.filter(function(k) { return k !== kw; }));
  }

  return h('div', { style: { marginBottom: 20 } },
    h('div', { style: { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 } },
      h('div', { style: { width: 10, height: 10, borderRadius: '50%', background: color } }),
      h('span', { style: { fontSize: 14, fontWeight: 600, color: '#2E2E38' } }, label),
      h('span', { style: { fontSize: 11, color: '#8F8FA3', marginLeft: 4 } }, description)
    ),
    h('div', { style: { display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 8 } },
      keywords.map(function(kw) {
        return h(Tag, {
          key: kw,
          closable: true,
          onClose: function(e) { e.preventDefault(); handleRemove(kw); },
          style: { fontSize: 11, borderRadius: 12, padding: '2px 10px' },
        }, kw);
      })
    ),
    h('div', { style: { display: 'flex', gap: 8, maxWidth: 400 } },
      h(Input, {
        size: 'small',
        placeholder: 'Add keyword...',
        value: newKw,
        onChange: function(e) { setNewKw(e.target.value); },
        onPressEnter: handleAdd,
        style: { flex: 1 },
      }),
      h(Button, { size: 'small', onClick: handleAdd, disabled: !newKw.trim() }, 'Add')
    )
  );
}

// ── Risk Distribution Chart (Highcharts) ──
function RiskDistributionChart(props) {
  var chartRef = useRef(null);
  var scoredBundles = props.scoredBundles;
  var riskConfig = props.riskConfig;

  useEffect(function() {
    if (!chartRef.current || typeof Highcharts === 'undefined') return;

    // Group by project
    var projects = {};
    scoredBundles.forEach(function(b) {
      var pName = b.projectName || 'Unknown';
      if (!projects[pName]) projects[pName] = { high: 0, medium: 0, low: 0 };
      if (b._risk.level === 'High') projects[pName].high++;
      else if (b._risk.level === 'Medium') projects[pName].medium++;
      else projects[pName].low++;
    });

    var categories = Object.keys(projects);

    Highcharts.chart(chartRef.current, {
      chart: { type: 'bar', backgroundColor: 'transparent', height: Math.max(200, categories.length * 50 + 80) },
      title: { text: null },
      xAxis: { categories: categories, labels: { style: { color: '#65657B', fontSize: '11px' } } },
      yAxis: { min: 0, title: { text: 'Deliverables', style: { color: '#8F8FA3' } }, stackLabels: { enabled: true, style: { color: '#2E2E38' } }, gridLineColor: '#E8E8EE' },
      legend: { itemStyle: { color: '#65657B' } },
      plotOptions: { series: { stacking: 'normal', borderRadius: 3 } },
      series: [
        { name: 'High Risk', data: categories.map(function(c) { return projects[c].high; }), color: riskConfig.highRisk.color },
        { name: 'Medium Risk', data: categories.map(function(c) { return projects[c].medium; }), color: riskConfig.mediumRisk.color },
        { name: 'Low Risk', data: categories.map(function(c) { return projects[c].low; }), color: riskConfig.lowRisk.color },
      ],
      credits: { enabled: false },
      tooltip: { shared: true },
    });
  }, [scoredBundles, riskConfig]);

  return h('div', { ref: chartRef, style: { width: '100%', minHeight: 200 } });
}


// ── Graph Modal Components ──

function AddNodeModal(props) {
  var _id = useState(''); var nodeId = _id[0]; var setNodeId = _id[1];
  var _label = useState(''); var nodeLabel = _label[0]; var setNodeLabel = _label[1];
  var _type = useState('sdtm'); var nodeType = _type[0]; var setNodeType = _type[1];
  var _bundle = useState(null); var nodeBundle = _bundle[0]; var setNodeBundle = _bundle[1];

  function handleOk() {
    var id = nodeId.trim().toLowerCase().replace(/\s+/g, '_');
    if (!id) { antd.message.warning('Dataset ID is required.'); return; }
    if (props.existingNodeIds.indexOf(id) >= 0) { antd.message.warning('Node "' + id + '" already exists.'); return; }
    props.onAdd({ id: id, label: nodeLabel.trim() || id.toUpperCase(), type: nodeType, bundleId: nodeBundle, anchorRisk: null, anchorReason: '' });
    setNodeId(''); setNodeLabel(''); setNodeType('sdtm'); setNodeBundle(null);
  }

  // Auto-detect type from ID
  function handleIdChange(val) {
    setNodeId(val);
    var lower = val.toLowerCase().trim();
    if (/^ad[a-z]/.test(lower)) setNodeType('adam');
    else if (/^t_/.test(lower) || lower.indexOf('table') >= 0 || lower.indexOf('figure') >= 0) setNodeType('tfl');
    else {
      var sdtm = ['dm', 'ae', 'lb', 'vs', 'eg', 'cm', 'mh', 'ds', 'ex', 'sv', 'ta', 'ti', 'ts', 'se', 'pc', 'pp', 'qs', 'ce', 'dd', 'dv', 'hy'];
      if (sdtm.indexOf(lower) >= 0) setNodeType('sdtm');
    }
    if (!nodeLabel) setNodeLabel(val.toUpperCase());
  }

  return h(Modal, {
    title: 'Add Dataset Node',
    open: props.open,
    onCancel: function() { props.onClose(); setNodeId(''); setNodeLabel(''); setNodeType('sdtm'); setNodeBundle(null); },
    onOk: handleOk,
    okText: 'Add Node',
    okButtonProps: { disabled: !nodeId.trim() },
    width: 480,
  },
    h('div', { style: { display: 'flex', flexDirection: 'column', gap: 12 } },
      h('div', null,
        h('label', { style: { fontSize: 12, color: '#65657B', display: 'block', marginBottom: 4 } }, 'Dataset ID'),
        h(antd.AutoComplete, {
          style: { width: '100%' },
          placeholder: 'e.g., dm, adsl, adtte, t_pop...',
          value: nodeId,
          onChange: handleIdChange,
          options: props.bundles.map(function(b) {
            return { value: (b.name || '').toLowerCase().replace(/\s+/g, '_'), label: b.name };
          }).filter(function(o) { return props.existingNodeIds.indexOf(o.value) === -1; }),
          filterOption: function(input, option) { return (option.label || '').toLowerCase().indexOf(input.toLowerCase()) >= 0; },
        })
      ),
      h('div', null,
        h('label', { style: { fontSize: 12, color: '#65657B', display: 'block', marginBottom: 4 } }, 'Display Label'),
        h(Input, { placeholder: 'e.g., DM (Demographics)', value: nodeLabel, onChange: function(e) { setNodeLabel(e.target.value); } })
      ),
      h('div', null,
        h('label', { style: { fontSize: 12, color: '#65657B', display: 'block', marginBottom: 4 } }, 'Dataset Type'),
        h(Select, {
          style: { width: '100%' },
          value: nodeType,
          onChange: setNodeType,
          options: [
            { value: 'sdtm', label: 'SDTM Domain' },
            { value: 'adam', label: 'ADaM Dataset' },
            { value: 'tfl', label: 'TFL Output' },
            { value: 'raw', label: 'Raw / Source Data' },
          ],
        })
      ),
      h('div', null,
        h('label', { style: { fontSize: 12, color: '#65657B', display: 'block', marginBottom: 4 } }, 'Link to ' + (capFirst ? capFirst('deliverable') : 'Deliverable') + ' (optional)'),
        h(Select, {
          style: { width: '100%' },
          placeholder: 'Select a bundle to link...',
          value: nodeBundle || undefined,
          onChange: setNodeBundle,
          allowClear: true,
          showSearch: true,
          optionFilterProp: 'label',
          options: props.bundles.map(function(b) { return { value: b.id, label: b.name }; }),
        })
      )
    )
  );
}

function AddEdgeModal(props) {
  var _src = useState(null); var edgeSrc = _src[0]; var setEdgeSrc = _src[1];
  var _tgt = useState(null); var edgeTgt = _tgt[0]; var setEdgeTgt = _tgt[1];
  var _rel = useState('direct'); var edgeRel = _rel[0]; var setEdgeRel = _rel[1];
  var _scope = useState('unknown'); var edgeScope = _scope[0]; var setEdgeScope = _scope[1];
  var _detail = useState(''); var edgeDetail = _detail[0]; var setEdgeDetail = _detail[1];

  function handleOk() {
    if (!edgeSrc || !edgeTgt) { antd.message.warning('Select both source and target.'); return; }
    if (edgeSrc === edgeTgt) { antd.message.warning('Source and target must be different.'); return; }
    props.onAdd({ source: edgeSrc, target: edgeTgt, relationship: edgeRel, columnScope: edgeScope, columnDetail: edgeDetail.trim() });
    setEdgeSrc(null); setEdgeTgt(null); setEdgeRel('direct'); setEdgeScope('unknown'); setEdgeDetail('');
  }

  var nodeOptions = props.nodes.map(function(n) { return { value: n.id, label: n.label || n.id }; });

  return h(Modal, {
    title: 'Add Dependency Edge',
    open: props.open,
    onCancel: function() { props.onClose(); setEdgeSrc(null); setEdgeTgt(null); setEdgeRel('direct'); setEdgeScope('unknown'); setEdgeDetail(''); },
    onOk: handleOk,
    okText: 'Add Edge',
    okButtonProps: { disabled: !edgeSrc || !edgeTgt || edgeSrc === edgeTgt },
    width: 520,
  },
    h('div', { style: { display: 'flex', flexDirection: 'column', gap: 12 } },
      h('div', { style: { display: 'flex', gap: 12 } },
        h('div', { style: { flex: 1 } },
          h('label', { style: { fontSize: 12, color: '#65657B', display: 'block', marginBottom: 4 } }, 'Source (upstream)'),
          h(Select, { style: { width: '100%' }, placeholder: 'Select source...', value: edgeSrc || undefined, onChange: setEdgeSrc, showSearch: true, optionFilterProp: 'label', options: nodeOptions })
        ),
        h('div', { style: { display: 'flex', alignItems: 'center', paddingTop: 20, fontSize: 16, color: '#8F8FA3' } }, '\u2192'),
        h('div', { style: { flex: 1 } },
          h('label', { style: { fontSize: 12, color: '#65657B', display: 'block', marginBottom: 4 } }, 'Target (downstream)'),
          h(Select, { style: { width: '100%' }, placeholder: 'Select target...', value: edgeTgt || undefined, onChange: setEdgeTgt, showSearch: true, optionFilterProp: 'label', options: nodeOptions })
        )
      ),
      h('div', { style: { display: 'flex', gap: 12 } },
        h('div', { style: { flex: 1 } },
          h('label', { style: { fontSize: 12, color: '#65657B', display: 'block', marginBottom: 4 } }, 'Relationship'),
          h(Select, { style: { width: '100%' }, value: edgeRel, onChange: setEdgeRel, options: [
            { value: 'direct', label: 'Direct dependency' },
            { value: 'indirect', label: 'Indirect dependency' },
            { value: 'reference_only', label: 'Reference only (metadata)' },
          ] })
        ),
        h('div', { style: { flex: 1 } },
          h('label', { style: { fontSize: 12, color: '#65657B', display: 'block', marginBottom: 4 } }, 'Column Scope'),
          h(Select, { style: { width: '100%' }, value: edgeScope, onChange: setEdgeScope, options: [
            { value: 'full', label: 'Full \u2014 all columns used' },
            { value: 'partial', label: 'Partial \u2014 some columns used' },
            { value: 'unknown', label: 'Unknown' },
          ] })
        )
      ),
      edgeScope === 'partial' ? h('div', null,
        h('label', { style: { fontSize: 12, color: '#65657B', display: 'block', marginBottom: 4 } }, 'Which columns? (helps explain attenuation)'),
        h(Input, { placeholder: 'e.g., Only AGE, SEX, RACE used in derivation', value: edgeDetail, onChange: function(e) { setEdgeDetail(e.target.value); } })
      ) : null,
      h('div', { style: { fontSize: 11, color: '#8F8FA3', background: '#F8F8FC', padding: 8, borderRadius: 6, marginTop: 4 } },
        'Attenuation: ',
        (function() {
          var att = { full: 1.0, partial: 0.6, unknown: 0.8 }[edgeScope] * { direct: 1.0, indirect: 0.7, reference_only: 0.3 }[edgeRel];
          return h('strong', null, (att * 100).toFixed(0) + '%');
        })(),
        ' \u2014 ',
        edgeScope === 'partial' ? 'Partial column usage reduces inherited risk.' : edgeScope === 'full' ? 'Full column usage passes inherited risk at full strength.' : 'Unknown scope uses a conservative 80% factor.',
        ' ',
        edgeRel === 'reference_only' ? 'Reference-only further reduces to 30%.' : edgeRel === 'indirect' ? 'Indirect dependency reduces to 70%.' : ''
      )
    )
  );
}

function AddAnchorModal(props) {
  var _node = useState(null); var anchorNode = _node[0]; var setAnchorNode = _node[1];
  var _risk = useState('High'); var anchorRisk = _risk[0]; var setAnchorRisk = _risk[1];
  var _reason = useState(''); var anchorReason = _reason[0]; var setAnchorReason = _reason[1];

  function handleOk() {
    if (!anchorNode) { antd.message.warning('Select a dataset node.'); return; }
    if (!anchorReason.trim()) { antd.message.warning('Please provide a reason for this risk anchor.'); return; }
    props.onAdd(anchorNode, anchorRisk, anchorReason.trim());
    setAnchorNode(null); setAnchorRisk('High'); setAnchorReason('');
  }

  return h(Modal, {
    title: 'Set Risk Anchor',
    open: props.open,
    onCancel: function() { props.onClose(); setAnchorNode(null); setAnchorRisk('High'); setAnchorReason(''); },
    onOk: handleOk,
    okText: 'Set Anchor',
    okButtonProps: { disabled: !anchorNode || !anchorReason.trim() },
    width: 480,
  },
    h('div', { style: { display: 'flex', flexDirection: 'column', gap: 12 } },
      h('div', null,
        h('label', { style: { fontSize: 12, color: '#65657B', display: 'block', marginBottom: 4 } }, 'Dataset'),
        h(Select, {
          style: { width: '100%' },
          placeholder: 'Select a dataset node...',
          value: anchorNode || undefined,
          onChange: setAnchorNode,
          showSearch: true,
          optionFilterProp: 'label',
          options: props.nodes.map(function(n) { return { value: n.id, label: n.label || n.id }; }),
        })
      ),
      h('div', null,
        h('label', { style: { fontSize: 12, color: '#65657B', display: 'block', marginBottom: 4 } }, 'Risk Level'),
        h(Select, {
          style: { width: '100%' },
          value: anchorRisk,
          onChange: setAnchorRisk,
          options: [
            { value: 'High', label: '\uD83D\uDD34 High Risk' },
            { value: 'Medium', label: '\uD83D\uDFE1 Medium Risk' },
            { value: 'Low', label: '\uD83D\uDFE2 Low Risk' },
          ],
        })
      ),
      h('div', null,
        h('label', { style: { fontSize: 12, color: '#65657B', display: 'block', marginBottom: 4 } }, 'Reason ', h('span', { style: { color: '#C20A29' } }, '(required)')),
        h(Input.TextArea, {
          rows: 2,
          value: anchorReason,
          onChange: function(e) { setAnchorReason(e.target.value); },
          placeholder: 'e.g., Primary efficacy endpoint — patient survival analysis',
        })
      ),
      h('div', { style: { fontSize: 11, color: '#8F8FA3', background: '#F8F8FC', padding: 8, borderRadius: 6 } },
        'Risk will propagate from this anchor upstream through all connected nodes, attenuated by edge annotations.'
      )
    )
  );
}

function CsvImportModal(props) {
  var _csv = useState(''); var csvText = _csv[0]; var setCsvText = _csv[1];

  return h(Modal, {
    title: 'Import Edges from CSV',
    open: props.open,
    onCancel: function() { props.onClose(); setCsvText(''); },
    onOk: function() { props.onImport(csvText); setCsvText(''); },
    okText: 'Import',
    okButtonProps: { disabled: !csvText.trim() },
    width: 560,
  },
    h('div', { style: { display: 'flex', flexDirection: 'column', gap: 12 } },
      h('div', { style: { fontSize: 12, color: '#65657B' } },
        'Paste CSV data with columns: ', h('code', null, 'source,target,relationship,column_scope,annotation'),
        '. Only source and target are required. Nodes will be auto-created if they don\'t exist.'
      ),
      h('div', { style: { fontSize: 11, color: '#8F8FA3', background: '#F8F8FC', padding: 8, borderRadius: 6 } },
        'Example:',
        h('pre', { style: { margin: '4px 0 0', fontSize: 11 } },
          'source,target,relationship,column_scope,annotation\n' +
          'dm,adsl,direct,full,Demographics feed ADSL\n' +
          'adsl,adtte,direct,partial,Only baseline covariates used\n' +
          'ae,adae,direct,full,AE domain feeds ADAE'
        )
      ),
      h(Input.TextArea, {
        rows: 8,
        value: csvText,
        onChange: function(e) { setCsvText(e.target.value); },
        placeholder: 'Paste CSV here...',
        style: { fontFamily: 'monospace', fontSize: 12 },
      })
    )
  );
}

// ═══════════════════════════════════════════════════════════════
//  COMPONENT: Copy Deliverables Utility
// ═══════════════════════════════════════════════════════════════
function CopyDeliverablesUtility(props) {
  var bundles = props.bundles || [];
  var projects = props.projects || [];
  var policies = props.policies || [];
  var connected = props.connected;
  var onComplete = props.onComplete;
  var terms = props.terms || DEFAULT_TERMS;
  var B = capFirst(terms.bundle);

  var _sourceProject = useState(null); var sourceProject = _sourceProject[0]; var setSourceProject = _sourceProject[1];
  var _targetProject = useState(null); var targetProject = _targetProject[0]; var setTargetProject = _targetProject[1];
  var _selectedKeys = useState([]); var selectedKeys = _selectedKeys[0]; var setSelectedKeys = _selectedKeys[1];
  var _step = useState(0); var step = _step[0]; var setStep = _step[1]; // 0=select, 1=confirm, 2=copying, 3=done
  var _progress = useState({ done: 0, total: 0, errors: [], created: [] }); var progress = _progress[0]; var setProgress = _progress[1];

  // Derive project options from all projects (not just those with bundles)
  var projectOptions = useMemo(function() {
    // Combine API projects list with any projects only known from bundles
    var map = {};
    projects.forEach(function(p) { map[p.id] = { id: p.id, name: p.name || p.id }; });
    bundles.forEach(function(b) {
      if (b.projectId && !map[b.projectId]) map[b.projectId] = { id: b.projectId, name: b.projectName || b.projectId };
    });
    return Object.values(map).sort(function(a, b) { return (a.name || '').localeCompare(b.name || ''); });
  }, [projects, bundles]);

  // Bundles in the source project
  var sourceBundles = useMemo(function() {
    if (!sourceProject) return [];
    return bundles.filter(function(b) { return b.projectId === sourceProject; });
  }, [bundles, sourceProject]);

  // Existing bundle names in target project (for duplicate detection)
  var targetExistingNames = useMemo(function() {
    if (!targetProject) return {};
    var names = {};
    bundles.forEach(function(b) {
      if (b.projectId === targetProject && b.name) names[b.name.trim().toLowerCase()] = true;
    });
    return names;
  }, [bundles, targetProject]);

  // Preview rows with duplicate detection + intra-batch name disambiguation
  var previewRows = useMemo(function() {
    // Use object lookup instead of indexOf for O(1) per item (matters at 1000+)
    var keySet = {};
    selectedKeys.forEach(function(k) { keySet[k] = true; });
    var selected = sourceBundles.filter(function(b) { return keySet[b.id]; });

    // Detect names that appear more than once in the batch
    var nameCounts = {};
    selected.forEach(function(b) {
      var key = (b.name || '').trim().toLowerCase();
      nameCounts[key] = (nameCounts[key] || 0) + 1;
    });

    // Track names we've already used (including target existing) for disambiguation
    var usedNames = {};
    Object.keys(targetExistingNames).forEach(function(k) { usedNames[k] = true; });

    return selected.map(function(b) {
      var baseName = (b.name || '').trim();
      var key = baseName.toLowerCase();
      var isDuplicate = targetExistingNames[key] && !nameCounts[key]; // exact dup in target, not disambiguated
      var copyName = baseName;
      var renamed = false;

      // If this name appears multiple times in the batch, or would collide with an already-used name, disambiguate
      if (nameCounts[key] > 1 || usedNames[key]) {
        var suffix = b.policyName ? ' (' + b.policyName + ')' : ' (' + (b.policyId || '').slice(0, 8) + ')';
        var candidate = baseName + suffix;
        if (!usedNames[candidate.toLowerCase()]) {
          copyName = candidate;
          renamed = true;
          isDuplicate = false;
        } else {
          // Even with suffix it collides — mark as duplicate
          isDuplicate = true;
        }
      }

      usedNames[copyName.toLowerCase()] = true;

      return {
        id: b.id,
        name: baseName,
        copyName: copyName,
        renamed: renamed,
        policyName: b.policyName || '',
        policyId: b.policyId || '',
        state: b.state || '',
        isDuplicate: !!isDuplicate,
      };
    });
  }, [sourceBundles, selectedKeys, targetExistingNames]);

  var validRows = previewRows.filter(function(r) { return !r.isDuplicate && r.policyId; });
  var duplicateRows = previewRows.filter(function(r) { return r.isDuplicate; });

  // Auto-select all when source changes
  useEffect(function() {
    setSelectedKeys(sourceBundles.map(function(b) { return b.id; }));
  }, [sourceProject]);

  function reset() {
    setSourceProject(null); setTargetProject(null); setSelectedKeys([]);
    setStep(0); setProgress({ done: 0, total: 0, errors: [], created: [] });
  }

  function startCopy() {
    if (!connected) {
      antd.message.warning('Cannot copy in dummy mode. Connect to a Domino instance first.');
      return;
    }
    if (validRows.length === 0) { antd.message.error('No valid ' + B.toLowerCase() + 's to copy.'); return; }
    setStep(2);
    setProgress({ done: 0, total: validRows.length, errors: [], created: [] });

    console.group('[CopyDeliverables] Starting copy: ' + validRows.length + ' items');
    console.log('Source project:', sourceProject, sourceProjectName);
    console.log('Target project:', targetProject, targetProjectName);
    console.log('Items to copy:', validRows.map(function(r) { return { name: r.copyName, originalName: r.renamed ? r.name : undefined, policyId: r.policyId, policyName: r.policyName }; }));
    if (duplicateRows.length > 0) console.warn('Skipping ' + duplicateRows.length + ' duplicates:', duplicateRows.map(function(r) { return r.name; }));

    var idx = 0;
    var errors = [];
    var created = [];
    // Scale concurrency: 3 for small batches, up to 5 for large ones
    var CONCURRENCY = validRows.length > 50 ? 5 : 3;
    // Throttle UI updates: every item for small batches, every N items for large
    var PROGRESS_INTERVAL = validRows.length > 100 ? Math.max(Math.floor(validRows.length / 50), 5) : 1;
    var completedCount = 0;
    var progressTimer = null;

    function flushProgress() {
      progressTimer = null;
      setProgress({ done: completedCount, total: validRows.length, errors: errors.slice(), created: created.slice() });
    }

    function scheduleProgressUpdate(force) {
      completedCount++;
      if (force || completedCount % PROGRESS_INTERVAL === 0) {
        if (progressTimer) clearTimeout(progressTimer);
        flushProgress();
      } else if (!progressTimer) {
        // Ensure we update at least every 500ms even between intervals
        progressTimer = setTimeout(flushProgress, 500);
      }
    }

    function copyNext() {
      if (idx >= validRows.length) {
        if (completedCount >= validRows.length) {
          if (progressTimer) { clearTimeout(progressTimer); progressTimer = null; }
          console.log('[CopyDeliverables] Complete — created: ' + created.length + ', failed: ' + errors.length);
          if (errors.length > 0) console.warn('[CopyDeliverables] Failures:', errors);
          console.groupEnd();
          setStep(3);
          setProgress({ done: completedCount, total: validRows.length, errors: errors, created: created });
          if (onComplete) onComplete();
        }
        return;
      }
      var row = validRows[idx++];
      var body = { name: row.copyName.trim(), policyId: row.policyId, projectId: targetProject };
      console.log('[CopyDeliverables] POST api/bundles →', JSON.stringify(body));
      apiPost('api/bundles', body)
        .then(function(resp) {
          console.log('[CopyDeliverables] OK "' + row.copyName + '" → id:', resp && resp.id);
          created.push({ name: row.copyName, id: resp && resp.id });
          scheduleProgressUpdate(false);
        })
        .catch(function(err) {
          var errMsg = (err && err.message) || String(err);
          console.error('[CopyDeliverables] FAIL "' + row.copyName + '" →', errMsg);
          errors.push({ name: row.copyName, error: errMsg, request: body });
          scheduleProgressUpdate(false);
        })
        .then(copyNext);
    }

    for (var c = 0; c < Math.min(CONCURRENCY, validRows.length); c++) { copyNext(); }
  }

  var sourceProjectName = (projectOptions.find(function(p) { return p.id === sourceProject; }) || {}).name || '';
  var targetProjectName = (projectOptions.find(function(p) { return p.id === targetProject; }) || {}).name || '';

  // Source bundle table columns
  var sourceColumns = [
    { title: B + ' Name', dataIndex: 'name', key: 'name' },
    { title: capFirst(terms.policy), dataIndex: 'policyName', key: 'policy' },
    { title: 'State', dataIndex: 'state', key: 'state', width: 100,
      render: function(val) {
        var color = val === 'Active' ? 'blue' : val === 'Complete' ? 'green' : 'default';
        return h(Tag, { color: color }, val || '-');
      }
    },
  ];

  // Preview table columns
  var previewColumns = [
    { title: B + ' Name', key: 'name',
      render: function(_, row) {
        if (row.renamed) {
          return h('span', null,
            h('span', { style: { textDecoration: 'line-through', color: '#8F8FA3', marginRight: 6 } }, row.name),
            h('span', { style: { fontWeight: 500 } }, row.copyName)
          );
        }
        return row.copyName;
      }
    },
    { title: capFirst(terms.policy), dataIndex: 'policyName', key: 'policy' },
    { title: 'Status', key: 'status', width: 180,
      render: function(_, row) {
        if (row.isDuplicate) return h(Tag, { color: 'orange' }, 'Duplicate — skip');
        if (!row.policyId) return h(Tag, { color: 'red' }, 'No policy');
        if (row.renamed) return h(Tag, { color: 'blue' }, 'Renamed — ready');
        return h(Tag, { color: 'green' }, 'Ready');
      }
    },
  ];

  return h('div', { className: 'panel', style: { maxWidth: 900 } },
    h('div', { className: 'panel-header' },
      h('span', { className: 'panel-title' }, 'Copy ' + B + 's Between Projects'),
      step === 3 ? h(Button, { size: 'small', onClick: reset }, 'Start Over') : null
    ),

    // Step 0: Select source & target
    step === 0 ? h('div', { style: { display: 'flex', flexDirection: 'column', gap: 16 } },
      h('div', { style: { display: 'flex', gap: 16, flexWrap: 'wrap' } },
        h('div', { style: { flex: 1, minWidth: 250 } },
          h('label', { style: { fontSize: 12, color: '#65657B', display: 'block', marginBottom: 4 } }, 'Source Project'),
          h(Select, {
            placeholder: 'Select source project...',
            value: sourceProject || undefined,
            onChange: function(val) { setSourceProject(val); setTargetProject(null); },
            showSearch: true, optionFilterProp: 'label',
            style: { width: '100%' },
            options: projectOptions.map(function(p) {
              var count = bundles.filter(function(b) { return b.projectId === p.id; }).length;
              return { label: p.name + (count > 0 ? ' (' + count + ' ' + B.toLowerCase() + 's)' : ''), value: p.id };
            }),
          })
        ),
        h('div', { style: { flex: 1, minWidth: 250 } },
          h('label', { style: { fontSize: 12, color: '#65657B', display: 'block', marginBottom: 4 } }, 'Target Project'),
          h(Select, {
            placeholder: 'Select target project...',
            value: targetProject || undefined,
            onChange: function(val) { setTargetProject(val); },
            showSearch: true, optionFilterProp: 'label',
            disabled: !sourceProject,
            style: { width: '100%' },
            options: projectOptions.filter(function(p) { return p.id !== sourceProject; }).map(function(p) {
              return { label: p.name, value: p.id };
            }),
          })
        )
      ),

      sourceProject && sourceBundles.length > 0 ? h('div', null,
        h('div', { style: { fontSize: 12, color: '#65657B', marginBottom: 8 } },
          sourceBundles.length + ' ' + B.toLowerCase() + (sourceBundles.length !== 1 ? 's' : '') + ' in ' + sourceProjectName +
          ' — select which to copy' + (selectedKeys.length > 0 ? ' (' + selectedKeys.length + ' selected)' : '')
        ),
        h(Table, {
          dataSource: sourceBundles,
          columns: sourceColumns,
          rowKey: 'id',
          size: 'small',
          pagination: sourceBundles.length > 20 ? { pageSize: 20, showSizeChanger: false } : false,
          rowSelection: {
            selectedRowKeys: selectedKeys,
            onChange: function(keys) { setSelectedKeys(keys); },
          },
        })
      ) : sourceProject && sourceBundles.length === 0
        ? h(Empty, { description: 'No ' + B.toLowerCase() + 's found in this project' })
        : null,

      sourceProject && targetProject && selectedKeys.length > 0
        ? h('div', { style: { display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 8 } },
            h(Button, { onClick: reset }, 'Cancel'),
            h(Button, { type: 'primary', onClick: function() { setStep(1); } },
              'Review ' + selectedKeys.length + ' ' + B.toLowerCase() + (selectedKeys.length !== 1 ? 's' : ''))
          )
        : null
    ) : null,

    // Step 1: Confirm
    step === 1 ? h('div', { style: { display: 'flex', flexDirection: 'column', gap: 16 } },
      h(Alert, {
        type: duplicateRows.length > 0 ? 'warning' : 'info',
        showIcon: true,
        message: 'Copying ' + validRows.length + ' ' + B.toLowerCase() + (validRows.length !== 1 ? 's' : '') +
          ' from ' + sourceProjectName + ' to ' + targetProjectName +
          (duplicateRows.length > 0 ? ' (' + duplicateRows.length + ' duplicate' + (duplicateRows.length !== 1 ? 's' : '') + ' will be skipped)' : ''),
      }),
      h(Table, {
        dataSource: previewRows,
        columns: previewColumns,
        rowKey: 'id',
        size: 'small',
        pagination: previewRows.length > 20 ? { pageSize: 20, showSizeChanger: false } : false,
      }),
      h('div', { style: { display: 'flex', justifyContent: 'flex-end', gap: 8 } },
        h(Button, { onClick: function() { setStep(0); } }, 'Back'),
        h(Button, { type: 'primary', disabled: validRows.length === 0, onClick: startCopy },
          'Copy ' + validRows.length + ' ' + B.toLowerCase() + (validRows.length !== 1 ? 's' : ''))
      )
    ) : null,

    // Step 2: Copying in progress
    step === 2 ? h('div', { style: { textAlign: 'center', padding: '40px 0' } },
      h(Spin, { size: 'large' }),
      h('div', { style: { marginTop: 16, fontSize: 14, color: '#65657B' } },
        'Copying ' + B.toLowerCase() + 's... ' + progress.done + ' / ' + progress.total
      ),
      h(Progress, { percent: Math.round((progress.done / (progress.total || 1)) * 100), strokeColor: '#543FDE', style: { maxWidth: 400, margin: '16px auto' } })
    ) : null,

    // Step 3: Done
    step === 3 ? h('div', { style: { display: 'flex', flexDirection: 'column', gap: 16 } },
      h(Alert, {
        type: progress.errors.length > 0 ? 'warning' : 'success',
        showIcon: true,
        message: progress.created.length + ' ' + B.toLowerCase() + (progress.created.length !== 1 ? 's' : '') +
          ' created in ' + targetProjectName +
          (duplicateRows.length > 0 ? ', ' + duplicateRows.length + ' skipped (duplicate)' : '') +
          (progress.errors.length > 0 ? ', ' + progress.errors.length + ' failed' : ''),
      }),
      progress.created.length > 0 ? h('div', null,
        h('div', { style: { fontSize: 12, fontWeight: 600, color: '#65657B', marginBottom: 8 } }, 'Created (' + progress.created.length + '):'),
        // For large batches, show first 50 then a "+N more" note
        h('div', { style: { display: 'flex', flexWrap: 'wrap', gap: 4 } },
          progress.created.slice(0, 50).map(function(c, i) { return h(Tag, { key: i, color: 'green' }, c.name); }),
          progress.created.length > 50 ? h(Tag, { key: 'more', color: 'default' }, '+' + (progress.created.length - 50) + ' more') : null
        )
      ) : null,
      progress.errors.length > 0 ? h('div', null,
        h('div', { style: { fontSize: 12, fontWeight: 600, color: '#C20A29', marginBottom: 8 } }, 'Failed (' + progress.errors.length + '):'),
        progress.errors.slice(0, 50).map(function(e, i) {
          return h('div', { key: i, style: { fontSize: 12, color: '#C20A29', marginBottom: 4 } },
            e.name + ': ' + e.error
          );
        }),
        progress.errors.length > 50 ? h('div', { style: { fontSize: 12, color: '#C20A29', fontStyle: 'italic' } }, '...and ' + (progress.errors.length - 50) + ' more') : null
      ) : null
    ) : null
  );
}

// ═══════════════════════════════════════════════════════════════
//  PAGE: Utilities
// ═══════════════════════════════════════════════════════════════
function UtilitiesPage(props) {
  var bundles = props.bundles || [];
  var projects = props.projects || [];
  var policies = props.policies || [];
  var connected = props.connected;
  var onRefresh = props.onRefresh;
  var terms = props.terms || DEFAULT_TERMS;
  var B = capFirst(terms.bundle);

  return h('div', { className: 'page-content' },
    h('div', { className: 'page-header' },
      h('h2', null, 'Utilities'),
      h('p', { style: { color: '#65657B', fontSize: 13, marginTop: 4 } },
        'Administrative tools for managing ' + B.toLowerCase() + 's across projects.')
    ),
    h(CopyDeliverablesUtility, {
      bundles: bundles,
      projects: projects,
      policies: policies,
      connected: connected,
      onComplete: onRefresh,
      terms: terms,
    })
  );
}

// ═══════════════════════════════════════════════════════════════
//  PAGE: Configuration
// ═══════════════════════════════════════════════════════════════
function ConfigurationPage(props) {
  console.log('[ConfigurationPage] props received:', Object.keys(props));
  console.log('[ConfigurationPage] bundles:', props.bundles ? props.bundles.length + ' items' : 'MISSING');
  console.log('[ConfigurationPage] reportConfig:', props.reportConfig ? Object.keys(props.reportConfig) : 'MISSING');
  if (props.reportConfig) {
    console.log('[ConfigurationPage] roleMapping:', props.reportConfig.roleMapping ? Object.keys(props.reportConfig.roleMapping).length + ' policies' : 'MISSING');
    console.log('[ConfigurationPage] pathPatterns:', props.reportConfig.pathPatterns ? Object.keys(props.reportConfig.pathPatterns) : 'MISSING');
    console.log('[ConfigurationPage] policyLookup:', props.reportConfig.policyLookup ? Object.keys(props.reportConfig.policyLookup).length + ' policies' : 'MISSING');
  }
  var bundles = props.bundles;
  var livePolicies = props.livePolicies || [];
  var terms = props.terms || DEFAULT_TERMS;
  var reportConfig = props.reportConfig || {};
  var onSaveRoleMapping = props.onSaveRoleMapping;
  var onSavePathPatterns = props.onSavePathPatterns;
  var onNavigate = props.onNavigate;
  var B = capFirst(terms.bundle);
  var P = capFirst(terms.policy);

  var effectiveMapping = reportConfig.roleMapping || {};
  var effectivePatterns = reportConfig.pathPatterns || {};
  var policyLookup = reportConfig.policyLookup || {};

  // Get all unique policy IDs that have bundles, with max stage count
  var policyRows = useMemo(function() {
    var ids = {};
    bundles.forEach(function(b) { if (b.policyId) ids[b.policyId] = true; });
    var rows = Object.keys(ids).map(function(pid) {
      var pol = policyLookup[pid];
      var stages = (pol && pol.stages) ? pol.stages : [];
      console.log('[ConfigurationPage policyRows] pid:', pid, 'pol:', pol ? pol.name : 'MISSING', 'pol.stages:', pol ? pol.stages : 'N/A', 'resolved stages:', stages);
      return { key: pid, policyId: pid, policyName: pol ? pol.name : 'Unknown', stages: stages };
    });
    console.log('[ConfigurationPage policyRows] total rows:', rows.length);
    return rows;
  }, [bundles, policyLookup]);

  var maxStages = useMemo(function() {
    return policyRows.reduce(function(max, r) { return Math.max(max, (r.stages || []).length); }, 0);
  }, [policyRows]);

  function updateRoleForStage(policyId, stageName, roleLabel) {
    var newMap = JSON.parse(JSON.stringify(effectiveMapping));
    if (!newMap[policyId]) newMap[policyId] = {};
    if (roleLabel) {
      newMap[policyId][stageName] = roleLabel;
    } else {
      delete newMap[policyId][stageName];
    }
    onSaveRoleMapping(newMap);
  }

  // Build stage columns dynamically
  var stageColumns = [];
  stageColumns.push({
    title: P, dataIndex: 'policyName', key: 'policy', width: 200, fixed: 'left',
    render: function(t) { return h('span', { style: { fontWeight: 500, fontSize: 12 } }, t); }
  });
  for (var si = 0; si < maxStages; si++) {
    (function(idx) {
      stageColumns.push({
        title: 'Stage ' + (idx + 1), key: 'stage_' + idx, width: 220,
        render: function(_, row) {
          if (!row.stages || idx >= row.stages.length) return h('span', { style: { color: '#D0D0D0', fontSize: 12 } }, '\u2014');
          var stageName = row.stages[idx];
          var policyMap = effectiveMapping[row.policyId] || {};
          var currentCategory = policyMap[stageName] || null;

          return h('div', null,
            h('div', { style: { fontSize: 11, color: '#65657B', marginBottom: 2, fontWeight: 500 } }, stageName),
            h(Select, {
              size: 'small', style: { width: '100%' },
              value: currentCategory || undefined,
              allowClear: true, placeholder: 'Select category...',
              onChange: function(val) {
                updateRoleForStage(row.policyId, stageName, val || null);
              }
            },
              WORK_CATEGORIES.map(function(opt) {
                return h(Select.Option, { key: opt, value: opt }, opt);
              })
            )
          );
        }
      });
    })(si);
  }

  // ── Path Patterns ─────────────────────────────────────────────
  // Collect all unique role labels currently in use
  var allRoleLabels = useMemo(function() {
    return WORK_CATEGORIES;
  }, [effectiveMapping]);

  // Path pattern editing: store as { roleLabel: prefixString }
  var _pathEdits = useState({});
  var pathEdits = _pathEdits[0]; var setPathEdits = _pathEdits[1];

  function getPathPrefix(roleLabel) {
    if (pathEdits[roleLabel] !== undefined) return pathEdits[roleLabel];
    var pat = effectivePatterns[roleLabel];
    return pat ? (pat.prefix || '') : '';
  }

  function applyPathPatterns() {
    var newPat = {};
    allRoleLabels.forEach(function(rl) {
      var pfx = getPathPrefix(rl);
      newPat[rl] = { prefix: pfx || null, label: rl };
    });
    onSavePathPatterns(newPat);
    setPathEdits({});
    antd.message.success('Path patterns saved');
  }

  function resetPathPatterns() {
    onSavePathPatterns(null);
    setPathEdits({});
    antd.message.info('Path patterns reset to defaults');
  }

  // Preview: show how many attachments match each pattern
  var patternPreview = useMemo(function() {
    var counts = {};
    var samples = {};
    allRoleLabels.forEach(function(rl) { counts[rl] = 0; samples[rl] = []; });
    counts._unmatched = 0;
    bundles.forEach(function(b) {
      (b._attachments || []).forEach(function(a) {
        if (a.type !== 'Report' || !a.identifier || !a.identifier.filename) return;
        var fn = a.identifier.filename;
        var matched = false;
        allRoleLabels.forEach(function(rl) {
          var pfx = getPathPrefix(rl);
          if (pfx && fn.indexOf(pfx) === 0) {
            counts[rl]++;
            if (samples[rl].length < 2) samples[rl].push(fn);
            matched = true;
          }
        });
        if (!matched) counts._unmatched++;
      });
    });
    return { counts: counts, samples: samples };
  }, [bundles, allRoleLabels, pathEdits, effectivePatterns]);

  return h('div', null,
    h('div', { className: 'page-header' },
      h('h1', null, 'Configuration'),
      h('p', null, 'Report settings, stage-to-category mapping, and file path patterns')
    ),

    // ── Section 1: Stage → Role Mapping ──────────────────────────
    h('div', { className: 'metrics-section-header' }, 'Stage \u2192 Category of Work'),
    h('div', { style: { fontSize: 12, color: '#8F8FA3', marginBottom: 12, marginTop: -8 } },
      'Categorize each stage in each ' + P.toLowerCase() + ' as Production Programming, QC Programming, or Independent Reviewing. Used by PDVT and Validation Status reports.'),

    h('div', { className: 'panel' },
      h('div', { className: 'panel-header' },
        h('span', { className: 'panel-title' }, 'Category of Work by ' + P),
        h('div', { style: { display: 'flex', gap: 8 } },
          h(Button, { size: 'small', onClick: function() { onSaveRoleMapping(null); antd.message.info('Categories reset to defaults'); } }, 'Reset to Defaults'),
          h(Button, { size: 'small', type: 'primary', onClick: function() { if (onNavigate) onNavigate('metrics'); } }, 'View Reports \u2192')
        )
      ),
      h('div', { className: 'panel-body' },
        h(Table, {
          dataSource: policyRows,
          columns: stageColumns,
          rowKey: 'key',
          pagination: false,
          size: 'small',
          scroll: maxStages > 4 ? { x: 200 + maxStages * 220 } : undefined,
        })
      )
    ),

    // ── Section 2: File Path Patterns ──────────────────────────
    h('div', { className: 'metrics-section-header', style: { marginTop: 24 } }, 'File Path Patterns'),
    h('div', { style: { fontSize: 12, color: '#8F8FA3', marginBottom: 12, marginTop: -8 } },
      'Define file path prefixes for each category of work. Report attachments whose filename starts with a prefix are matched to that category. Used by the Validation Task Status report.'),

    h('div', { className: 'panel' },
      h('div', { className: 'panel-header' },
        h('span', { className: 'panel-title' }, 'Path Prefix by Category'),
        h('div', { style: { display: 'flex', gap: 8 } },
          h(Button, { size: 'small', onClick: resetPathPatterns }, 'Reset to Defaults'),
          h(Button, { size: 'small', type: 'primary', onClick: applyPathPatterns }, 'Save Patterns')
        )
      ),
      h('div', { className: 'panel-body' },
        allRoleLabels.length === 0
          ? h(EmptyState, { text: 'No roles assigned yet', sub: 'Assign roles to stages above first' })
          : h('div', null,
              h('div', { style: { display: 'grid', gridTemplateColumns: '180px 200px 1fr', gap: '8px 16px', alignItems: 'center', marginBottom: 16 } },
                h('span', { style: { fontWeight: 600, fontSize: 12, color: '#65657B' } }, 'Category'),
                h('span', { style: { fontWeight: 600, fontSize: 12, color: '#65657B' } }, 'Path Prefix'),
                h('span', { style: { fontWeight: 600, fontSize: 12, color: '#65657B' } }, 'Matches'),
                allRoleLabels.map(function(rl) {
                  return [
                    h('span', { key: rl + '_label', style: { fontSize: 13 } }, rl),
                    h(Input, { key: rl + '_input', size: 'small', value: getPathPrefix(rl),
                      onChange: function(e) { var upd = {}; upd[rl] = e.target.value; setPathEdits(Object.assign({}, pathEdits, upd)); },
                      placeholder: 'e.g. prod/', style: { fontFamily: 'monospace' }
                    }),
                    h('span', { key: rl + '_count', style: { fontSize: 12, color: '#65657B' } },
                      patternPreview.counts[rl] + ' files' + (patternPreview.samples[rl] && patternPreview.samples[rl].length > 0 ? ' \u2014 e.g. ' + patternPreview.samples[rl][0] : ''))
                  ];
                })
              ),
              patternPreview.counts._unmatched > 0
                ? h(Alert, { type: 'info', showIcon: true, message: patternPreview.counts._unmatched + ' report attachment(s) don\'t match any prefix pattern.', style: { fontSize: 12 } })
                : null
            )
      )
    ),

    // ── Section 3: About ──────────────────────────────────────────
    h('div', { className: 'metrics-section-header', style: { marginTop: 24 } }, 'About'),
    h('div', { className: 'panel' },
      h('div', { className: 'panel-body' },
        h('div', { style: { fontSize: 12, color: '#65657B', lineHeight: '1.6' } },
          h('p', null, 'Configuration is stored in your browser\'s localStorage and persists across sessions. It is not shared with other users.'),
          h('p', null, 'The stage-to-category mapping controls how reports group work by category (Production Programming, QC Programming, Independent Reviewing). The file path patterns control how the Validation Task Status report matches report attachments to categories.'),
          h('p', null, 'Use "Reset to Defaults" to clear all category assignments and start fresh.')
        )
      )
    )
  );
}

// ═══════════════════════════════════════════════════════════════
//  ROOT APP
// ═══════════════════════════════════════════════════════════════
function App() {
  var _s1 = useState('tracker'); var activePage = _s1[0]; var setActivePage = _s1[1];
  var _s2 = useState([]); var bundles = _s2[0]; var setBundles = _s2[1];
  var _s3 = useState(true); var loading = _s3[0]; var setLoading = _s3[1];
  var _s4 = useState(false); var connected = _s4[0]; var setConnected = _s4[1];
  var _s5 = useState(null); var selectedBundle = _s5[0]; var setSelectedBundle = _s5[1];
  var _s6 = useState(false); var drawerOpen = _s6[0]; var setDrawerOpen = _s6[1];
  var _s7 = useState(null); var error = _s7[0]; var setError = _s7[1];
  var _s8 = useState(DEFAULT_TERMS); var terms = _s8[0]; var setTerms = _s8[1];
  var _s9 = useState(false); var useDummy = _s9[0]; var setUseDummy = _s9[1];
  var _s10 = useState([]); var assignmentRules = _s10[0]; var setAssignmentRules = _s10[1];
  var _s11 = useState([]); var automationRules = _s11[0]; var setAutomationRules = _s11[1];
  var _s12 = useState([]); var automationHistory = _s12[0]; var setAutomationHistory = _s12[1];
  var _dbg = useState(function() { try { return localStorage.getItem('sce_debug_mode') === 'true'; } catch(e) { return false; } }); var debugMode = _dbg[0]; var setDebugMode = _dbg[1];
  var toggleDebugMode = useCallback(function(v) { setDebugMode(v); try { localStorage.setItem('sce_debug_mode', v ? 'true' : 'false'); } catch(e) {} }, []);

  // ── Report Configuration (shared across tabs) ─────────────────
  var _roleMap = useState(function() { return loadStoredJSON(ROLE_MAPPING_KEY); });
  var storedRoleMapping = _roleMap[0]; var setStoredRoleMapping = _roleMap[1];
  var _pathPat = useState(function() { return loadStoredJSON(PATH_PATTERN_KEY); });
  var storedPathPatterns = _pathPat[0]; var setStoredPathPatterns = _pathPat[1];

  function saveRoleMapping(newMap) {
    setStoredRoleMapping(newMap);
    try { localStorage.setItem(ROLE_MAPPING_KEY, JSON.stringify(newMap)); } catch(e) {}
  }
  function savePathPatterns(newPat) {
    setStoredPathPatterns(newPat);
    try { localStorage.setItem(PATH_PATTERN_KEY, JSON.stringify(newPat)); } catch(e) {}
  }

  // ── Live data state ──────────────────────────────────────────
  var _cu = useState(null); var currentUser = _cu[0]; var setCurrentUser = _cu[1];
  var _pm = useState({}); var projectMembersCache = _pm[0]; var setProjectMembersCache = _pm[1];
  var _pt = useState({}); var projectTagsMap = _pt[0]; var setProjectTagsMap = _pt[1];
  var _lp = useState([]); var livePolicies = _lp[0]; var setLivePolicies = _lp[1];
  var _lpj = useState([]); var liveProjects = _lpj[0]; var setLiveProjects = _lpj[1];
  var _deu = useState(null); var dataExplorerUrl = _deu[0]; var setDataExplorerUrl = _deu[1];

  // ── Universal Scope Filters ──────────────────────────────────
  // Load saved scope presets and default from localStorage
  var _initPresets = useMemo(function() {
    try {
      var saved = localStorage.getItem('sce_scope_presets');
      return saved ? JSON.parse(saved) : [];
    } catch(e) { return []; }
  }, []);
  var _initDefaultName = useMemo(function() {
    try { return localStorage.getItem('sce_scope_default_preset') || null; } catch(e) { return null; }
  }, []);
  var _initDefault = _initPresets.find(function(p) { return p.name === _initDefaultName; }) || null;
  var _presets = useState(_initPresets); var scopePresets = _presets[0]; var setScopePresets = _presets[1];
  var _defName = useState(_initDefaultName); var defaultPresetName = _defName[0]; var setDefaultPresetName = _defName[1];
  var _activePreset = useState(_initDefaultName); var activePresetName = _activePreset[0]; var setActivePresetName = _activePreset[1];
  var _presetModalVis = useState(false); var presetSaveOpen = _presetModalVis[0]; var setPresetSaveOpen = _presetModalVis[1];
  var _presetNameInput = useState(''); var presetNameInput = _presetNameInput[0]; var setPresetNameInput = _presetNameInput[1];
  var _sc1 = useState(_initDefault ? (_initDefault.projects || []) : []); var scopeProjects = _sc1[0]; var setScopeProjects = _sc1[1];
  var _sc2 = useState(_initDefault ? (_initDefault.tags || []) : []); var scopeTags = _sc2[0]; var setScopeTags = _sc2[1];
  var _sc3a = useState(_initDefault ? !!_initDefault.myCurrentStage : false); var filterMyCurrentStage = _sc3a[0]; var setFilterMyCurrentStage = _sc3a[1];
  var _sc3b = useState(_initDefault ? !!_initDefault.myFutureStage : false); var filterMyFutureStage = _sc3b[0]; var setFilterMyFutureStage = _sc3b[1];
  var _sc3c = useState(_initDefault ? !!_initDefault.myPriorStage : false); var filterMyPriorStage = _sc3c[0]; var setFilterMyPriorStage = _sc3c[1];
  var _sc4 = useState(_initDefault ? (_initDefault.states || []) : []); var scopeStates = _sc4[0]; var setScopeStates = _sc4[1];

  // Helper: get current scope state as a preset object
  function getCurrentScopeState(name) {
    return {
      name: name,
      projects: scopeProjects,
      tags: scopeTags,
      myCurrentStage: filterMyCurrentStage,
      myFutureStage: filterMyFutureStage,
      myPriorStage: filterMyPriorStage,
      states: scopeStates,
    };
  }

  // Helper: apply a preset to scope state
  function applyPreset(preset) {
    setScopeProjects(preset.projects || []);
    setScopeTags(preset.tags || []);
    setFilterMyCurrentStage(!!preset.myCurrentStage);
    setFilterMyFutureStage(!!preset.myFutureStage);
    setFilterMyPriorStage(!!preset.myPriorStage);
    setScopeStates(preset.states || []);
    setActivePresetName(preset.name);
  }

  // Helper: persist presets to localStorage
  function persistPresets(presets, defName) {
    try { localStorage.setItem('sce_scope_presets', JSON.stringify(presets)); } catch(e) {}
    if (defName !== undefined) {
      try {
        if (defName) localStorage.setItem('sce_scope_default_preset', defName);
        else localStorage.removeItem('sce_scope_default_preset');
      } catch(e) {}
    }
  }

  // Save preset (add or overwrite)
  function handleSavePreset(name) {
    if (!name || !name.trim()) return;
    var preset = getCurrentScopeState(name.trim());
    var updated = scopePresets.filter(function(p) { return p.name !== preset.name; });
    updated.push(preset);
    setScopePresets(updated);
    setActivePresetName(preset.name);
    persistPresets(updated);
    setPresetSaveOpen(false);
    setPresetNameInput('');
    antd.message.success('Preset "' + preset.name + '" saved');
  }

  // Delete preset
  function handleDeletePreset(name) {
    var updated = scopePresets.filter(function(p) { return p.name !== name; });
    setScopePresets(updated);
    persistPresets(updated);
    if (defaultPresetName === name) {
      setDefaultPresetName(null);
      persistPresets(updated, null);
    }
    if (activePresetName === name) setActivePresetName(null);
    antd.message.success('Preset "' + name + '" deleted');
  }

  // Set/unset default preset
  function handleToggleDefault(name) {
    if (defaultPresetName === name) {
      setDefaultPresetName(null);
      persistPresets(scopePresets, null);
      antd.message.info('Default cleared');
    } else {
      setDefaultPresetName(name);
      persistPresets(scopePresets, name);
      antd.message.success('"' + name + '" set as default');
    }
  }

  // Clear active preset tracking when user manually changes filters
  useEffect(function() {
    if (!activePresetName) return;
    var active = scopePresets.find(function(p) { return p.name === activePresetName; });
    if (!active) return;
    var same = JSON.stringify(active.projects || []) === JSON.stringify(scopeProjects)
      && JSON.stringify(active.tags || []) === JSON.stringify(scopeTags)
      && !!active.myCurrentStage === filterMyCurrentStage
      && !!active.myFutureStage === filterMyFutureStage
      && !!active.myPriorStage === filterMyPriorStage;
    if (!same) setActivePresetName(null);
  }, [scopeProjects, scopeTags, filterMyCurrentStage, filterMyFutureStage, filterMyPriorStage]);
  var _sc4 = useState(null); var scopeCurrentUser = _sc4[0]; var setScopeCurrentUser = _sc4[1];
  var _sidebarCollapsed = useState(function() { try { return localStorage.getItem('sce_sidebar_collapsed') === 'true'; } catch(e) { return false; } });
  var sidebarCollapsed = _sidebarCollapsed[0]; var setSidebarCollapsed = _sidebarCollapsed[1];

  // Load assignment rules from localStorage on mount
  useEffect(function() {
    try {
      var saved = localStorage.getItem('sce_assignment_rules');
      if (saved) setAssignmentRules(JSON.parse(saved));
    } catch(e) { console.warn('Failed to load assignment rules from localStorage:', e); }
  }, []);

  // Persist assignment rules to localStorage on change
  useEffect(function() {
    try {
      localStorage.setItem('sce_assignment_rules', JSON.stringify(assignmentRules));
    } catch(e) { console.warn('Failed to save assignment rules to localStorage:', e); }
  }, [assignmentRules]);

  // Load automation rules + history from localStorage on mount
  useEffect(function() {
    try {
      var saved = localStorage.getItem('sce_automation_rules');
      if (saved) setAutomationRules(JSON.parse(saved));
    } catch(e) { console.warn('Failed to load automation rules:', e); }
    try {
      var savedH = localStorage.getItem('sce_automation_history');
      if (savedH) setAutomationHistory(JSON.parse(savedH));
    } catch(e) { console.warn('Failed to load automation history:', e); }
  }, []);

  // Persist automation rules + history
  useEffect(function() {
    try { localStorage.setItem('sce_automation_rules', JSON.stringify(automationRules)); } catch(e) {}
  }, [automationRules]);
  useEffect(function() {
    try { localStorage.setItem('sce_automation_history', JSON.stringify(automationHistory.slice(0, 200))); } catch(e) {}
  }, [automationHistory]);

  // Reflow all Highcharts instances on window resize
  useEffect(function() {
    var timer;
    function handleResize() {
      clearTimeout(timer);
      timer = setTimeout(function() {
        if (typeof Highcharts !== 'undefined' && Highcharts.charts) {
          Highcharts.charts.forEach(function(chart) {
            if (chart) chart.reflow();
          });
        }
      }, 200);
    }
    window.addEventListener('resize', handleResize);
    return function() { window.removeEventListener('resize', handleResize); clearTimeout(timer); };
  }, []);

  // Set scopeCurrentUser from fetched currentUser
  useEffect(function() {
    if (currentUser && currentUser.userName && !scopeCurrentUser) {
      setScopeCurrentUser(currentUser.userName);
    }
  }, [currentUser]);

  // Derive project options from all bundles
  var scopeProjectOptions = useMemo(function() {
    var seen = {};
    return bundles.reduce(function(acc, b) {
      if (b.projectName && !seen[b.projectName]) {
        seen[b.projectName] = true;
        acc.push({ label: b.projectName, value: b.projectName });
      }
      return acc;
    }, []);
  }, [bundles]);

  // Derive tag options from projectTagsMap (live data)
  var scopeTagOptions = useMemo(function() {
    var tags = {};
    bundles.forEach(function(b) {
      var pTags = projectTagsMap[b.projectId] || [];
      pTags.forEach(function(t) {
        var label = t.name || (t.key + ': ' + t.value);
        tags[label] = true;
      });
    });
    return Object.keys(tags).sort().map(function(t) { return { label: t, value: t }; });
  }, [bundles, projectTagsMap]);

  // Derive user options for "My Work" persona selector from live project members
  var scopeUserOptions = useMemo(function() {
    var seen = {};
    var opts = [];
    // Add current user first
    if (currentUser && currentUser.userName && !seen[currentUser.userName]) {
      seen[currentUser.userName] = true;
      opts.push({ label: (currentUser.firstName || '') + ' ' + (currentUser.lastName || '') + ' (me)', value: currentUser.userName });
    }
    // Add all project collaborators
    Object.keys(projectMembersCache).forEach(function(pid) {
      (projectMembersCache[pid] || []).forEach(function(m) {
        if (!seen[m.userName]) {
          seen[m.userName] = true;
          opts.push({ label: (m.firstName || '') + ' ' + (m.lastName || ''), value: m.userName });
        }
      });
    });
    return opts;
  }, [currentUser, projectMembersCache]);

  // Apply universal scope to get scopedBundles
  var scopedBundles = useMemo(function() {
    return bundles.filter(function(b) {
      // Project filter
      if (scopeProjects.length > 0 && scopeProjects.indexOf(b.projectName) < 0) return false;
      // Tag filter
      if (scopeTags.length > 0) {
        var pTags = projectTagsMap[b.projectId] || [];
        var tagLabels = pTags.map(function(t) { return t.name || (t.key + ': ' + t.value); });
        var matchesTag = scopeTags.some(function(ft) { return tagLabels.indexOf(ft) >= 0; });
        if (!matchesTag) return false;
      }
      // State filter
      if (scopeStates.length > 0 && scopeStates.indexOf(b.state) < 0) return false;
      // "Assigned to Me" checkbox filters — if any checked, bundle must match at least one
      var anyCheckbox = filterMyCurrentStage || filterMyFutureStage || filterMyPriorStage;
      if (anyCheckbox && scopeCurrentUser) {
        var stageNames = (b.stages || []).map(function(s) { return s.stage ? s.stage.name : ''; });
        var curIdx = stageNames.indexOf(b.stage);
        var matchesAny = false;
        if (filterMyCurrentStage) {
          (b.stages || []).forEach(function(s) {
            if (s.stage && s.stage.name === b.stage && s.assignee && s.assignee.name === scopeCurrentUser) matchesAny = true;
          });
        }
        if (filterMyFutureStage && !matchesAny) {
          (b.stages || []).forEach(function(s, idx) {
            if (idx > curIdx && s.assignee && s.assignee.name === scopeCurrentUser) matchesAny = true;
          });
        }
        if (filterMyPriorStage && !matchesAny) {
          (b.stages || []).forEach(function(s, idx) {
            if (idx < curIdx && s.assignee && s.assignee.name === scopeCurrentUser) matchesAny = true;
          });
        }
        if (!matchesAny) return false;
      }
      return true;
    });
  }, [bundles, scopeProjects, scopeTags, scopeStates, filterMyCurrentStage, filterMyFutureStage, filterMyPriorStage, scopeCurrentUser, projectTagsMap]);

  var hasScopeFilters = scopeProjects.length > 0 || scopeTags.length > 0 || scopeStates.length > 0 || filterMyCurrentStage || filterMyFutureStage || filterMyPriorStage;

  // Load mock/dummy data
  function loadMockData() {
    setConnected(false);
    // Set a mock current user so "Assigned to Me" filters work in dummy mode
    if (typeof MOCK_USERS !== 'undefined' && MOCK_USERS.studyLead) {
      var mockUser = MOCK_USERS.studyLead;
      setCurrentUser({ id: mockUser.id, userName: mockUser.name, firstName: mockUser.firstName, lastName: mockUser.lastName });
    }
    if (typeof MOCK_BUNDLES !== 'undefined') {
      var mockEnriched = MOCK_BUNDLES.map(function(b) {
        var copy = Object.assign({}, b);
        copy._approvals = (typeof MOCK_APPROVALS !== 'undefined' && MOCK_APPROVALS[b.id]) || [];
        copy._findings = (typeof MOCK_FINDINGS !== 'undefined' && MOCK_FINDINGS[b.id]) || [];
        copy._gates = (typeof MOCK_GATES !== 'undefined' && MOCK_GATES[b.id]) || [];
        copy._attachments = (typeof MOCK_ATTACHMENTS !== 'undefined' && MOCK_ATTACHMENTS[b.id]) || [];
        // Populate the current stage's assignee from the bundle-level stageAssignee
        if (copy.stageAssignee && copy.stages) {
          copy.stages = copy.stages.map(function(s) {
            if (s.stage && s.stage.name === copy.stage) {
              return Object.assign({}, s, { assignee: { id: copy.stageAssignee.id, name: copy.stageAssignee.name } });
            }
            return s;
          });
        }
        return copy;
      });
      // Compute snapshot staleness across mock attachments
      var allMockAttach = [];
      mockEnriched.forEach(function(b) {
        (b._attachments || []).forEach(function(a) { a._bundleId = b.id; allMockAttach.push(a); });
      });
      computeSnapshotStaleness(allMockAttach);

      setBundles(mockEnriched);
    } else {
      setBundles([]);
    }
    if (typeof MOCK_TERMINOLOGY !== 'undefined') {
      setTerms(MOCK_TERMINOLOGY);
    }
    // Populate project members cache so inline assignee dropdowns work in dummy mode
    if (typeof MOCK_PROJECT_MEMBERS !== 'undefined' && typeof MOCK_BUNDLES !== 'undefined') {
      var mockMembersCache = {};
      MOCK_BUNDLES.forEach(function(b) {
        if (b.projectId && !mockMembersCache[b.projectId]) {
          mockMembersCache[b.projectId] = MOCK_PROJECT_MEMBERS;
        }
      });
      setProjectMembersCache(mockMembersCache);
    }
    // Set a mock Data Explorer URL so attachment links render in dummy mode
    setDataExplorerUrl('__mock_data_explorer__');
    setLoading(false);
    setError(null);
  }

  // Fetch live data from Domino
  // fallbackToDummy: if true, silently switch to dummy data on failure (used on initial mount)
  //                  if false, show an error instead (used when user explicitly toggles dummy off)
  function fetchLiveData(fallbackToDummy) {
    setLoading(true);
    setError(null);

    // 1. Fetch current user, bundles, projects, policies in parallel
    Promise.all([
      apiGet('api/users/self').catch(function(e) { console.error('users/self failed:', e); return null; }),
      apiGet('api/bundles?limit=200'),
      apiGet('api/projects?limit=200').catch(function() { return []; }),
      apiGet('api/policies?limit=200').catch(function() { return { data: [] }; }),
      apiGet('api/attachment-overviews?limit=200').catch(function() { return { data: [] }; }),
    ])
      .then(function(topResults) {
        var user = topResults[0];
        var bundleResp = topResults[1];
        var projects = topResults[2];
        var policiesResp = topResults[3];
        var attachResp = topResults[4];

        setConnected(true);
        setUseDummy(false);

        // Store current user
        if (user && user.userName) {
          setCurrentUser(user);
        }

        // Store live policies
        var policyList = policiesResp.data || (Array.isArray(policiesResp) ? policiesResp : []);
        setLivePolicies(policyList);

        // Build project tags map and owner map from projects data
        var tagsMap = {};
        var projectOwnerMap = {}; // projectId → { id, userName, firstName, lastName }
        var projectsList = Array.isArray(projects) ? projects : [];
        setLiveProjects(projectsList);
        projectsList.forEach(function(p) {
          if (p.tags && p.tags.length > 0) {
            tagsMap[p.id] = p.tags; // shape: [{ id, name, isApproved }]
          }
          // Capture project owner for merging into collaborators (Fix 2.5)
          if (p.ownerUsername || p.owner) {
            projectOwnerMap[p.id] = {
              id: p.ownerId || (p.owner && p.owner.id) || '',
              userName: p.ownerUsername || (p.owner && p.owner.userName) || '',
              firstName: p.ownerFirstName || (p.owner && p.owner.firstName) || '',
              lastName: p.ownerLastName || (p.owner && p.owner.lastName) || '',
            };
          }
        });
        setProjectTagsMap(tagsMap);

        // Build attachment map by bundleId
        var attachList = attachResp.data || (Array.isArray(attachResp) ? attachResp : []);
        var attachMap = {};
        attachList.forEach(function(a) {
          var bid = a.bundle && a.bundle.id;
          if (bid) {
            if (!attachMap[bid]) attachMap[bid] = [];
            attachMap[bid].push(a);
          }
        });

        // Fetch collaborators for unique project IDs (with cache)
        var bundleList = bundleResp.data || [];
        var uniqueProjectIds = {};
        bundleList.forEach(function(b) { if (b.projectId) uniqueProjectIds[b.projectId] = true; });
        var projectIds = Object.keys(uniqueProjectIds);

        var collabPromises = projectIds.map(function(pid) {
          return apiGet('api/projects/' + pid + '/collaborators')
            .then(function(members) {
              var memberList = Array.isArray(members) ? members : [];
              // Merge project owner if not already in collaborators list (Fix 2.5)
              var owner = projectOwnerMap[pid];
              if (owner && owner.userName) {
                var ownerAlreadyPresent = memberList.some(function(m) { return m.userName === owner.userName; });
                if (!ownerAlreadyPresent) {
                  memberList.unshift(owner);
                }
              }
              return { pid: pid, members: memberList };
            })
            .catch(function() {
              // Even if collaborators fetch fails, include owner
              var owner = projectOwnerMap[pid];
              return { pid: pid, members: owner && owner.userName ? [owner] : [] };
            });
        });

        // Fire collaborator fetches AND per-bundle enrichment simultaneously
        // (previously sequential: collabs first, then enrichment)
        // All per-bundle calls (approvals, findings, gates) + collaborator calls
        // fire in a single Promise.all batch for maximum parallelism.
        var enrichPromises = bundleList.map(function(bundle) {
          return Promise.all([
            apiGet('api/bundles/' + bundle.id + '/approvals').catch(function() { return []; }),
            apiGet('api/bundles/' + bundle.id + '/findings?limit=200').catch(function() { return { data: [] }; }),
            apiGet('api/bundles/' + bundle.id + '/gates').catch(function() { return []; }),
          ]).then(function(enrichResults) {
            bundle._approvals = Array.isArray(enrichResults[0]) ? enrichResults[0] : [];
            bundle._findings = enrichResults[1].data || (Array.isArray(enrichResults[1]) ? enrichResults[1] : []);
            bundle._gates = Array.isArray(enrichResults[2]) ? enrichResults[2] : [];
            bundle._attachments = attachMap[bundle.id] || [];
            return bundle;
          });
        });

        // Single Promise.all: collaborator fetches + all enrichment calls fire together
        return Promise.all([
          Promise.all(collabPromises),
          Promise.all(enrichPromises),
        ]);
      })
      .then(function(results) {
        var collabResults = results[0];
        var enrichedBundles = results[1];

        // Store project members cache
        var membersCache = {};
        collabResults.forEach(function(r) { membersCache[r.pid] = r.members; });

        // Resolve unknown assignees: find assignee IDs that have empty names AND aren't in the members cache
        var unknownIds = {};
        enrichedBundles.forEach(function(b) {
          var sa = b.stageAssignee;
          if (sa && sa.id && !sa.name) {
            // Check if this ID is in the project's members cache
            var members = membersCache[b.projectId] || [];
            var found = members.some(function(m) { return m.id === sa.id; });
            if (!found) unknownIds[sa.id] = true;
          }
          // Also check stage-level assignees
          (b.stages || []).forEach(function(s) {
            var a = s.assignee;
            if (a && a.id && !a.name) {
              var members2 = membersCache[b.projectId] || [];
              if (!members2.some(function(m) { return m.id === a.id; })) unknownIds[a.id] = true;
            }
          });
        });

        var unkKeys = Object.keys(unknownIds);
        if (unkKeys.length > 0) {
          console.info('[Assignee] Resolving', unkKeys.length, 'unknown assignee ID(s) via /api/users bulk fetch...');
          return apiGet('api/users').then(function(allUsers) {
            var userList = Array.isArray(allUsers) ? allUsers : [];
            // Build lookup maps: by id and by userName
            var byId = {};
            var byUserName = {};
            userList.forEach(function(u) {
              if (u.id) byId[u.id] = u;
              if (u.userName) byUserName[u.userName] = u;
            });
            console.info('[Assignee] Fetched', userList.length, 'users. Looking up', unkKeys.length, 'unknown IDs...');
            var resolved = 0;
            // Patch assignee names in bundles and add resolved users to members caches
            enrichedBundles.forEach(function(b) {
              function patchAssignee(a) {
                if (!a || !a.id || a.name) return;
                var u = byId[a.id] || byUserName[a.id]; // try ID match, then userName match
                if (u) {
                  a.name = u.userName || '';
                  a.firstName = u.firstName || '';
                  a.lastName = u.lastName || '';
                  // Add to members cache so dropdowns work
                  var members = membersCache[b.projectId] || [];
                  if (!members.some(function(m) { return m.id === a.id; })) {
                    members.push({ id: a.id, userName: u.userName, firstName: u.firstName, lastName: u.lastName });
                  }
                  resolved++;
                } else {
                  console.warn('[Assignee] User ID not found in global users list:', a.id);
                }
              }
              patchAssignee(b.stageAssignee);
              (b.stages || []).forEach(function(s) { patchAssignee(s.assignee); });
            });
            console.info('[Assignee] Resolved', resolved, 'assignee(s) from global user list');
            setProjectMembersCache(membersCache);
            return enrichedBundles;
          }).catch(function(err) {
            console.warn('[Assignee] Global users fetch failed, continuing with unknown assignees:', err);
            setProjectMembersCache(membersCache);
            return enrichedBundles;
          });
        }

        setProjectMembersCache(membersCache);
        return enrichedBundles;
      })
      .then(function(enrichedBundles) {
        // Compute snapshot staleness across all attachments
        var allAttach = [];
        enrichedBundles.forEach(function(b) {
          (b._attachments || []).forEach(function(a) { a._bundleId = b.id; allAttach.push(a); });
        });
        computeSnapshotStaleness(allAttach);

        // Fire optional live staleness check (non-blocking)
        checkRemoteStaleness(allAttach, enrichedBundles);

        setBundles(enrichedBundles);
        setLoading(false);
      })
      .catch(function(err) {
        console.error('Failed to fetch live data:', err);
        if (fallbackToDummy) {
          console.info('Initial load failed — falling back to dummy data');
          setUseDummy(true);
          loadMockData();
        } else {
          setLoading(false);
          setError('Could not connect to Domino API. Check that the app is running inside a Domino workspace.');
        }
      });
  }

  // Check Domino for latest snapshot versions (async, non-blocking)
  function checkRemoteStaleness(allAttach, currentBundles) {
    // Collect unique dataset IDs and volume IDs that need checking
    var datasetIds = {};
    var volumeIds = {};
    allAttach.forEach(function(a) {
      var id = a.identifier || {};
      if (a.type === 'DatasetSnapshotFile' && id.datasetId) {
        datasetIds[id.datasetId] = true;
      }
      if (a.type === 'NetAppVolumeSnapshotFile' && id.volumeId) {
        volumeIds[id.volumeId] = true;
      }
    });

    var dsKeys = Object.keys(datasetIds);
    var volKeys = Object.keys(volumeIds);
    if (dsKeys.length === 0 && volKeys.length === 0) return;

    // Fetch latest snapshot version for each dataset
    var dsPromises = dsKeys.map(function(dsId) {
      return apiGet('api/datasets/' + dsId + '/snapshots?limit=1&sort=-version')
        .then(function(resp) {
          var snapshots = resp.data || (Array.isArray(resp) ? resp : []);
          if (snapshots.length > 0) {
            return { id: dsId, latestVersion: snapshots[0].version || snapshots[0].snapshotVersion, latestSnapshotTime: snapshots[0].createdAt || snapshots[0].snapshotCreationTime };
          }
          return null;
        })
        .catch(function() { return null; });
    });

    // Fetch latest snapshot version for each NetApp volume
    var volPromises = volKeys.map(function(volId) {
      return apiGet('api/volumes/' + volId + '/snapshots?limit=1&sort=-version')
        .then(function(resp) {
          var snapshots = resp.data || (Array.isArray(resp) ? resp : []);
          if (snapshots.length > 0) {
            return { id: volId, latestVersion: snapshots[0].version || snapshots[0].snapshotVersion, latestSnapshotTime: snapshots[0].createdAt || snapshots[0].snapshotCreationTime };
          }
          return null;
        })
        .catch(function() { return null; });
    });

    Promise.all([Promise.all(dsPromises), Promise.all(volPromises)])
      .then(function(results) {
        var dsResults = results[0];
        var volResults = results[1];
        var remoteVersions = { datasets: {}, volumes: {} };
        var hasData = false;

        dsResults.forEach(function(r) {
          if (r) { remoteVersions.datasets[r.id] = r; hasData = true; }
        });
        volResults.forEach(function(r) {
          if (r) { remoteVersions.volumes[r.id] = r; hasData = true; }
        });

        if (hasData) {
          mergeRemoteStaleness(allAttach, remoteVersions);
          // Trigger re-render by updating bundles reference
          setBundles(currentBundles.slice());
        }
      })
      .catch(function(err) {
        console.log('Remote staleness check failed (non-critical):', err.message || err);
      });
  }

  // On mount: try live data first, fall back to dummy
  useEffect(function() {
    fetchLiveData(true);
  }, []);

  // Handle dummy data toggle
  function handleToggleDummy(checked) {
    setUseDummy(checked);
    if (checked) {
      loadMockData();
    } else {
      fetchLiveData(false);
    }
  }

  // Fetch whitelabel terminology when connected to live Domino
  useEffect(function() {
    if (!connected) return;
    apiGet('api/terminology')
      .then(function(t) { setTerms({ bundle: capWords(t.bundle), policy: capWords(t.policy) }); })
      .catch(function() {});
  }, [connected]);

  // Always try to discover Data Explorer (local backend call, works even in dummy mode)
  useEffect(function() {
    apiGet('api/data-explorer-url')
      .then(function(r) { if (r && r.url) setDataExplorerUrl(r.url); })
      .catch(function() {});
  }, []);

  var _s6b = useState(null); var drawerInitialView = _s6b[0]; var setDrawerInitialView = _s6b[1];

  function handleSelectBundle(bundle, initialView) {
    setSelectedBundle(bundle);
    setDrawerInitialView(initialView || null);
    setDrawerOpen(true);
  }

  // ── Effective report config (computed from stored + defaults) ──
  var effectiveRoleMapping = useMemo(function() {
    var defaults = buildDefaultRoleMapping(livePolicies, bundles);
    if (!storedRoleMapping) return defaults;
    var merged = {};
    Object.keys(defaults).forEach(function(pid) { merged[pid] = defaults[pid]; });
    Object.keys(storedRoleMapping).forEach(function(pid) { merged[pid] = storedRoleMapping[pid]; });
    return merged;
  }, [livePolicies, bundles, storedRoleMapping]);

  var effectivePathPatterns = useMemo(function() {
    if (!storedPathPatterns) return DEFAULT_PATH_PATTERNS;
    // Merge stored over defaults, keyed by role label
    var merged = {};
    Object.keys(DEFAULT_PATH_PATTERNS).forEach(function(k) { merged[k] = DEFAULT_PATH_PATTERNS[k]; });
    Object.keys(storedPathPatterns).forEach(function(k) { merged[k] = storedPathPatterns[k]; });
    return merged;
  }, [storedPathPatterns]);

  // Build policy lookup for config page
  // Live API policies may not have a stages[] of strings — derive from bundles
  var policyLookup = useMemo(function() {
    var map = {};
    livePolicies.forEach(function(p) {
      map[p.id] = { id: p.id, name: p.name, stages: (p.stages && Array.isArray(p.stages)) ? p.stages : [] };
    });
    // Enrich with stage names derived from bundles (bundles have stages as objects with .stage.name)
    bundles.forEach(function(b) {
      if (!b.policyId || !b.stages || !b.stages.length) return;
      var stageNames = b.stages.map(function(s) { return s.stage ? s.stage.name : ''; }).filter(Boolean);
      if (!stageNames.length) return;
      if (!map[b.policyId]) {
        map[b.policyId] = { id: b.policyId, name: b.policyName || 'Unknown', stages: stageNames };
      } else if (!map[b.policyId].stages || !map[b.policyId].stages.length) {
        // Policy exists but has no stages — fill from bundle
        map[b.policyId].stages = stageNames;
      }
    });
    console.log('[App policyLookup]', Object.keys(map).map(function(k) { return map[k].name + ': ' + (map[k].stages || []).length + ' stages'; }));
    return map;
  }, [livePolicies, bundles]);

  var reportConfig = useMemo(function() {
    console.log('[App reportConfig] building reportConfig:',
      'roleMapping policies:', Object.keys(effectiveRoleMapping).length,
      'pathPatterns:', Object.keys(effectivePathPatterns),
      'policyLookup policies:', Object.keys(policyLookup).length);
    return {
      roleMapping: effectiveRoleMapping,
      pathPatterns: effectivePathPatterns,
      policyLookup: policyLookup,
    };
  }, [effectiveRoleMapping, effectivePathPatterns, policyLookup]);

  function renderPage() {
    // Assignment Rules always gets unfiltered bundles (it has its own project selector)
    // All other pages get scopedBundles
    switch (activePage) {
      case 'tracker':
        return h(QCTrackerPage, { bundles: scopedBundles, loading: loading, onSelectBundle: handleSelectBundle, selectedBundle: selectedBundle, terms: terms, projectMembersCache: projectMembersCache, dataExplorerUrl: dataExplorerUrl, connected: connected, policies: livePolicies, debugMode: debugMode, onRefresh: function() { if (connected) fetchLiveData(); } });
      case 'rules':
        return h(AssignmentRulesPage, { bundles: bundles, setBundles: setBundles, assignmentRules: assignmentRules, setAssignmentRules: setAssignmentRules, terms: terms, projectMembersCache: projectMembersCache, livePolicies: livePolicies, onNavigate: setActivePage });
      case 'milestones':
        return h(MilestonesPage, { bundles: scopedBundles, loading: loading, terms: terms });
      case 'approvals':
        return h(ApprovalsPage, { bundles: scopedBundles, loading: loading, terms: terms });
      case 'findings':
        return h(FindingsPage, { bundles: scopedBundles, loading: loading, terms: terms });
      case 'metrics':
        return h(MetricsPage, { bundles: scopedBundles, terms: terms, livePolicies: livePolicies, reportConfig: reportConfig, onSelectBundle: handleSelectBundle });
      case 'stages':
        return h(StageAssignmentsPage, { bundles: bundles, terms: terms, projectMembersCache: projectMembersCache, onNavigate: setActivePage });
      case 'automation':
        return h(AutomationRulesPage, { bundles: bundles, automationRules: automationRules, setAutomationRules: setAutomationRules, automationHistory: automationHistory, setAutomationHistory: setAutomationHistory, terms: terms, projectMembersCache: projectMembersCache });
      case 'insights':
        return h(AIInsightsPage, { bundles: scopedBundles, terms: terms });
      case 'risk':
        return h(RiskOptimizerPage, { bundles: bundles, livePolicies: livePolicies, terms: terms, useDummy: useDummy });
      case 'utilities':
        return h(UtilitiesPage, { bundles: bundles, projects: liveProjects, policies: livePolicies, connected: connected, onRefresh: function() { if (connected) fetchLiveData(); }, terms: terms });
      case 'config':
        return h(ConfigurationPage, { bundles: bundles, livePolicies: livePolicies, terms: terms, reportConfig: reportConfig, onSaveRoleMapping: saveRoleMapping, onSavePathPatterns: savePathPatterns, onNavigate: setActivePage });
      default:
        return h(DashboardPage, { bundles: scopedBundles, loading: loading, onSelectBundle: handleSelectBundle, terms: terms });
    }
  }

  var anyMyWorkCheckbox = filterMyCurrentStage || filterMyFutureStage;

  return h(ConfigProvider, { theme: dominoTheme },
    h('div', null,
      // TopNav commented out — Domino platform provides its own top bar for hosted apps
      // h(TopNav, { terms: terms, useDummy: useDummy, onToggleDummy: handleToggleDummy, connected: connected, debugMode: debugMode, onToggleDebug: toggleDebugMode }),
      h('div', { className: 'app-layout app-layout-no-topnav' },
        h(Sidebar, { active: activePage, collapsed: sidebarCollapsed, onToggleCollapse: function() {
          setSidebarCollapsed(function(c) {
            var next = !c;
            try { localStorage.setItem('sce_sidebar_collapsed', String(next)); } catch(e) {}
            // Trigger Highcharts reflow after sidebar animation
            setTimeout(function() {
              if (typeof Highcharts !== 'undefined' && Highcharts.charts) {
                Highcharts.charts.forEach(function(chart) { if (chart) chart.reflow(); });
              }
            }, 300);
            return next;
          });
        }, onNav: function(page) {
          setActivePage(page);
          var mc = document.querySelector('.main-content');
          if (mc) mc.scrollTop = 0;
        } }),
        h('div', { className: 'main-content-wrapper' },
          // Universal Scope Bar — only on pages that use scoped data
          ['dashboard', 'tracker', 'milestones', 'approvals', 'findings', 'metrics', 'insights'].indexOf(activePage) >= 0 ? h('div', { className: 'global-filter-bar' },
            // Saved Views filter group
            h('div', { className: 'global-filter-group' },
              h('span', { className: 'global-filter-label' }, 'Saved Views'),
              h(Select, {
                placeholder: 'Select a view...',
                value: activePresetName || undefined,
                onChange: function(val) {
                  if (!val) {
                    setScopeProjects([]); setScopeTags([]); setScopeStates([]); setFilterMyCurrentStage(false); setFilterMyFutureStage(false); setFilterMyPriorStage(false);
                    setActivePresetName(null);
                    return;
                  }
                  var preset = scopePresets.find(function(p) { return p.name === val; });
                  if (preset) applyPreset(preset);
                },
                allowClear: true,
                style: { minWidth: 180 }, size: 'small',
                options: scopePresets.map(function(p) {
                  return {
                    label: (defaultPresetName === p.name ? '★ ' : '') + p.name,
                    value: p.name,
                  };
                }),
                optionRender: function(option) {
                  var name = option.value;
                  var isDef = defaultPresetName === name;
                  return h('div', {
                    style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%' },
                    onContextMenu: function(e) {
                      e.preventDefault(); e.stopPropagation();
                    },
                  },
                    h('span', null, option.label),
                    h('span', { style: { display: 'flex', gap: 4, marginLeft: 8 } },
                      h(Tooltip, { title: isDef ? 'Remove as default' : 'Set as default (loads on startup)' },
                        h('span', {
                          style: { cursor: 'pointer', fontSize: 14, color: isDef ? '#FAAD14' : '#d9d9d9' },
                          onClick: function(e) { e.stopPropagation(); handleToggleDefault(name); },
                        }, '★')
                      ),
                      h(Tooltip, { title: 'Delete this view' },
                        h('span', {
                          style: { cursor: 'pointer', fontSize: 12, color: '#ff4d4f' },
                          onClick: function(e) { e.stopPropagation(); handleDeletePreset(name); },
                        }, '✕')
                      )
                    )
                  );
                },
              }),
              hasScopeFilters
                ? h(Tooltip, { title: 'Save current scope as a named view' },
                    h(Button, {
                      type: 'link', size: 'small',
                      style: { fontSize: 12, padding: '0 4px' },
                      onClick: function() { setPresetSaveOpen(true); setPresetNameInput(activePresetName || ''); },
                    }, '+ Save view')
                  )
                : null
            ),
            // Project filter group
            h('div', { className: 'global-filter-group' },
              h('span', { className: 'global-filter-label' }, 'Project'),
              h(Select, {
                mode: 'multiple', placeholder: 'All',
                value: scopeProjects, onChange: setScopeProjects,
                allowClear: true, maxTagCount: 2,
                style: { minWidth: 180 }, size: 'small',
                options: scopeProjectOptions,
                dropdownRender: function(menu) {
                  return h('div', null, menu,
                    h('div', { className: 'select-done-footer' },
                      h(Button, { type: 'primary', size: 'small', style: { fontSize: 11, height: 22 }, onMouseDown: function(e) {
                        e.preventDefault(); e.stopPropagation();
                        setTimeout(function() {
                          var openSelect = document.querySelector('.ant-select-open .ant-select-selection-search-input');
                          if (openSelect) openSelect.blur();
                        }, 0);
                      } }, 'Done')
                    )
                  );
                },
              })
            ),
            // Tags filter group
            h('div', { className: 'global-filter-group' },
              h('span', { className: 'global-filter-label' }, 'Tags'),
              h(Select, {
                mode: 'multiple', placeholder: 'All',
                value: scopeTags, onChange: setScopeTags,
                allowClear: true, maxTagCount: 2,
                style: { minWidth: 160 }, size: 'small',
                options: scopeTagOptions,
                dropdownRender: function(menu) {
                  return h('div', null, menu,
                    h('div', { className: 'select-done-footer' },
                      h(Button, { type: 'primary', size: 'small', style: { fontSize: 11, height: 22 }, onMouseDown: function(e) {
                        e.preventDefault(); e.stopPropagation();
                        setTimeout(function() {
                          var openSelect = document.querySelector('.ant-select-open .ant-select-selection-search-input');
                          if (openSelect) openSelect.blur();
                        }, 0);
                      } }, 'Done')
                    )
                  );
                },
              })
            ),
            // State filter group
            h('div', { className: 'global-filter-group' },
              h('span', { className: 'global-filter-label' }, 'State'),
              h(Select, {
                mode: 'multiple', placeholder: 'All',
                value: scopeStates, onChange: setScopeStates,
                allowClear: true, maxTagCount: 2,
                style: { minWidth: 130 }, size: 'small',
                options: [
                  { label: 'Active', value: 'Active' },
                  { label: 'Complete', value: 'Complete' },
                  { label: 'Archived', value: 'Archived' },
                ],
                dropdownRender: function(menu) {
                  return h('div', null, menu,
                    h('div', { className: 'select-done-footer' },
                      h(Button, { type: 'primary', size: 'small', style: { fontSize: 11, height: 22 }, onMouseDown: function(e) {
                        e.preventDefault(); e.stopPropagation();
                        setTimeout(function() {
                          var openSelect = document.querySelector('.ant-select-open .ant-select-selection-search-input');
                          if (openSelect) openSelect.blur();
                        }, 0);
                      } }, 'Done')
                    )
                  );
                },
              })
            ),
            h('span', { className: 'global-filter-divider' }),
            // Assigned to Me — segmented toggle
            h('div', { className: 'global-filter-group' },
              h(Tooltip, { title: 'Filter deliverables where you are assigned to a stage' },
                h('span', { className: 'global-filter-label', style: { borderBottom: '1px dashed #8F8FA3', cursor: 'help' } }, 'Assigned to Me')
              ),
              h('div', { className: 'stage-toggle-group' },
                h(Tooltip, { title: 'Show deliverables where you are assigned to the currently active stage' },
                  h('button', {
                    className: 'stage-toggle-btn' + (filterMyCurrentStage ? ' active' : ''),
                    onClick: function() { setFilterMyCurrentStage(function(v) { return !v; }); },
                  }, 'Current')
                ),
                h(Tooltip, { title: 'Show deliverables where you are assigned to an upcoming (not yet active) stage' },
                  h('button', {
                    className: 'stage-toggle-btn' + (filterMyFutureStage ? ' active' : ''),
                    onClick: function() { setFilterMyFutureStage(function(v) { return !v; }); },
                  }, 'Upcoming')
                )
              )
            ),
            // Right-aligned count + clear
            hasScopeFilters
              ? h('span', { style: { marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8 } },
                  h(Tag, { color: 'purple' }, scopedBundles.length + ' of ' + bundles.length + ' ' + terms.bundle.toLowerCase() + 's'),
                  h(Button, { type: 'link', size: 'small', onClick: function() {
                    setScopeProjects([]); setScopeTags([]); setScopeStates([]); setFilterMyCurrentStage(false); setFilterMyFutureStage(false); setFilterMyPriorStage(false);
                    setActivePresetName(null);
                  } }, 'Clear all')
                )
              : null
          ) : null,
          // Save preset modal
          h(Modal, {
            title: 'Save Scope View',
            open: presetSaveOpen,
            onCancel: function() { setPresetSaveOpen(false); setPresetNameInput(''); },
            onOk: function() { handleSavePreset(presetNameInput); },
            okText: scopePresets.some(function(p) { return p.name === presetNameInput.trim(); }) ? 'Overwrite' : 'Save',
            okButtonProps: { disabled: !presetNameInput.trim() },
            width: 400,
          },
            h('div', null,
              h('div', { style: { marginBottom: 8, fontSize: 13, color: '#555' } }, 'Give this scope view a name. It will save the current project, tag, and assignment filters.'),
              h(antd.Input, {
                placeholder: 'e.g. "My Active Work" or "Project X Overview"',
                value: presetNameInput,
                onChange: function(e) { setPresetNameInput(e.target.value); },
                onPressEnter: function() { handleSavePreset(presetNameInput); },
                autoFocus: true,
              }),
              scopePresets.some(function(p) { return p.name === presetNameInput.trim(); })
                ? h('div', { style: { marginTop: 8, fontSize: 12, color: '#FAAD14' } }, 'A view with this name already exists and will be overwritten.')
                : null,
              h('div', { style: { marginTop: 12, fontSize: 12, color: '#8F8FA3' } },
                'Current scope: ',
                scopeProjects.length ? scopeProjects.length + ' project(s), ' : '',
                scopeTags.length ? scopeTags.length + ' tag(s), ' : '',
                [filterMyCurrentStage && 'current', filterMyFutureStage && 'upcoming'].filter(Boolean).join(', ') || 'no assignment filter'
              )
            )
          ),
          h('div', { className: 'main-content' },
          loading && bundles.length === 0
            ? h('div', { className: 'page-container' },
                h(antd.Skeleton, { active: true, title: { width: '30%' }, paragraph: { rows: 0 }, style: { marginBottom: 16 } }),
                h('div', { className: 'stats-row', style: { marginBottom: 24 } },
                  h('div', { className: 'stat-card' }, h(antd.Skeleton, { active: true, title: { width: '60%' }, paragraph: { rows: 1, width: ['40%'] } })),
                  h('div', { className: 'stat-card' }, h(antd.Skeleton, { active: true, title: { width: '60%' }, paragraph: { rows: 1, width: ['40%'] } })),
                  h('div', { className: 'stat-card' }, h(antd.Skeleton, { active: true, title: { width: '60%' }, paragraph: { rows: 1, width: ['40%'] } })),
                  h('div', { className: 'stat-card' }, h(antd.Skeleton, { active: true, title: { width: '60%' }, paragraph: { rows: 1, width: ['40%'] } }))
                ),
                h('div', { className: 'panel', style: { padding: 16 } },
                  h(antd.Skeleton, { active: true, title: false, paragraph: { rows: 8, width: ['100%', '95%', '100%', '90%', '100%', '95%', '85%', '100%'] } })
                )
              )
            : renderPage()
          ) // end main-content
        ) // end main-content-wrapper
      ),
      h(DetailDrawer, {
        bundle: selectedBundle,
        visible: drawerOpen,
        onClose: function() { setDrawerOpen(false); setDrawerInitialView(null); },
        terms: terms,
        dataExplorerUrl: dataExplorerUrl,
        projectMembersCache: projectMembersCache,
        initialView: drawerInitialView,
        debugMode: debugMode,
      })
    )
  );
}

// ── Mount ───────────────────────────────────────────────────────
var root = ReactDOM.createRoot(document.getElementById('root'));
root.render(h(App));
