import React, { useState } from 'react';
import axios from 'axios';
import { WorkOrderRow } from '../../../shared/src/types';

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:3000/api';

interface SearchProps {
  sheetId: string;
  onResultSelect: (rowNumber: number) => void;
}

export default function Search({ sheetId, onResultSelect }: SearchProps) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<WorkOrderRow[]>([]);
  const [searching, setSearching] = useState(false);
  const [showResults, setShowResults] = useState(false);

  async function handleSearch(e: React.FormEvent) {
    e.preventDefault();

    if (!query || query.length < 2) {
      setResults([]);
      return;
    }

    try {
      setSearching(true);
      const res = await axios.post(`${API_BASE}/sheets/${sheetId}/search`, {
        query,
        limit: 20,
      });

      setResults(res.data.results);
      setShowResults(true);
    } catch (error) {
      console.error('Search error:', error);
    } finally {
      setSearching(false);
    }
  }

  return (
    <div style={{ position: 'relative', flex: 1, maxWidth: '300px' }}>
      <form onSubmit={handleSearch} style={{ display: 'flex', gap: '8px' }}>
        <input
          type="text"
          placeholder="Search work orders..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          style={{
            flex: 1,
            padding: '6px 12px',
            border: '1px solid #d1d5db',
            borderRadius: '4px',
            fontSize: '13px',
          }}
        />
        <button
          type="submit"
          disabled={searching}
          style={{
            padding: '6px 12px',
            border: '1px solid #146EF5',
            background: '#146EF5',
            color: 'white',
            borderRadius: '4px',
            cursor: searching ? 'not-allowed' : 'pointer',
            fontSize: '13px',
            opacity: searching ? 0.7 : 1,
          }}
        >
          {searching ? 'Searching...' : 'Search'}
        </button>
      </form>

      {showResults && (
        <div
          style={{
            position: 'absolute',
            top: '100%',
            left: 0,
            right: 0,
            background: 'white',
            border: '1px solid #e4e7ec',
            borderRadius: '4px',
            marginTop: '4px',
            maxHeight: '300px',
            overflow: 'auto',
            zIndex: 10,
            boxShadow: '0 4px 6px rgba(0, 0, 0, 0.1)',
          }}
        >
          {results.length === 0 && !searching && (
            <div style={{ padding: '12px', color: '#667085', fontSize: '13px' }}>
              No results found
            </div>
          )}

          {results.map((result) => (
            <div
              key={result.id}
              onClick={() => {
                onResultSelect(result.row_number);
                setShowResults(false);
                setQuery('');
              }}
              style={{
                padding: '10px 12px',
                borderBottom: '1px solid #f3f4f6',
                cursor: 'pointer',
              }}
              onMouseEnter={(e) => {
                (e.currentTarget as HTMLElement).style.background = '#f9fafb';
              }}
              onMouseLeave={(e) => {
                (e.currentTarget as HTMLElement).style.background = 'white';
              }}
            >
              <div style={{ fontWeight: 600, fontSize: '13px', color: '#1f2937' }}>
                {result.work_order_id}
              </div>
              <div style={{ fontSize: '12px', color: '#667085' }}>
                {result.title?.substring(0, 50)}...
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
