/* ================================================================
   SCE QC Tracker — Domino App
   For pharma stat programming milestones and QC tracking
   ================================================================ */

const { ConfigProvider, Button, Table, Tag, Space, Spin, Drawer, Badge,
        Tooltip, Progress, Select, Input, Empty, Tabs, Statistic, Switch,
        Modal, Alert, Radio } = antd;
const { createElement: h, useState, useEffect, useCallback, useMemo } = React;

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
function getDominoBundleUrl(bundle) {
  var host = '';
  try { host = window.location.origin; } catch(e) {}
  // In Domino, the bundle URL pattern is: /u/{owner}/{project}/governance/bundle/{bundleId}/policy/{policyId}
  if (bundle.projectOwner && bundle.projectName && bundle.id && bundle.policyId) {
    return host + '/u/' + bundle.projectOwner + '/' + bundle.projectName +
      '/governance/bundle/' + bundle.id + '/policy/' + bundle.policyId;
  }
  return null;
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
  return h('div', { className: 'top-nav' },
    h('img', { src: 'static/../domino-logo.svg', className: 'top-nav-logo', alt: 'Domino' }),
    h('div', { className: 'top-nav-divider' }),
    h('span', { className: 'top-nav-title' }, 'SCE QC Tracker'),
    h('div', { className: 'top-nav-right' },
      isWhitelabeled
        ? h(Tooltip, { title: terms.bundle + 's & ' + terms.policy + ' terminology active' },
            h('span', { className: 'top-nav-whitelabel-badge' },
              terms.bundle + 's / ' + terms.policy
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
  { key: 'dashboard', icon: '\u25A3', label: 'Dashboard' },
  { key: 'tracker', icon: '\u25C9', label: 'QC Tracker' },
  { key: 'rules', icon: '\u2699', label: 'Assignment Rules' },
  { key: 'milestones', icon: '\u2630', label: 'Milestones' },
  { key: 'approvals', icon: '\u2713', label: 'Approvals' },
  { key: 'findings', icon: '\u26A0', label: 'Findings & QC' },
  { key: 'metrics', icon: '\u2261', label: 'Team Metrics' },
];

function Sidebar(props) {
  var active = props.active;
  var onNav = props.onNav;
  return h('div', { className: 'sidebar' },
    NAV_ITEMS.map(function(item) {
      return h('div', {
        key: item.key,
        className: 'sidebar-item' + (active === item.key ? ' active' : ''),
        onClick: function() { onNav(item.key); },
      },
        h('span', { className: 'sidebar-icon' }, item.icon),
        h('span', null, item.label)
      );
    })
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
      h('p', null, 'Visual stage progression for active ' + B.toLowerCase() + 's')
    ),
    h('div', { className: 'panel' },
      h('div', { className: 'panel-header' },
        h('span', { className: 'panel-title' }, 'Programming Milestones'),
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
      h(StatCard, { label: 'Total Approvals', value: approvalStats.total, color: 'primary', active: !approvalFilter, onClick: function() { setApprovalFilter(null); } }),
      h(StatCard, { label: 'Pending', value: approvalStats.pending + approvalStats.review, color: 'warning', sub: 'Awaiting action', active: approvalFilter === 'pendingAll', onClick: function() { setApprovalFilter(approvalFilter === 'pendingAll' ? null : 'pendingAll'); } }),
      h(StatCard, { label: 'Approved', value: approvalStats.approved, color: 'success', active: approvalFilter === 'approved', onClick: function() { setApprovalFilter(approvalFilter === 'approved' ? null : 'approved'); } }),
      h(StatCard, { label: 'Conditional', value: approvalStats.conditional, color: 'info', active: approvalFilter === 'conditional', onClick: function() { setApprovalFilter(approvalFilter === 'conditional' ? null : 'conditional'); } })
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

  var allFindings = useMemo(function() {
    var result = [];
    bundles.forEach(function(b) {
      if (b._findings) {
        b._findings.forEach(function(f) {
          result.push(Object.assign({}, f, { _bundleName: b.name }));
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
    if (!findingFilter) return allFindings;
    if (findingFilter.type === 'severity') return allFindings.filter(function(f) { return f.severity === findingFilter.value; });
    if (findingFilter.type === 'status') return allFindings.filter(function(f) { return f.status === findingFilter.value; });
    if (findingFilter.type === 'open') return allFindings.filter(function(f) { return f.status !== 'Done' && f.status !== 'WontDo'; });
    if (findingFilter.type === 'critical') return allFindings.filter(function(f) { return f.severity === 'S0'; });
    if (findingFilter.type === 'resolved') return allFindings.filter(function(f) { return f.status === 'Done'; });
    return allFindings;
  }, [allFindings, findingFilter]);

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

  var columns = [
    { title: B, dataIndex: '_bundleName', key: 'study', width: 160,
      render: function(t) { return h('span', { style: { fontWeight: 500 } }, t); } },
    { title: 'Finding', dataIndex: 'name', key: 'name' },
    { title: 'Severity', dataIndex: 'severity', key: 'severity',
      render: function(sev) { return h(Tag, { color: severityColor(sev), style: { color: '#fff', border: 'none' } }, sev); },
      filters: ['S0', 'S1', 'S2', 'S3'].map(function(s) { return { text: s, value: s }; }),
      onFilter: function(v, r) { return r.severity === v; },
    },
    { title: 'Status', dataIndex: 'status', key: 'status', render: findingStatusTag,
      filters: ['ToDo', 'InProgress', 'InReview', 'Done', 'WontDo'].map(function(s) { return { text: s, value: s }; }),
      onFilter: function(v, r) { return r.status === v; },
    },
    { title: 'Assignee', key: 'assignee',
      render: function(_, r) { return r.assignee ? r.assignee.name : '\u2014'; } },
    { title: 'Due', dataIndex: 'dueDate', key: 'due',
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
      h('div', { className: 'panel-body-flush' },
        h(Table, {
          dataSource: filteredFindings,
          columns: columns,
          rowKey: function(r) { return r.id || (r._bundleName + '-' + r.name); },
          loading: loading,
          pagination: { pageSize: 10, size: 'small' },
          size: 'small',
        })
      )
    )
  );
}


// ═══════════════════════════════════════════════════════════════
//  PAGE: Team Metrics
// ═══════════════════════════════════════════════════════════════
function MetricsPage(props) {
  var bundles = props.bundles;
  var terms = props.terms || DEFAULT_TERMS;
  var B = terms.bundle;
  var P = terms.policy;

  var _mf = useState(null);
  var metricsFilter = _mf[0];
  var setMetricsFilter = _mf[1];

  var metrics = useMemo(function() {
    var activeBundles = bundles.filter(function(b) { return b.state === 'Active'; });
    var completeBundles = bundles.filter(function(b) { return b.state === 'Complete'; });

    // Bundles per policy (team/therapeutic area proxy)
    var policyGroups = {};
    bundles.forEach(function(b) {
      var key = b.policyName || 'Unassigned';
      if (!policyGroups[key]) policyGroups[key] = { active: 0, complete: 0, total: 0 };
      policyGroups[key].total++;
      if (b.state === 'Active') policyGroups[key].active++;
      if (b.state === 'Complete') policyGroups[key].complete++;
    });

    // Assignee workload
    var assignees = {};
    bundles.forEach(function(b) {
      var name = (b.stageAssignee && b.stageAssignee.name) ? b.stageAssignee.name : 'Unassigned';
      if (!assignees[name]) assignees[name] = 0;
      assignees[name]++;
    });

    // Findings per assignee
    var findingsByAssignee = {};
    bundles.forEach(function(b) {
      if (b._findings) {
        b._findings.forEach(function(f) {
          var name = (f.assignee && f.assignee.name) ? f.assignee.name : 'Unassigned';
          if (!findingsByAssignee[name]) findingsByAssignee[name] = { open: 0, resolved: 0 };
          if (f.status === 'Done' || f.status === 'WontDo') findingsByAssignee[name].resolved++;
          else findingsByAssignee[name].open++;
        });
      }
    });

    return {
      active: activeBundles.length,
      complete: completeBundles.length,
      policyGroups: policyGroups,
      assignees: assignees,
      findingsByAssignee: findingsByAssignee,
      completionRate: bundles.length > 0 ? Math.round((completeBundles.length / bundles.length) * 100) : 0,
    };
  }, [bundles]);

  // Filtered bundles for detail table
  var filteredMetricsBundles = useMemo(function() {
    if (!metricsFilter) return bundles;
    if (metricsFilter.type === 'active') return bundles.filter(function(b) { return b.state === 'Active'; });
    if (metricsFilter.type === 'complete') return bundles.filter(function(b) { return b.state === 'Complete'; });
    if (metricsFilter.type === 'policy') return bundles.filter(function(b) { return (b.policyName || 'Unassigned') === metricsFilter.value; });
    if (metricsFilter.type === 'assignee') return bundles.filter(function(b) {
      var name = (b.stageAssignee && b.stageAssignee.name) ? b.stageAssignee.name : 'Unassigned';
      return name === metricsFilter.value;
    });
    return bundles;
  }, [bundles, metricsFilter]);

  var metricsFilterLabel = metricsFilter
    ? (metricsFilter.type === 'active' ? 'Active' : metricsFilter.type === 'complete' ? 'Completed' : metricsFilter.type === 'policy' ? P + ': ' + metricsFilter.value : metricsFilter.type === 'assignee' ? 'Assignee: ' + metricsFilter.value : null)
    : null;

  // Policy breakdown chart
  useEffect(function() {
    var groups = metrics.policyGroups;
    var names = Object.keys(groups);
    if (names.length === 0) return;
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

  // Workload chart
  useEffect(function() {
    var assignees = metrics.assignees;
    var names = Object.keys(assignees).filter(function(n) { return n !== 'Unassigned'; });
    if (names.length === 0) return;
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

  // Findings resolution chart
  useEffect(function() {
    var fba = metrics.findingsByAssignee;
    var names = Object.keys(fba).filter(function(n) { return n !== 'Unassigned'; });
    if (names.length === 0) return;
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

  return h('div', null,
    h('div', { className: 'page-header' },
      h('h1', null, 'Team Metrics'),
      h('p', null, 'Workload distribution, productivity, and quality metrics')
    ),

    h('div', { className: 'stats-row' },
      h(StatCard, { label: 'Active ' + B + 's', value: metrics.active, color: 'primary', active: metricsFilter && metricsFilter.type === 'active', onClick: function() { setMetricsFilter(metricsFilter && metricsFilter.type === 'active' ? null : { type: 'active' }); } }),
      h(StatCard, { label: 'Completed', value: metrics.complete, color: 'success', active: metricsFilter && metricsFilter.type === 'complete', onClick: function() { setMetricsFilter(metricsFilter && metricsFilter.type === 'complete' ? null : { type: 'complete' }); } }),
      h(StatCard, { label: 'Completion Rate', value: metrics.completionRate + '%', color: metrics.completionRate >= 50 ? 'success' : 'warning' }),
      h(StatCard, { label: P + 's In Use', value: Object.keys(metrics.policyGroups).length })
    ),

    h('div', { className: 'panel' },
      h('div', { className: 'panel-header' }, h('span', { className: 'panel-title' }, B + 's by ' + P + ' / Therapeutic Area')),
      h('div', { className: 'panel-body' },
        Object.keys(metrics.policyGroups).length > 0
          ? h('div', { id: 'chart-policy-breakdown', className: 'chart-container' })
          : h(EmptyState, { text: 'No policy data' })
      )
    ),

    h('div', { className: 'two-col' },
      h('div', { className: 'panel' },
        h('div', { className: 'panel-header' }, h('span', { className: 'panel-title' }, 'Assignee Workload')),
        h('div', { className: 'panel-body' },
          Object.keys(metrics.assignees).length > 1 || (Object.keys(metrics.assignees).length === 1 && !metrics.assignees['Unassigned'])
            ? h('div', { id: 'chart-workload', className: 'chart-container' })
            : h(EmptyState, { text: 'No assignee data', sub: 'Assign stage owners in SCE QC' })
        )
      ),
      h('div', { className: 'panel' },
        h('div', { className: 'panel-header' }, h('span', { className: 'panel-title' }, 'Findings Resolution by Assignee')),
        h('div', { className: 'panel-body' },
          Object.keys(metrics.findingsByAssignee).length > 1 || (Object.keys(metrics.findingsByAssignee).length === 1 && !metrics.findingsByAssignee['Unassigned'])
            ? h('div', { id: 'chart-findings-resolution', className: 'chart-container' })
            : h(EmptyState, { text: 'No findings data' })
        )
      )
    ),

    // Detail table (shown when a filter is active)
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
//  COMPONENT: Stage Pipeline (inline SVG dots)
// ═══════════════════════════════════════════════════════════════
function StagePipeline(props) {
  var bundle = props.bundle;
  var stageNames = getBundleStageNames(bundle);
  if (stageNames.length === 0) return h('span', { style: { color: '#8F8FA3', fontSize: 12 } }, 'No stages');
  var currentIdx = deriveBundleStageIndex(bundle);
  var isComplete = bundle.state === 'Complete';
  var hasOpenFindings = bundle._findings && bundle._findings.some(function(f) {
    return f.status !== 'Done' && f.status !== 'WontDo';
  });

  var dotR = 6;
  var gap = 8;
  var step = dotR * 2 + gap;
  var svgW = stageNames.length * dotR * 2 + (stageNames.length - 1) * gap;
  var svgH = dotR * 2 + 4;

  var elements = [];

  // Connector lines
  for (var i = 0; i < stageNames.length - 1; i++) {
    var x1 = dotR + i * step + dotR;
    var x2 = x1 + gap;
    var isBeforeCurrent = i < currentIdx || isComplete;
    var isAtCurrent = i === currentIdx - 1;
    var lineColor = (isComplete || i < currentIdx) ? '#28A464' : '#D1D1DB';
    var dashArray = (isComplete || i < currentIdx) ? 'none' : '3,2';
    elements.push(h('line', {
      key: 'line-' + i,
      x1: x1, y1: svgH / 2, x2: x2, y2: svgH / 2,
      stroke: lineColor, strokeWidth: 2, strokeDasharray: dashArray
    }));
  }

  // Dots
  for (var j = 0; j < stageNames.length; j++) {
    var cx = dotR + j * step;
    var cy = svgH / 2;
    var dotState;
    if (isComplete || j < currentIdx) dotState = 'completed';
    else if (j === currentIdx) dotState = hasOpenFindings ? 'blocked' : 'active';
    else dotState = 'pending';

    var fill, stroke, strokeW, className;
    if (dotState === 'completed') { fill = '#28A464'; stroke = 'none'; strokeW = 0; className = ''; }
    else if (dotState === 'active') { fill = '#F59E0B'; stroke = 'none'; strokeW = 0; className = 'stage-dot-pulse'; }
    else if (dotState === 'blocked') { fill = '#C20A29'; stroke = 'none'; strokeW = 0; className = 'stage-dot-pulse'; }
    else { fill = 'transparent'; stroke = '#D1D1DB'; strokeW = 2; className = ''; }

    var assignee = bundle.stages[j] && bundle.stages[j].assignee;
    var assigneeName = assignee ? assignee.name : 'Unassigned';
    var statusText = dotState === 'completed' ? 'Completed' : dotState === 'active' ? 'In Progress' : dotState === 'blocked' ? 'Open Finding' : 'Pending';
    var tipText = stageNames[j] + '\n' + assigneeName + ' \u2022 ' + statusText;

    elements.push(
      h(Tooltip, { key: 'dot-' + j, title: tipText },
        h('circle', {
          cx: cx, cy: cy, r: dotR - (strokeW ? 1 : 0),
          fill: fill, stroke: stroke, strokeWidth: strokeW,
          className: className,
          style: { cursor: 'pointer' }
        })
      )
    );
  }

  return h('svg', {
    width: svgW, height: svgH,
    className: 'stage-pipeline',
    style: { verticalAlign: 'middle' }
  }, elements);
}


// ═══════════════════════════════════════════════════════════════
//  COMPONENT: Status Flags (3 data-driven indicators)
// ═══════════════════════════════════════════════════════════════
function StatusFlags(props) {
  var bundle = props.bundle;

  var openFindings = bundle._findings ? bundle._findings.filter(function(f) {
    return f.status !== 'Done' && f.status !== 'WontDo';
  }).length : 0;

  var isUnassigned = !bundle.stageAssignee || !bundle.stageAssignee.name;

  var allApproved = bundle._approvals && bundle._approvals.length > 0 &&
    bundle._approvals.every(function(a) { return a.status === 'Approved'; });

  var flags = [];

  if (openFindings > 0) {
    flags.push(h(Tooltip, { key: 'findings', title: openFindings + ' open finding' + (openFindings > 1 ? 's' : '') },
      h('span', { className: 'status-flag open-findings' }, '\u26A0 ' + openFindings)
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
            }, '\u2197 Open in Domino')
          : null
      ),
      stageNames.map(function(name, idx) {
        var dotState;
        if (isComplete || idx < currentIdx) dotState = 'completed';
        else if (idx === currentIdx) dotState = 'active';
        else dotState = 'pending';

        var stageData = bundle.stages[idx] || {};
        var assignee = stageData.assignee;
        var assigneeName = assignee ? assignee.name : null;

        // Project member options for reassignment
        var memberOptions = (typeof MOCK_PROJECT_MEMBERS !== 'undefined' ? MOCK_PROJECT_MEMBERS : []).map(function(m) {
          return { label: m.firstName + ' ' + m.lastName + ' (' + m.userName + ')', value: m.userName };
        });

        return h('div', { key: idx, className: 'tracker-timeline-item' },
          h('div', { className: 'tracker-timeline-dot ' + dotState }),
          idx < stageNames.length - 1
            ? h('div', { className: 'tracker-timeline-line ' + dotState })
            : null,
          h('div', { className: 'tracker-timeline-content' },
            h('div', { className: 'tracker-timeline-name' + (dotState === 'active' ? ' active' : '') }, name),
            h('div', { className: 'tracker-timeline-meta' },
              h(Select, {
                size: 'small',
                placeholder: 'Assign...',
                value: assigneeName || undefined,
                style: { minWidth: 160, fontSize: 11 },
                showSearch: true,
                allowClear: true,
                options: memberOptions,
                onChange: function(val) {
                  // In production: POST to Domino API to update stage assignee
                  console.log('Reassign stage "' + name + '" on bundle "' + bundle.name + '" to: ' + (val || 'Unassigned'));
                },
                optionFilterProp: 'label',
              }),
              h('span', { className: 'tracker-stage-badge ' + dotState },
                dotState === 'completed' ? 'Done' : dotState === 'active' ? 'Current' : 'Pending'
              )
            )
          )
        );
      }),
      // Bundle metadata: created/updated info
      h('div', { className: 'tracker-metadata', style: { marginTop: 16, padding: '10px 0', borderTop: '1px solid #E0E0E0' } },
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
    // Right column: findings + approvals
    h('div', { className: 'tracker-expanded-right' },
      // Findings
      bundle._findings && bundle._findings.length > 0
        ? h('div', null,
            h('div', { className: 'tracker-section-title' }, 'Findings (' + bundle._findings.length + ')'),
            bundle._findings.slice(0, 5).map(function(f, i) {
              return h('div', { key: i, className: 'tracker-finding-row' },
                h(Tag, { color: severityColor(f.severity), style: { color: '#fff', border: 'none', minWidth: 28, textAlign: 'center', fontSize: 11 } }, f.severity),
                h('span', { className: 'tracker-finding-name' }, f.name),
                findingStatusTag(f.status),
                f.assignee ? h('span', { className: 'tracker-finding-meta' }, f.assignee.name) : null,
                f.dueDate ? h('span', { className: 'tracker-finding-meta' }, dayjs(f.dueDate).format('MMM D')) : null
              );
            }),
            bundle._findings.length > 5
              ? h('div', { style: { fontSize: 12, color: '#8F8FA3', padding: '4px 0' } }, '+ ' + (bundle._findings.length - 5) + ' more')
              : null
          )
        : h('div', null,
            h('div', { className: 'tracker-section-title' }, 'Findings'),
            h('div', { style: { color: '#8F8FA3', fontSize: 12 } }, 'No findings')
          ),

      // Approvals
      bundle._approvals && bundle._approvals.length > 0
        ? h('div', { style: { marginTop: 16 } },
            h('div', { className: 'tracker-section-title' }, 'Approvals (' + bundle._approvals.length + ')'),
            bundle._approvals.map(function(a, i) {
              return h('div', { key: i, className: 'tracker-approval-row' },
                h('span', { className: 'tracker-approval-dot', style: { background: approvalStatusColor(a.status) } }),
                h('span', { className: 'tracker-approval-name' }, a.name),
                h('span', { className: 'tracker-approval-status' }, approvalStatusLabel(a.status)),
                a.approvers && a.approvers.length > 0
                  ? h('span', { className: 'tracker-approval-actors' }, a.approvers.map(function(ap) { return ap.name; }).join(', '))
                  : null,
                a.updatedAt
                  ? h('span', { className: 'tracker-approval-time' }, fmtTimeAgo(a.updatedAt))
                  : null
              );
            })
          )
        : null,

      // Gates
      bundle._gates && bundle._gates.length > 0
        ? h('div', { style: { marginTop: 16 } },
            h('div', { className: 'tracker-section-title' }, 'Gates (' + bundle._gates.length + ')'),
            bundle._gates.map(function(g, i) {
              return h('div', { key: i, className: 'tracker-approval-row' },
                h(Tag, { color: g.isOpen ? 'success' : 'error', style: { fontSize: 11 } }, g.isOpen ? 'Open' : 'Closed'),
                h('span', { className: 'tracker-approval-name' }, g.name)
              );
            })
          )
        : null,

      // Attachments
      bundle._attachments && bundle._attachments.length > 0
        ? h('div', { style: { marginTop: 16 } },
            h('div', { className: 'tracker-section-title' }, 'Attachments (' + bundle._attachments.length + ')'),
            h(Table, {
              dataSource: bundle._attachments,
              rowKey: 'id',
              size: 'small',
              pagination: false,
              style: { fontSize: 11 },
              columns: [
                { title: 'File', key: 'filename', width: 180, ellipsis: true,
                  render: function(_, r) {
                    var fname = r.identifier && r.identifier.filename;
                    var name = r.identifier && r.identifier.name;
                    return h('span', { style: { fontWeight: 500, fontSize: 11 } }, fname || name || 'Unknown');
                  }
                },
                { title: 'Type', dataIndex: 'type', key: 'type', width: 120,
                  render: function(t) {
                    var colors = { DatasetSnapshotFile: 'blue', Report: 'green', ModelVersion: 'purple', Endpoint: 'orange', FlowArtifact: 'cyan', NetAppVolumeSnapshotFile: 'default' };
                    return h(Tag, { color: colors[t] || 'default', style: { fontSize: 10 } }, (t || '').replace(/([A-Z])/g, ' $1').trim());
                  }
                },
                { title: 'Source', key: 'source', width: 140, ellipsis: true,
                  render: function(_, r) {
                    var id = r.identifier || {};
                    if (id.source === 'DominoDataset') return h('span', { style: { fontSize: 10 } }, (id.name || 'Dataset') + ' @ ' + (id.branch || ''));
                    if (id.source === 'DominoFlow') return h('span', { style: { fontSize: 10 } }, id.executionWorkflowName || 'Flow');
                    if (id.source === 'DominoModel') return h('span', { style: { fontSize: 10 } }, (id.name || 'Model') + ' v' + (id.version || ''));
                    return h('span', { style: { fontSize: 10, color: '#8F8FA3' } }, id.source || id.name || '\u2014');
                  }
                },
                { title: 'Added By', key: 'addedBy', width: 110,
                  render: function(_, r) {
                    var name = r.createdBy && (r.createdBy.name || r.createdBy.userName);
                    return h('span', { style: { fontSize: 10 } }, name || '\u2014');
                  }
                },
                { title: 'Added', key: 'addedAt', width: 90,
                  render: function(_, r) {
                    return r.createdAt ? h('span', { style: { fontSize: 10, color: '#8F8FA3' } }, dayjs(r.createdAt).format('MMM D, YYYY')) : '\u2014';
                  }
                },
              ],
            })
          )
        : h('div', { style: { marginTop: 16 } },
            h('div', { className: 'tracker-section-title' }, 'Attachments'),
            h('div', { style: { color: '#8F8FA3', fontSize: 12 } }, 'No attachments')
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
  var terms = props.terms || DEFAULT_TERMS;
  var B = terms.bundle;
  var selectedKeys = props.selectedKeys || [];

  var _ba = useState(null);
  var bulkAssignee = _ba[0];
  var setBulkAssignee = _ba[1];

  if (count === 0) return null;

  var memberOptions = (typeof MOCK_PROJECT_MEMBERS !== 'undefined' ? MOCK_PROJECT_MEMBERS : []).map(function(m) {
    return { label: m.firstName + ' ' + m.lastName + ' (' + m.userName + ')', value: m.userName };
  });

  function handleBulkAssign() {
    if (!bulkAssignee) return;
    console.log('Bulk assign ' + count + ' deliverables to: ' + bulkAssignee, selectedKeys);
    // In production: POST to Domino API for each selected bundle
    antd.message.success('Assigned ' + count + ' ' + B.toLowerCase() + (count > 1 ? 's' : '') + ' to ' + bulkAssignee);
    setBulkAssignee(null);
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
        disabled: !bulkAssignee,
        onClick: handleBulkAssign,
      }, 'Assign'),
      h(Button, { size: 'small', type: 'link', onClick: onClear, style: { color: '#fff' } }, 'Clear')
    )
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

  // Filter state
  var _fs1 = useState(''); var searchText = _fs1[0]; var setSearchText = _fs1[1];
  var _fs2 = useState([]); var filterPolicies = _fs2[0]; var setFilterPolicies = _fs2[1];
  var _fs3 = useState(null); var filterState = _fs3[0]; var setFilterState = _fs3[1];
  var _fs4 = useState(null); var filterAssignee = _fs4[0]; var setFilterAssignee = _fs4[1];
  var _fs5 = useState([]); var filterFlags = _fs5[0]; var setFilterFlags = _fs5[1];
  var _fs6 = useState([]); var selectedRowKeys = _fs6[0]; var setSelectedRowKeys = _fs6[1];
  var _fs7 = useState([]); var expandedRowKeys = _fs7[0]; var setExpandedRowKeys = _fs7[1];
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
      if (searchText && b.name.toLowerCase().indexOf(searchText.toLowerCase()) < 0) return false;
      if (filterPolicies.length > 0 && filterPolicies.indexOf(b.policyName) < 0) return false;
      if (filterState && b.state !== filterState) return false;
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
  }, [bundles, searchText, filterPolicies, filterState, filterAssignee, filterFlags]);

  // Stats (computed from filtered, not all bundles)
  var stats = useMemo(function() {
    var openFindings = 0; var unassigned = 0; var complete = 0;
    filtered.forEach(function(b) {
      if (b.state === 'Complete') complete++;
      if (!b.stageAssignee || !b.stageAssignee.name) unassigned++;
      if (b._findings && b._findings.some(function(f) { return f.status !== 'Done' && f.status !== 'WontDo'; })) openFindings++;
    });
    return { total: filtered.length, openFindings: openFindings, unassigned: unassigned, complete: complete, active: filtered.length - complete };
  }, [filtered]);

  var activeFilterCount = (searchText ? 1 : 0) + (filterPolicies.length > 0 ? 1 : 0) + (filterState ? 1 : 0) + (filterAssignee ? 1 : 0) + filterFlags.length;

  function clearFilters() {
    setSearchText(''); setFilterPolicies([]); setFilterState(null); setFilterAssignee(null); setFilterFlags([]);
  }

  // Clickable stat cards — set a filter when clicked
  function handleStatClick(type) {
    clearFilters();
    if (type === 'active') setFilterState('Active');
    else if (type === 'openFindings') setFilterFlags(['open_findings']);
    else if (type === 'unassigned') setFilterFlags(['unassigned']);
    else if (type === 'complete') setFilterState('Complete');
    // 'total' clears filters (already done above)
  }

  // Excel-like column filters + sorters
  var columns = [
    {
      title: B, dataIndex: 'name', key: 'name', width: 140, fixed: 'left',
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
      onFilter: function(v, r) { return r.projectName === v; },
      sorter: function(a, b) { return (a.projectName || '').localeCompare(b.projectName || ''); },
      render: function(t) { return h('span', { style: { fontSize: 12 } }, t || '\u2014'); } },
    { title: P, dataIndex: 'policyName', key: 'policy', width: 150, ellipsis: true,
      filters: policyOptions.map(function(p) { return { text: p, value: p }; }),
      onFilter: function(v, r) { return r.policyName === v; },
      render: function(t) { return t ? h(Tag, { style: { fontSize: 10 } }, t) : '\u2014'; } },
    { title: 'Progress', key: 'progress', width: 130,
      sorter: function(a, b) { return getBundleProgress(a) - getBundleProgress(b); },
      render: function(_, record) { return h(StagePipeline, { bundle: record }); } },
    { title: 'Stage', dataIndex: 'stage', key: 'stage', width: 130, ellipsis: true,
      filters: allStageNames.map(function(s) { return { text: s, value: s }; }),
      onFilter: function(v, r) { return r.stage === v; },
      sorter: function(a, b) { return (a.stage || '').localeCompare(b.stage || ''); },
      render: function(t) { return h('span', { style: { fontSize: 12 } }, t || '\u2014'); } },
    { title: 'Assignee', key: 'assignee', width: 100,
      filters: [{ text: 'Unassigned', value: '__unassigned__' }].concat(
        assigneeOptions.map(function(n) { return { text: n, value: n }; })
      ),
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
    { title: '\uD83D\uDCCE', key: 'attachments', width: 50, align: 'center',
      sorter: function(a, b) { return (a._attachments || []).length - (b._attachments || []).length; },
      render: function(_, record) {
        var count = (record._attachments || []).length;
        if (count === 0) return h('span', { style: { color: '#D1D1DB', fontSize: 11 } }, '\u2014');
        return h(Tooltip, { title: count + ' attachment' + (count > 1 ? 's' : '') },
          h('span', { style: { color: '#543FDE', fontSize: 12, fontWeight: 600, cursor: 'pointer' } }, count)
        );
      }
    },
    { title: 'Flags', key: 'flags', width: 70,
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
      render: function(_, record) { return h(StatusFlags, { bundle: record }); } },
  ];

  return h('div', null,
    h('div', { className: 'page-header' },
      h('h1', null, 'QC Tracker'),
      h('p', null, 'Track all ' + B.toLowerCase() + 's across projects and ' + P.toLowerCase() + 's')
    ),

    // Stat cards — clickable to filter
    h('div', { className: 'stats-row' },
      h('div', { className: 'stat-card-clickable', onClick: function() { handleStatClick('total'); } },
        h(StatCard, { label: 'Total ' + B + 's', value: stats.total, color: 'primary' })),
      h('div', { className: 'stat-card-clickable', onClick: function() { handleStatClick('active'); } },
        h(StatCard, { label: 'Active', value: stats.active, color: 'info' })),
      h('div', { className: 'stat-card-clickable', onClick: function() { handleStatClick('openFindings'); } },
        h(StatCard, { label: 'Open Findings', value: stats.openFindings, color: stats.openFindings > 0 ? 'danger' : '' })),
      h('div', { className: 'stat-card-clickable', onClick: function() { handleStatClick('unassigned'); } },
        h(StatCard, { label: 'Unassigned', value: stats.unassigned, color: stats.unassigned > 0 ? 'warning' : '' })),
      h('div', { className: 'stat-card-clickable', onClick: function() { handleStatClick('complete'); } },
        h(StatCard, { label: 'Complete', value: stats.complete, color: 'success' }))
    ),

    // Main panel
    h('div', { className: 'panel' },
      // Bulk actions
      h(BulkActionBar, {
        count: selectedRowKeys.length,
        selectedKeys: selectedRowKeys,
        onClear: function() { setSelectedRowKeys([]); },
        terms: terms,
      }),

      // Table with Excel-like column filters
      h('div', { className: 'panel-body-flush' },
        h(Table, {
          dataSource: filtered,
          columns: columns,
          rowKey: function(r) { return r.id || r.name; },
          loading: loading,
          size: 'small',
          scroll: { x: 1000 },
          pagination: { pageSize: 15, size: 'small', showSizeChanger: false, showTotal: function(total) { return total + ' ' + B.toLowerCase() + 's'; } },
          rowSelection: {
            selectedRowKeys: selectedRowKeys,
            onChange: function(keys) { setSelectedRowKeys(keys); },
          },
          expandable: {
            expandedRowKeys: expandedRowKeys,
            onExpandedRowsChange: function(keys) { setExpandedRowKeys(keys); },
            expandedRowRender: function(record) {
              return h(QCTrackerExpandedRow, { bundle: record, terms: terms });
            },
          },
        })
      )
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
        }, '\u2197 Open in Domino')
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
          h('div', { className: 'detail-section-title' }, 'Findings (' + bundle._findings.length + ')'),
          bundle._findings.slice(0, 5).map(function(f, i) {
            return h('div', { key: i, style: { display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0', borderBottom: '1px solid #F5F5F8' } },
              h(Tag, { color: severityColor(f.severity), style: { color: '#fff', border: 'none', minWidth: 28, textAlign: 'center' } }, f.severity),
              h('span', { style: { flex: 1, fontSize: 13 } }, f.name),
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

  // Stages for selected QC Plan (from MOCK_POLICIES or from bundle data)
  var stageOptions = useMemo(function() {
    if (!formPlan) return [];
    // Try MOCK_POLICIES first
    if (typeof MOCK_POLICIES !== 'undefined') {
      var policy = MOCK_POLICIES.find(function(p) { return p.name === formPlan; });
      if (policy) return policy.stages.map(function(s) { return { label: s, value: s }; });
    }
    // Fallback: extract from bundle stages
    var names = {};
    projectBundles.forEach(function(b) {
      if (b.policyName !== formPlan) return;
      (b.stages || []).forEach(function(s) {
        var n = s.stage ? s.stage.name : '';
        if (n) names[n] = true;
      });
    });
    return Object.keys(names).map(function(n) { return { label: n, value: n }; });
  }, [formPlan, projectBundles]);

  // Assignee options (project members)
  var memberOptions = useMemo(function() {
    return (typeof MOCK_PROJECT_MEMBERS !== 'undefined' ? MOCK_PROJECT_MEMBERS : []).map(function(m) {
      return { label: m.firstName + ' ' + m.lastName + ' (' + m.userName + ')', value: m.userName };
    });
  }, []);

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
      var mem = (typeof MOCK_PROJECT_MEMBERS !== 'undefined' ? MOCK_PROJECT_MEMBERS : []).find(function(m) { return m.userName === rule.assignee; });
      var newLabel = mem ? mem.firstName + ' ' + mem.lastName : rule.assignee;
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
        var mem = (typeof MOCK_PROJECT_MEMBERS !== 'undefined' ? MOCK_PROJECT_MEMBERS : []).find(function(m) { return m.userName === v; });
        return mem ? mem.firstName + ' ' + mem.lastName : v;
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
      h('h2', null, 'Assignment Rules'),
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
              h(Button, {
                onClick: function() { setApplyModalOpen(true); },
                disabled: projectRules.length === 0,
              }, 'Apply Rules')
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
            title: 'Apply Assignment Rules',
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
  var _s9 = useState(true); var useDummy = _s9[0]; var setUseDummy = _s9[1];
  var _s10 = useState([]); var assignmentRules = _s10[0]; var setAssignmentRules = _s10[1];

  // ── Universal Scope Filters ──────────────────────────────────
  var _sc1 = useState([]); var scopeProjects = _sc1[0]; var setScopeProjects = _sc1[1];
  var _sc2 = useState([]); var scopeTags = _sc2[0]; var setScopeTags = _sc2[1];
  var _sc3 = useState('all'); var scopeView = _sc3[0]; var setScopeView = _sc3[1];
  var _sc4 = useState('production_programmer'); var scopeCurrentUser = _sc4[0]; var setScopeCurrentUser = _sc4[1];

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

  // Derive tag options from all bundles
  var scopeTagOptions = useMemo(function() {
    var tags = {};
    if (typeof MOCK_PROJECT_TAGS === 'undefined') return [];
    bundles.forEach(function(b) {
      var pTags = MOCK_PROJECT_TAGS[b.projectId] || [];
      pTags.forEach(function(t) { tags[t.key + ': ' + t.value] = true; });
    });
    return Object.keys(tags).sort().map(function(t) { return { label: t, value: t }; });
  }, [bundles]);

  // Derive user options for "My Work" persona selector
  var scopeUserOptions = useMemo(function() {
    return (typeof MOCK_PROJECT_MEMBERS !== 'undefined' ? MOCK_PROJECT_MEMBERS : []).map(function(m) {
      return { label: m.firstName + ' ' + m.lastName, value: m.userName };
    });
  }, []);

  // Apply universal scope to get scopedBundles
  var scopedBundles = useMemo(function() {
    return bundles.filter(function(b) {
      // Project filter
      if (scopeProjects.length > 0 && scopeProjects.indexOf(b.projectName) < 0) return false;
      // Tag filter
      if (scopeTags.length > 0 && typeof MOCK_PROJECT_TAGS !== 'undefined') {
        var pTags = MOCK_PROJECT_TAGS[b.projectId] || [];
        var tagLabels = pTags.map(function(t) { return t.key + ': ' + t.value; });
        var matchesTag = scopeTags.some(function(ft) { return tagLabels.indexOf(ft) >= 0; });
        if (!matchesTag) return false;
      }
      // View filter
      if (scopeView === 'mywork') {
        var isAssigned = false;
        (b.stages || []).forEach(function(s) {
          if (s.assignee && s.assignee.name === scopeCurrentUser) isAssigned = true;
        });
        if (!isAssigned) return false;
      } else if (scopeView === 'mywork_current') {
        var currentStage = b.stage;
        var match = false;
        (b.stages || []).forEach(function(s) {
          if (s.stage && s.stage.name === currentStage && s.assignee && s.assignee.name === scopeCurrentUser) match = true;
        });
        if (!match) return false;
      } else if (scopeView === 'mywork_upcoming') {
        var stageNames = (b.stages || []).map(function(s) { return s.stage ? s.stage.name : ''; });
        var curIdx = stageNames.indexOf(b.stage);
        var futureMatch = false;
        (b.stages || []).forEach(function(s, idx) {
          if (idx > curIdx && s.assignee && s.assignee.name === scopeCurrentUser) futureMatch = true;
        });
        if (!futureMatch) return false;
      } else if (scopeView === 'mywork_completed') {
        var stageNames2 = (b.stages || []).map(function(s) { return s.stage ? s.stage.name : ''; });
        var curIdx2 = stageNames2.indexOf(b.stage);
        var priorMatch = false;
        (b.stages || []).forEach(function(s, idx) {
          if (idx < curIdx2 && s.assignee && s.assignee.name === scopeCurrentUser) priorMatch = true;
        });
        if (!priorMatch) return false;
      } else if (scopeView === 'unassigned') {
        var currentStage2 = b.stage;
        var currentAssigned = false;
        (b.stages || []).forEach(function(s) {
          if (s.stage && s.stage.name === currentStage2 && s.assignee && s.assignee.name) currentAssigned = true;
        });
        if (currentAssigned) return false;
      } else if (scopeView === 'blocked') {
        var hasOpen = b._findings && b._findings.some(function(f) { return f.status !== 'Done' && f.status !== 'WontDo'; });
        if (!hasOpen) return false;
      }
      return true;
    });
  }, [bundles, scopeProjects, scopeTags, scopeView, scopeCurrentUser]);

  var hasScopeFilters = scopeProjects.length > 0 || scopeTags.length > 0 || scopeView !== 'all';

  // Load mock/dummy data
  function loadMockData() {
    setConnected(false);
    if (typeof MOCK_BUNDLES !== 'undefined') {
      var mockEnriched = MOCK_BUNDLES.map(function(b) {
        var copy = Object.assign({}, b);
        copy._approvals = (typeof MOCK_APPROVALS !== 'undefined' && MOCK_APPROVALS[b.id]) || [];
        copy._findings = (typeof MOCK_FINDINGS !== 'undefined' && MOCK_FINDINGS[b.id]) || [];
        copy._gates = (typeof MOCK_GATES !== 'undefined' && MOCK_GATES[b.id]) || [];
        copy._attachments = (typeof MOCK_ATTACHMENTS !== 'undefined' && MOCK_ATTACHMENTS[b.id]) || [];
        return copy;
      });
      setBundles(mockEnriched);
    } else {
      setBundles([]);
    }
    if (typeof MOCK_TERMINOLOGY !== 'undefined') {
      setTerms(MOCK_TERMINOLOGY);
    }
    setLoading(false);
    setError(null);
  }

  // Fetch live data from Domino
  function fetchLiveData() {
    setLoading(true);
    setError(null);
    apiGet('api/bundles?limit=100')
      .then(function(resp) {
        var bundleList = resp.data || [];
        setConnected(true);
        var enrichPromises = bundleList.map(function(bundle) {
          return Promise.all([
            apiGet('api/bundles/' + bundle.id + '/approvals').catch(function() { return []; }),
            apiGet('api/bundles/' + bundle.id + '/findings?limit=100').catch(function() { return { data: [] }; }),
            apiGet('api/bundles/' + bundle.id + '/gates').catch(function() { return []; }),
          ]).then(function(results) {
            bundle._approvals = Array.isArray(results[0]) ? results[0] : [];
            bundle._findings = results[1].data || (Array.isArray(results[1]) ? results[1] : []);
            bundle._gates = Array.isArray(results[2]) ? results[2] : [];
            bundle._attachments = Array.isArray(bundle.attachments) ? bundle.attachments : [];
            return bundle;
          });
        });
        return Promise.all(enrichPromises);
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

  function handleSelectBundle(bundle) {
    setSelectedBundle(bundle);
    setDrawerOpen(true);
  }

  function renderPage() {
    // Assignment Rules always gets unfiltered bundles (it has its own project selector)
    // All other pages get scopedBundles
    switch (activePage) {
      case 'dashboard':
        return h(DashboardPage, { bundles: scopedBundles, loading: loading, onSelectBundle: handleSelectBundle, terms: terms });
      case 'tracker':
        return h(QCTrackerPage, { bundles: scopedBundles, loading: loading, onSelectBundle: handleSelectBundle, terms: terms });
      case 'rules':
        return h(AssignmentRulesPage, { bundles: bundles, setBundles: setBundles, assignmentRules: assignmentRules, setAssignmentRules: setAssignmentRules, terms: terms });
      case 'milestones':
        return h(MilestonesPage, { bundles: scopedBundles, loading: loading, terms: terms });
      case 'approvals':
        return h(ApprovalsPage, { bundles: scopedBundles, loading: loading, terms: terms });
      case 'findings':
        return h(FindingsPage, { bundles: scopedBundles, loading: loading, terms: terms });
      case 'metrics':
        return h(MetricsPage, { bundles: scopedBundles, terms: terms });
      default:
        return h(DashboardPage, { bundles: scopedBundles, loading: loading, onSelectBundle: handleSelectBundle, terms: terms });
    }
  }

  var viewOptions = [
    { label: 'All Deliverables', value: 'all' },
    { label: 'My Work (Any Stage)', value: 'mywork' },
    { label: 'My Work (Current Stage)', value: 'mywork_current' },
    { label: 'My Work (Upcoming)', value: 'mywork_upcoming' },
    { label: 'My Work (Completed)', value: 'mywork_completed' },
    { label: 'Unassigned', value: 'unassigned' },
    { label: 'Blocked', value: 'blocked' },
  ];

  var isMyWorkView = scopeView.indexOf('mywork') === 0;

  return h(ConfigProvider, { theme: dominoTheme },
    h('div', null,
      h(TopNav, { terms: terms, useDummy: useDummy, onToggleDummy: handleToggleDummy, connected: connected }),
      h('div', { className: 'app-layout' },
        h(Sidebar, { active: activePage, onNav: setActivePage }),
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
            h('span', { className: 'global-filter-label' }, 'View:'),
            h(Select, {
              value: scopeView, onChange: setScopeView,
              style: { minWidth: 180 }, size: 'small',
              options: viewOptions,
            }),
            isMyWorkView
              ? h(Select, {
                  value: scopeCurrentUser, onChange: setScopeCurrentUser,
                  style: { minWidth: 180 }, size: 'small',
                  showSearch: true, optionFilterProp: 'label',
                  options: scopeUserOptions,
                })
              : null,
            hasScopeFilters
              ? h('span', { style: { marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8 } },
                  h(Tag, { color: 'purple' }, scopedBundles.length + ' of ' + bundles.length + ' deliverables'),
                  h(Button, { type: 'link', size: 'small', onClick: function() {
                    setScopeProjects([]); setScopeTags([]); setScopeView('all');
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
