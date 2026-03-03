// ==========================================
// WATER QUALITY ANALYTICS SCRIPT — FULLY FIXED
//
// KEY FIXES:
//   • OPTIMAL_RANGES is no longer hardcoded — it is built dynamically from
//     the Firebase 'thresholds' node so any changes made in the admin panel
//     are automatically reflected in all analytics, charts, and forecasts.
//   • Hardcoded fallback values are used only if Firebase hasn't loaded yet.
//   • All Firebase queries (Trends, Correlation, Forecast, Summary) fetch ALL
//     records and filter client-side — fixes the mixed string/number 'time'
//     field bug where Firebase's .startAt/.endAt silently skipped records.
//   • Timestamps normalised from both numeric and string representations.
//   • Summary date grouping and grid use LOCAL time (fixes UTC+8 off-by-one-day bug).
// ==========================================

// ---------------------------------------------------------------------------
// HARDCODED FALLBACK RANGES
// Used only if Firebase thresholds haven't loaded yet.
// These match the structure expected throughout the script.
// ---------------------------------------------------------------------------

const FALLBACK_RANGES = {
  do:          { min: 5,    max: 8,    critical: 3,    unit: 'mg/L', label: 'Dissolved Oxygen' },
  salinity:    { min: 10,   max: 25,   critical: 35,   unit: 'ppt',  label: 'Salinity'         },
  temperature: { min: 26,   max: 32,   critical: 35,   unit: '°C',   label: 'Temperature'      },
  ph:          { min: 7.5,  max: 8.5,  critical: 6.0,  unit: '',     label: 'pH Level'         },
  turbidity:   { min: 30,   max: 60,   critical: 20,   unit: 'cm',   label: 'Turbidity'        }
};

// ---------------------------------------------------------------------------
// DYNAMIC OPTIMAL_RANGES
// This starts as a copy of the fallback and is overwritten once Firebase
// thresholds load. All parts of the script read from this object.
// ---------------------------------------------------------------------------

let OPTIMAL_RANGES = JSON.parse(JSON.stringify(FALLBACK_RANGES));

// ---------------------------------------------------------------------------
// FIREBASE THRESHOLD FIELD MAPPING
//
// history.js stores thresholds in Firebase like:
//   thresholds/do    → { safeMin, safeMax, warnMin, warnMax }
//   thresholds/ph    → { safeMin, safeMax, warnMin, warnMax }
//   etc.
//
// We map:
//   safeMin → min      (lower bound of optimal range)
//   safeMax → max      (upper bound of optimal range)
//   warnMin → critical (value below which things are critical)
//
// The unit and label fields are not stored in Firebase so we keep them
// from FALLBACK_RANGES.
// ---------------------------------------------------------------------------

function buildOptimalRangesFromFirebase(snapshot) {
  const data = snapshot.val();
  if (!data) return; // nothing in Firebase — keep fallback

  const paramKeys = Object.keys(FALLBACK_RANGES);

  paramKeys.forEach(param => {
    const node = data[param];
    if (!node) return; // this param not in Firebase — keep fallback for it

    const safeMin = parseFloat(node.safeMin);
    const safeMax = parseFloat(node.safeMax);
    const warnMin = parseFloat(node.warnMin);

    // Only apply if the values are valid numbers
    if (!isNaN(safeMin)) OPTIMAL_RANGES[param].min      = safeMin;
    if (!isNaN(safeMax)) OPTIMAL_RANGES[param].max      = safeMax;
    if (!isNaN(warnMin)) OPTIMAL_RANGES[param].critical = warnMin;
  });

  console.log('[Analytics] Thresholds loaded from Firebase:', JSON.stringify(OPTIMAL_RANGES, null, 2));
}

// How many data points to smooth over (higher = smoother line, 1 = raw)
const SMOOTH_WINDOW = 5;

// ---------------------------------------------------------------------------
// STATE
// ---------------------------------------------------------------------------

let analyticsData        = [];
let trendChart           = null;
let correlationChart6h   = null;
let correlationChart12h  = null;
let correlationChart24h  = null;

// ---------------------------------------------------------------------------
// TIMESTAMP NORMALISER (shared by all tabs)
// ---------------------------------------------------------------------------

function normaliseTimestamp(rawTime) {
  if (rawTime === undefined || rawTime === null) return NaN;
  if (typeof rawTime === 'number') return rawTime;
  if (typeof rawTime === 'string') {
    const asNum = Number(rawTime);
    return isNaN(asNum) ? new Date(rawTime).getTime() : asNum;
  }
  return NaN;
}

// ---------------------------------------------------------------------------
// INIT
// ---------------------------------------------------------------------------

window.addEventListener('load', () => {
  // Load thresholds from Firebase FIRST, then initialise analytics.
  // This ensures OPTIMAL_RANGES is up to date before any charts are drawn.
  firebase.database().ref('thresholds')
    .once('value')
    .then(snapshot => {
      buildOptimalRangesFromFirebase(snapshot);

      // Also keep thresholds in sync if an admin changes them live
      firebase.database().ref('thresholds').on('value', snap => {
        buildOptimalRangesFromFirebase(snap);
        // Re-run analysis with updated thresholds if data is already loaded
        if (analyticsData.length > 0) runStatisticalAnalysis();
      });
    })
    .catch(err => {
      console.warn('[Analytics] Could not load thresholds from Firebase, using fallback values.', err);
    })
    .finally(() => {
      // Initialise analytics regardless of whether thresholds loaded
      initializeAnalytics();
      initSummaryDefaults();
    });

  document.getElementById('trendsTimeRange')?.addEventListener('change', onTimeRangeChange);
  document.getElementById('corrTimeRange')?.addEventListener('change', onTimeRangeChange);
});

function initializeAnalytics() {
  loadAnalyticsData();
}

// ---------------------------------------------------------------------------
// TIME-RANGE HELPER
// ---------------------------------------------------------------------------

function getActiveTimeRange() {
  const trendsActive = document.getElementById('tabPanelTrends')?.classList.contains('active');
  const trendsRange  = document.getElementById('trendsTimeRange')?.value;
  const corrRange    = document.getElementById('corrTimeRange')?.value;

  return trendsActive
    ? (trendsRange || corrRange || '7d')
    : (corrRange   || trendsRange || '7d');
}

function onTimeRangeChange(e) {
  const value = e.target.value;

  const trendsRange = document.getElementById('trendsTimeRange');
  const corrRange   = document.getElementById('corrTimeRange');
  if (trendsRange) trendsRange.value = value;
  if (corrRange)   corrRange.value   = value;

  loadAnalyticsData();
}

// ---------------------------------------------------------------------------
// DATA LOADING — Trends / Correlation / Forecast tabs
// ---------------------------------------------------------------------------
//
// Fetches ALL records — no server-side range filter.
// Fixes Firebase mixed string/number 'time' field bug where .startAt/.endAt
// silently skips any records whose 'time' was stored as a string.
// ---------------------------------------------------------------------------

