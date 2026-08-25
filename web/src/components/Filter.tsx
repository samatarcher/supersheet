import React, { useState } from 'react';

interface FilterCondition {
  field: string;
  operator: string;
  value?: any;
  values?: any[];
}

interface FilterProps {
  onApplyFilters: (filters: FilterCondition[]) => void;
  loading?: boolean;
}

const FIELDS = [
  { label: 'Work Order ID', value: 'work_order_id' },
  { label: 'Title', value: 'title' },
  { label: 'Facility', value: 'facility' },
  { label: 'Region', value: 'region' },
  { label: 'Priority', value: 'priority' },
  { label: 'Status', value: 'status' },
  { label: 'Owner', value: 'owner' },
  { label: 'Due Date', value: 'due_date' },
  { label: 'Budget', value: 'budget' },
  { label: 'Actual Cost', value: 'actual_cost' },
];

const OPERATORS = [
  { label: 'Equals', value: '=' },
  { label: 'Not Equals', value: '!=' },
  { label: 'Contains', value: 'contains' },
  { label: 'Is Blank', value: 'is_blank' },
  { label: 'Is Not Blank', value: 'is_not_blank' },
  { label: 'Greater Than', value: '>' },
  { label: 'Less Than', value: '<' },
  { label: 'Is Before', value: 'is_before' },
  { label: 'Is After', value: 'is_after' },
];

const PRIORITY_VALUES = ['Critical', 'High', 'Normal', 'Low'];
const STATUS_VALUES = ['New', 'In Progress', 'On Hold', 'Complete'];
const REGION_VALUES = ['Northeast', 'Southeast', 'Midwest', 'Southwest', 'West', 'Pacific'];

