/* ================================================================
   SCE QC Tracker — Domino App
   For pharma stat programming milestones and QC tracking
   ================================================================ */

const { ConfigProvider, Button, Table, Tag, Space, Spin, Drawer, Badge,
        Tooltip, Progress, Select, Input, Empty, Tabs, Statistic, Switch,
        Modal, Alert, Radio, Checkbox, Popover } = antd;
const { createElement: h, useState, useEffect, useCallback, useMemo, useRef } = React;

dayjs.extend(dayjs_plugin_relativeTime);

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
    message: 'This action is coming soon — the Domino write API for applying rules is in development.',
    ready: false,
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
  // Only show whitelabel badge if terms differ from defaults
  var isWhitelabeled = terms.bundle !== DEFAULT_TERMS.bundle || terms.policy !== DEFAULT_TERMS.policy;
  var B = capFirst(terms.bundle);
  var P = capFirst(terms.policy);
  return h('div', { className: 'top-nav' },
    h('img', { src: 'static/domino-logo.svg', className: 'top-nav-logo', alt: 'Domino' }),
    h('div', { className: 'top-nav-divider' }),
    h('span', { className: 'top-nav-title' }, 'SCE QC Tracker'),
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
      h('span', { className: 'top-nav-env' }, 'SCE QC Dashboard')
    )
  );
}

// ── Sidebar ─────────────────────────────────────────────────────
var NAV_ITEMS = [
  { key: 'tracker', iconName: 'TableOutlined', label: 'QC Tracker' },
  { key: 'milestones', iconName: 'FlagOutlined', label: 'Milestones' },
  { key: 'approvals', iconName: 'CheckCircleOutlined', label: 'Approvals' },
  { key: 'findings', iconName: 'FileSearchOutlined', label: 'Findings & QC' },
  { key: 'metrics', iconName: 'BarChartOutlined', label: 'Team Metrics' },
  { key: 'stages', iconName: 'ApartmentOutlined', label: 'Stage Manager' },
  { key: 'rules', iconName: 'SettingOutlined', label: 'Bulk Assignment Rules' },
  { key: 'automation', iconName: 'ThunderboltOutlined', label: 'Automation' },
  { key: 'risk', iconName: 'SlidersOutlined', label: 'Risk Optimizer' },
];