function loadAnalyticsData() {
  const timeRange = getActiveTimeRange();
  const hours     = { '24h': 24, '7d': 168, '30d': 720, '90d': 2160 }[timeRange] ?? 168;
  const startTime = Date.now() - hours * 3_600_000;

  ['insightsList', 'correlationInsightsList', 'forecastContent'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.innerHTML = `
      <div class="loading-state">
        <div class="loading-spinner"></div>
        <p>${
          id === 'forecastContent'
            ? 'Loading forecast data…'
            : id === 'correlationInsightsList'
              ? 'Analyzing correlations…'
              : 'Loading data from Firebase…'
        }</p>
      </div>`;
  });

  firebase.database().ref('history')
    .once('value')
    .then(snapshot => {
      analyticsData = [];

      snapshot.forEach(child => {
        const d = child.val();

        const ts = normaliseTimestamp(d.time ?? d.timestamp);
        if (isNaN(ts)) return;

        if (ts < startTime) return;

        if (
          d.temperature === undefined ||
          d.ph          === undefined ||
          d.salinity    === undefined ||
          d.turbidity   === undefined ||
          d.do          === undefined
        ) return;

        analyticsData.push({
          timestamp:   new Date(ts),
          do:          parseFloat(d.do),
          salinity:    parseFloat(d.salinity),
          temperature: parseFloat(d.temperature),
          ph:          parseFloat(d.ph),
          turbidity:   parseFloat(d.turbidity)
        });
      });

      analyticsData.sort((a, b) => a.timestamp - b.timestamp);

      console.log(`[Analytics] Loaded ${analyticsData.length} records for time range: ${timeRange}`);

      if (analyticsData.length === 0) {
        const msg = (containerId, icon, text) => {
          const el = document.getElementById(containerId);
          if (el) el.innerHTML = `
            <div class="insight-item">
              <div class="insight-icon">${icon}</div>
              <div class="insight-content">
                <div class="insight-message">${text}</div>
                <span class="insight-severity info">No Data</span>
              </div>
            </div>`;
        };
        msg('insightsList',            'ℹ️', 'No data available for the selected time range.');
        msg('correlationInsightsList', '🔗', 'No data available for correlation analysis.');
        const fc = document.getElementById('forecastContent');
        if (fc) fc.innerHTML = `
          <div class="forecast-empty">
            <i class="fas fa-database"></i>
            <h3>No Data Available</h3>
            <p>No data found for the selected time range.</p>
          </div>`;
        return;
      }

      runStatisticalAnalysis();
      createTrendChart();
      createCorrelationCharts();
      updateEmptyState();
    })
    .catch(error => {
      console.error('[Analytics] Firebase error:', error);
      const el = document.getElementById('insightsList');
      if (el) el.innerHTML = `
        <div class="insight-item">
          <div class="insight-icon">⚠️</div>
          <div class="insight-content">
            <div class="insight-message">Error loading data: ${error.message}</div>
            <span class="insight-severity danger">Error</span>
          </div>
        </div>`;
    });
}

// ---------------------------------------------------------------------------
// DATA SMOOTHING
// ---------------------------------------------------------------------------

function movingAverage(values, window = SMOOTH_WINDOW) {
  if (window <= 1 || values.length < window) return values;
  const half   = Math.floor(window / 2);
  const result = [];

  for (let i = 0; i < values.length; i++) {
    const lo  = Math.max(0, i - half);
    const hi  = Math.min(values.length - 1, i + half);
    const sum = values.slice(lo, hi + 1).reduce((a, b) => a + b, 0);
    result.push(sum / (hi - lo + 1));
  }
  return result;
}

// ---------------------------------------------------------------------------
// PARAMETER FILTER HELPERS
// ---------------------------------------------------------------------------

const PARAM_CHECKBOX_IDS = {
  do:          'paramDO',
  salinity:    'paramSalinity',
  temperature: 'paramTemperature',
  ph:          'paramPH',
  turbidity:   'paramTurbidity'
};

function getActiveParams() {
  const active = [];
  Object.entries(PARAM_CHECKBOX_IDS).forEach(([param, id]) => {
    const el = document.getElementById(id);
    if (!el || el.checked) active.push(param);
  });
  return active;
}

function onParamFilterChange() {
  if (analyticsData.length === 0) return;
  const activeParams = getActiveParams();

  ['6h', '12h', '24h'].forEach(chartId => {
    const section = document.getElementById(`section${chartId}`);
    if (section && section.style.display !== 'none') {
      createCorrelationChart(chartId, parseInt(chartId), activeParams);
    }
  });

  const correlationInsights = analyzeSensorCorrelations(activeParams);
  displayCorrelationInsights(correlationInsights, activeParams);
}

// ---------------------------------------------------------------------------
// STATISTICAL ANALYSIS
// ---------------------------------------------------------------------------

function runStatisticalAnalysis() {
  const activeParams = getActiveParams();

  const analyticsInsights = [];
  Object.keys(OPTIMAL_RANGES).forEach(param => {
    const trendInsight = analyzeTrend(param);
    if (trendInsight) analyticsInsights.push(trendInsight);
  });
  analyticsInsights.push(...detectAnomalies());

  const correlationInsights = analyzeSensorCorrelations(activeParams);
  const forecastInsights    = generatePredictions();

  displayAnalyticsInsights(analyticsInsights);
  displayCorrelationInsights(correlationInsights, activeParams);
  displayForecastInsights(forecastInsights);
}

function analyzeTrend(parameter) {
  const values     = analyticsData.map(d => d[parameter]);
  const points     = values.map((v, i) => [i, v]);
  const regression = ss.linearRegression(points);
  const slope      = regression.m;

  const timeRange    = getActiveTimeRange();
  const hours        = { '24h': 24, '7d': 168, '30d': 720, '90d': 2160 }[timeRange] ?? 168;
  const hourlyChange = slope * (analyticsData.length / hours);

  if (Math.abs(hourlyChange) > 0.03) {
    return {
      type:        slope > 0 ? 'trend-up' : 'trend-down',
      icon:        slope > 0 ? '📈' : '📉',
      message:     `${OPTIMAL_RANGES[parameter].label} is ${slope > 0 ? 'increasing' : 'decreasing'} by ${Math.abs(hourlyChange).toFixed(3)} ${OPTIMAL_RANGES[parameter].unit}/hour`,
      severity:    Math.abs(hourlyChange) > 0.1 ? 'warning' : 'info',
      insightType: 'trend'
    };
  }
  return null;
}

function detectAnomalies() {
  const insights   = [];
  const recentData = analyticsData.slice(-24);

  Object.keys(OPTIMAL_RANGES).forEach(param => {
    const allValues = analyticsData.map(d => d[param]);
    const mean      = ss.mean(allValues);
    const stdDev    = ss.standardDeviation(allValues);

    recentData.forEach(reading => {
      const zScore = (reading[param] - mean) / stdDev;
      if (Math.abs(zScore) > 2.5) {
        insights.push({
          type:        'anomaly',
          icon:        '⚡',
          message:     `Unusual ${OPTIMAL_RANGES[param].label} detected: ${reading[param].toFixed(1)} ${OPTIMAL_RANGES[param].unit} (${Math.abs(zScore).toFixed(1)}σ from normal)`,
          severity:    'warning',
          timestamp:   reading.timestamp.toLocaleString(),
          insightType: 'anomaly'
        });
      }
    });
  });

  return insights.slice(0, 3);
}

