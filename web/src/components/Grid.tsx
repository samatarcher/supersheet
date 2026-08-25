import React, { useCallback, useEffect, useState } from 'react';
import { FixedSizeList as List } from 'react-window';
import axios from 'axios';
import { WorkOrderRow, SheetColumn } from '../../../shared/src/types';

interface GridProps {
  viewId: string;
  sheetId?: string;
  columns: SheetColumn[];
  windowStart: number;
  onWindowStartChange: (start: number) => void;
  onRowSelect?: (row: WorkOrderRow) => void;
}

const API_BASE = import.meta.env.VITE_API_URL || '/api';
const ROW_HEIGHT = 30;

export default function Grid({
  viewId,
  sheetId,
  columns,
  windowStart,
  onWindowStartChange,
  onRowSelect,
}: GridProps) {
  const [rows, setRows] = useState<WorkOrderRow[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editingCell, setEditingCell] = useState<{ rowIndex: number; colKey: string } | null>(null);

  // Fetch row window
  const fetchRowWindow = useCallback(
    async (start: number) => {
      try {
        setLoading(true);
        setError(null);

        const res = await axios.get(`${API_BASE}/views/${viewId}/window`, {
          params: { start, limit: 200 },
        });

        const { rows: newRows, total_count } = res.data;
        setRows(newRows);
        setTotalCount(total_count);
      } catch (err) {
        console.error('Fetch error:', err);
        setError(err instanceof Error ? err.message : 'Failed to load rows');
      } finally {
        setLoading(false);
      }
    },
    [viewId]
  );

  // Load initial window
  useEffect(() => {
    fetchRowWindow(windowStart);
  }, [viewId, windowStart, fetchRowWindow]);

  // Format cell value for display
  const formatValue = (value: any, column: SheetColumn): string => {
    if (value === null || value === undefined) return '';

    if (column.data_type === 'currency') {
      return `$${(value as number).toLocaleString()}`;
    }

    if (column.data_type === 'date') {
      try {
        return new Date(value).toLocaleDateString();
      } catch {
        return String(value);
      }
    }

    if (column.data_type === 'checkbox') {
      return value ? '✓' : '◯';
    }

    return String(value);
  };

  // Handle cell edit
  const handleCellEdit = useCallback(
    async (rowIndex: number, column: SheetColumn, newValue: string) => {
      const rowData = rows[rowIndex];
      if (!rowData || !sheetId) return;

      // Optimistic update
      const updatedRows = [...rows];
      (updatedRows[rowIndex] as any)[column.column_key] = newValue;
      setRows(updatedRows);

      setEditingCell({ rowIndex, colKey: column.column_key });

      try {
        await axios.patch(
          `${API_BASE}/sheets/${sheetId}/rows/${rowData.id}/cells/${column.column_key}`,
          {
            value: newValue,
            expected_version: rowData.row_version,
          }
        );

        setEditingCell(null);
      } catch (error: any) {
        if (error.response?.status === 409) {
          const currentRow = error.response.data.current_row;
          const revertedRows = [...rows];
          revertedRows[rowIndex] = currentRow;
          setRows(revertedRows);

          const choice = confirm(
            `This row was changed. Current: ${(currentRow as any)[column.column_key]}\n\nUse latest?`
          );

          if (!choice) {
            const keepMineRows = [...rows];
            (keepMineRows[rowIndex] as any)[column.column_key] = newValue;
            setRows(keepMineRows);
          }
        } else {
          setError('Failed to save');
          const revertedRows = [...rows];
          revertedRows[rowIndex] = rowData;
          setRows(revertedRows);
        }
        setEditingCell(null);
      }
    },
    [rows, sheetId]
  );

  const visibleColumns = columns.filter((c) => c.is_visible);
  const colWidths = visibleColumns.map((c) => c.width);
  const totalWidth = colWidths.reduce((a, b) => a + b, 0);

  const Row = ({ index, style }: { index: number; style: React.CSSProperties }) => {
    const row = rows[index];
    if (!row) return <div style={style} />;

    return (
      <div
        style={{
          ...style,
          display: 'flex',
          borderBottom: '1px solid #e4e7ec',
          backgroundColor: index % 2 === 0 ? '#ffffff' : '#f9fafb',
          cursor: 'pointer',
        }}
        onClick={() => onRowSelect?.(row)}
      >
        {visibleColumns.map((col, colIdx) => (
          <div
            key={col.column_key}
            style={{
              width: colWidths[colIdx],
              padding: '6px 8px',
              display: 'flex',
              alignItems: 'center',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              fontSize: '13px',
              borderRight: '1px solid #e4e7ec',
              backgroundColor:
                editingCell?.rowIndex === index && editingCell?.colKey === col.column_key
                  ? '#dbeafe'
                  : 'transparent',
              color: col.formula_mode ? '#667085' : '#1f2937',
            }}
            onDoubleClick={(e) => {
              e.stopPropagation();
              if (!col.formula_mode) {
                const newValue = prompt(`Edit ${col.name}:`, formatValue((row as any)[col.column_key], col));
                if (newValue !== null) {
                  handleCellEdit(index, col, newValue);
                }
              }
            }}
          >
            {formatValue((row as any)[col.column_key], col)}
          </div>
        ))}
      </div>
    );
  };

  return (
    <div style={{ width: '100%', height: '100%', position: 'relative', background: 'white' }}>
      {error && (
        <div
          style={{
            padding: '12px',
            background: '#fee2e2',
            color: '#991b1b',
            fontSize: '13px',
            display: 'flex',
            justifyContent: 'space-between',
          }}
        >
          {error}
          <button onClick={() => setError(null)} style={{ background: 'transparent', border: 'none', cursor: 'pointer' }}>
            ✕
          </button>
        </div>
      )}

      {loading && rows.length === 0 && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: '#667085' }}>
          Loading...
        </div>
      )}

      {!loading && rows.length === 0 && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: '#667085' }}>
          No rows found
        </div>
      )}

      {/* Column headers */}
      {rows.length > 0 && (
        <>
          <div
            style={{
              display: 'flex',
              borderBottom: '2px solid #d1d5db',
              background: '#f3f4f6',
              position: 'sticky',
              top: 0,
              zIndex: 10,
            }}
          >
            {visibleColumns.map((col, idx) => (
              <div
                key={col.column_key}
                style={{
                  width: colWidths[idx],
                  padding: '8px',
                  fontWeight: 600,
                  fontSize: '12px',
                  color: '#1f2937',
                  borderRight: '1px solid #e4e7ec',
                  textOverflow: 'ellipsis',
                  overflow: 'hidden',
                  whiteSpace: 'nowrap',
                }}
              >
                {col.name} {col.formula_mode && '📐'}
              </div>
            ))}
          </div>

          <List
            height={window.innerHeight - 280}
            itemCount={totalCount}
            itemSize={ROW_HEIGHT}
            width="100%"
            onScroll={({ scrollOffset }) => {
              const newStart = Math.max(0, Math.floor(scrollOffset / ROW_HEIGHT / 10) * 10);
              if (newStart !== windowStart) {
                onWindowStartChange(newStart);
              }
            }}
          >
            {Row}
          </List>
        </>
      )}
    </div>
  );
}
