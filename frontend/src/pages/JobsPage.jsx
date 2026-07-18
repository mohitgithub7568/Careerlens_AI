import React, { useState, useEffect, useCallback } from 'react';
import { API_BASE_URL } from '../services/api';
import './JobsPage.css';

const API_BASE = API_BASE_URL;

const DIFFICULTY_CONFIG = {
  Easy: { color: '#10b981', bg: 'rgba(16,185,129,0.12)', label: 'Easy Apply' },
  Medium: { color: '#f59e0b', bg: 'rgba(245,158,11,0.12)', label: 'Moderate' },
  Hard: { color: '#ef4444', bg: 'rgba(239,68,68,0.12)', label: 'Competitive' },
};

function ScoreRing({ score, size = 60, stroke = 6 }) {
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const progress = ((score || 0) / 100) * circumference;
  const color = score >= 80 ? '#34d399' : score >= 60 ? '#f59e0b' : '#f87171';

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="score-ring-svg">
      <circle
        cx={size / 2} cy={size / 2} r={radius}
        fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth={stroke}
      />
      <circle
        cx={size / 2} cy={size / 2} r={radius}
        fill="none" stroke={color} strokeWidth={stroke}
        strokeLinecap="round"
        strokeDasharray={circumference}
        strokeDashoffset={circumference - progress}
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
        style={{ transition: 'stroke-dashoffset 0.8s ease' }}
      />
      <text
        x={size / 2} y={size / 2 + 1}
        textAnchor="middle" dominantBaseline="middle"
        fill={color} fontSize={size * 0.22} fontWeight="700"
      >
        {score}%
      </text>
    </svg>
  );
}