function analyzeSensorCorrelations(activeParams) {
  const insights  = [];
  const threshold = parseFloat(document.getElementById('correlationThreshold')?.value || 0.5);
  if (!activeParams) activeParams = Object.keys(OPTIMAL_RANGES);

  const sensorPairs = [
    { param1:'temperature', param2:'do',        positiveExplanation:'When water temperature rises, dissolved oxygen levels also increase',   negativeExplanation:'When water temperature rises, dissolved oxygen levels decrease',   positiveImpact:'Unusual for this pair — monitor closely as aerator activity or algae photosynthesis may be elevating DO despite warming water', negativeImpact:'This is critical for fish health — warm water naturally holds less dissolved oxygen'       },
    { param1:'salinity',    param2:'do',        positiveExplanation:'Higher salinity correlates with higher dissolved oxygen',               negativeExplanation:'Higher salinity correlates with lower dissolved oxygen',               positiveImpact:'Unusual pattern — biological activity or aeration may be compensating for salt-induced oxygen reduction',              negativeImpact:'Salt water holds less oxygen — high salinity can reduce oxygen availability for fish'    },
    { param1:'ph',          param2:'do',        positiveExplanation:'Higher pH correlates with higher dissolved oxygen',                     negativeExplanation:'Higher pH correlates with lower dissolved oxygen',                     positiveImpact:'Likely driven by algae photosynthesis — algae consume CO₂ (raising pH) and produce oxygen simultaneously',          negativeImpact:'May indicate decomposition activity — organic breakdown can lower both pH and oxygen levels' },
    { param1:'turbidity',   param2:'do',        positiveExplanation:'Cloudier water correlates with higher dissolved oxygen',               negativeExplanation:'Cloudier water correlates with lower dissolved oxygen',               positiveImpact:'Suspended algae or plankton may be producing oxygen through photosynthesis',                                         negativeImpact:'High turbidity may be blocking sunlight, reducing photosynthesis and depleting oxygen'  },
    { param1:'temperature', param2:'ph',        positiveExplanation:'Higher temperatures correlate with higher pH',                         negativeExplanation:'Higher temperatures correlate with lower pH',                         positiveImpact:'Warm water can accelerate algae photosynthesis, which consumes CO₂ and raises pH',                                  negativeImpact:'Warmer water speeds up decomposition, producing CO₂ and lowering pH'                    },
    { param1:'temperature', param2:'salinity',  positiveExplanation:'Warmer water correlates with higher salinity',                         negativeExplanation:'Warmer water correlates with lower salinity',                         positiveImpact:'Evaporation in warmer conditions may be concentrating salt levels',                                                  negativeImpact:'Could indicate freshwater inflow or rainfall diluting salinity as temperatures drop'     },
    { param1:'temperature', param2:'turbidity', positiveExplanation:'Higher temperatures correlate with cloudier water',                    negativeExplanation:'Higher temperatures correlate with clearer water',                    positiveImpact:'Warm water promotes algae and plankton growth, increasing water cloudiness',                                         negativeImpact:'May indicate sediment settling or reduced biological activity in cooler periods'         },
    { param1:'salinity',    param2:'ph',        positiveExplanation:'Higher salinity correlates with higher pH',                            negativeExplanation:'Higher salinity correlates with lower pH',                            positiveImpact:'Saltwater buffering capacity can help maintain or raise alkalinity',                                                 negativeImpact:'High salt concentrations may introduce acidic ions that lower pH'                        },
    { param1:'salinity',    param2:'turbidity', positiveExplanation:'Higher salinity correlates with cloudier water',                       negativeExplanation:'Higher salinity correlates with clearer water',                       positiveImpact:'Salt may be causing flocculation, clumping particles and increasing cloudiness',                                     negativeImpact:'Higher salinity may be causing particles to settle, improving water clarity'             },
    { param1:'ph',          param2:'turbidity', positiveExplanation:'Higher pH correlates with cloudier water',                             negativeExplanation:'Higher pH correlates with clearer water',                             positiveImpact:'Algae blooms raise pH through photosynthesis while also increasing turbidity',                                       negativeImpact:'Clear, alkaline water may indicate low biological activity and good filtration'           }
  ];

  sensorPairs.forEach(pair => {
    if (!activeParams.includes(pair.param1) || !activeParams.includes(pair.param2)) return;

    const values1     = analyticsData.map(d => d[pair.param1]);
    const values2     = analyticsData.map(d => d[pair.param2]);
    const correlation = ss.sampleCorrelation(values1, values2);

    if (Math.abs(correlation) > threshold) {
      const cv1 = (ss.standardDeviation(values1) / ss.mean(values1)) * 100;
      const cv2 = (ss.standardDeviation(values2) / ss.mean(values2)) * 100;
      if (cv1 < 2 || cv2 < 2) return;

      const strength   = Math.abs(correlation) > 0.8 ? 'Very Strong'
                       : Math.abs(correlation) > 0.7 ? 'Strong'
                       : Math.abs(correlation) > 0.5 ? 'Moderate'
                       : 'Weak';
      const percentage = Math.abs(correlation * 100).toFixed(0);
      const direction  = correlation > 0 ? 'positive' : 'inverse';
      const message    = correlation > 0
        ? `${strength} relationship: ${pair.positiveExplanation}`
        : `${strength} relationship: ${pair.negativeExplanation}`;

      let detail = `${percentage}% ${direction} correlation. ${correlation > 0 ? pair.positiveImpact : pair.negativeImpact}`;
      if (cv1 < 5 || cv2 < 5) {
        const lowVarParam = cv1 < cv2 ? OPTIMAL_RANGES[pair.param1].label : OPTIMAL_RANGES[pair.param2].label;
        detail += ` Note: ${lowVarParam} has limited variation in this period, which may affect accuracy.`;
      }

      insights.push({
        type:             'correlation',
        icon:             '🔗',
        message,
        severity:         'info',
        detail,
        correlationValue: Math.abs(correlation),
        insightType:      'correlation'
      });
    }
  });

  return insights.sort((a, b) => b.correlationValue - a.correlationValue);
}

