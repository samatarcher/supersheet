import React, { useEffect, useState } from 'react';
import axios from 'axios';
import { WorkOrderRow, Sheet, SheetColumn, SheetView } from '../../shared/src/types';
import Grid from './components/Grid';
import Search from './components/Search';
import Filter from './components/Filter';
import RecordDetails from './components/RecordDetails';

interface AppState {
  sheet: Sheet | null;
  columns: SheetColumn[];
  views: SheetView[];
  currentViewId: string | null;
  loading: boolean;
  error: string | null;
  rowWindowStart: number;
  goToRowNumber: string;
  selectedRow: WorkOrderRow | null;
  filterLoading: boolean;
  resultCount: number | null;
}

const API_BASE = import.meta.env.VITE_API_URL || '/api';

export default function App() {
  const [state, setState] = useState<AppState>({
    sheet: null,
    columns: [],
    views: [],
    currentViewId: null,
    loading: true,
    error: null,
    rowWindowStart: 0,
    goToRowNumber: '',
    selectedRow: null,
    filterLoading: false,
    resultCount: null,
  });

  // Load sheet on mount
  useEffect(() => {
    loadSheet();
  }, []);

  async function loadSheet() {
    try {
      setState((s) => ({ ...s, loading: true, error: null }));

      // Get the first sheet (in demo mode)
      const sheetsRes = await axios.get(`${API_BASE}/sheets`);
      const sheets = sheetsRes.data;

      if (sheets.length === 0) {
        setState((s) => ({ ...s, error: 'No sheets found. Run database seed first.', loading: false }));
        return;
      }

      const sheetId = sheets[0].id;

      // Load sheet details
      const [sheetRes, columnsRes, viewsRes] = await Promise.all([
        axios.get(`${API_BASE}/sheets/${sheetId}`),
        axios.get(`${API_BASE}/sheets/${sheetId}/columns`),
        axios.get(`${API_BASE}/sheets/${sheetId}/views`),
      ]);

      const views = viewsRes.data;
      const defaultViewId = views.find((v: SheetView) => v.name === 'All Work Orders')?.id || views[0]?.id;

      setState((s) => ({
        ...s,
        sheet: sheetRes.data,
        columns: columnsRes.data,
        views,
        currentViewId: defaultViewId,
        loading: false,
        resultCount: sheetRes.data.row_count,
      }));
    } catch (error) {
      console.error('Load sheet error:', error);
      setState((s) => ({
        ...s,
        error: error instanceof Error ? error.message : 'Failed to load sheet',
        loading: false,
      }));
    }
  }

  function handleGoToRow() {
    const rowNum = parseInt(state.goToRowNumber, 10);
    if (rowNum > 0) {
      setState((s) => ({
        ...s,
        rowWindowStart: Math.max(0, rowNum - 1),
        goToRowNumber: '',
      }));
    }
  }

  async function handleApplyFilters(filters: any[]) {
    if (!state.currentViewId) return;

    try {
      setState((s) => ({ ...s, filterLoading: true }));

      const res = await axios.post(`${API_BASE}/views/${state.currentViewId}/apply_filters`, {
        filters,
        sort: [],
      });

      setState((s) => ({
        ...s,
        resultCount: res.data.result_count,
        rowWindowStart: 0,
        filterLoading: false,
      }));
    } catch (error) {
      console.error('Filter error:', error);
      setState((s) => ({
        ...s,
        error: 'Failed to apply filters',
        filterLoading: false,
      }));
    }
  }

  function handleSearchResult(rowNumber: number) {
    setState((s) => ({
      ...s,
      rowWindowStart: Math.max(0, rowNumber - 1),
    }));
  }

  if (state.loading) {
    return (
      <div className="supersheet-app">
        <div className="loading">Loading sheet...</div>
      </div>
    );
  }

  if (state.error && !state.sheet) {
    return (
      <div className="supersheet-app">
        <div className="error">{state.error}</div>
      </div>
    );
  }

  if (!state.sheet || !state.currentViewId) {
    return (
      <div className="supersheet-app">
        <div className="loading">No sheet configured</div>
      </div>
    );
  }

  return (
    <div className="supersheet-app">
      {/* Header */}
      <div className="header">
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <div className="header-title">{state.sheet.name}</div>
          {state.sheet.sheet_class === 'enterprise_scale' && (
            <div className="header-badge">ENTERPRISE SCALE</div>
          )}
        </div>
        <div className="header-info">
          {(state.resultCount ?? state.sheet.row_count).toLocaleString()} rows
        </div>
      </div>

      {/* Toolbar */}
      <div className="toolbar">
        <div style={{ display: 'flex', gap: '8px', flex: 1, alignItems: 'center' }}>
          <input
            type="text"
            placeholder="Go to row..."
            value={state.goToRowNumber}
            onChange={(e) => setState((s) => ({ ...s, goToRowNumber: e.target.value }))}
            onKeyPress={(e) => {
              if (e.key === 'Enter') handleGoToRow();
            }}
            style={{ width: '120px', padding: '6px 12px', border: '1px solid #d1d5db', borderRadius: '4px', fontSize: '13px' }}
          />
          <button
            onClick={handleGoToRow}
            style={{
              padding: '6px 12px',
              border: '1px solid #d1d5db',
              background: 'white',
              borderRadius: '4px',
              cursor: 'pointer',
              fontSize: '13px',
            }}
          >
            Jump
          </button>

          <Search sheetId={state.sheet.id} onResultSelect={handleSearchResult} />

          <Filter onApplyFilters={handleApplyFilters} loading={state.filterLoading} />

          <select
            value={state.currentViewId}
            onChange={(e) => setState((s) => ({ ...s, currentViewId: e.target.value, rowWindowStart: 0 }))}
            style={{ padding: '6px 12px', border: '1px solid #d1d5db', borderRadius: '4px', fontSize: '13px' }}
          >
            {state.views.map((view) => (
              <option key={view.id} value={view.id}>
                {view.name}
              </option>
            ))}
          </select>

          <button
            onClick={async () => {
              try {
                const res = await axios.get(`${API_BASE}/demo/scale_inspector?sheet_id=${state.sheet?.id}`);
                console.log('Scale Inspector:', res.data);
                alert(`Scale Inspector:\n- DB Rows: ${res.data.database_row_count}\n- Browser Cache: ~${res.data.populated_field_estimate}`);
              } catch (e) {
                console.error('Scale Inspector error:', e);
              }
            }}
            style={{
              padding: '6px 12px',
              border: '1px solid #d1d5db',
              background: 'white',
              borderRadius: '4px',
              cursor: 'pointer',
              fontSize: '13px',
            }}
          >
            📊 Inspector
          </button>
        </div>
      </div>

      {/* Error notification */}
      {state.error && (
        <div
          style={{
            padding: '8px 16px',
            background: '#fee2e2',
            color: '#991b1b',
            fontSize: '13px',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}
        >
          {state.error}
          <button
            onClick={() => setState((s) => ({ ...s, error: null }))}
            style={{ background: 'transparent', border: 'none', color: '#991b1b', cursor: 'pointer' }}
          >
            ✕
          </button>
        </div>
      )}

      {/* Grid */}
      <div className="content">
        <div className="grid-container">
          <Grid
            viewId={state.currentViewId}
            sheetId={state.sheet.id}
            columns={state.columns}
            windowStart={state.rowWindowStart}
            onWindowStartChange={(start) => setState((s) => ({ ...s, rowWindowStart: start }))}
            onRowSelect={(row) => setState((s) => ({ ...s, selectedRow: row }))}
          />
        </div>

        {/* Record Details Panel */}
        {state.selectedRow && (
          <RecordDetails
            sheetId={state.sheet.id}
            row={state.selectedRow}
            columns={state.columns}
            onClose={() => setState((s) => ({ ...s, selectedRow: null }))}
          />
        )}
      </div>

      {/* Status Bar */}
      <div className="status-bar">
        <div>
          Rows {(state.rowWindowStart + 1).toLocaleString()} - {Math.min(state.rowWindowStart + 200, state.resultCount ?? state.sheet.row_count).toLocaleString()} of {(state.resultCount ?? state.sheet.row_count).toLocaleString()}
        </div>
        <div>{state.filterLoading ? 'Filtering...' : 'Ready'}</div>
      </div>
    </div>
  );
}