export default function JobsPage() {
  const [jobs, setJobs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState('All');
  const [sortBy, setSortBy] = useState('match');
  const [savedJobs, setSavedJobs] = useState(() => {
    try { return JSON.parse(localStorage.getItem('saved_jobs') || '[]'); } catch { return []; }
  });
  const [showSaved, setShowSaved] = useState(false);
  const [toast, setToast] = useState('');

  const fetchJobs = useCallback(async () => {
    setLoading(true);
    setError('');
    const storedUser = JSON.parse(localStorage.getItem('careerlens_user') || '{}');
    const userId = storedUser.id || 'demo_user_123';
    try {
      const res = await fetch(`${API_BASE}/job-recommendations?user_id=${userId}`);
      if (!res.ok) throw new Error('Server error');
      const data = await res.json();
      if (data.success) {
        setJobs(data.jobs || []);
      } else {
        setError('Could not load job recommendations.');
      }
    } catch (e) {
      setError('Failed to fetch recommendations. Please try again.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchJobs(); }, [fetchJobs]);

  const toggleSave = (title) => {
    setSavedJobs(prev => {
      const next = prev.includes(title) ? prev.filter(t => t !== title) : [...prev, title];
      localStorage.setItem('saved_jobs', JSON.stringify(next));
      setToast(prev.includes(title) ? 'Removed from saved jobs' : '✓ Saved to your list');
      setTimeout(() => setToast(''), 2500);
      return next;
    });
  };

  const difficulties = ['All', 'Easy', 'Medium', 'Hard'];
  const filtered = jobs
    .filter(j => filter === 'All' || j.difficulty === filter)
    .sort((a, b) => sortBy === 'match' ? b.match_score - a.match_score : a.title.localeCompare(b.title));

  const displayJobs = showSaved ? filtered.filter(j => savedJobs.includes(j.title)) : filtered;

  return (
    <div className="jobs-page animate-fade-in">
      {/* Toast */}
      {toast && <div className="jobs-toast">{toast}</div>}

      {/* Page Header */}
      <div className="jobs-header">
        <div className="jobs-header__left">
          <div className="jobs-page-icon">
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="2" y="7" width="20" height="14" rx="2" ry="2"></rect>
              <path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"></path>
            </svg>
          </div>
          <div>
            <h1 className="jobs-title">AI Job Recommendations</h1>
            <p className="jobs-subtitle">
              Personalized roles curated by AI based on your resume skills and interview history
            </p>
          </div>
        </div>
        <button className="btn btn-primary jobs-refresh-btn" onClick={fetchJobs} disabled={loading}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="23 4 23 10 17 10"></polyline>
            <polyline points="1 20 1 14 7 14"></polyline>
            <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"></path>
          </svg>
          {loading ? 'Loading...' : 'Refresh'}
        </button>
      </div>

      {/* Toolbar */}
      <div className="jobs-toolbar card card-static">
        <div className="jobs-filter-group">
          <span className="jobs-filter-label">Difficulty:</span>
          {difficulties.map(d => (
            <button
              key={d}
              className={`jobs-filter-btn ${filter === d ? 'active' : ''}`}
              onClick={() => setFilter(d)}
            >
              {d}
            </button>
          ))}
        </div>
        <div className="jobs-toolbar-right">
          <label className="jobs-sort-label">
            Sort by:&nbsp;
            <select
              className="jobs-sort-select"
              value={sortBy}
              onChange={e => setSortBy(e.target.value)}
            >
              <option value="match">Match Score</option>
              <option value="title">Title A–Z</option>
            </select>
          </label>
          <button
            className={`jobs-saved-btn ${showSaved ? 'active' : ''}`}
            onClick={() => setShowSaved(s => !s)}
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill={showSaved ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"></path>
            </svg>
            Saved ({savedJobs.length})
          </button>
        </div>
      </div>

      {/* Content */}
      {loading ? (
        <div className="jobs-loading">
          <div className="jobs-loading-ring"></div>
          <p>AI is analyzing your profile to find the best matching roles…</p>
        </div>
      ) : error ? (
        <div className="jobs-error card">
          <div style={{ fontSize: '2.5rem', marginBottom: '1rem' }}>⚠️</div>
          <p>{error}</p>
          <button className="btn btn-primary" style={{ marginTop: '1rem' }} onClick={fetchJobs}>Try Again</button>
        </div>
      ) : displayJobs.length === 0 ? (
        <div className="jobs-empty card">
          <div style={{ fontSize: '3rem', marginBottom: '1rem' }}>{showSaved ? '🔖' : '🔍'}</div>
          <h3>{showSaved ? 'No saved jobs yet' : 'No matching jobs found'}</h3>
          <p>{showSaved ? 'Save roles you like to find them here.' : 'Try adjusting the difficulty filter.'}</p>
        </div>
      ) : (
        <div className="jobs-grid">
          {displayJobs.map((job, idx) => {
            const diff = DIFFICULTY_CONFIG[job.difficulty] || DIFFICULTY_CONFIG.Medium;
            const isSaved = savedJobs.includes(job.title);
            return (
              <div key={idx} className="job-card card" style={{ animationDelay: `${idx * 0.06}s` }}>
                {/* Card Header */}
                <div className="job-card__header">
                  <div className="job-card__info">
                    <div className="job-card__title">{job.title}</div>
                    <div className="job-card__company">{job.company_type}</div>
                  </div>
                  <ScoreRing score={job.match_score} />
                </div>

                {/* Badges */}
                <div className="job-card__badges">
                  <span className="job-badge job-badge--salary">
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <line x1="12" y1="1" x2="12" y2="23"></line>
                      <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"></path>
                    </svg>
                    {job.salary_range}
                  </span>
                  <span
                    className="job-badge"
                    style={{ color: diff.color, background: diff.bg, borderColor: `${diff.color}30` }}
                  >
                    {diff.label}
                  </span>
                </div>

                {/* Requirements */}
                {job.requirements?.length > 0 && (
                  <div className="job-card__reqs">
                    <div className="job-card__reqs-title">Key Requirements</div>
                    <ul>
                      {job.requirements.map((req, i) => (
                        <li key={i}>{req}</li>
                      ))}
                    </ul>
                  </div>
                )}

                {/* Why fit */}
                {job.why_fit && (
                  <div className="job-card__why">
                    <span className="job-card__why-icon">💡</span>
                    <span>{job.why_fit}</span>
                  </div>
                )}

                {/* Actions */}
                <div className="job-card__actions">
                  <button
                    className={`job-save-btn ${isSaved ? 'saved' : ''}`}
                    onClick={() => toggleSave(job.title)}
                    title={isSaved ? 'Remove from saved' : 'Save this job'}
                  >
                    <svg width="15" height="15" viewBox="0 0 24 24" fill={isSaved ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"></path>
                    </svg>
                    {isSaved ? 'Saved' : 'Save'}
                  </button>
                  <button
                    className="btn btn-primary job-apply-btn"
                    onClick={() => {
                      const query = encodeURIComponent(job.title);
                      window.open(`https://www.linkedin.com/jobs/search/?keywords=${query}`, '_blank');
                    }}
                  >
                    Search on LinkedIn
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path>
                      <polyline points="15 3 21 3 21 9"></polyline>
                      <line x1="10" y1="14" x2="21" y2="3"></line>
                    </svg>
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Footer tip */}
      {!loading && !error && jobs.length > 0 && (
        <div className="jobs-footer-tip">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10"></circle>
            <line x1="12" y1="8" x2="12" y2="12"></line>
            <line x1="12" y1="16" x2="12.01" y2="16"></line>
          </svg>
          Recommendations update each time you upload a new resume or complete a mock interview.
        </div>
      )}
    </div>
  );
}