function generatePredictions() {
  const insights          = [];
  const hoursAhead        = parseInt(document.getElementById('predictionWindow')?.value || 6);
  const dataRangeHours    = parseInt(document.getElementById('predictionDataRange')?.value || 48);
  const minimumDataPoints = Math.min(24, dataRangeHours);

  if (analyticsData.length < minimumDataPoints) {
    return [{
      type:        'info',
      icon:        'ℹ️',
      message:     `Need at least ${minimumDataPoints} hours of data for predictions. Currently have ${analyticsData.length} data points.`,
      severity:    'info',
      detail:      'Predictions will become available as more data is collected.',
      priority:    3
    }];
  }

  Object.keys(OPTIMAL_RANGES).forEach(param => {
    const dataPointsToUse = Math.min(analyticsData.length, dataRangeHours);
    const recent          = analyticsData.slice(-dataPointsToUse);
    const values          = recent.map((d, i) => [i, d[param]]);
    const regression      = ss.linearRegression(values);
    const futureIndex     = values.length + (hoursAhead * (values.length / dataRangeHours));
    const predictedValue  = regression.m * futureIndex + regression.b;
    const config          = OPTIMAL_RANGES[param];
    const currentValue    = analyticsData[analyticsData.length - 1][param];
    const change          = predictedValue - currentValue;
    const percentChange   = Math.abs((change / currentValue) * 100);
    const residuals       = values.map(p => Math.abs(p[1] - (regression.m * p[0] + regression.b)));
    const avgError        = ss.mean(residuals);
    const confidence      = Math.max(0, Math.min(100, 100 - (avgError / currentValue * 100)));
    const accuracyNote    = hoursAhead <= 6  ? `High confidence`
                          : hoursAhead <= 12 ? `Medium confidence`
                          : `Lower confidence — longer forecasts are less certain`;

    if (Math.abs(regression.m) > 0.005 || predictedValue < config.critical || predictedValue > config.critical * 1.5) {
      if (predictedValue < config.critical || predictedValue > config.critical * 1.5) {
        insights.push({ type:'prediction-critical', icon:'🚨', message:`CRITICAL: ${config.label} forecasted to reach ${predictedValue.toFixed(1)} ${config.unit} in ${hoursAhead}h`, severity:'danger',  detail:`Current: ${currentValue.toFixed(1)} ${config.unit}. ${change > 0 ? 'Increasing' : 'Decreasing'} and may become dangerous for fish. ${accuracyNote}`, priority:1 });
      } else if (predictedValue < config.min || predictedValue > config.max) {
        insights.push({ type:'prediction-warning',  icon:'⚠️', message:`${config.label} expected to reach ${predictedValue.toFixed(1)} ${config.unit} in ${hoursAhead}h`, severity:'warning', detail:`Currently at ${currentValue.toFixed(1)} ${config.unit}. Trending ${change > 0 ? 'upward' : 'downward'} and may leave optimal range. ${accuracyNote}`, priority:2 });
      } else if (percentChange > 3) {
        insights.push({ type:'prediction-info',     icon:'🔮', message:`${config.label} forecasted to ${change > 0 ? 'increase' : 'decrease'} to ${predictedValue.toFixed(1)} ${config.unit} in ${hoursAhead}h`, severity:'info', detail:`A ${percentChange.toFixed(1)}% ${change > 0 ? 'increase' : 'decrease'} from current level (${currentValue.toFixed(1)} ${config.unit}). Expected to remain within optimal range. ${accuracyNote}`, priority:3 });
      }
    }
  });

  return insights.sort((a, b) => (a.priority || 999) - (b.priority || 999));
}

// ---------------------------------------------------------------------------
// DISPLAY — Trends tab
// ---------------------------------------------------------------------------

function displayAnalyticsInsights(insights) {
  const insightsList   = document.getElementById('insightsList');
  const severityFilter = document.getElementById('severityFilter')?.value || 'all';
  let filtered = insights;
  if (severityFilter === 'anomaly') filtered = insights.filter(i => i.insightType === 'anomaly');
  else if (severityFilter === 'trend') filtered = insights.filter(i => i.insightType === 'trend');

  if (filtered.length === 0) {
    insightsList.innerHTML = `
      <div class="insight-item">
        <div class="insight-icon">✅</div>
        <div class="insight-content">
          <div class="insight-message">${severityFilter !== 'all' ? 'No insights match your current filter. Try changing the filter above.' : 'Water quality parameters are stable. No significant trends or anomalies detected.'}</div>
          <span class="insight-severity success">All Clear</span>
        </div>
      </div>`;
    return;
  }

  insightsList.innerHTML = filtered.map(insight => `
    <div class="insight-item">
      <div class="insight-icon">${insight.icon}</div>
      <div class="insight-content">
        <div class="insight-message">${insight.message}</div>
        ${insight.detail ? `<div style="font-size:0.85rem;color:#64748b;margin-top:0.5rem;line-height:1.4;">${insight.detail}</div>` : ''}
        <span class="insight-severity ${insight.severity}">${insight.severity}</span>
        ${insight.timestamp ? `<div style="font-size:0.8rem;color:#64748b;margin-top:0.25rem;">Detected at: ${insight.timestamp}</div>` : ''}
      </div>
    </div>`).join('');
}

// ---------------------------------------------------------------------------
// DISPLAY — Correlation tab
// ---------------------------------------------------------------------------

function displayCorrelationInsights(insights, activeParams) {
  const list = document.getElementById('correlationInsightsList');
  if (!list) return;

  const paramLabels   = activeParams.map(p => OPTIMAL_RANGES[p].label);
  const selectionNote = activeParams.length === Object.keys(OPTIMAL_RANGES).length
    ? 'All parameters selected'
    : `Showing: ${paramLabels.join(', ')}`;

  if (insights.length === 0) {
    list.innerHTML = `
      <div style="background:rgba(255,255,255,0.5);padding:0.65rem 1rem;border-radius:8px;margin-bottom:0.85rem;font-size:0.82rem;color:#64748b;">🔍 ${selectionNote}</div>
      <div class="insight-item">
        <div class="insight-icon">🔗</div>
        <div class="insight-content">
          <div class="insight-message">${activeParams.length < 2 ? 'Select at least 2 parameters to see correlation insights.' : 'No significant correlations detected between the selected parameters.'}</div>
          <span class="insight-severity info">No Correlations</span>
        </div>
      </div>`;
    return;
  }

  list.innerHTML = `
    <div style="background:rgba(255,255,255,0.5);padding:0.65rem 1rem;border-radius:8px;margin-bottom:0.85rem;font-size:0.82rem;color:#92400e;font-weight:600;">
      🔗 ${insights.length} correlation${insights.length !== 1 ? 's' : ''} found &nbsp;·&nbsp; <span style="font-weight:400;color:#64748b;">${selectionNote}</span>
    </div>
    ${insights.map(insight => `
      <div class="insight-item">
        <div class="insight-icon">${insight.icon}</div>
        <div class="insight-content">
          <div class="insight-message">${insight.message}</div>
          ${insight.detail ? `<div style="font-size:0.85rem;color:#64748b;margin-top:0.5rem;line-height:1.4;">${insight.detail}</div>` : ''}
          <span class="insight-severity ${insight.severity}">${insight.severity}</span>
        </div>
      </div>`).join('')}`;
}

// ---------------------------------------------------------------------------
// DISPLAY — Forecast tab
// ---------------------------------------------------------------------------

function displayForecastInsights(insights) {
  const forecastContent = document.getElementById('forecastContent');
  const forecastBadge   = document.getElementById('forecastBadge');

  if (!forecastContent) return;

  if (forecastBadge) {
    const dangerCount  = insights.filter(i => i.severity === 'danger').length;
    const warningCount = insights.filter(i => i.severity === 'warning').length;
    forecastBadge.textContent = insights.length;
    forecastBadge.className   = 'tab-badge';
    if (dangerCount > 0)       forecastBadge.classList.add('badge-danger');
    else if (warningCount > 0) forecastBadge.classList.add('badge-warning');
  }

  if (insights.length === 0) {
    forecastContent.innerHTML = `
      <div class="forecast-empty">
        <i class="fas fa-check-circle" style="color:#10b981;"></i>
        <h3>No Forecasted Issues</h3>
        <p>All parameters are predicted to remain stable within their optimal ranges.</p>
      </div>`;
    return;
  }

  const hoursAhead = document.getElementById('predictionWindow')?.value || 6;
  const groups     = {
    danger:  insights.filter(i => i.severity === 'danger'),
    warning: insights.filter(i => i.severity === 'warning'),
    info:    insights.filter(i => i.severity === 'info')
  };

  let html = '';
  if (groups.danger.length)  html += renderForecastSection('danger',  `Critical Alerts — Forecasted in ${hoursAhead}h (dangerous levels)`,      'fa-skull-crossbones',     groups.danger);
  if (groups.warning.length) html += renderForecastSection('warning', `Warnings — Forecasted in ${hoursAhead}h (may leave optimal range)`,        'fa-exclamation-triangle', groups.warning);
  if (groups.info.length)    html += renderForecastSection('info',    `Informational — Forecasted in ${hoursAhead}h (within safe range)`,          'fa-info-circle',          groups.info);

  forecastContent.innerHTML = html;
}