function Sidebar(props) {
  var active = props.active;
  var onNav = props.onNav;
  return h('div', { className: 'sidebar' },
    NAV_ITEMS.map(function(item) {
      var IconComp = icons && icons[item.iconName] ? icons[item.iconName] : null;
      return h('div', {
        key: item.key,
        className: 'sidebar-item' + (active === item.key ? ' active' : ''),
        onClick: function() { onNav(item.key); },
      },
        h('span', { className: 'sidebar-icon' },
          IconComp ? h(IconComp, null) : null
        ),
        h('span', null, item.label)
      );
    })
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
  return h('div', { className: cls, onClick: props.onClick || null },
    h('div', { className: 'stat-card-label' }, props.label),
    h('div', { className: 'stat-card-value ' + (props.color || '') }, props.value),
    props.sub ? h('div', { className: 'stat-card-sub' }, props.sub) : null
  );
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
      render: function(text) { return h('span', { style: { color: '#65657B', fontSize: 12 } }, text || '\u2014'); },
    },
    {
      title: P, dataIndex: 'policyName', key: 'policy',
      render: function(text) { return h(Tag, null, text || '\u2014'); },
    },
    {
      title: 'Stage', key: 'stage',
      render: function(_, record) {
        var pct = getBundleProgress(record);
        return h(Space, { direction: 'vertical', size: 2 },
          h('span', { style: { fontSize: 12, fontWeight: 500 } }, record.stage || '\u2014'),
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
      render: function(d) { return d ? dayjs(d).fromNow() : '\u2014'; },
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
        h('span', { className: 'panel-title' }, filterLabel ? B + 's — ' + filterLabel : 'All ' + B + 's'),
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
                      return h(Tooltip, { key: stage, title: stage },
                        h('div', { className: cls },
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
        if (!record.approvers || record.approvers.length === 0) return '\u2014';
        return record.approvers.map(function(a) { return a.name; }).join(', ');
      },
    },
    { title: 'Updated', dataIndex: 'updatedAt', key: 'updated',
      render: function(d) { return d ? dayjs(d).fromNow() : '\u2014'; },
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
        h('span', { className: 'panel-title' }, approvalFilterLabel ? 'Approvals — ' + approvalFilterLabel : 'All Approvals'),
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
    allFindings.forEach(function(f) {
      if (bySev[f.severity] !== undefined) bySev[f.severity]++;
      if (byStatus[f.status] !== undefined) byStatus[f.status]++;
      if (f.status !== 'Done' && f.status !== 'WontDo') open++;
    });
    return { bySev: bySev, byStatus: byStatus, open: open, total: allFindings.length };
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
      render: function(assignee) { return assignee ? assignee.name : '\u2014'; } },
    { title: 'Due', dataIndex: 'dueDate', key: 'due', width: 150,
      sorter: function(a, b) { return (a.dueDate || '').localeCompare(b.dueDate || ''); },
      render: function(d) {
        if (!d) return '\u2014';
        var due = dayjs(d);
        var overdue = due.isBefore(dayjs());
        return h('span', { style: { color: overdue ? '#C20A29' : '#2E2E38', fontWeight: overdue ? 600 : 400 } },
          due.format('MMM D, YYYY'), overdue ? ' (overdue)' : '');
      },
    },
  ];

  return h('div', null,
    h('div', { className: 'page-header' },
      h('h1', null, 'Findings & QC'),
      h('p', null, 'Quality issues and review findings across all ' + B.toLowerCase() + 's')
    ),

    h('div', { className: 'stats-row' },
      h(StatCard, { label: 'Total Findings', value: findingStats.total, color: 'primary', active: !findingFilter, onClick: function() { setFindingFilter(null); } }),
      h(StatCard, { label: 'Open', value: findingStats.open, color: findingStats.open > 0 ? 'warning' : 'success', active: findingFilter && findingFilter.type === 'open', onClick: function() { setFindingFilter(findingFilter && findingFilter.type === 'open' ? null : { type: 'open' }); } }),
      h(StatCard, { label: 'Critical (S0)', value: findingStats.bySev.S0, color: findingStats.bySev.S0 > 0 ? 'danger' : '', active: findingFilter && findingFilter.type === 'critical', onClick: function() { setFindingFilter(findingFilter && findingFilter.type === 'critical' ? null : { type: 'critical' }); } }),
      h(StatCard, { label: 'Resolved', value: findingStats.byStatus.Done, color: 'success', active: findingFilter && findingFilter.type === 'resolved', onClick: function() { setFindingFilter(findingFilter && findingFilter.type === 'resolved' ? null : { type: 'resolved' }); } })
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

    h('div', { className: 'panel' },
      h('div', { className: 'panel-header' },
        h('span', { className: 'panel-title' }, findingFilterLabel ? 'Findings — ' + findingFilterLabel : 'All Findings'),
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
  var B = capFirst(terms.bundle);
  var P = capFirst(terms.policy);

  var _mf = useState(null);
  var metricsFilter = _mf[0];
  var setMetricsFilter = _mf[1];

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

  // Helper: chart title with info tooltip
  function chartTitle(title, tooltip) {
    return h('div', { className: 'panel-header' },
      h('span', { className: 'panel-title' }, title),
      h(Tooltip, { title: tooltip, placement: 'right', overlayStyle: { maxWidth: 320 } },
        h('span', { style: { marginLeft: 6, cursor: 'help', color: '#B0B0C0', fontSize: 13 } }, '\u24D8')
      )
    );
  }

  // ── Render ──────────────────────────────────────────────────
  return h('div', null,
    h('div', { className: 'page-header' },
      h('h1', null, 'Team Metrics'),
      h('p', null, 'Quality indicators, cycle times, and workload distribution')
    ),

    // ── Section 1: Findings & Quality ──
    h('div', { className: 'metrics-section-header' }, 'Findings & Quality'),
    h('div', { className: 'stats-row' },
      h(StatCard, { label: 'Total Findings', value: metrics.totalFindings, color: 'primary', sub: metrics.totalComments + ' comments' }),
      h(StatCard, { label: 'Open', value: metrics.openFindings, color: metrics.openFindings > 0 ? 'danger' : 'success', sub: metrics.overdueFindings > 0 ? metrics.overdueFindings + ' overdue' : 'None overdue' }),
      h(StatCard, { label: 'Resolved', value: metrics.resolvedFindings, color: 'success', sub: metrics.resolutionRate + '% resolution rate' }),
      h(StatCard, { label: 'Critical (S0)', value: metrics.findingsBySev.S0, color: metrics.findingsBySev.S0 > 0 ? 'danger' : '', sub: 'Highest severity' })
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
      h(StatCard, { label: 'Avg Cycle Time', value: metrics.avgCycleTime + 'd', color: 'primary', sub: 'Creation to completion' }),
      h(StatCard, { label: 'Median Cycle Time', value: metrics.medianCycleTime + 'd', sub: metrics.cycleTimes.length + ' completed ' + B.toLowerCase() + 's' }),
      h(StatCard, { label: 'Active ' + B + 's', value: metrics.active, color: 'info', sub: 'Currently in progress',
        active: metricsFilter && metricsFilter.type === 'active',
        onClick: function() { setMetricsFilter(metricsFilter && metricsFilter.type === 'active' ? null : { type: 'active' }); } }),
      h(StatCard, { label: 'Completion Rate', value: metrics.completionRate + '%', color: metrics.completionRate >= 50 ? 'success' : 'warning', sub: metrics.complete + ' of ' + bundles.length + ' complete' })
    ),
    h('div', { className: 'two-col' },
      h('div', { className: 'panel' },
        chartTitle('Avg Cycle Time by ' + P, 'Average number of days from creation to completion for each ' + P.toLowerCase() + '. Calculated as (last updated date \u2212 created date) for completed ' + B.toLowerCase() + 's only. Higher values may indicate bottlenecks.'),
        h('div', { className: 'panel-body' },
          Object.keys(metrics.cycleByPolicy).length > 0
            ? h('div', null,
                metrics.cycleTimeSampleData ? h(Tag, { color: 'orange', style: { marginBottom: 8, fontSize: 10 } }, 'Sample data \u2014 no completed ' + B.toLowerCase() + 's yet') : null,
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
      h(StatCard, { label: 'Avg Finding Density', value: metrics.avgFindingDensity, color: parseFloat(metrics.avgFindingDensity) > 1 ? 'warning' : '', sub: 'Findings per ' + B.toLowerCase() }),
      h(StatCard, { label: 'Active Rework', value: metrics.reworkBundles.length, color: metrics.reworkBundles.length > 0 ? 'danger' : 'success',
        sub: 'Open + resolved findings',
        active: metricsFilter && metricsFilter.type === 'rework',
        onClick: function() { setMetricsFilter(metricsFilter && metricsFilter.type === 'rework' ? null : { type: 'rework' }); } }),
      h(StatCard, { label: 'Overdue Findings', value: metrics.overdueFindings, color: metrics.overdueFindings > 0 ? 'danger' : 'success',
        sub: 'Past due date',
        active: metricsFilter && metricsFilter.type === 'overdue',
        onClick: function() { setMetricsFilter(metricsFilter && metricsFilter.type === 'overdue' ? null : { type: 'overdue' }); } }),
      h(StatCard, { label: B + 's with Findings', value: metrics.bundlesWithFindings, sub: 'Of ' + bundles.length + ' total' })
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

    // ── Detail table (shown when a filter is active) ──
    metricsFilter ? h('div', { className: 'panel', style: { marginTop: 20 } },
      h('div', { className: 'panel-header' },
        h('span', { className: 'panel-title' }, B + 's — ' + metricsFilterLabel),
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
            { title: 'Project', dataIndex: 'projectName', key: 'project', render: function(t) { return h('span', { style: { color: '#65657B', fontSize: 12 } }, t || '\u2014'); } },
            { title: P, dataIndex: 'policyName', key: 'policy', render: function(t) { return h(Tag, null, t || '\u2014'); } },
            { title: 'Stage', dataIndex: 'stage', key: 'stage', render: function(t) { return h('span', { style: { fontSize: 12 } }, t || '\u2014'); } },
            { title: 'Findings', key: 'findings', render: function(_, r) { return (r._findings ? r._findings.length : 0); } },
            { title: 'Assignee', key: 'assignee', render: function(_, r) { return (r.stageAssignee && r.stageAssignee.name) || '\u2014'; } },
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
          totalApprovals > 0 ? approvedCount + '/' + totalApprovals : '\u2014'
        ),
        h('div', { className: 'stage-popover-card-label' },
          totalApprovals > 0 ? 'Approved' : 'No Approvals'
        )
      ),
      h('div', { className: 'stage-popover-card' },
        h('div', { className: 'stage-popover-card-value', style: { color: totalGates > 0 ? (openGates === totalGates ? '#28A464' : '#C20A29') : '#8F8FA3' } },
          totalGates > 0 ? openGates + '/' + totalGates : '\u2014'
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
    return h('span', { style: { color: '#D1D1DB', fontSize: 12 } }, '\u2014');
  }

  return h('div', { className: 'status-flags-row' }, flags);
}


// ═══════════════════════════════════════════════════════════════
//  COMPONENT: QC Tracker Expanded Row
// ═══════════════════════════════════════════════════════════════
function QCTrackerExpandedRow(props) {
  var bundle = props.bundle;
  var terms = props.terms || DEFAULT_TERMS;
  var B = terms.bundle;
  var P = terms.policy;
  var dataExplorerUrl = props.dataExplorerUrl || null;
  var stageNames = getBundleStageNames(bundle);
  var currentIdx = deriveBundleStageIndex(bundle);
  var isComplete = bundle.state === 'Complete';

  var dominoUrl = getDominoBundleUrl(bundle);

  // Format a timestamp
  function fmtTime(ts) { return ts ? dayjs(ts).format('MMM D, YYYY h:mm A') : null; }
  function fmtTimeAgo(ts) { return ts ? dayjs(ts).fromNow() : null; }

  return h('div', { className: 'tracker-expanded' },
    // Left column: stage timeline
    h('div', { className: 'tracker-expanded-left' },
      h('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 } },
        h('div', { className: 'tracker-section-title', style: { marginBottom: 0 } }, 'Stage Timeline'),
        dominoUrl
          ? h(Button, {
              type: 'primary', size: 'small',
              onClick: function() { window.open(dominoUrl, '_blank'); },
              style: { fontSize: 11 },
            }, '\u2197 View in Domino')
          : null
      ),
      // #8: Stage legend
      h('div', { className: 'tracker-timeline-legend' },
        h('span', { className: 'tracker-timeline-legend-item' }, h('span', { className: 'tracker-timeline-dot completed', style: { width: 8, height: 8, display: 'inline-block', verticalAlign: 'middle', marginRight: 4 } }), 'Complete'),
        h('span', { className: 'tracker-timeline-legend-item' }, h('span', { className: 'tracker-timeline-dot active', style: { width: 8, height: 8, display: 'inline-block', verticalAlign: 'middle', marginRight: 4, boxShadow: 'none' } }), 'Current'),
        h('span', { className: 'tracker-timeline-legend-item' }, h('span', { className: 'tracker-timeline-dot pending', style: { width: 8, height: 8, display: 'inline-block', verticalAlign: 'middle', marginRight: 4 } }), 'Pending')
      ),
      stageNames.map(function(name, idx) {
        var dotState;
        if (isComplete || idx < currentIdx) dotState = 'completed';
        else if (idx === currentIdx) dotState = 'active';
        else dotState = 'pending';

        var stageData = bundle.stages[idx] || {};
        var assignee = stageData.assignee;
        var assigneeName = assignee ? assignee.name : null;

        // Project member options for reassignment (from live data)
        var pmc = props.projectMembersCache || {};
        var members = pmc[bundle.projectId] || [];
        var memberOptions = members.map(function(m) {
          return { label: (m.firstName || '') + ' ' + (m.lastName || '') + ' (' + m.userName + ')', value: m.id };
        });

        var gapInfo = API_GAPS.stageReassign;
        var stageId = stageData.stageId || (stageData.stage && stageData.stage.id);

        return h('div', { key: idx, className: 'tracker-timeline-item' },
          h('div', { className: 'tracker-timeline-dot ' + dotState }),
          idx < stageNames.length - 1
            ? h('div', { className: 'tracker-timeline-line ' + dotState })
            : null,
          h('div', { className: 'tracker-timeline-content' },
            h('div', { className: 'tracker-timeline-name' + (dotState === 'active' ? ' active' : '') }, name),
            h('div', { className: 'tracker-timeline-meta' },
              // Reassignment Select — calls PATCH /api/bundles/{bundleId}/stages/{stageId}
              gapInfo.ready
                ? h(Select, {
                    size: 'small',
                    placeholder: 'Assign...',
                    value: assignee ? assignee.id : undefined,
                    style: { minWidth: 160, fontSize: 11 },
                    showSearch: true,
                    allowClear: true,
                    options: memberOptions,
                    onChange: function(userId) {
                      if (!stageId) { antd.message.error('Missing stage ID'); return; }
                      var body = { assignee: userId ? { id: userId } : null };
                      apiPatch('api/bundles/' + bundle.id + '/stages/' + stageId, body)
                        .then(function(resp) {
                          antd.message.success('Stage reassigned');
                          // Update local state: find the stage and update assignee
                          if (resp && resp.assignee) {
                            stageData.assignee = resp.assignee;
                          } else if (!userId) {
                            stageData.assignee = null;
                          }
                          // Store policyVersionId if returned
                          if (resp && resp.stage && resp.stage.policyVersionId) {
                            bundle._policyVersionId = resp.stage.policyVersionId;
                          }
                        })
                        .catch(function(err) {
                          antd.message.error('Reassignment failed: ' + (err.message || err));
                        });
                    },
                    optionFilterProp: 'label',
                  })
                : assigneeName
                  ? h('span', { style: { fontSize: 12, color: '#2E2E38', fontWeight: 500 } }, assigneeName)
                  : h('span', { style: { fontSize: 12, color: '#B0B0C0', fontStyle: 'italic' } }, 'Unassigned'),
              h('span', { className: 'tracker-stage-badge ' + dotState },
                dotState === 'completed' ? 'Done' : dotState === 'active' ? 'Current' : 'Pending'
              )
            )
          )
        );
      }),
      // #9: Metadata section with clear label
      h('div', { className: 'tracker-metadata' },
        h('div', { className: 'tracker-section-title', style: { marginBottom: 8 } }, 'Details'),
        bundle.createdBy
          ? h('div', { className: 'tracker-metadata-row' },
              h('span', { className: 'tracker-metadata-label' }, 'Created by'),
              h('span', { className: 'tracker-metadata-value' }, bundle.createdBy.name || bundle.createdBy.userName || 'Unknown'),
              fmtTime(bundle.createdAt)
                ? h('span', { className: 'tracker-metadata-time' }, fmtTime(bundle.createdAt))
                : null
            )
          : null,
        bundle.updatedAt
          ? h('div', { className: 'tracker-metadata-row' },
              h('span', { className: 'tracker-metadata-label' }, 'Last updated'),
              h('span', { className: 'tracker-metadata-value' }, fmtTimeAgo(bundle.updatedAt)),
              h('span', { className: 'tracker-metadata-time' }, fmtTime(bundle.updatedAt))
            )
          : null
      )
    ),
    // Right column: findings + approvals + gates + attachments
    h('div', { className: 'tracker-expanded-right' },
      // #4/#7: Findings section with divider and actionable empty state
      h('div', { className: 'tracker-expanded-section' },
        bundle._findings && bundle._findings.length > 0
          ? h('div', null,
              h('div', { className: 'tracker-section-title' }, 'Findings (' + bundle._findings.length + ')'),
              bundle._findings.slice(0, 5).map(function(f, i) {
                var findingUrl = f.id ? getDominoBundleUrl(bundle, { findingId: f.id }) : dominoUrl;
                return h('div', { key: i, className: 'tracker-finding-row' },
                  h(Tag, { color: severityColor(f.severity), style: { color: '#fff', border: 'none', minWidth: 28, textAlign: 'center', fontSize: 11 } }, f.severity),
                  findingUrl
                    ? h('a', { href: findingUrl, target: '_blank', rel: 'noopener noreferrer', className: 'tracker-finding-name', style: { color: '#543FDE' }, title: 'View finding in Domino: ' + f.name }, f.name)
                    : h('span', { className: 'tracker-finding-name', title: f.name }, f.name),
                  findingStatusTag(f.status)
                );
              }),
              bundle._findings.length > 5
                ? h('div', { style: { fontSize: 12, color: '#8F8FA3', padding: '4px 0' } }, '+ ' + (bundle._findings.length - 5) + ' more')
                : null
            )
          : h('div', null,
              h('div', { className: 'tracker-section-title' }, 'Findings'),
              h('div', { className: 'tracker-empty-state' }, 'No findings recorded. Findings are created in Domino when QC issues are identified.')
            )
      ),

      // Approvals section
      h('div', { className: 'tracker-expanded-section' },
        bundle._approvals && bundle._approvals.length > 0
          ? h('div', null,
              h('div', { className: 'tracker-section-title' }, 'Approvals (' + bundle._approvals.length + ')'),
              bundle._approvals.map(function(a, i) {
                return h('div', { key: i, className: 'tracker-approval-row' },
                  h('span', { className: 'tracker-approval-dot', style: { background: approvalStatusColor(a.status) } }),
                  h('span', { className: 'tracker-approval-name' }, a.name),
                  a.approvers && a.approvers.length > 0
                    ? h('span', { className: 'tracker-approval-actors' }, a.approvers.map(function(ap) { return ap.name; }).join(', '))
                    : null,
                  a.updatedAt
                    ? h('span', { className: 'tracker-approval-time' }, fmtTimeAgo(a.updatedAt))
                    : null
                );
              })
            )
          : h('div', null,
              h('div', { className: 'tracker-section-title' }, 'Approvals'),
              h('div', { className: 'tracker-empty-state' }, 'No approvals configured for this stage.')
            )
      ),

      // Gates section
      h('div', { className: 'tracker-expanded-section' },
        bundle._gates && bundle._gates.length > 0
          ? h('div', null,
              h('div', { className: 'tracker-section-title' }, 'Gates (' + bundle._gates.length + ')'),
              bundle._gates.map(function(g, i) {
                return h('div', { key: i, className: 'tracker-approval-row' },
                  h(Tag, { color: g.isOpen ? 'success' : 'error', style: { fontSize: 11 } }, g.isOpen ? 'Open' : 'Closed'),
                  h('span', { className: 'tracker-approval-name' }, g.name)
                );
              })
            )
          : h('div', null,
              h('div', { className: 'tracker-section-title' }, 'Gates'),
              h('div', { className: 'tracker-empty-state' }, 'No quality gates defined.')
            )
      ),

      // #3/#4/#10: Attachments section — wider columns, no Source column, with divider
      bundle._attachments && bundle._attachments.length > 0
        ? h('div', { className: 'tracker-expanded-section' },
            h('div', { className: 'tracker-section-title' }, 'Attachments (' + bundle._attachments.length + ')'),
            h(Table, {
              dataSource: bundle._attachments,
              rowKey: 'id',
              size: 'small',
              pagination: false,
              style: { fontSize: 11 },
              columns: [
                { title: 'File', key: 'filename', ellipsis: true,
                  render: function(_, r) {
                    var fname = r.identifier && r.identifier.filename;
                    var name = r.identifier && r.identifier.name;
                    var label = fname || name || 'Unknown';
                    var deUrl = dataExplorerUrl && isDataExplorerFile(fname || name) ? buildDataExplorerUrl(dataExplorerUrl, r) : null;
                    if (deUrl) {
                      return h('span', { style: { display: 'flex', alignItems: 'center', gap: 4 } },
                        h('a', {
                          href: deUrl,
                          target: '_blank',
                          rel: 'noopener noreferrer',
                          style: { fontWeight: 500, fontSize: 11, color: '#0070CC' },
                          title: 'Open in Data Explorer',
                        }, label),
                        h(Tooltip, { title: 'Open in Data Explorer' },
                          h('span', { style: { fontSize: 12, cursor: 'pointer' } }, '\uD83D\uDCCA')
                        )
                      );
                    }
                    if (!dominoUrl) return h('span', { style: { fontWeight: 500, fontSize: 11 } }, label);
                    return h('a', {
                      href: dominoUrl,
                      target: '_blank',
                      rel: 'noopener noreferrer',
                      style: { fontWeight: 500, fontSize: 11, color: '#543FDE' },
                      title: 'View in Domino',
                    }, label);
                  }
                },
                { title: 'Type', dataIndex: 'type', key: 'type', width: 140,
                  render: function(t) {
                    var colors = { DatasetSnapshotFile: 'blue', Report: 'green', ModelVersion: 'purple', Endpoint: 'orange', FlowArtifact: 'cyan', NetAppVolumeSnapshotFile: 'default' };
                    return h(Tag, { color: colors[t] || 'default', style: { fontSize: 10 } }, (t || '').replace(/([A-Z])/g, ' $1').trim());
                  }
                },
                { title: 'Added by', key: 'addedBy', width: 130,
                  render: function(_, r) {
                    var name = r.createdBy && (r.createdBy.name || r.createdBy.userName);
                    return h('span', { style: { fontSize: 10 } }, name || '\u2014');
                  }
                },
                { title: 'Added', key: 'addedAt', width: 100,
                  render: function(_, r) {
                    return r.createdAt ? h('span', { style: { fontSize: 10, color: '#8F8FA3' } }, dayjs(r.createdAt).format('MMM D, YYYY')) : '\u2014';
                  }
                },
              ],
            })
          )
        : h('div', { className: 'tracker-expanded-section' },
            h('div', { className: 'tracker-section-title' }, 'Attachments'),
            h('div', { className: 'tracker-empty-state' }, 'No attachments linked to this ' + B.toLowerCase() + '.')
          )
    )
  );
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

  var _ba = useState(null);
  var bulkAssignee = _ba[0];
  var setBulkAssignee = _ba[1];

  var _bl = useState(false);
  var bulkLoading = _bl[0];
  var setBulkLoading = _bl[1];

  if (count === 0) return null;

  // Combine all project members for bulk assignment — use id as value
  var seen = {};
  var memberOptions = [];
  Object.keys(pmc).forEach(function(pid) {
    (pmc[pid] || []).forEach(function(m) {
      if (!seen[m.id]) {
        seen[m.id] = true;
        memberOptions.push({ label: (m.firstName || '') + ' ' + (m.lastName || '') + ' (' + m.userName + ')', value: m.id });
      }
    });
  });

  // Get the selected bundles with their current stage info
  function getSelectedBundlesWithStages() {
    return selectedKeys.map(function(bundleId) {
      var bundle = bundles.find(function(b) { return b.id === bundleId; });
      if (!bundle) return null;
      // Find the current (active) stage — stage matching bundle.stage name, or first non-completed stage
      var currentStageIdx = -1;
      var stageNames = (bundle.stages || []).map(function(s) {
        return (s.stage && s.stage.name) || s.name || '';
      });
      if (bundle.stage) {
        currentStageIdx = stageNames.indexOf(bundle.stage);
      }
      if (currentStageIdx < 0) currentStageIdx = 0;
      var stageData = bundle.stages[currentStageIdx];
      if (!stageData) return null;
      var stageId = stageData.stageId || (stageData.stage && stageData.stage.id);
      return { bundleId: bundle.id, bundleName: bundle.name, stageId: stageId, stageName: stageNames[currentStageIdx], bundle: bundle, stageData: stageData };
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
      antd.message.warning(missingStageIds.length + ' ' + B.toLowerCase() + '(s) have no stage ID — skipping those');
    }
    var validTargets = targets.filter(function(t) { return t.stageId; });
    if (validTargets.length === 0) return;

    setBulkLoading(true);
    var body = { assignee: { id: bulkAssignee } };
    var promises = validTargets.map(function(t) {
      return apiPatch('api/bundles/' + t.bundleId + '/stages/' + t.stageId, body)
        .then(function(resp) {
          // Update local state immediately
          if (resp && resp.assignee && t.stageData) {
            t.stageData.assignee = resp.assignee;
          }
          return { success: true, bundleName: t.bundleName, stageName: t.stageName };
        })
        .catch(function(err) {
          return { success: false, bundleName: t.bundleName, stageName: t.stageName, error: err.message || String(err) };
        });
    });

    Promise.all(promises).then(function(results) {
      setBulkLoading(false);
      var succeeded = results.filter(function(r) { return r.success; });
      var failed = results.filter(function(r) { return !r.success; });
      if (failed.length === 0) {
        antd.message.success('Assigned ' + succeeded.length + ' ' + B.toLowerCase() + (succeeded.length > 1 ? 's' : '') + ' successfully');
      } else if (succeeded.length > 0) {
        antd.message.warning(succeeded.length + ' succeeded, ' + failed.length + ' failed: ' + failed.map(function(f) { return f.bundleName; }).join(', '));
      } else {
        antd.message.error('All assignments failed: ' + failed[0].error);
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
        return h(Tag, { color: severityColor(sev), style: { color: '#fff', border: 'none', minWidth: 28, textAlign: 'center', fontSize: 11 } }, sev || '\u2014');
      }
    },
    { title: 'Name', dataIndex: 'name', key: 'name', width: 180, ellipsis: true,
      render: function(t, r) {
        var findingUrl = bundle && r.id ? getDominoBundleUrl(bundle, { findingId: r.id }) : null;
        if (!findingUrl) return h('span', { style: { fontWeight: 500, fontSize: 12 } }, t || '\u2014');
        return h('a', {
          href: findingUrl,
          target: '_blank',
          rel: 'noopener noreferrer',
          style: { fontWeight: 500, fontSize: 12, color: '#543FDE' },
          title: 'View finding in Domino',
        }, t || '\u2014');
      }
    },
    { title: 'Status', dataIndex: 'status', key: 'status', width: 110,
      render: function(s) { return findingStatusTag(s); }
    },
    { title: 'Assignee', key: 'assignee', width: 120,
      render: function(_, r) {
        var name = r.assignee ? (r.assignee.name || r.assignee.userName) : null;
        return h('span', { style: { fontSize: 12 } }, name || '\u2014');
      }
    },
    { title: 'Due Date', key: 'dueDate', width: 100,
      render: function(_, r) {
        return r.dueDate ? h('span', { style: { fontSize: 12 } }, dayjs(r.dueDate).format('MMM D, YYYY')) : h('span', { style: { color: '#8F8FA3', fontSize: 12 } }, '\u2014');
      }
    },
    { title: 'Description', key: 'description', ellipsis: true,
      render: function(_, r) {
        return h('span', { style: { fontSize: 11, color: '#65657B' } }, r.description || '\u2014');
      }
    },
  ];

  return h(Drawer, {
    title: bundle ? 'Findings \u2014 ' + bundle.name : 'Findings',
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

  var columns = [
    { title: 'Type', dataIndex: 'type', key: 'type', width: 150,
      render: function(t) {
        var colors = { DatasetSnapshotFile: 'blue', Report: 'green', ModelVersion: 'purple', Endpoint: 'orange', FlowArtifact: 'cyan', NetAppVolumeSnapshotFile: 'default' };
        var labels = { DatasetSnapshotFile: 'Dataset Snapshot', NetAppVolumeSnapshotFile: 'NetApp Volume', FlowArtifact: 'Flow Artifact', ModelVersion: 'Model Version' };
        var label = labels[t] || (t || '').replace(/([A-Z])/g, ' $1').trim();
        return h(Tag, { color: colors[t] || 'default', style: { fontSize: 10, whiteSpace: 'normal', lineHeight: '16px' } }, label);
      }
    },
    { title: 'Identifier', key: 'identifier', width: 200, ellipsis: true,
      render: function(_, r) {
        var id = r.identifier || {};
        var fname = id.filename || id.name || '\u2014';
        var explorerLink = deUrl && isDataExplorerFile(fname) ? buildDataExplorerUrl(deUrl, r) : null;
        if (explorerLink) {
          return h('span', { style: { display: 'flex', alignItems: 'center', gap: 4 } },
            h('a', {
              href: explorerLink,
              target: '_blank',
              rel: 'noopener noreferrer',
              style: { fontWeight: 500, fontSize: 12, color: '#0070CC' },
              title: 'Open in Data Explorer',
            }, fname),
            h(Tooltip, { title: 'Open in Data Explorer' },
              h('span', { style: { fontSize: 13, cursor: 'pointer' } }, '\uD83D\uDCCA')
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
    { title: 'Created', key: 'createdAt', width: 120,
      render: function(_, r) {
        return r.createdAt ? h('span', { style: { fontSize: 12 } }, dayjs(r.createdAt).format('MMM D, YYYY')) : '\u2014';
      }
    },
    { title: 'Created By', key: 'createdBy', width: 130,
      render: function(_, r) {
        var name = r.createdBy ? (r.createdBy.name || r.createdBy.userName) : null;
        return h('span', { style: { fontSize: 12 } }, name || '\u2014');
      }
    },
  ];

  return h(Drawer, {
    title: bundle ? 'Attachments \u2014 ' + bundle.name : 'Attachments',
    open: visible,
    onClose: onClose,
    width: 640,
    extra: dominoUrl
      ? h(Button, { type: 'primary', size: 'small', onClick: function() { window.open(dominoUrl, '_blank'); }, style: { fontSize: 11 } }, '\u2197 View in Domino')
      : null,
  },
    attachments.length > 0
      ? h(Table, {
          dataSource: attachments,
          rowKey: function(r, i) { return r.id || i; },
          size: 'small',
          pagination: attachments.length > 10 ? { pageSize: 10 } : false,
          columns: columns,
        })
      : h(Empty, { description: 'No attachments linked' })
  );
}


// ═══════════════════════════════════════════════════════════════
//  COMPONENT: CSV Upload Drawer
// ═══════════════════════════════════════════════════════════════
function CSVUploadDrawer(props) {
  var visible = props.visible;
  var onClose = props.onClose;
  var policies = props.policies || [];
  var projects = props.projects || [];
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
    { key: 'policyId', label: 'QC Plan ID', description: 'Policy/QC Plan ID (or use default below)', required: false },
    { key: 'projectId', label: 'Project ID', description: 'Domino project ID (or use default below)', required: false },
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
      else if (lower === 'policyid' || lower === 'qcplanid' || lower === 'policyname') autoMap.policyId = h;
      else if (lower === 'projectid' || lower === 'projectname') autoMap.projectId = h;
    });
    setMapping(autoMap);
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

  // Validation
  var validationErrors = useMemo(function() {
    if (step < 2) return [];
    var errors = [];
    if (!mapping.name) { errors.push('Must map a column to "' + B + ' Name".'); }
    if (!mapping.policyId && !defaultPolicy) { errors.push('Must map a "QC Plan ID" column or select a default QC Plan.'); }
    if (!mapping.projectId && !defaultProject) { errors.push('Must map a "Project ID" column or select a default Project.'); }
    // Check for empty names
    if (mapping.name) {
      var emptyNames = csvRows.filter(function(r) { return !r[mapping.name] || !r[mapping.name].trim(); });
      if (emptyNames.length > 0) errors.push(emptyNames.length + ' row(s) have empty names (rows: ' + emptyNames.slice(0, 5).map(function(r) { return r._rowNum; }).join(', ') + ').');
    }
    return errors;
  }, [step, mapping, defaultPolicy, defaultProject, csvRows]);

  // Preview data
  var previewRows = useMemo(function() {
    return csvRows.map(function(r) {
      return {
        _rowNum: r._rowNum,
        name: mapping.name ? r[mapping.name] : '',
        policyId: mapping.policyId ? r[mapping.policyId] : (defaultPolicy || ''),
        projectId: mapping.projectId ? r[mapping.projectId] : (defaultProject || ''),
        _valid: !!(mapping.name && r[mapping.name] && r[mapping.name].trim()) && !!(mapping.policyId ? r[mapping.policyId] : defaultPolicy) && !!(mapping.projectId ? r[mapping.projectId] : defaultProject),
      };
    });
  }, [csvRows, mapping, defaultPolicy, defaultProject]);

  // Upload function — 1-by-1 with concurrency control
  function startUpload() {
    if (!connected) {
      antd.message.warning('Cannot upload in dummy mode — connect to a Domino instance first.');
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
  var headerOptions = [{ label: '— Do not map —', value: '' }].concat(csvHeaders.map(function(h) { return { label: h, value: h }; }));

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
      h(Button, { type: 'primary', onClick: function() { setStep(2); } }, 'Next: Preview')
    ) : step === 2 ? h('div', { style: { display: 'flex', justifyContent: 'flex-end', gap: 8 } },
      h(Button, { onClick: function() { setStep(1); } }, 'Back'),
      h(Button, { type: 'primary', disabled: validationErrors.length > 0, onClick: startUpload },
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
      h('div', { style: { marginTop: 16 } },
        h(antd.Collapse, { items: [{
          key: 'template',
          label: 'CSV Template & Requirements',
          children: h('div', null,
            h('p', { style: { fontSize: 12, color: '#65657B' } }, 'Required columns:'),
            h('ul', { style: { fontSize: 12, color: '#65657B', paddingLeft: 20 } },
              h('li', null, h('strong', null, 'name'), ' — Unique name for each ' + B.toLowerCase()),
              h('li', null, h('strong', null, 'policyId'), ' — QC Plan ID (or set a default during mapping)'),
              h('li', null, h('strong', null, 'projectId'), ' — Domino Project ID (or set a default during mapping)')
            ),
            h('p', { style: { fontSize: 12, color: '#8F8FA3', marginTop: 8 } }, 'Example CSV:'),
            h('pre', { style: { fontSize: 11, background: '#F5F5F5', padding: 8, borderRadius: 4 } },
              'name,policyId,projectId\n"ADAE Q1 2026","abc-123","proj-001"\n"ADSL Q1 2026","abc-123","proj-001"'
            )
          )
        }] })
      )
    ) : null,

    // Step 1: Column mapping
    step === 1 ? h('div', null,
      h('div', { style: { marginBottom: 16 } },
        h(Tag, { color: 'blue' }, csvRows.length + ' rows found'),
        h(Tag, null, csvHeaders.length + ' columns')
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
      h('div', { style: { fontSize: 13, fontWeight: 600, marginBottom: 12, color: '#2E2E38' } }, 'Default values (applied when column is not mapped):'),
      h('div', { style: { display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 } },
        h('div', { style: { width: 130, fontSize: 12, fontWeight: 500 } }, 'Default QC Plan'),
        h(Select, {
          placeholder: 'Select a QC Plan...',
          value: defaultPolicy || undefined,
          onChange: setDefaultPolicy,
          options: policyOptions,
          showSearch: true,
          optionFilterProp: 'label',
          allowClear: true,
          style: { width: 300 },
          size: 'small',
        })
      ),
      h('div', { style: { display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 } },
        h('div', { style: { width: 130, fontSize: 12, fontWeight: 500 } }, 'Default Project'),
        h(Select, {
          placeholder: 'Select a project...',
          value: defaultProject || undefined,
          onChange: setDefaultProject,
          options: projectOptions,
          showSearch: true,
          optionFilterProp: 'label',
          allowClear: true,
          style: { width: 300 },
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
            type: 'success',
            showIcon: true,
            style: { marginBottom: 16 },
            message: previewRows.filter(function(r) { return r._valid; }).length + ' of ' + previewRows.length + ' rows ready to upload',
          }),
      !connected ? h(antd.Alert, { type: 'warning', showIcon: true, style: { marginBottom: 16 },
        message: 'Dummy mode — upload is disabled. Connect to a Domino instance to create ' + B.toLowerCase() + 's.' }) : null,
      h(Table, {
        dataSource: previewRows,
        columns: [
          { title: 'Row', dataIndex: '_rowNum', key: 'row', width: 50 },
          { title: B + ' Name', dataIndex: 'name', key: 'name', ellipsis: true },
          { title: 'QC Plan ID', dataIndex: 'policyId', key: 'policy', ellipsis: true, width: 180 },
          { title: 'Project ID', dataIndex: 'projectId', key: 'project', ellipsis: true, width: 180 },
          { title: 'Valid', key: 'valid', width: 60, align: 'center',
            render: function(_, r) { return r._valid ? h(Tag, { color: 'green' }, 'Yes') : h(Tag, { color: 'red' }, 'No'); } },
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
          ? progress.errors.length + ' failed — see details below'
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
  var B = terms.bundle;
  var P = terms.policy;
  var dataExplorerUrl = props.dataExplorerUrl || null;
  var connected = props.connected;
  var policies = props.policies || [];
  var projects = props.projects || [];
  var onRefresh = props.onRefresh;

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
  var _fs7 = useState([]); var expandedRowKeys = _fs7[0]; var setExpandedRowKeys = _fs7[1];
  // Findings & attachments drawer state
  var _fd1 = useState(false); var findingsDrawerOpen = _fd1[0]; var setFindingsDrawerOpen = _fd1[1];
  var _fd2 = useState(null); var findingsDrawerBundle = _fd2[0]; var setFindingsDrawerBundle = _fd2[1];
  var _ad1 = useState(false); var attachDrawerOpen = _ad1[0]; var setAttachDrawerOpen = _ad1[1];
  var _ad2 = useState(null); var attachDrawerBundle = _ad2[0]; var setAttachDrawerBundle = _ad2[1];
  // Column widths state (resizable)
  var _cw = useState({}); var colWidths = _cw[0]; var setColWidths = _cw[1];
  // Hidden columns state
  var _hc = useState(['policy']); var hiddenCols = _hc[0]; var setHiddenCols = _hc[1];
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

  // Unique stage names for column filter
  var allStageNames = useMemo(function() {
    var names = {};
    bundles.forEach(function(b) { if (b.stage) names[b.stage] = true; });
    return Object.keys(names).sort();
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
          || (b.stageAssignee && b.stageAssignee.name || '').toLowerCase().indexOf(q) >= 0;
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
        return h('a', {
          style: { fontWeight: 600, color: nameColor, fontSize: 12 },
          onClick: function(e) { e.stopPropagation(); if (onSelectBundle) onSelectBundle(record); }
        }, name);
      }
    },
    { title: 'Project', dataIndex: 'projectName', key: 'project', width: 130,
      filters: projectOptions.map(function(p) { return { text: p, value: p }; }),
      filterSearch: true,
      onFilter: function(v, r) { return r.projectName === v; },
      sorter: function(a, b) { return (a.projectName || '').localeCompare(b.projectName || ''); },
      render: function(t) { return h('span', { style: { fontSize: 12 } }, t || '\u2014'); } },
    { title: capFirst(P), dataIndex: 'policyName', key: 'policy', width: 150, ellipsis: true,
      filters: policyOptions.map(function(p) { return { text: p, value: p }; }),
      filterSearch: true,
      onFilter: function(v, r) { return r.policyName === v; },
      render: function(t) { return t ? h(Tag, { style: { fontSize: 10 } }, t) : '\u2014'; } },
    { title: 'Progress', key: 'progress', width: 130,
      sorter: function(a, b) { return getBundleProgress(a) - getBundleProgress(b); },
      render: function(_, record) { return h(StagePipeline, { bundle: record, onFindingsClick: function(b) { setFindingsDrawerBundle(b); setFindingsDrawerOpen(true); } }); } },
    { title: 'Stage', dataIndex: 'stage', key: 'stage', width: 130, ellipsis: true,
      filters: allStageNames.map(function(s) { return { text: s, value: s }; }),
      filterSearch: true,
      onFilter: function(v, r) { return r.stage === v; },
      sorter: function(a, b) { return (a.stage || '').localeCompare(b.stage || ''); },
      render: function(t) { return h('span', { style: { fontSize: 12 } }, t || '\u2014'); } },
    { title: 'Assignee', key: 'assignee', width: 100,
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
        var name = record.stageAssignee && record.stageAssignee.name;
        return name
          ? h('span', { style: { fontSize: 12 } }, name)
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
    { title: h(Tooltip, { title: 'Attachments' }, icons && icons.PaperClipOutlined ? h(icons.PaperClipOutlined, { style: { fontSize: 14, color: '#8F8FA3' } }) : 'Att'), key: 'attachments', width: 50, align: 'center',
      sorter: function(a, b) { return (a._attachments || []).length - (b._attachments || []).length; },
      render: function(_, record) {
        var count = (record._attachments || []).length;
        if (count === 0) return h('span', { style: { color: '#D1D1DB', fontSize: 11 } }, '\u2014');
        return h(Tooltip, { title: 'Click to view ' + count + ' attachment' + (count > 1 ? 's' : '') },
          h('span', {
            style: { color: '#543FDE', fontSize: 12, fontWeight: 600, cursor: 'pointer' },
            onClick: function(e) { e.stopPropagation(); setAttachDrawerBundle(record); setAttachDrawerOpen(true); },
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
          dataLabels: { enabled: true, format: '{point.name}: {point.y}', style: { fontSize: '10px' } },
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
          columns: columns.map(function(c) { return { key: c.key, title: typeof c.title === 'string' ? c.title : c.key }; }),
          hiddenKeys: hiddenCols,
          onToggle: function(key) {
            setHiddenCols(function(prev) {
              return prev.indexOf(key) >= 0 ? prev.filter(function(k) { return k !== key; }) : prev.concat([key]);
            });
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
          // Apply column widths and visibility
          var visibleCols = columns.filter(function(c) { return hiddenCols.indexOf(c.key) < 0; });
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
            scroll: { x: 1000 },
            pagination: { defaultPageSize: 20, size: 'small', showSizeChanger: true, pageSizeOptions: ['20', '50', '100', String(filtered.length > 100 ? filtered.length : 200)], showTotal: function(total) { return total + ' ' + capFirst(B).toLowerCase() + 's'; } },
            rowSelection: {
              selectedRowKeys: selectedRowKeys,
              onChange: function(keys) { setSelectedRowKeys(keys); },
            },
            expandable: {
              expandedRowKeys: expandedRowKeys,
              onExpandedRowsChange: function(keys) { setExpandedRowKeys(keys); },
              expandedRowRender: function(record) {
                return h(QCTrackerExpandedRow, { bundle: record, terms: terms, projectMembersCache: props.projectMembersCache, dataExplorerUrl: dataExplorerUrl });
              },
            },
          });
        })()
      ),
      h(FindingsDrawer, {
        visible: findingsDrawerOpen,
        onClose: function() { setFindingsDrawerOpen(false); },
        bundle: findingsDrawerBundle,
      }),
      h(AttachmentsDrawer, {
        visible: attachDrawerOpen,
        onClose: function() { setAttachDrawerOpen(false); },
        bundle: attachDrawerBundle,
        dataExplorerUrl: dataExplorerUrl,
      })
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

  if (!bundle) return null;

  var stageIdx = deriveBundleStageIndex(bundle);
  var dominoUrl = getDominoBundleUrl(bundle);

  return h(Drawer, {
    title: bundle.name,
    open: visible,
    onClose: onClose,
    width: 480,
    extra: dominoUrl
      ? h(Button, {
          type: 'primary', size: 'small',
          onClick: function() { window.open(dominoUrl, '_blank'); },
        }, '\u2197 View in Domino')
      : null,
  },
    // Overview
    h('div', { className: 'detail-section' },
      h('div', { className: 'detail-section-title' }, B + ' Overview'),
      h('div', { className: 'detail-field' },
        h('span', { className: 'detail-field-label' }, 'State'),
        h('span', { className: 'detail-field-value' }, h(Tag, { color: stateColor(bundle.state) }, bundle.state))
      ),
      h('div', { className: 'detail-field' },
        h('span', { className: 'detail-field-label' }, 'Project'),
        h('span', { className: 'detail-field-value' }, bundle.projectName || '\u2014')
      ),
      h('div', { className: 'detail-field' },
        h('span', { className: 'detail-field-label' }, P),
        h('span', { className: 'detail-field-value' }, bundle.policyName || '\u2014')
      ),
      h('div', { className: 'detail-field' },
        h('span', { className: 'detail-field-label' }, 'Current Stage'),
        h('span', { className: 'detail-field-value' }, bundle.stage || '\u2014')
      ),
      h('div', { className: 'detail-field' },
        h('span', { className: 'detail-field-label' }, 'Progress'),
        h('span', { className: 'detail-field-value' },
          h(Progress, { percent: getBundleProgress(bundle), size: 'small', strokeColor: '#543FDE' })
        )
      ),
      bundle.stageAssignee && bundle.stageAssignee.name
        ? h('div', { className: 'detail-field' },
            h('span', { className: 'detail-field-label' }, 'Stage Owner'),
            h('span', { className: 'detail-field-value' }, bundle.stageAssignee.name)
          )
        : null,
      h('div', { className: 'detail-field' },
        h('span', { className: 'detail-field-label' }, 'Created'),
        h('span', { className: 'detail-field-value' }, bundle.createdAt ? dayjs(bundle.createdAt).format('MMM D, YYYY') : '\u2014')
      )
    ),

    // Approvals
    bundle._approvals && bundle._approvals.length > 0
      ? h('div', { className: 'detail-section' },
          h('div', { className: 'detail-section-title' }, 'Approvals (' + bundle._approvals.length + ')'),
          bundle._approvals.map(function(a, i) {
            return h('div', { key: i, className: 'approval-item', style: { padding: '8px 0' } },
              h('div', { className: 'approval-dot ' + (a.status || '').toLowerCase().replace(/\s+/g, '').replace('pending', 'pending').replace('approved', 'approved').replace('conditionallyapproved', 'conditional') }),
              h('div', { className: 'approval-info' },
                h('div', { className: 'approval-name' }, a.name),
                h('div', { className: 'approval-meta' }, approvalStatusLabel(a.status))
              )
            );
          })
        )
      : null,

    // Findings summary
    bundle._findings && bundle._findings.length > 0
      ? h('div', { className: 'detail-section' },
          h('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between' } },
            h('div', { className: 'detail-section-title' }, 'Findings (' + bundle._findings.length + ')'),
            (function() {
              var fpUrl = getDominoBundleUrl(bundle, { findingsPage: true });
              return fpUrl ? h('a', { href: fpUrl, target: '_blank', rel: 'noopener noreferrer', style: { fontSize: 11, color: '#543FDE' } }, 'View all in Domino \u2197') : null;
            })()
          ),
          bundle._findings.slice(0, 5).map(function(f, i) {
            var fUrl = f.id ? getDominoBundleUrl(bundle, { findingId: f.id }) : null;
            return h('div', { key: i, style: { display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0', borderBottom: '1px solid #F5F5F8' } },
              h(Tag, { color: severityColor(f.severity), style: { color: '#fff', border: 'none', minWidth: 28, textAlign: 'center' } }, f.severity),
              fUrl
                ? h('a', { href: fUrl, target: '_blank', rel: 'noopener noreferrer', style: { flex: 1, fontSize: 13, color: '#543FDE', textDecoration: 'none' }, title: 'View finding in Domino' }, f.name)
                : h('span', { style: { flex: 1, fontSize: 13 } }, f.name),
              findingStatusTag(f.status)
            );
          }),
          bundle._findings.length > 5
            ? h('div', { style: { fontSize: 12, color: '#8F8FA3', padding: '8px 0' } },
                '+ ' + (bundle._findings.length - 5) + ' more findings')
            : null
        )
      : null,

    // Gates
    bundle._gates && bundle._gates.length > 0
      ? h('div', { className: 'detail-section' },
          h('div', { className: 'detail-section-title' }, 'Gates (' + bundle._gates.length + ')'),
          bundle._gates.map(function(g, i) {
            return h('div', { key: i, className: 'detail-field' },
              h('span', { className: 'detail-field-label' }, g.name),
              h('span', { className: 'detail-field-value' },
                h(Tag, { color: g.isOpen ? 'success' : 'error' }, g.isOpen ? 'Open' : 'Closed')
              )
            );
          })
        )
      : null
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
    projectRules.forEach(function(rule) {
      // Find the user label for display
      var pmc = props.projectMembersCache || {};
      var projMembers = selectedProject ? (pmc[selectedProject] || []) : [];
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
    var gapInfo = API_GAPS.applyRules;
    if (!gapInfo.ready) {
      antd.message.warning(gapInfo.message);
      setApplyModalOpen(false);
      return;
    }
    var updated = bundles.map(function(b) {
      if (b.projectId !== selectedProject) return b;
      var matched = false;
      var newStages = (b.stages || []).map(function(s) {
        var stageName = s.stage ? s.stage.name : '';
        var rule = projectRules.find(function(r) {
          return r.policyName === b.policyName && r.stageName === stageName;
        });
        if (!rule) return s;
        var current = s.assignee && s.assignee.name;
        if (conflictMode === 'skip' && current) return s;
        matched = true;
        return Object.assign({}, s, { assignee: { id: '', name: rule.assignee } });
      });
      if (!matched) return b;
      return Object.assign({}, b, { stages: newStages });
    });
    setApplyModalOpen(false);
    setBundles(updated);
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
      h('h2', null, 'Bulk Assignment Rules'),
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
              !API_GAPS.applyRules.ready ? h(Tag, { color: 'orange', style: { fontSize: 10, lineHeight: '22px' } }, 'API Pending') : null
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
            onCancel: function() { setApplyModalOpen(false); },
            okText: 'Apply ' + changesCount + ' Assignment' + (changesCount !== 1 ? 's' : ''),
            okButtonProps: { disabled: changesCount === 0 },
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
      return apiPatch('api/bundles/' + row.bundleId + '/stages/' + row.stageId, { assignee: { id: reassignTarget } })
        .catch(function(err) { return { error: err.message || err, bundleName: row.bundleName, stageName: row.stageName }; });
    });
    Promise.all(promises).then(function(results) {
      var failures = results.filter(function(r) { return r && r.error; });
      if (failures.length === 0) {
        antd.message.success('Reassigned ' + selectedStages.length + ' stage' + (selectedStages.length !== 1 ? 's' : ''));
        // Trigger a data refresh if available
        if (props.onRefresh) props.onRefresh();
      } else {
        antd.message.warning(failures.length + ' of ' + selectedStages.length + ' reassignments failed');
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
        h('h2', { style: { margin: 0, fontSize: 20, fontWeight: 600, color: '#2D2D3F' } }, 'Stage Manager'),
        h('div', { style: { color: '#8F8FA3', fontSize: 13, marginTop: 4 } },
          'View all stages across ' + B.toLowerCase() + 's — identify unassigned work, reassign owners, and manage workload.'
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
              ? h(Tag, { color: 'orange', style: { fontSize: 10 } }, 'API Pending')
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
      if (detail.indexOf('404') >= 0) hint = ' — The Jobs API may not be enabled on this Domino instance.';
      else if (detail.indexOf('403') >= 0) hint = ' — Check that your API token has permission to start jobs.';
      else if (detail.indexOf('401') >= 0) hint = ' — Authentication failed. Verify your Domino API token.';
      else if (detail.indexOf('503') >= 0) hint = ' — DOMINO_API_HOST may not be configured.';
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
        antd.notification.warning({ message: 'Job Polling Timeout', description: 'Job ' + runId + ' did not complete within 10 minutes. It may still be running in Domino — check the project runs page.', duration: 10 });
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
            antd.notification.error({ message: 'Job Status Unavailable', description: 'Could not poll status for job ' + runId + '. The job may still be running — check the Domino project runs page.', duration: 8 });
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
      render: function(t) { return t ? dayjs(t).format('MMM D, YYYY h:mm A') : '\u2014'; } },
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
      render: function(t) { return h('span', { style: { fontSize: 11, fontFamily: 'monospace' } }, t || '\u2014'); } },
    { title: 'Duration', key: 'duration', width: 100,
      render: function(_, r) {
        if (!r.startedAt || !r.completedAt) return r.status === 'Running' ? h(Tag, { color: 'blue' }, 'In progress') : '\u2014';
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
                  readyCount + ' automation' + (readyCount !== 1 ? 's' : '') + ' ready to run — completed stages matched with active rules.')
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
              { label: 'Log only \u2014 view in execution history', value: 'log-only' },
              { label: 'Attach to bundle \u2014 upload output file', value: 'attach' },
              { label: 'Create finding \u2014 add as a QC finding', value: 'finding' },
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

function RiskOptimizerPage(props) {
  var bundles = props.bundles || [];
  var livePolicies = props.livePolicies || [];
  var terms = props.terms || DEFAULT_TERMS;
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

  // ── Risk Scoring Engine ──
  function scoreBundle(bundle) {
    // Matches against evidence name, QC plan name, and deliverable type patterns
    // (SDTM domains, ADaM prefixes, TFL conventions).
    // If there's a manual override, use it
    var override = riskOverrides[bundle.id];
    if (override) {
      return { level: override.level, score: override.level === 'High' ? 90 : override.level === 'Medium' ? 50 : 10, source: 'manual', reason: override.reason };
    }

    var name = (bundle.name || '').toLowerCase();
    var policyName = (bundle.policyName || '').toLowerCase();
    // Derive deliverable type hints from the name for additional matching context
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
      // No keyword match → default to Medium (conservative)
      level = 'Medium'; score = 30; matches = [];
    }

    var reason = matches.length > 0
      ? 'Matched keywords: ' + matches.join(', ')
      : 'No keyword matches — defaulting to Medium risk (conservative).';

    return { level: level, score: score, source: 'algorithm', reason: reason, matches: matches };
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
  }, [bundles, riskConfig, riskOverrides, policyTiers, allPolicies]);

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
        return h(Tooltip, { title: r._risk.reason, placement: 'topLeft', overlayStyle: { maxWidth: 400 } },
          h('span', { style: { fontSize: 12, color: '#65657B', cursor: 'help' } },
            r._risk.matches && r._risk.matches.length > 0
              ? r._risk.matches.slice(0, 3).join(', ') + (r._risk.matches.length > 3 ? ' +' + (r._risk.matches.length - 3) + ' more' : '')
              : r._risk.source === 'manual' ? r._risk.reason : 'No keyword matches'
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
        if (!r._currentTier) return h('span', { style: { color: '#8F8FA3', fontSize: 12 } }, 'Tag policies to see recommendations');
        var recPolicies = r._recommendedPolicies;
        if (recPolicies.length === 0) return h('span', { style: { color: '#8F8FA3', fontSize: 12 } }, 'No ' + getTierLabel(r._recommendedTier) + ' policy tagged');
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
      render: function(t) { return t ? dayjs(t).format('MMM D, YYYY h:mm A') : '\u2014'; },
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
          ? h(Tag, null, r.oldRisk || '\u2014')
          : h('span', null, r.oldPolicy || '\u2014');
      },
    },
    { title: 'To', key: 'to', width: 160, ellipsis: true,
      render: function(_, r) {
        return r.action === 'risk_override'
          ? h(Tag, null, r.newRisk || '\u2014')
          : h('span', null, r.newPolicy || '\u2014');
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
        'Tag each policy with its rigor level. This drives the recommendation engine.'
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

  // ── Setup Wizard ──
  var showWizard = taggedPolicyCount === 0 && !wizardDismissed;

  function handleWizardDone() {
    setWizardDismissed(true);
    try { localStorage.setItem('sce_risk_wizard_done', 'true'); } catch(e) {}
    setActiveTab('overview');
  }

  var wizardSteps = [
    { title: 'Review Keywords', description: 'Review the risk classification keywords' },
    { title: 'Tag Policies', description: 'Classify each ' + P.toLowerCase() + ' by rigor level' },
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

        // Step 1: Review Keywords
        wizardStep === 0 ? h('div', null,
          h('div', { className: 'panel-header', style: { marginBottom: 12 } },
            h('span', { className: 'panel-title' }, 'Step 1: Review Risk Keywords')
          ),
          h('p', { style: { fontSize: 13, color: '#65657B', marginBottom: 16 } },
            'The risk engine classifies each ' + B.toLowerCase() + ' by matching its name and ' + P.toLowerCase() + ' name against these keyword lists. ' +
            'Review the defaults and adjust if needed for your therapeutic area.'
          ),
          ['highRisk', 'mediumRisk', 'lowRisk'].map(function(tier) {
            var cfg = riskConfig[tier];
            var colors = { highRisk: '#C20A29', mediumRisk: '#F59E0B', lowRisk: '#28A464' };
            var labels = { highRisk: 'High Risk', mediumRisk: 'Medium Risk', lowRisk: 'Low Risk' };
            return h('div', { key: tier, style: { marginBottom: 16 } },
              h('div', { style: { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 } },
                h('div', { style: { width: 10, height: 10, borderRadius: '50%', background: colors[tier] } }),
                h('span', { style: { fontSize: 13, fontWeight: 600 } }, labels[tier]),
                h('span', { style: { fontSize: 11, color: '#8F8FA3', marginLeft: 4 } }, '\u2014 ' + cfg.description)
              ),
              h('div', { style: { display: 'flex', flexWrap: 'wrap', gap: 4 } },
                cfg.keywords.map(function(kw, j) {
                  return h(Tag, { key: j, style: { fontSize: 10 } }, kw);
                })
              )
            );
          }),
          h('div', { style: { marginTop: 8, fontSize: 12, color: '#8F8FA3' } },
            'You can edit these keywords later via the Config tab.'
          )
        ) : null,

        // Step 2: Tag Policies
        wizardStep === 1 ? h('div', null,
          h('div', { className: 'panel-header', style: { marginBottom: 12 } },
            h('span', { className: 'panel-title' }, 'Step 2: Tag Your ' + P + 's')
          ),
          h('p', { style: { fontSize: 13, color: '#65657B', marginBottom: 16 } },
            'Classify each ' + P.toLowerCase() + ' by how rigorous its QC process is. ' +
            'This tells the optimizer what level of scrutiny each policy provides, so it can detect mismatches.'
          ),
          h('div', { style: { display: 'flex', gap: 16, marginBottom: 16 } },
            h(Tag, { color: '#C20A29' }, '\uD83D\uDD34 Most Rigorous — e.g. double programming, independent replication'),
            h(Tag, { color: '#F59E0B' }, '\uD83D\uDFE1 Moderate — e.g. code review + spot checks'),
            h(Tag, { color: '#28A464' }, '\uD83D\uDFE2 Lightweight — e.g. output crosscheck, automated validation')
          ),
          taggedPolicyCount > 0
            ? h(Alert, { type: 'success', showIcon: true, style: { marginBottom: 12, borderRadius: 8 },
                message: taggedPolicyCount + ' of ' + allPolicies.length + ' policies tagged',
                description: taggedPolicyCount === allPolicies.length ? 'All policies tagged! Click Next to see your results.' : 'Keep going \u2014 tag the remaining policies for best results.'
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
                message: 'No policies tagged yet',
                description: 'Go back to Step 2 to tag at least one policy. Without tags, calibration results will all show as "Untagged".',
                action: h(Button, { size: 'small', onClick: function() { setWizardStep(1); } }, 'Go Back'),
              })
            : h('p', { style: { fontSize: 13, color: '#65657B', marginBottom: 16 } },
                'Here\'s how your ' + B.toLowerCase() + 's are classified based on the keywords and policy tier tags you set.'
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
          message: untaggedPolicyCount + ' of ' + allPolicies.length + ' policies are not tagged with a rigor tier.',
          description: 'Tag each policy as Most Rigorous, Moderate, or Lightweight in the "' + P + ' Tiers" tab. This powers the recommendation engine.',
          action: h(Button, { size: 'small', type: 'primary', onClick: function() { setActiveTab('policies'); } }, 'Tag Policies'),
        })
      : null,

    // ── Overview Tab ──
    !showWizard && activeTab === 'overview' ? h('div', null,
      // Summary cards row
      h('div', { className: 'stats-row' },
        h(StatCard, { label: 'Total ' + B + 's', value: scoredBundles.length, color: 'primary' }),
        h(StatCard, { label: 'High Risk', value: summary.high, color: 'danger', sub: 'Need most rigorous QC' }),
        h(StatCard, { label: 'Medium Risk', value: summary.medium, color: 'warning', sub: 'Code review + spot check' }),
        h(StatCard, { label: 'Low Risk', value: summary.low, color: 'success', sub: 'Output crosscheck sufficient' })
      ),

      // Calibration cards
      h('div', { className: 'panel-header', style: { marginBottom: 12 } },
        h('span', { className: 'panel-title' }, 'QC Calibration Summary')
      ),
      h('div', { className: 'stats-row' },
        h(StatCard, { label: 'Over-QC\'d', value: summary.overQc, color: 'warning',
          sub: summary.overQc > 0 ? 'More rigorous QC than needed' : 'None detected' }),
        h(StatCard, { label: 'Well-Matched', value: summary.wellMatched, color: 'success',
          sub: summary.wellMatched > 0 ? 'Policy aligns with risk level' : taggedPolicyCount === 0 ? 'Tag policies to see results' : 'None detected' }),
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

    // ── Policy Tiers Tab ──
    !showWizard && activeTab === 'policies' ? h('div', null,
      h('div', { className: 'panel', style: { padding: 20, borderRadius: 8 } },
        h('div', { className: 'panel-header', style: { marginBottom: 12 } },
          h('span', { className: 'panel-title' }, P + ' Rigor Tiers'),
          h('span', { style: { marginLeft: 8, fontSize: 12, color: '#8F8FA3' } },
            taggedPolicyCount + ' of ' + allPolicies.length + ' tagged'
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
              { value: 'High', label: '\u{1F534} High Risk — most rigorous QC' },
              { value: 'Medium', label: '\u{1F7E1} Medium Risk — code review + spot check' },
              { value: 'Low', label: '\u{1F7E2} Low Risk — output crosscheck' },
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
      h('span', { style: { fontSize: 11, color: '#8F8FA3', marginLeft: 4 } }, '\u2014 ' + description)
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

  // ── Live data state ──────────────────────────────────────────
  var _cu = useState(null); var currentUser = _cu[0]; var setCurrentUser = _cu[1];
  var _pm = useState({}); var projectMembersCache = _pm[0]; var setProjectMembersCache = _pm[1];
  var _pt = useState({}); var projectTagsMap = _pt[0]; var setProjectTagsMap = _pt[1];
  var _lp = useState([]); var livePolicies = _lp[0]; var setLivePolicies = _lp[1];
  var _deu = useState(null); var dataExplorerUrl = _deu[0]; var setDataExplorerUrl = _deu[1];

  // ── Universal Scope Filters ──────────────────────────────────
  var _sc1 = useState([]); var scopeProjects = _sc1[0]; var setScopeProjects = _sc1[1];
  var _sc2 = useState([]); var scopeTags = _sc2[0]; var setScopeTags = _sc2[1];
  var _sc3a = useState(false); var filterMyCurrentStage = _sc3a[0]; var setFilterMyCurrentStage = _sc3a[1];
  var _sc3b = useState(false); var filterMyFutureStage = _sc3b[0]; var setFilterMyFutureStage = _sc3b[1];
  var _sc3c = useState(false); var filterMyPriorStage = _sc3c[0]; var setFilterMyPriorStage = _sc3c[1];
  var _sc4 = useState(null); var scopeCurrentUser = _sc4[0]; var setScopeCurrentUser = _sc4[1];

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
  }, [bundles, scopeProjects, scopeTags, filterMyCurrentStage, filterMyFutureStage, filterMyPriorStage, scopeCurrentUser, projectTagsMap]);

  var hasScopeFilters = scopeProjects.length > 0 || scopeTags.length > 0 || filterMyCurrentStage || filterMyFutureStage || filterMyPriorStage;

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
      setBundles(mockEnriched);
    } else {
      setBundles([]);
    }
    if (typeof MOCK_TERMINOLOGY !== 'undefined') {
      setTerms(MOCK_TERMINOLOGY);
    }
    // Set a mock Data Explorer URL so attachment links render in dummy mode
    setDataExplorerUrl('__mock_data_explorer__');
    setLoading(false);
    setError(null);
  }

  // Fetch live data from Domino
  function fetchLiveData() {
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
        setProjectMembersCache(membersCache);

        return enrichedBundles;
      })
      .then(function(enrichedBundles) {
        setBundles(enrichedBundles);
        setLoading(false);
      })
      .catch(function(err) {
        console.error('Failed to fetch live data, falling back to dummy data:', err);
        setUseDummy(true);
        loadMockData();
      });
  }

  // On mount: try live data first, fall back to dummy
  useEffect(function() {
    fetchLiveData();
  }, []);

  // Handle dummy data toggle
  function handleToggleDummy(checked) {
    setUseDummy(checked);
    if (checked) {
      loadMockData();
    } else {
      fetchLiveData();
    }
  }

  // Fetch whitelabel terminology when connected to live Domino
  useEffect(function() {
    if (!connected) return;
    apiGet('api/terminology')
      .then(function(t) { setTerms(t); })
      .catch(function() {});
  }, [connected]);

  // Always try to discover Data Explorer (local backend call, works even in dummy mode)
  useEffect(function() {
    apiGet('api/data-explorer-url')
      .then(function(r) { if (r && r.url) setDataExplorerUrl(r.url); })
      .catch(function() {});
  }, []);

  function handleSelectBundle(bundle) {
    setSelectedBundle(bundle);
    setDrawerOpen(true);
  }

  function renderPage() {
    // Assignment Rules always gets unfiltered bundles (it has its own project selector)
    // All other pages get scopedBundles
    switch (activePage) {
      case 'tracker':
        return h(QCTrackerPage, { bundles: scopedBundles, loading: loading, onSelectBundle: handleSelectBundle, terms: terms, projectMembersCache: projectMembersCache, dataExplorerUrl: dataExplorerUrl, connected: connected, policies: livePolicies, onRefresh: function() { if (connected) fetchLiveData(); } });
      case 'rules':
        return h(AssignmentRulesPage, { bundles: bundles, setBundles: setBundles, assignmentRules: assignmentRules, setAssignmentRules: setAssignmentRules, terms: terms, projectMembersCache: projectMembersCache, livePolicies: livePolicies });
      case 'milestones':
        return h(MilestonesPage, { bundles: scopedBundles, loading: loading, terms: terms });
      case 'approvals':
        return h(ApprovalsPage, { bundles: scopedBundles, loading: loading, terms: terms });
      case 'findings':
        return h(FindingsPage, { bundles: scopedBundles, loading: loading, terms: terms });
      case 'metrics':
        return h(MetricsPage, { bundles: scopedBundles, terms: terms });
      case 'stages':
        return h(StageAssignmentsPage, { bundles: bundles, terms: terms, projectMembersCache: projectMembersCache });
      case 'automation':
        return h(AutomationRulesPage, { bundles: bundles, automationRules: automationRules, setAutomationRules: setAutomationRules, automationHistory: automationHistory, setAutomationHistory: setAutomationHistory, terms: terms, projectMembersCache: projectMembersCache });
      case 'risk':
        return h(RiskOptimizerPage, { bundles: bundles, livePolicies: livePolicies, terms: terms });
      default:
        return h(DashboardPage, { bundles: scopedBundles, loading: loading, onSelectBundle: handleSelectBundle, terms: terms });
    }
  }

  var anyMyWorkCheckbox = filterMyCurrentStage || filterMyFutureStage || filterMyPriorStage;

  return h(ConfigProvider, { theme: dominoTheme },
    h('div', null,
      h(TopNav, { terms: terms, useDummy: useDummy, onToggleDummy: handleToggleDummy, connected: connected }),
      h('div', { className: 'app-layout' },
        h(Sidebar, { active: activePage, onNav: function(page) {
          setActivePage(page);
          var mc = document.querySelector('.main-content');
          if (mc) mc.scrollTop = 0;
        } }),
        h('div', { className: 'main-content' },
          // Universal Scope Bar
          h('div', { className: 'global-filter-bar' },
            h('span', { className: 'global-filter-label' }, 'Scope:'),
            h(Select, {
              mode: 'multiple', placeholder: 'All Projects',
              value: scopeProjects, onChange: setScopeProjects,
              allowClear: true, maxTagCount: 2,
              style: { minWidth: 220 }, size: 'small',
              options: scopeProjectOptions,
            }),
            h(Select, {
              mode: 'multiple', placeholder: 'Tags',
              value: scopeTags, onChange: setScopeTags,
              allowClear: true, maxTagCount: 2,
              style: { minWidth: 220 }, size: 'small',
              options: scopeTagOptions,
            }),
            h('span', { className: 'global-filter-divider' }),
            h('span', { className: 'global-filter-label' }, 'Assigned to Me:'),
            h(Checkbox, {
              checked: filterMyCurrentStage,
              onChange: function(e) { setFilterMyCurrentStage(e.target.checked); },
              style: { fontSize: 12 },
            }, 'Current stage'),
            h(Checkbox, {
              checked: filterMyFutureStage,
              onChange: function(e) { setFilterMyFutureStage(e.target.checked); },
              style: { fontSize: 12 },
            }, 'Future stage'),
            h(Checkbox, {
              checked: filterMyPriorStage,
              onChange: function(e) { setFilterMyPriorStage(e.target.checked); },
              style: { fontSize: 12 },
            }, 'Prior stage'),
            hasScopeFilters
              ? h('span', { style: { marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8 } },
                  h(Tag, { color: 'purple' }, scopedBundles.length + ' of ' + bundles.length + ' ' + terms.bundle.toLowerCase() + 's'),
                  h(Button, { type: 'link', size: 'small', onClick: function() {
                    setScopeProjects([]); setScopeTags([]); setFilterMyCurrentStage(false); setFilterMyFutureStage(false); setFilterMyPriorStage(false);
                  } }, 'Clear all')
                )
              : null
          ),
          activePage === 'metrics' && hasScopeFilters
            ? h(Alert, {
                type: 'info', showIcon: true,
                message: 'Team Metrics are scoped to the current filter. Some team members may have work outside this scope.',
                style: { marginBottom: 12 },
              })
            : null,
          renderPage()
        )
      ),
      h(DetailDrawer, {
        bundle: selectedBundle,
        visible: drawerOpen,
        onClose: function() { setDrawerOpen(false); },
        terms: terms,
      })
    )
  );
}

// ── Mount ───────────────────────────────────────────────────────
var root = ReactDOM.createRoot(document.getElementById('root'));
root.render(h(App));
