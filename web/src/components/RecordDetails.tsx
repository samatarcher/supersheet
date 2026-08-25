import React, { useEffect, useState } from 'react';
import axios from 'axios';
import { WorkOrderRow, ActivityEvent, SheetColumn } from '../../../shared/src/types';

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:3000/api';

interface RecordDetailsProps {
  sheetId: string;
  row: WorkOrderRow | null;
  columns: SheetColumn[];
  onClose: () => void;
}

export default function RecordDetails({ sheetId, row, columns, onClose }: RecordDetailsProps) {
  const [activity, setActivity] = useState<ActivityEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState<'details' | 'activity' | 'comments'>('details');

  useEffect(() => {
    if (row && activeTab === 'activity') {
      loadActivity();
    }
  }, [row, activeTab]);

  async function loadActivity() {
    if (!row) return;

    try {
      setLoading(true);
      const res = await axios.get(`${API_BASE}/sheets/${sheetId}/rows/${row.id}/activity`);
      setActivity(res.data.activity);
    } catch (error) {
      console.error('Load activity error:', error);
    } finally {
      setLoading(false);
    }
  }

  if (!row) {
    return null;
  }

  const getColumnLabel = (key: string) => {
    const col = columns.find((c) => c.column_key === key);
    return col?.name || key;
  };

  const formatValue = (value: any, columnKey: string) => {
    const col = columns.find((c) => c.column_key === columnKey);

    if (value === null || value === undefined) {
      return '—';
    }

    if (col?.data_type === 'currency') {
      return `$${(value as number).toLocaleString()}`;
    }

    if (col?.data_type === 'checkbox') {
      return value ? '✓ Yes' : '◯ No';
    }

    if (col?.data_type === 'date') {
      try {
        return new Date(value).toLocaleDateString();
      } catch {
        return value;
      }
    }

    return String(value);
  };

  return (
    <div
      style={{
        position: 'fixed',
        right: 0,
        top: 0,
        bottom: 0,
        width: '350px',
        background: 'white',
        borderLeft: '1px solid #e4e7ec',
        display: 'flex',
        flexDirection: 'column',
        zIndex: 100,
      }}
    >
      {/* Header */}
      <div
        style={{
          padding: '16px',
          borderBottom: '1px solid #e4e7ec',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
        }}
      >
        <div style={{ fontWeight: 600, fontSize: '14px', color: '#1f2937' }}>
          {row.work_order_id}
        </div>
        <button
          onClick={onClose}
          style={{
            background: 'transparent',
            border: 'none',
            cursor: 'pointer',
            fontSize: '18px',
            padding: '0 4px',
          }}
        >
          ✕
        </button>
      </div>

      {/* Tabs */}
      <div
        style={{
          display: 'flex',
          borderBottom: '1px solid #e4e7ec',
          background: '#f9fafb',
        }}
      >
        {(['details', 'activity', 'comments'] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            style={{
              flex: 1,
              padding: '8px 12px',
              border: 'none',
              background: activeTab === tab ? 'white' : 'transparent',
              borderBottom: activeTab === tab ? '2px solid #146EF5' : 'none',
              cursor: 'pointer',
              fontSize: '13px',
              color: activeTab === tab ? '#146EF5' : '#667085',
              fontWeight: activeTab === tab ? 600 : 400,
              marginBottom: activeTab === tab ? '-1px' : '0',
            }}
          >
            {tab === 'details' && 'Details'}
            {tab === 'activity' && 'Activity'}
            {tab === 'comments' && 'Comments'}
          </button>
        ))}
      </div>

      {/* Content */}
      <div style={{ flex: 1, overflow: 'auto', padding: '16px' }}>
        {activeTab === 'details' && (
          <div>
            <div style={{ fontSize: '14px', fontWeight: 600, marginBottom: '12px', color: '#1f2937' }}>
              {row.title}
            </div>

            <div style={{ display: 'grid', gap: '12px' }}>
              {columns
                .filter((c) => c.is_visible && !['id', 'sheet_id', 'row_version', 'created_at', 'updated_at'].includes(c.column_key))
                .map((col) => (
                  <div key={col.column_key}>
                    <div style={{ fontSize: '11px', color: '#667085', fontWeight: 600, marginBottom: '4px' }}>
                      {col.name}
                    </div>
                    <div style={{ fontSize: '13px', color: '#1f2937' }}>
                      {formatValue((row as any)[col.column_key], col.column_key)}
                    </div>
                  </div>
                ))}
            </div>
          </div>
        )}

        {activeTab === 'activity' && (
          <div>
            {loading && <div style={{ color: '#667085' }}>Loading...</div>}

            {!loading && activity.length === 0 && (
              <div style={{ color: '#667085', fontSize: '13px' }}>No activity yet</div>
            )}

            {!loading && activity.length > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                {activity.map((event) => (
                  <div
                    key={event.id}
                    style={{
                      padding: '8px',
                      background: '#f9fafb',
                      borderRadius: '4px',
                      borderLeft: '3px solid #146EF5',
                    }}
                  >
                    <div style={{ fontSize: '12px', fontWeight: 600, color: '#1f2937' }}>
                      {event.action_type}
                    </div>
                    <div style={{ fontSize: '11px', color: '#667085', marginTop: '4px' }}>
                      {event.source_type} •{' '}
                      {new Date(event.created_at).toLocaleDateString() +
                        ' ' +
                        new Date(event.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </div>
                    {event.changes_json && (
                      <div style={{ fontSize: '12px', color: '#1f2937', marginTop: '4px' }}>
                        {Object.entries(event.changes_json as Record<string, any>).map(([key, change]) => (
                          <div key={key} style={{ marginTop: '2px' }}>
                            <strong>{key}:</strong> {JSON.stringify(change)}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {activeTab === 'comments' && (
          <div style={{ color: '#667085', fontSize: '13px' }}>
            Comments feature coming soon
          </div>
        )}
      </div>
    </div>
  );
}