function renderForecastSection(severity, title, faIcon, items) {
  return `
    <div class="forecast-severity-section">
      <div class="forecast-severity-label label-${severity === 'danger' ? 'critical' : severity}">
        <i class="fas ${faIcon}"></i> ${title}
      </div>
      ${items.map(insight => renderForecastCard(insight)).join('')}
    </div>`;
}

function renderForecastCard(insight) {
  const borderColor = insight.severity === 'danger'  ? '#dc2626' : insight.severity === 'warning' ? '#f59e0b' : '#3b82f6';
  const iconBg      = insight.severity === 'danger'  ? '#fee2e2' : insight.severity === 'warning' ? '#fed7aa' : '#dbeafe';
  return `
    <div class="insight-item" style="background:white;border-left:4px solid ${borderColor};margin-bottom:0.65rem;">
      <div class="insight-icon" style="background:${iconBg};">${insight.icon}</div>
      <div class="insight-content">
        <div class="insight-message">${insight.message}</div>
        ${insight.detail ? `<div style="font-size:0.85rem;color:#64748b;margin-top:0.5rem;line-height:1.4;">${insight.detail}</div>` : ''}
        <span class="insight-severity ${insight.severity}">${insight.severity}</span>
      </div>
    </div>`;
}

// ---------------------------------------------------------------------------
// LEGACY COMPAT
// ---------------------------------------------------------------------------

function displayInsights(insights) {
  const forecastTypes       = ['prediction-critical', 'prediction-warning', 'prediction-info', 'info'];
  const correlationInsights = insights.filter(i => i.insightType === 'correlation');
  const analyticsInsights   = insights.filter(i => !forecastTypes.includes(i.type) && i.insightType !== 'correlation');
  const forecastInsights    = insights.filter(i =>  forecastTypes.includes(i.type));
  displayAnalyticsInsights(analyticsInsights);
  displayCorrelationInsights(correlationInsights, getActiveParams());
  displayForecastInsights(forecastInsights);
}

// ---------------------------------------------------------------------------
// CHART — Trend
// ---------------------------------------------------------------------------

function buildTimeLabels(data, timeRange) {
  const opts = timeRange === '24h'
    ? { hour: '2-digit', minute: '2-digit' }
    : timeRange === '7d'
      ? { month: 'short', day: 'numeric', hour: '2-digit' }
      : { month: 'short', day: 'numeric' };

  return data.map(d => d.timestamp.toLocaleString('en-US', opts));
}

function downsample(data, targetPoints = 200) {
  if (data.length <= targetPoints) return data;
  const step = Math.ceil(data.length / targetPoints);
  return data.filter((_, i) => i % step === 0);
}

function createTrendChart() {
  const canvas = document.getElementById('trendChart');
  if (!canvas) return;

  if (trendChart) trendChart.destroy();

  const timeRange = getActiveTimeRange();
  const plotData  = downsample(analyticsData);
  const labels    = buildTimeLabels(plotData, timeRange);
  const smooth    = param => movingAverage(plotData.map(d => d[param]));

  trendChart = new Chart(canvas.getContext('2d'), {
    type: 'line',
    data: {
      labels,
      datasets: [
        { label:'Dissolved Oxygen (mg/L)', data:smooth('do'),          borderColor:'#0ea5e9', backgroundColor:'rgba(14,165,233,0.08)',  tension:0.4, fill:false, borderWidth:2, pointRadius:0, pointHoverRadius:4, yAxisID:'y',  paramKey:'do'          },
        { label:'Salinity (ppt)',           data:smooth('salinity'),    borderColor:'#ef4444', backgroundColor:'rgba(239,68,68,0.08)',   tension:0.4, fill:false, borderWidth:2, pointRadius:0, pointHoverRadius:4, yAxisID:'y1', paramKey:'salinity'    },
        { label:'Temperature (°C)',         data:smooth('temperature'), borderColor:'#f59e0b', backgroundColor:'rgba(245,158,11,0.08)',  tension:0.4, fill:false, borderWidth:2, pointRadius:0, pointHoverRadius:4, yAxisID:'y2', paramKey:'temperature' },
        { label:'pH',                       data:smooth('ph'),          borderColor:'#10b981', backgroundColor:'rgba(16,185,129,0.08)', tension:0.4, fill:false, borderWidth:2, pointRadius:0, pointHoverRadius:4, yAxisID:'y3', paramKey:'ph'          },
        { label:'Turbidity (cm)',           data:smooth('turbidity'),   borderColor:'#8b5cf6', backgroundColor:'rgba(139,92,246,0.08)', tension:0.4, fill:false, borderWidth:2, pointRadius:0, pointHoverRadius:4, yAxisID:'y4', paramKey:'turbidity'   }
      ]
    },
    options: {
      responsive:          true,
      maintainAspectRatio: true,
      aspectRatio:         2.5,
      animation:           { duration: 400 },
      interaction:         { mode:'index', intersect:false },
      plugins: {
        legend: {
          position: 'bottom',
          labels:   { usePointStyle:true, padding:20, font:{ family:'Inter', size:12 } }
        },
        tooltip: {
          backgroundColor: 'rgba(15,23,42,0.92)',
          padding:         12,
          titleFont:       { family:'Inter', size:13, weight:'600' },
          bodyFont:        { family:'Inter', size:12 },
          callbacks: {
            label: ctx => {
              const units = {
                'Dissolved Oxygen (mg/L)': ' mg/L',
                'Salinity (ppt)':          ' ppt',
                'Temperature (°C)':        ' °C',
                'pH':                      '',
                'Turbidity (cm)':          ' cm'
              };
              return `${ctx.dataset.label.split(' (')[0]}: ${ctx.parsed.y.toFixed(2)}${units[ctx.dataset.label] ?? ''}`;
            }
          }
        }
      },
      scales: {
        y:  { position:'left',  title:{ display:true, text:'DO (mg/L)',      font:{ family:'Inter', size:11 } }, beginAtZero:false, grid:{ color:'rgba(226,232,240,0.5)' }, ticks:{ font:{ family:'Inter' } } },
        y1: { position:'right', title:{ display:true, text:'Salinity (ppt)', font:{ family:'Inter', size:11 } }, beginAtZero:false, grid:{ drawOnChartArea:false }, ticks:{ font:{ family:'Inter' } } },
        y2: { position:'right', title:{ display:true, text:'Temp (°C)',      font:{ family:'Inter', size:11 } }, beginAtZero:false, grid:{ drawOnChartArea:false }, ticks:{ font:{ family:'Inter' } } },
        y3: { position:'right', title:{ display:true, text:'pH',             font:{ family:'Inter', size:11 } }, beginAtZero:false, grid:{ drawOnChartArea:false }, ticks:{ font:{ family:'Inter' } } },
        y4: { position:'right', title:{ display:true, text:'Turbidity (cm)', font:{ family:'Inter', size:11 } }, beginAtZero:false, grid:{ drawOnChartArea:false }, ticks:{ font:{ family:'Inter' } } },
        x:  { grid:{ display:false }, ticks:{ maxRotation:45, minRotation:45, font:{ family:'Inter', size:10 } } }
      }
    }
  });
}

