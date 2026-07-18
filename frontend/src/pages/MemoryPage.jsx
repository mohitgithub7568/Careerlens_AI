import React, { useState, useEffect } from 'react';
import { API_BASE_URL } from '../services/api';
import './MemoryPage.css';

const API_BASE = API_BASE_URL;

export default function MemoryPage() {
  const [memories, setMemories] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    const fetchMemory = async () => {
      const storedUser = JSON.parse(localStorage.getItem('careerlens_user') || '{}');
      const userId = storedUser.id || 'demo_user_123';
      try {
        const res = await fetch(`${API_BASE}/memory/${userId}`);
        if (res.ok) {
          const data = await res.json();
          if (data.success) {
            setMemories(data.memories || []);
          } else {
            setError('Failed to load memory entries.');
          }
        } else {
          setError('Failed to contact memory service.');
        }
      } catch (err) {
        console.error("Error fetching memories:", err);
        setError('Network error loading memories.');
      } finally {
        setLoading(false);
      }
    };
    fetchMemory();
  }, []);

  const formatDate = (isoStr) => {
    if (!isoStr) return 'Recent';
    const date = new Date(isoStr);
    return date.toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });
  };

  return (
    <div className="memory-page animate-fade-in">
      <div className="memory-header">
        <h1 className="memory-title">🧠 Long-Term Career Memory</h1>
        <p className="memory-subtitle">Visual timeline tracking your skills, strengths, and roadmap from all prior mock interview evaluation sessions.</p>
      </div>

      {loading ? (
        <div style={{ display: 'flex', justifyContent: 'center', padding: '4rem 0' }}>
          <span className="spinner" style={{ width: '32px', height: '32px', borderTopColor: 'var(--color-brand-accent)' }}></span>
        </div>
      ) : error ? (
        <div className="error-banner">{error}</div>
      ) : memories.length === 0 ? (
        <div className="empty-memory card">
          <div style={{ fontSize: '3rem', marginBottom: '1rem' }}>🧩</div>
          <h3>No Long-Term Memories Yet</h3>
          <p style={{ marginTop: '0.5rem' }}>Complete a mock interview and evaluation to save key details to your long-term career facts portfolio.</p>
        </div>
      ) : (
        <div className="timeline">
          {memories.map((entry, index) => {
            const facts = entry.facts || {};
            return (
              <div key={index} className="timeline-item">
                <div className="timeline-dot" />
                <div className="timeline-card">
                  <div className="timeline-meta">
                    <h3 className="timeline-role">Target Role: {entry.role || 'General candidate'}</h3>
                    <span className="timeline-date">{formatDate(entry.timestamp)}</span>
                  </div>

                  {facts.summary && (
                    <p className="timeline-summary">
                      {facts.summary}
                    </p>
                  )}

                  <div className="memory-badges-grid">
                    {/* Top Skills */}
                    {facts.top_skills && facts.top_skills.length > 0 && (
                      <div className="badge-col">
                        <span className="badge-col-title skills-title">Top Skills Evaluated</span>
                        <div className="memory-tag-list">
                          {facts.top_skills.map((skill, sIdx) => (
                            <span key={sIdx} className="memory-tag tag-blue">{skill}</span>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Key Strengths */}
                    {facts.key_strengths && facts.key_strengths.length > 0 && (
                      <div className="badge-col">
                        <span className="badge-col-title strengths-title">Key Strengths</span>
                        <div className="memory-tag-list">
                          {facts.key_strengths.map((str, sIdx) => (
                            <span key={sIdx} className="memory-tag tag-green">{str}</span>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Key Weaknesses */}
                    {facts.key_weaknesses && facts.key_weaknesses.length > 0 && (
                      <div className="badge-col">
                        <span className="badge-col-title weaknesses-title">Areas to Improve</span>
                        <div className="memory-tag-list">
                          {facts.key_weaknesses.map((weak, wIdx) => (
                            <span key={wIdx} className="memory-tag tag-red">{weak}</span>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>

                  {facts.confidence_level && (
                    <div style={{ marginTop: '1.25rem', fontSize: '0.85rem', color: 'var(--color-text-secondary)' }}>
                      <strong>Estimated Confidence Level:</strong> <span style={{ color: 'var(--color-text-primary)' }}>{facts.confidence_level}</span>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