export default function Filter({ onApplyFilters, loading = false }: FilterProps) {
  const [filters, setFilters] = useState<FilterCondition[]>([]);
  const [showBuilder, setShowBuilder] = useState(false);
  const [tempFilter, setTempFilter] = useState<FilterCondition>({
    field: 'status',
    operator: '=',
  });

  function addFilter() {
    if (tempFilter.field && tempFilter.operator) {
      setFilters([...filters, { ...tempFilter }]);
      setTempFilter({ field: 'status', operator: '=' });
    }
  }

  function removeFilter(index: number) {
    setFilters(filters.filter((_, i) => i !== index));
  }

  function apply() {
    onApplyFilters(filters);
  }

  const getValueInputForField = (field: string, operator: string) => {
    if (['is_blank', 'is_not_blank'].includes(operator)) {
      return null;
    }

    if (field === 'priority') {
      return (
        <select
          value={tempFilter.value || ''}
          onChange={(e) => setTempFilter({ ...tempFilter, value: e.target.value })}
          style={{ padding: '4px 8px', fontSize: '13px', borderRadius: '4px', border: '1px solid #d1d5db' }}
        >
          <option value="">Select...</option>
          {PRIORITY_VALUES.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>
      );
    }

    if (field === 'status') {
      return (
        <select
          value={tempFilter.value || ''}
          onChange={(e) => setTempFilter({ ...tempFilter, value: e.target.value })}
          style={{ padding: '4px 8px', fontSize: '13px', borderRadius: '4px', border: '1px solid #d1d5db' }}
        >
          <option value="">Select...</option>
          {STATUS_VALUES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      );
    }

    if (field === 'region') {
      return (
        <select
          value={tempFilter.value || ''}
          onChange={(e) => setTempFilter({ ...tempFilter, value: e.target.value })}
          style={{ padding: '4px 8px', fontSize: '13px', borderRadius: '4px', border: '1px solid #d1d5db' }}
        >
          <option value="">Select...</option>
          {REGION_VALUES.map((r) => (
            <option key={r} value={r}>
              {r}
            </option>
          ))}
        </select>
      );
    }

    if (['due_date', 'submitted_date'].includes(field)) {
      return (
        <input
          type="date"
          value={tempFilter.value || ''}
          onChange={(e) => setTempFilter({ ...tempFilter, value: e.target.value })}
          style={{ padding: '4px 8px', fontSize: '13px', borderRadius: '4px', border: '1px solid #d1d5db' }}
        />
      );
    }

    if (['budget', 'actual_cost'].includes(field)) {
      return (
        <input
          type="number"
          value={tempFilter.value || ''}
          onChange={(e) => setTempFilter({ ...tempFilter, value: parseFloat(e.target.value) })}
          style={{ padding: '4px 8px', fontSize: '13px', borderRadius: '4px', border: '1px solid #d1d5db', width: '120px' }}
        />
      );
    }

    return (
      <input
        type="text"
        value={tempFilter.value || ''}
        onChange={(e) => setTempFilter({ ...tempFilter, value: e.target.value })}
        placeholder="Enter value..."
        style={{ padding: '4px 8px', fontSize: '13px', borderRadius: '4px', border: '1px solid #d1d5db' }}
      />
    );
  };

  return (
    <div style={{ position: 'relative' }}>
      <button
        onClick={() => setShowBuilder(!showBuilder)}
        style={{
          padding: '6px 12px',
          border: '1px solid #d1d5db',
          background: filters.length > 0 ? '#dbeafe' : 'white',
          borderRadius: '4px',
          cursor: 'pointer',
          fontSize: '13px',
          color: filters.length > 0 ? '#0369a1' : '#1f2937',
          fontWeight: filters.length > 0 ? 600 : 400,
        }}
      >
        🔍 Filter {filters.length > 0 ? `(${filters.length})` : ''}
      </button>

      {showBuilder && (
        <div
          style={{
            position: 'absolute',
            top: '100%',
            left: 0,
            background: 'white',
            border: '1px solid #e4e7ec',
            borderRadius: '4px',
            padding: '12px',
            marginTop: '4px',
            minWidth: '500px',
            zIndex: 10,
            boxShadow: '0 4px 6px rgba(0, 0, 0, 0.1)',
          }}
        >
          {/* Add new filter */}
          <div style={{ marginBottom: '12px', paddingBottom: '12px', borderBottom: '1px solid #f3f4f6' }}>
            <div style={{ fontSize: '12px', fontWeight: 600, marginBottom: '8px', color: '#667085' }}>
              Add Filter
            </div>
            <div style={{ display: 'flex', gap: '8px', marginBottom: '8px' }}>
              <select
                value={tempFilter.field}
                onChange={(e) => setTempFilter({ ...tempFilter, field: e.target.value })}
                style={{ padding: '4px 8px', fontSize: '13px', borderRadius: '4px', border: '1px solid #d1d5db' }}
              >
                {FIELDS.map((f) => (
                  <option key={f.value} value={f.value}>
                    {f.label}
                  </option>
                ))}
              </select>

              <select
                value={tempFilter.operator}
                onChange={(e) => setTempFilter({ ...tempFilter, operator: e.target.value })}
                style={{ padding: '4px 8px', fontSize: '13px', borderRadius: '4px', border: '1px solid #d1d5db' }}
              >
                {OPERATORS.map((op) => (
                  <option key={op.value} value={op.value}>
                    {op.label}
                  </option>
                ))}
              </select>

              {getValueInputForField(tempFilter.field, tempFilter.operator)}

              <button
                onClick={addFilter}
                style={{
                  padding: '4px 8px',
                  background: '#146EF5',
                  color: 'white',
                  border: 'none',
                  borderRadius: '4px',
                  cursor: 'pointer',
                  fontSize: '13px',
                }}
              >
                Add
              </button>
            </div>
          </div>

          {/* Applied filters */}
          {filters.length > 0 && (
            <div style={{ marginBottom: '12px' }}>
              <div style={{ fontSize: '12px', fontWeight: 600, marginBottom: '8px', color: '#667085' }}>
                Applied Filters
              </div>
              {filters.map((filter, idx) => (
                <div
                  key={idx}
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    padding: '8px',
                    background: '#f9fafb',
                    borderRadius: '4px',
                    marginBottom: '4px',
                    fontSize: '13px',
                  }}
                >
                  <span>
                    {FIELDS.find((f) => f.value === filter.field)?.label} {filter.operator}
                    {filter.value && ` "${filter.value}"`}
                  </span>
                  <button
                    onClick={() => removeFilter(idx)}
                    style={{
                      background: '#fee2e2',
                      color: '#991b1b',
                      border: 'none',
                      borderRadius: '4px',
                      padding: '2px 6px',
                      cursor: 'pointer',
                      fontSize: '12px',
                    }}
                  >
                    Remove
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* Action buttons */}
          <div style={{ display: 'flex', gap: '8px' }}>
            <button
              onClick={apply}
              disabled={filters.length === 0 || loading}
              style={{
                flex: 1,
                padding: '6px 12px',
                background: filters.length > 0 ? '#146EF5' : '#e5e7eb',
                color: 'white',
                border: 'none',
                borderRadius: '4px',
                cursor: filters.length > 0 ? 'pointer' : 'not-allowed',
                fontSize: '13px',
                opacity: loading ? 0.7 : 1,
              }}
            >
              {loading ? 'Applying...' : 'Apply Filters'}
            </button>
            <button
              onClick={() => {
                setFilters([]);
                setShowBuilder(false);
              }}
              style={{
                padding: '6px 12px',
                background: 'white',
                border: '1px solid #d1d5db',
                borderRadius: '4px',
                cursor: 'pointer',
                fontSize: '13px',
              }}
            >
              Clear
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