// ---------------------------------------------------------------------------
// CHART — Correlation
// ---------------------------------------------------------------------------

function createCorrelationCharts() {
  const activeParams = getActiveParams();
  if (document.getElementById('show6h')?.checked)  createCorrelationChart('6h',  6,  activeParams);
  if (document.getElementById('show12h')?.checked) createCorrelationChart('12h', 12, activeParams);
  if (document.getElementById('show24h')?.checked) createCorrelationChart('24h', 24, activeParams);
}

function toggleTimeWindow(chartId) {
  const section  = document.getElementById(`section${chartId}`);
  const checkbox = document.getElementById(`show${chartId}`);

  if (checkbox.checked) {
    section.style.display = 'block';
    createCorrelationChart(chartId, parseInt(chartId), getActiveParams());
  } else {
    section.style.display = 'none';
    const charts = { '6h': correlationChart6h, '12h': correlationChart12h, '24h': correlationChart24h };
    charts[chartId]?.destroy();
    if (chartId === '6h')       correlationChart6h  = null;
    else if (chartId === '12h') correlationChart12h = null;
    else                        correlationChart24h = null;
  }
  updateEmptyState();
}

function updateEmptyState() {
  const emptyState = document.getElementById('emptyStateMessage');
  const anyVisible = ['6h', '12h', '24h'].some(id => document.getElementById(`show${id}`)?.checked);
  if (emptyState) emptyState.style.display = anyVisible ? 'none' : 'block';
}

function createCorrelationChart(chartId, hours, activeParams) {
  if (!activeParams) activeParams = getActiveParams();

  const canvasId = `correlationChart${chartId}`;
  const ctx      = document.getElementById(canvasId)?.getContext('2d');
  if (!ctx) { console.error(`Canvas ${canvasId} not found`); return; }

  const existing = chartId === '6h' ? correlationChart6h : chartId === '12h' ? correlationChart12h : correlationChart24h;
  existing?.destroy();

  const cutoff     = Date.now() - hours * 3_600_000;
  const windowData = analyticsData.filter(d => d.timestamp.getTime() >= cutoff);

  const countEl = document.getElementById(`count${chartId}`);
  if (countEl) countEl.textContent = `${windowData.length} readings`;

  if (windowData.length === 0) {
    if (countEl) Object.assign(countEl.style, { background: '#fee2e2', color: '#991b1b' });
    return;
  }

  if (countEl) Object.assign(countEl.style, { background: '', color: '' });

  const plotData = downsample(windowData, 150);
  const labels   = plotData.map(d => d.timestamp.toLocaleTimeString('en-US', {
    hour:    '2-digit',
    minute:  hours <= 6 ? '2-digit' : undefined,
    hour12:  true
  }));

  const smooth = param => movingAverage(plotData.map(d => d[param]), 3);

  const allDatasets = [
    { paramKey:'do',          label:'DO',          data:smooth('do'),          borderColor:'#0ea5e9', yAxisID:'y'  },
    { paramKey:'salinity',    label:'Salinity',    data:smooth('salinity'),    borderColor:'#ef4444', yAxisID:'y1' },
    { paramKey:'temperature', label:'Temperature', data:smooth('temperature'), borderColor:'#f59e0b', yAxisID:'y2' },
    { paramKey:'ph',          label:'pH',          data:smooth('ph'),          borderColor:'#10b981', yAxisID:'y3' },
    { paramKey:'turbidity',   label:'Turbidity',   data:smooth('turbidity'),   borderColor:'#8b5cf6', yAxisID:'y4' }
  ];

  const datasets = allDatasets.map(ds => ({
    label:            ds.label,
    data:             ds.data,
    borderColor:      ds.borderColor,
    backgroundColor:  ds.borderColor.replace(')', ', 0.08)').replace('rgb', 'rgba'),
    borderWidth:      2,
    pointRadius:      0,
    pointHoverRadius: 4,
    tension:          0.3,
    yAxisID:          ds.yAxisID,
    hidden:           !activeParams.includes(ds.paramKey)
  }));

  const newChart = new Chart(ctx, {
    type: 'line',
    data: { labels, datasets },
    options: {
      responsive:          true,
      maintainAspectRatio: true,
      aspectRatio:         2.2,
      animation:           { duration: 300 },
      interaction:         { mode:'index', intersect:false },
      plugins: {
        legend: {
          position: 'bottom',
          labels:   { usePointStyle:true, padding:15, font:{ family:'Inter', size:11 } }
        },
        tooltip: {
          backgroundColor: 'rgba(15,23,42,0.95)',
          padding:         12,
          titleFont:       { family:'Inter', size:13 },
          bodyFont:        { family:'Inter', size:12 },
          displayColors:   true,
          callbacks: {
            label: ctx => {
              const units = { DO:' mg/L', Salinity:' ppt', Temperature:' °C', pH:'', Turbidity:' cm' };
              return `${ctx.dataset.label}: ${ctx.parsed.y.toFixed(2)}${units[ctx.dataset.label] ?? ''}`;
            }
          }
        },
        zoom: {
          pan:    { enabled:true, mode:'x', modifierKey:null },
          zoom:   { wheel:{ enabled:true, speed:0.1 }, pinch:{ enabled:true }, mode:'x' },
          limits: { x:{ min:'original', max:'original' } }
        }
      },
      scales: {
        y:  { position:'left',  title:{ display:true, text:'DO (mg/L)',      font:{ family:'Inter', size:11 } }, grid:{ color:'rgba(226,232,240,0.5)' } },
        y1: { position:'right', title:{ display:true, text:'Salinity (ppt)', font:{ family:'Inter', size:11 } }, grid:{ drawOnChartArea:false } },
        y2: { position:'right', title:{ display:true, text:'Temp (°C)',      font:{ family:'Inter', size:11 } }, grid:{ drawOnChartArea:false } },
        y3: { position:'right', title:{ display:true, text:'pH',             font:{ family:'Inter', size:11 } }, grid:{ drawOnChartArea:false } },
        y4: { position:'right', title:{ display:true, text:'Turbidity (cm)', font:{ family:'Inter', size:11 } }, grid:{ drawOnChartArea:false } },
        x:  { grid:{ display:false }, ticks:{ maxRotation:45, minRotation:45, font:{ family:'Inter', size:10 } } }
      }
    }
  });

  if (chartId === '6h')       correlationChart6h  = newChart;
  else if (chartId === '12h') correlationChart12h = newChart;
  else                        correlationChart24h = newChart;
}

function resetZoom(chartId) {
  const charts = { '6h': correlationChart6h, '12h': correlationChart12h, '24h': correlationChart24h };
  charts[chartId]?.resetZoom?.();
}

// ---------------------------------------------------------------------------
// USER INTERACTIONS
// ---------------------------------------------------------------------------

function changeChartType(type) {
  document.querySelectorAll('.chart-controls button').forEach(btn => btn.classList.remove('active'));
  event.target.classList.add('active');
  trendChart.data.datasets.forEach(ds => ds.fill = (type === 'area'));
  trendChart.update();
}

function updateChartParameter() {
  const param = document.getElementById('trendsParamFilter')?.value || 'all';
  trendChart.data.datasets.forEach(ds => {
    ds.hidden = param === 'all' ? false : ds.paramKey !== param;
  });
  trendChart.update();
}

function updateAnalytics() {
  if (analyticsData.length > 0) runStatisticalAnalysis();
}

