/* =================================================================
   Tests for Data Explorer URL building logic
   Run: node test_data_explorer.js
   ================================================================= */

// ── Extract the pure functions from app.js (copy to keep tests independent) ──

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
    var dsName = id.datasetName;
    var snapVer = id.snapshotVersion;
    if (dsName && snapVer != null) {
      return '/domino/datasets/local/snapshots/' + dsName + '/' + snapVer + '/' + filename;
    }
    if (dsName) return '/domino/datasets/local/' + dsName + '/' + filename;
  }

  if (attachment.type === 'NetAppVolumeSnapshotFile') {
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

// ── Test harness ──

var passed = 0;
var failed = 0;
var failures = [];

function assert(condition, name) {
  if (condition) {
    passed++;
  } else {
    failed++;
    failures.push(name);
    console.error('  FAIL: ' + name);
  }
}

function assertEqual(actual, expected, name) {
  if (actual === expected) {
    passed++;
  } else {
    failed++;
    failures.push(name);
    console.error('  FAIL: ' + name);
    console.error('    expected: ' + JSON.stringify(expected));
    console.error('    actual:   ' + JSON.stringify(actual));
  }
}

// ── isDataExplorerFile ──

console.log('\n--- isDataExplorerFile ---');

assert(isDataExplorerFile('results.csv') === true, 'csv is a data explorer file');
assert(isDataExplorerFile('data.CSV') === true, 'CSV uppercase is a data explorer file');
assert(isDataExplorerFile('output.parquet') === true, 'parquet is a data explorer file');
assert(isDataExplorerFile('transport.xpt') === true, 'xpt is a data explorer file');
assert(isDataExplorerFile('dataset.sas7bdat') === true, 'sas7bdat is a data explorer file');
assert(isDataExplorerFile('report.pdf') === false, 'pdf is NOT a data explorer file');
assert(isDataExplorerFile('script.sas') === false, 'sas script is NOT a data explorer file');
assert(isDataExplorerFile('output.log') === false, 'log is NOT a data explorer file');
assert(isDataExplorerFile('readme.txt') === false, 'txt is NOT a data explorer file');
assert(isDataExplorerFile(null) === false, 'null filename returns false');
assert(isDataExplorerFile('') === false, 'empty filename returns false');
assert(isDataExplorerFile(undefined) === false, 'undefined filename returns false');
assert(isDataExplorerFile('my.csv.pdf') === false, 'csv in middle but pdf extension returns false');
assert(isDataExplorerFile('archive.csv.gz') === false, 'compressed csv returns false');

// ── buildDataExplorerPath: DatasetSnapshotFile ──

console.log('\n--- buildDataExplorerPath: DatasetSnapshotFile ---');

assertEqual(
  buildDataExplorerPath({
    type: 'DatasetSnapshotFile',
    identifier: { filename: 'ae.csv', datasetName: 'SDTM', snapshotVersion: 3 }
  }),
  '/domino/datasets/local/snapshots/SDTM/3/ae.csv',
  'snapshot file with dataset name and version'
);

assertEqual(
  buildDataExplorerPath({
    type: 'DatasetSnapshotFile',
    identifier: { filename: 'dm.parquet', datasetName: 'ADaM', snapshotVersion: 0 }
  }),
  '/domino/datasets/local/snapshots/ADaM/0/dm.parquet',
  'snapshot version 0 is valid (not falsy)'
);

assertEqual(
  buildDataExplorerPath({
    type: 'DatasetSnapshotFile',
    identifier: { filename: 'vs.xpt', datasetName: 'SDTM' }
  }),
  '/domino/datasets/local/SDTM/vs.xpt',
  'snapshot file without version falls back to live dataset path'
);

assertEqual(
  buildDataExplorerPath({
    type: 'DatasetSnapshotFile',
    identifier: { filename: 'lb.csv' }
  }),
  null,
  'snapshot file without datasetName returns null'
);

assertEqual(
  buildDataExplorerPath({
    type: 'DatasetSnapshotFile',
    identifier: {}
  }),
  null,
  'snapshot file with empty identifier returns null'
);

// ── buildDataExplorerPath: NetAppVolumeSnapshotFile ──

console.log('\n--- buildDataExplorerPath: NetAppVolumeSnapshotFile ---');

assertEqual(
  buildDataExplorerPath({
    type: 'NetAppVolumeSnapshotFile',
    identifier: { filename: 'data.csv', volumeName: 'shared-vol' }
  }),
  '/domino/netapp-volumes/shared-vol/data.csv',
  'netapp volume file with volume name'
);

assertEqual(
  buildDataExplorerPath({
    type: 'NetAppVolumeSnapshotFile',
    identifier: { filename: 'data.csv' }
  }),
  null,
  'netapp volume file without volumeName returns null'
);

// ── buildDataExplorerPath: unsupported types ──

console.log('\n--- buildDataExplorerPath: unsupported types ---');

assertEqual(
  buildDataExplorerPath({
    type: 'Report',
    identifier: { filename: 'results.csv' }
  }),
  null,
  'Report type returns null even for csv'
);

assertEqual(
  buildDataExplorerPath({
    type: 'FlowArtifact',
    identifier: { filename: 'output.parquet' }
  }),
  null,
  'FlowArtifact type returns null even for parquet'
);

assertEqual(
  buildDataExplorerPath({
    type: 'ModelVersion',
    identifier: { filename: 'model.csv' }
  }),
  null,
  'ModelVersion type returns null'
);

// ── buildDataExplorerUrl: full URL assembly ──

console.log('\n--- buildDataExplorerUrl ---');

var BASE = 'https://domino.example.com/app/data-explorer';

assertEqual(
  buildDataExplorerUrl(BASE, {
    type: 'DatasetSnapshotFile',
    identifier: { filename: 'ae.csv', datasetName: 'SDTM', snapshotVersion: 3 }
  }),
  BASE + '/?dataset=' + encodeURIComponent('/domino/datasets/local/snapshots/SDTM/3/ae.csv'),
  'full URL for dataset snapshot csv'
);

assertEqual(
  buildDataExplorerUrl(BASE + '/', {
    type: 'DatasetSnapshotFile',
    identifier: { filename: 'ae.csv', datasetName: 'SDTM', snapshotVersion: 3 }
  }),
  BASE + '/?dataset=' + encodeURIComponent('/domino/datasets/local/snapshots/SDTM/3/ae.csv'),
  'trailing slash on base URL is stripped'
);

assertEqual(
  buildDataExplorerUrl(null, {
    type: 'DatasetSnapshotFile',
    identifier: { filename: 'ae.csv', datasetName: 'SDTM', snapshotVersion: 3 }
  }),
  null,
  'null base URL returns null'
);

assertEqual(
  buildDataExplorerUrl(BASE, {
    type: 'Report',
    identifier: { filename: 'results.csv' }
  }),
  null,
  'returns null when path cannot be built (unsupported type)'
);

assertEqual(
  buildDataExplorerUrl(BASE, {
    type: 'NetAppVolumeSnapshotFile',
    identifier: { filename: 'big.sas7bdat', volumeName: 'clinical' }
  }),
  BASE + '/?dataset=' + encodeURIComponent('/domino/netapp-volumes/clinical/big.sas7bdat'),
  'full URL for netapp volume file'
);

// ── End-to-end: would a CSV attachment get a Data Explorer link? ──

console.log('\n--- End-to-end: CSV routing to Data Explorer ---');

function wouldGetDataExplorerLink(baseUrl, attachment) {
  var fname = (attachment.identifier || {}).filename || attachment.name || '';
  return isDataExplorerFile(fname) && buildDataExplorerUrl(baseUrl, attachment) !== null;
}

assert(
  wouldGetDataExplorerLink(BASE, {
    type: 'DatasetSnapshotFile',
    identifier: { filename: 'ae.csv', datasetName: 'SDTM', snapshotVersion: 1 }
  }) === true,
  'CSV DatasetSnapshotFile gets a Data Explorer link'
);

assert(
  wouldGetDataExplorerLink(BASE, {
    type: 'DatasetSnapshotFile',
    identifier: { filename: 'ae.pdf', datasetName: 'SDTM', snapshotVersion: 1 }
  }) === false,
  'PDF DatasetSnapshotFile does NOT get a Data Explorer link'
);

assert(
  wouldGetDataExplorerLink(BASE, {
    type: 'Report',
    identifier: { filename: 'results.csv' }
  }) === false,
  'CSV as Report type does NOT get a Data Explorer link (no path built)'
);

assert(
  wouldGetDataExplorerLink(BASE, {
    type: 'NetAppVolumeSnapshotFile',
    identifier: { filename: 'transport.xpt', volumeName: 'vol1' }
  }) === true,
  'XPT NetAppVolumeSnapshotFile gets a Data Explorer link'
);

assert(
  wouldGetDataExplorerLink(null, {
    type: 'DatasetSnapshotFile',
    identifier: { filename: 'ae.csv', datasetName: 'SDTM', snapshotVersion: 1 }
  }) === false,
  'No Data Explorer link when base URL is null (app not discovered)'
);

// ── Summary ──

console.log('\n========================================');
console.log('  ' + passed + ' passed, ' + failed + ' failed');
if (failures.length > 0) {
  console.log('  Failures:');
  failures.forEach(function(f) { console.log('    - ' + f); });
}
console.log('========================================\n');

process.exit(failed > 0 ? 1 : 0);
