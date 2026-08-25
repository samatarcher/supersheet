import React, { useCallback, useEffect, useRef, useState } from 'react';
import DataGridDl, {
  GridCell,
  GridCellKind,
  GridColumn,
  Item,
  EditableGridCell,
} from 'glide-data-grid';
import axios from 'axios';
import { WorkOrderRow, SheetColumn } from '../../../shared/src/types';
import 'glide-data-grid/dist/index.css';

interface GridProps {
  viewId: string;
  sheetId?: string;
  columns: SheetColumn[];
  windowStart: number;
  onWindowStartChange: (start: number) => void;
  onRowSelect?: (row: WorkOrderRow) => void;
}

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:3000/api';

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
  const [savingCell, setSavingCell] = useState<boolean>(false);
  const gridRef = useRef<DataGridDl>(null);
  const cacheRef = useRef<Map<number, WorkOrderRow[]>>(new Map());

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
        cacheRef.current.set(start, newRows);
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

  // Build GridColumns from SheetColumns
  const visibleColumns = columns.filter((c) => c.is_visible);
  const gridColumns: GridColumn[] = visibleColumns.map((col) => ({
    title: col.name,
    width: col.width,
    id: col.column_key,
  }));

  // Handle cell fetch
  const handleGetCells = useCallback(
    (selections: Item[]): GridCell[] => {
      return selections.map(([colIndex, rowIndex]) => {
        const column = visibleColumns[colIndex];
        const rowData = rows[rowIndex];

        if (!column || !rowData) {
          return {
            kind: GridCellKind.Loading,
            allowOverlay: false,
          };
        }

        const columnKey = column.column_key;
        const value = (rowData as any)[columnKey];
        const isFormula = column.formula_mode && column.formula_mode !== null;
        const isSaving = editingCell?.rowIndex === rowIndex && editingCell?.colKey === columnKey && savingCell;

        if (value === null || value === undefined) {
          return {
            kind: GridCellKind.Text,
            data: '',
            allowOverlay: !isFormula,
            readonly: isFormula || column.data_type === 'formula',
          };
        }

        if (column.data_type === 'currency' || column.data_type === 'formula') {
          return {
            kind: GridCellKind.Number,
            data: value as number,
            displayData: `$${(value as number).toLocaleString()}`,
            allowOverlay: !isFormula,
            readonly: isFormula,
          };
        }

        if (column.data_type === 'date') {
          return {
            kind: GridCellKind.Text,
            data: value as string,
            allowOverlay: true,
            readonly: isFormula,
          };
        }

        if (column.data_type === 'checkbox') {
          return {
            kind: GridCellKind.Boolean,
            data: value as boolean,
            allowOverlay: true,
            readonly: isFormula,
          };
        }

        if (column.data_type === 'number') {
          return {
            kind: GridCellKind.Number,
            data: value as number,
            allowOverlay: true,
            readonly: isFormula,
          };
        }

        // Default: text
        return {
          kind: GridCellKind.Text,
          data: String(value),
          allowOverlay: true,
          readonly: isFormula,
        };
      });
    },
    [visibleColumns, rows, editingCell, savingCell]
  );

  // Handle cell edit
  const handleCellEdited = useCallback(
    async (cell: Item, newValue: EditableGridCell) => {
      const [colIndex, rowIndex] = cell;
      const column = visibleColumns[colIndex];
      const rowData = rows[rowIndex];

      if (!column || !rowData || !sheetId) return;

      // Optimistic update: update display immediately
      const updatedRows = [...rows];
      (updatedRows[rowIndex] as any)[column.column_key] = newValue.data;
      setRows(updatedRows);

      // Start saving
      setSavingCell(true);
      setEditingCell({ rowIndex, colKey: column.column_key });

      try {
        // Send update to server
        await axios.patch(
          `${API_BASE}/sheets/${sheetId}/rows/${rowData.id}/cells/${column.column_key}`,
          {
            value: newValue.data,
            expected_version: rowData.row_version,
          }
        );

        // Success: clear saving state
        setSavingCell(false);
        setEditingCell(null);

        // Optionally refetch this row to get updated data from server
      } catch (error: any) {
        console.error('Edit error:', error);

        // Conflict handling: revert and show conflict modal
        if (error.response?.status === 409) {
          const conflictData = error.response.data;
          const currentRow = conflictData.current_row;

          // Revert display
          const revertedRows = [...rows];
          revertedRows[rowIndex] = currentRow;
          setRows(revertedRows);

          setSavingCell(false);
          setEditingCell(null);

          // Show conflict modal
          const choice = confirm(
            `This row was changed by someone else. Current value: ${(currentRow as any)[column.column_key]}\n\nUse the latest version?`
          );

          if (!choice) {
            // Keep mine - revert back to what user typed
            const keepMineRows = [...rows];
            (keepMineRows[rowIndex] as any)[column.column_key] = newValue.data;
            setRows(keepMineRows);
          }
        } else {
          // Other error: revert and show error
          setError('Failed to save edit');
          const revertedRows = [...rows];
          revertedRows[rowIndex] = rowData;
          setRows(revertedRows);
          setSavingCell(false);
          setEditingCell(null);
        }
      }
    },
    [visibleColumns, rows, sheetId]
  );

  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        position: 'relative',
        background: 'white',
      }}
    >
      {error && (
        <div
          style={{
            padding: '16px',
            background: '#fee2e2',
            color: '#991b1b',
            borderBottom: '1px solid #fecaca',
            fontSize: '13px',
          }}
        >
          {error}
          <button
            onClick={() => setError(null)}
            style={{
              marginLeft: '12px',
              background: 'transparent',
              border: 'none',
              color: '#991b1b',
              cursor: 'pointer',
              textDecoration: 'underline',
            }}
          >
            Dismiss
          </button>
        </div>
      )}

      {loading && rows.length === 0 && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            height: '100%',
            color: '#667085',
          }}
        >
          Loading...
        </div>
      )}

      {!loading && rows.length === 0 && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            height: '100%',
            color: '#667085',
          }}
        >
          No rows found
        </div>
      )}

      {rows.length > 0 && (
        <DataGridDl
          ref={gridRef}
          columns={gridColumns}
          rows={totalCount}
          getCellContent={handleGetCells}
          onCellEdited={handleCellEdited}
          onRowAppended={() => {}}
          onVisibleRegionChanged={(region) => {
            const newStart = Math.max(0, region.y * 200);
            if (newStart !== windowStart) {
              onWindowStartChange(newStart);
            }
          }}
          onGridSelectionChange={(selection) => {
            if (selection.current && onRowSelect) {
              const rowIndex = selection.current.cell[1];
              if (rows[rowIndex]) {
                onRowSelect(rows[rowIndex]);
              }
            }
          }}
          rowMarkers="both"
          showSearch={false}
          freezeColumns={1}
          smoothScrollX={false}
          smoothScrollY={true}
        />
      )}
    </div>
  );
}