// ---------------------------------------------------------------------------
// SUMMARY TAB
// ---------------------------------------------------------------------------

const summaryCharts = {};

const SUMMARY_COLORS = {
  do:          { border:'#0ea5e9', min:'rgba(14,165,233,0.35)',  avg:'rgba(14,165,233,0.75)',  max:'rgba(14,165,233,1)'  },
  salinity:    { border:'#ef4444', min:'rgba(239,68,68,0.35)',   avg:'rgba(239,68,68,0.75)',   max:'rgba(239,68,68,1)'   },
  temperature: { border:'#f59e0b', min:'rgba(245,158,11,0.35)',  avg:'rgba(245,158,11,0.75)',  max:'rgba(245,158,11,1)'  },
  ph:          { border:'#10b981', min:'rgba(16,185,129,0.35)',  avg:'rgba(16,185,129,0.75)',  max:'rgba(16,185,129,1)'  },
  turbidity:   { border:'#8b5cf6', min:'rgba(139,92,246,0.35)', avg:'rgba(139,92,246,0.75)',  max:'rgba(139,92,246,1)'  }
};

const SUMMARY_CHECKBOX_IDS = {
  do:          'summaryParamDO',
  salinity:    'summaryParamSalinity',
  temperature: 'summaryParamTemperature',
  ph:          'summaryParamPH',
  turbidity:   'summaryParamTurbidity'
};

function getSummaryActiveParams() {
  return Object.entries(SUMMARY_CHECKBOX_IDS)
    .filter(([, id]) => document.getElementById(id)?.checked)
    .map(([param]) => param);
}

function initSummaryDefaults() {
  const today   = new Date();
  const weekAgo = new Date(today);
  weekAgo.setDate(today.getDate() - 6);
  const fmt = d => {
    const y   = d.getFullYear();
    const m   = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  };
  const sd = document.getElementById('summaryStartDate');
  const ed = document.getElementById('summaryEndDate');
  if (sd && !sd.value) sd.value = fmt(weekAgo);
  if (ed && !ed.value) ed.value = fmt(today);
}

// ---------------------------------------------------------------------------
// LOCAL-TIME DATE HELPERS
// ---------------------------------------------------------------------------

function localDateKey(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function parseLocalDate(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(y, m - 1, d);
}

// ---------------------------------------------------------------------------
// SUMMARY DATA LOADING
// ---------------------------------------------------------------------------

function loadSummaryData() {
  const startDateVal = document.getElementById('summaryStartDate')?.value;
  const endDateVal   = document.getElementById('summaryEndDate')?.value;
  const startTimeVal = document.getElementById('summaryStartTime')?.value || '';
  const endTimeVal   = document.getElementById('summaryEndTime')?.value   || '';
  const container    = document.getElementById('summaryChartsContainer');

  if (!startDateVal || !endDateVal) {
    showSummaryStatus('Please select both a start and end date.', 'warn');
    return;
  }

  let startTs, endTs;

  if (startTimeVal) {
    const [sh, sm]      = startTimeVal.split(':').map(Number);
    const [sy, smo, sd] = startDateVal.split('-').map(Number);
    startTs = new Date(sy, smo - 1, sd, sh, sm, 0, 0).getTime();
  } else {
    const [sy, smo, sd] = startDateVal.split('-').map(Number);
    startTs = new Date(sy, smo - 1, sd, 0, 0, 0, 0).getTime();
  }

  if (endTimeVal) {
    const [eh, em]      = endTimeVal.split(':').map(Number);
    const [ey, emo, ed] = endDateVal.split('-').map(Number);
    endTs = new Date(ey, emo - 1, ed, eh, em, 59, 999).getTime();
  } else {
    const [ey, emo, ed] = endDateVal.split('-').map(Number);
    endTs = new Date(ey, emo - 1, ed, 23, 59, 59, 999).getTime();
  }

  if (startTs > endTs) {
    showSummaryStatus('Start date/time must be before end date/time.', 'warn');
    return;
  }

  document.getElementById('summaryStatusMsg')?.style?.setProperty('display', 'none');
  if (container) container.innerHTML = `
    <div class="loading-state">
      <div class="loading-spinner"></div>
      <p>Loading summary data…</p>
    </div>`;

  firebase.database().ref('history')
    .once('value')
    .then(snapshot => {
      const rawRows = [];

      snapshot.forEach(child => {
        const d = child.val();

        const ts = normaliseTimestamp(d.time ?? d.timestamp);
        if (isNaN(ts)) return;
        if (ts < startTs || ts > endTs) return;

        if (
          d.do          === undefined ||
          d.salinity    === undefined ||
          d.temperature === undefined ||
          d.ph          === undefined ||
          d.turbidity   === undefined
        ) return;

        rawRows.push({
          timestamp:   new Date(ts),
          do:          parseFloat(d.do),
          salinity:    parseFloat(d.salinity),
          temperature: parseFloat(d.temperature),
          ph:          parseFloat(d.ph),
          turbidity:   parseFloat(d.turbidity)
        });
      });

      console.log(`[Summary] ${rawRows.length} records matched the selected date range`);

      if (rawRows.length === 0) {
        if (container) container.innerHTML = '';
        const startLabel = startTimeVal ? `${startDateVal} ${startTimeVal}` : startDateVal;
        const endLabel   = endTimeVal   ? `${endDateVal} ${endTimeVal}`     : endDateVal;
        showSummaryStatus(
          `<i class="fas fa-info-circle"></i> No readings found between <strong>${startLabel}</strong> and <strong>${endLabel}</strong>.`,
          'info'
        );
        return;
      }

      const byDate = {};
      rawRows.forEach(row => {
        const dk = localDateKey(row.timestamp);
        if (!byDate[dk]) byDate[dk] = { do:[], salinity:[], temperature:[], ph:[], turbidity:[] };
        Object.keys(OPTIMAL_RANGES).forEach(param => byDate[dk][param].push(row[param]));
      });

      const allDates = [];
      const cur = parseLocalDate(startDateVal);
      const end = parseLocalDate(endDateVal);
      while (cur <= end) {
        allDates.push(localDateKey(cur));
        cur.setDate(cur.getDate() + 1);
      }

      const summaryData = {};
      Object.keys(OPTIMAL_RANGES).forEach(param => {
        summaryData[param] = allDates.map(date => {
          const vals = byDate[date]?.[param];
          if (!vals || vals.length === 0) return null;
          return {
            min: Math.min(...vals),
            avg: parseFloat((vals.reduce((a, b) => a + b, 0) / vals.length).toFixed(3)),
            max: Math.max(...vals)
          };
        });
      });

      const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
      const labels = allDates.map(d => {
        const [, m, day] = d.split('-');
        return `${months[parseInt(m) - 1]} ${parseInt(day)}`;
      });

      const startLabel = startTimeVal ? `${startDateVal} ${startTimeVal}` : startDateVal;
      const endLabel   = endTimeVal   ? `${endDateVal} ${endTimeVal}`     : endDateVal;
      showSummaryStatus(
        `<i class="fas fa-check-circle"></i> Showing <strong>${rawRows.length} readings</strong> from <strong>${startLabel}</strong> to <strong>${endLabel}</strong> across <strong>${allDates.length} day${allDates.length !== 1 ? 's' : ''}</strong>.`,
        'info'
      );

      window._summaryState = { labels, summaryData, allDates };
      renderSummaryCharts();
    })
    .catch(err => {
      console.error('[Summary] Firebase error:', err);
      showSummaryStatus(`Error loading data: ${err.message}`, 'warn');
    });
}

// ---------------------------------------------------------------------------
// SUMMARY CHART RENDERING
// ---------------------------------------------------------------------------

function renderSummaryCharts() {
  const state     = window._summaryState;
  const container = document.getElementById('summaryChartsContainer');
  if (!container) return;

  if (!state) {
    container.innerHTML = `
      <div class="summary-no-data">
        <i class="fas fa-calendar-alt" style="font-size:2rem;opacity:0.35;display:block;margin-bottom:0.75rem;"></i>
        Select a date range and click <strong>Refresh</strong> to load summary data.
      </div>`;
    return;
  }

  const { labels, summaryData } = state;
  const activeParams = getSummaryActiveParams();

  if (activeParams.length === 0) {
    container.innerHTML = `<div class="summary-no-data">No parameters selected. Check at least one parameter above.</div>`;
    return;
  }

  Object.keys(summaryCharts).forEach(param => {
    if (!activeParams.includes(param)) { summaryCharts[param]?.destroy(); delete summaryCharts[param]; }
  });

  container.innerHTML = activeParams.map(param => `
    <div class="analytics-card summary-chart-card" id="summaryCard_${param}">
      <div class="card-header" style="border-bottom:none;margin-bottom:0.5rem;padding-bottom:0;">
        <div>
          <div class="summary-chart-title">
            <span style="display:inline-block;width:12px;height:12px;border-radius:50%;background:${SUMMARY_COLORS[param].border};"></span>
            ${OPTIMAL_RANGES[param].label}
            <span style="font-size:0.78rem;font-weight:500;color:#64748b;">(${OPTIMAL_RANGES[param].unit || 'unitless'})</span>
          </div>
          <div class="card-subtitle">Min / Avg / Max per day &nbsp;·&nbsp; Safe range: ${OPTIMAL_RANGES[param].min}–${OPTIMAL_RANGES[param].max} ${OPTIMAL_RANGES[param].unit}</div>
        </div>
      </div>
      <canvas id="summaryChart_${param}" style="max-height:320px;"></canvas>
    </div>`).join('');

  activeParams.forEach(param => {
    const ctx = document.getElementById(`summaryChart_${param}`)?.getContext('2d');
    if (!ctx) return;
    summaryCharts[param]?.destroy(); delete summaryCharts[param];

    const data   = summaryData[param];
    const colors = SUMMARY_COLORS[param];
    const cfg    = OPTIMAL_RANGES[param];
    const noData = data.map(d => d === null);

    summaryCharts[param] = new Chart(ctx, {
      type: 'bar',
      data: {
        labels,
        datasets: [
          { label:'Min', data:data.map(d => d === null ? 0 : d.min), backgroundColor:colors.min, borderColor:colors.border, borderWidth:1, borderRadius:4 },
          { label:'Avg', data:data.map(d => d === null ? 0 : d.avg), backgroundColor:colors.avg, borderColor:colors.border, borderWidth:1, borderRadius:4 },
          { label:'Max', data:data.map(d => d === null ? 0 : d.max), backgroundColor:colors.max, borderColor:colors.border, borderWidth:1, borderRadius:4 }
        ]
      },
      options: {
        responsive:          true,
        maintainAspectRatio: true,
        aspectRatio:         2.8,
        interaction:         { mode:'index', intersect:false },
        plugins: {
          legend: {
            position: 'bottom',
            labels:   { usePointStyle:true, padding:18, font:{ family:'Inter', size:12 } }
          },
          tooltip: {
            backgroundColor: 'rgba(15,23,42,0.93)',
            padding:         12,
            titleFont:       { family:'Inter', size:13, weight:'600' },
            bodyFont:        { family:'Inter', size:12 },
            callbacks: {
              label: ctx => {
                if (noData[ctx.dataIndex]) return `${ctx.dataset.label}: No data`;
                return `${ctx.dataset.label}: ${ctx.parsed.y.toFixed(2)}${cfg.unit ? ' ' + cfg.unit : ''}`;
              }
            }
          },
          annotation: {
            annotations: {
              safeMin: {
                type: 'line', yMin:cfg.min, yMax:cfg.min, borderColor:'#10b981', borderWidth:2, borderDash:[6,4],
                label:{ display:true, content:`Safe Min: ${cfg.min}${cfg.unit ? ' '+cfg.unit : ''}`, position:'start', backgroundColor:'rgba(16,185,129,0.12)', color:'#047857', font:{ family:'Inter', size:11, weight:'600' }, padding:{ x:8, y:4 }, borderRadius:4 }
              },
              safeMax: {
                type: 'line', yMin:cfg.max, yMax:cfg.max, borderColor:'#f59e0b', borderWidth:2, borderDash:[6,4],
                label:{ display:true, content:`Safe Max: ${cfg.max}${cfg.unit ? ' '+cfg.unit : ''}`, position:'start', backgroundColor:'rgba(245,158,11,0.12)', color:'#b45309', font:{ family:'Inter', size:11, weight:'600' }, padding:{ x:8, y:4 }, borderRadius:4 }
              },
              critical: {
                type: 'line', yMin:cfg.critical, yMax:cfg.critical, borderColor:'#dc2626', borderWidth:2, borderDash:[4,3],
                label:{ display:true, content:`Critical: ${cfg.critical}${cfg.unit ? ' '+cfg.unit : ''}`, position:'end', backgroundColor:'rgba(220,38,38,0.12)', color:'#b91c1c', font:{ family:'Inter', size:11, weight:'600' }, padding:{ x:8, y:4 }, borderRadius:4 }
              }
            }
          }
        },
        scales: {
          y: { beginAtZero:false, grid:{ color:'rgba(226,232,240,0.5)' }, ticks:{ font:{ family:'Inter', size:11 } }, title:{ display:true, text:cfg.unit || param, font:{ family:'Inter', size:11 } } },
          x: { grid:{ display:false }, ticks:{ font:{ family:'Inter', size:11 }, maxRotation:45 } }
        }
      }
    });
  });
}

// ---------------------------------------------------------------------------
// SUMMARY STATUS MESSAGE
// ---------------------------------------------------------------------------

function showSummaryStatus(html, type) {
  const el = document.getElementById('summaryStatusMsg');
  if (!el) return;
  el.className = 'summary-status-info';
  if (type === 'warn') {
    el.style.background  = '#fffbeb';
    el.style.borderColor = '#fcd34d';
    el.style.color       = '#92400e';
  } else {
    el.style.background  = '';
    el.style.borderColor = '';
    el.style.color       = '';
  }
  el.innerHTML     = html;
  el.style.display = 'flex';
}

// ---------------------------------------------------------------------------
// TAB SWITCHING
// ---------------------------------------------------------------------------

function switchPageTab(tab) {
  document.querySelectorAll('.page-tab-btn').forEach(btn => btn.classList.remove('active'));
  document.querySelectorAll('.tab-panel').forEach(panel => panel.classList.remove('active'));

  const cap = tab.charAt(0).toUpperCase() + tab.slice(1);
  document.getElementById(`tabBtn${cap}`)?.classList.add('active');
  document.getElementById(`tabPanel${cap}`)?.classList.add('active');

  if (tab === 'trends' && trendChart) {
    requestAnimationFrame(() => { trendChart.resize(); trendChart.update('none'); });
  }
}