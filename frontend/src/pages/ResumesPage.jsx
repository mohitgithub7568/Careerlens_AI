import React, { useRef, useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { API_BASE_URL } from '../services/api';
import './ResumesPage.css';

const ResumesPage = () => {
  const navigate = useNavigate();
  const fileInputRef = useRef(null);
  const [uploading, setUploading] = useState(false);
  const [listLoading, setListLoading] = useState(true);
  const [resumesList, setResumesList] = useState([]);
  const [expandedId, setExpandedId] = useState(null);
  const [toast, setToast] = useState(null); // { type: 'success'|'error', message }

  const showToast = (type, message) => {
    setToast({ type, message });
    setTimeout(() => setToast(null), 5000);
  };

  const loadResumes = useCallback(async () => {
    setListLoading(true);
    try {
      const storedUser = JSON.parse(localStorage.getItem('careerlens_user') || '{}');
      const userId = storedUser.id || 'demo_user_123';
      const res = await fetch(`${API_BASE_URL}/resumes?user_id=${userId}`);
      if (res.ok) {
        const data = await res.json();
        if (data.success) {
          setResumesList(data.resumes || []);
        }
      }
    } catch (e) {
      console.error(e);
    } finally {
      setListLoading(false);
    }
  }, []);

  useEffect(() => {
    loadResumes();
  }, [loadResumes]);

  const handleUploadClick = () => {
    if (fileInputRef.current) {
      // Reset so same file can be re-uploaded
      fileInputRef.current.value = '';
      fileInputRef.current.click();
    }
  };

  const handleFileChange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    if (!file.name.toLowerCase().endsWith('.pdf')) {
      showToast('error', 'Only PDF files are accepted.');
      return;
    }

    setUploading(true);
    const storedUser = JSON.parse(localStorage.getItem('careerlens_user') || '{}');
    const formData = new FormData();
    formData.append('file', file);
    formData.append('user_id', storedUser.id || 'demo_user_123');

    try {
      const response = await fetch(`${API_BASE_URL}/upload-resume`, {
        method: 'POST',
        body: formData,
      });

      const data = await response.json();

      if (!response.ok) {
        // Backend returned an error
        const errMsg = data.detail || data.message || 'Upload failed. Please try again.';
        showToast('error', errMsg);
        return;
      }

      // Upload succeeded
      showToast('success', `✅ Resume analyzed! ATS Score: ${data.ats?.ats_score || 'N/A'}`);

      // Wait a moment for MongoDB write to complete before reloading list
      setTimeout(() => loadResumes(), 800);

    } catch (err) {
      console.error(err);
      showToast('error', 'Network error. Please check your connection and try again.');
    } finally {
      setUploading(false);
    }
  };

  const toggleExpand = (id) => {
    setExpandedId(expandedId === id ? null : id);
  };

  return (
    <div className="resumes-page animate-fade-in">
      {/* Toast notification */}
      {toast && (
        <div className={`resume-toast resume-toast--${toast.type}`}>
          {toast.type === 'error' ? (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
          ) : (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><path d="M8 12l2 2 6-6"/></svg>
          )}
          <span>{toast.message}</span>
          <button onClick={() => setToast(null)} className="toast-close">✕</button>
        </div>
      )}

      <div className="page-header resumes-header">
        <div className="page-title-group">
          <div className="page-icon icon-purple">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
              <polyline points="14 2 14 8 20 8"></polyline>
              <line x1="16" y1="13" x2="8" y2="13"></line>
              <line x1="16" y1="17" x2="8" y2="17"></line>
              <polyline points="10 9 9 9 8 9"></polyline>
            </svg>
          </div>
          <div>
            <h1 className="page-title">My Uploaded Resumes</h1>
            <p className="page-subtitle">Upload your resume and track ATS analysis, interviews, and improvements.</p>
          </div>
        </div>

        <input
          type="file"
          ref={fileInputRef}
          style={{ display: 'none' }}
          accept="application/pdf"
          onChange={handleFileChange}
        />

        <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
          <button
            className="btn btn-secondary btn-sm"
            onClick={loadResumes}
            disabled={listLoading || uploading}
            title="Refresh list"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ transform: listLoading ? 'rotate(360deg)' : 'none', transition: 'transform 0.5s' }}>
              <polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/>
              <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/>
            </svg>
          </button>

          <button
            className="btn btn-primary"
            style={{ background: 'var(--gradient-primary)' }}
            onClick={handleUploadClick}
            disabled={uploading}
          >
            {uploading ? (
              <><span className="spinner"></span><span style={{ marginLeft: '8px' }}>Analyzing...</span></>
            ) : (
              <>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                  <polyline points="17 8 12 3 7 8"></polyline>
                  <line x1="12" y1="3" x2="12" y2="15"></line>
                </svg>
                <span style={{ marginLeft: '8px' }}>Upload PDF</span>
              </>
            )}
          </button>
        </div>
      </div>

      {/* Upload progress banner */}
      {uploading && (
        <div className="upload-progress-banner">
          <span className="spinner" style={{ width: '16px', height: '16px', borderWidth: '2px' }}></span>
          <span>Analyzing your resume with AI — this may take 15–30 seconds...</span>
        </div>
      )}

      <div className="resumes-list">
        {listLoading ? (
          <div className="empty-state">
            <span className="spinner" style={{ width: '36px', height: '36px', borderWidth: '3px' }}></span>
            <p style={{ color: 'var(--color-text-secondary)', marginTop: '1rem' }}>Loading resumes...</p>
          </div>
        ) : resumesList.length === 0 ? (
          <div className="empty-state">
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ color: 'var(--color-text-secondary)', marginBottom: '1rem' }}>
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
              <polyline points="14 2 14 8 20 8"></polyline>
            </svg>
            <h3 style={{ color: 'var(--color-text-primary)', marginBottom: '0.5rem' }}>No Resumes Yet</h3>
            <p style={{ color: 'var(--color-text-secondary)' }}>Upload your first resume to get AI analysis.</p>
          </div>
        ) : (
          resumesList.map((resume) => {
            const formattedDate = new Date(resume.createdAt).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
            const isExpanded = expandedId === resume._id;
            const ats = resume.atsAnalysis;
            const analysis = resume.resumeAnalysis;

            return (
              <div key={resume._id} className={`resume-card card ${isExpanded ? 'resume-card--expanded' : ''}`}>
                {/* Header row */}
                <div className="resume-card__header" onClick={() => toggleExpand(resume._id)}>
                  <div className="resume-card__left">
                    <div className="resume-icon-wrapper">
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
                        <polyline points="14 2 14 8 20 8"></polyline>
                        <line x1="16" y1="13" x2="8" y2="13"></line>
                        <line x1="16" y1="17" x2="8" y2="17"></line>
                        <polyline points="10 9 9 9 8 9"></polyline>
                      </svg>
                    </div>
                    <div className="resume-info">
                      <h3 className="resume-title">{resume.fileName || 'resume.pdf'}</h3>
                      <p className="resume-meta">
                        Uploaded {formattedDate} <span className="meta-dot">•</span>{' '}
                        <span className="resume-ats text-gradient">ATS: {ats?.ats_score || 'N/A'}</span>
                        {analysis?.name && <><span className="meta-dot">•</span> {analysis.name}</>}
                      </p>
                    </div>
                  </div>

                  <div className="resume-card__right">
                    <button
                      className="btn btn-secondary btn-sm"
                      onClick={(e) => {
                        e.stopPropagation();
                        const storedUser = JSON.parse(localStorage.getItem('careerlens_user') || '{}');
                        navigate('/interviews', { state: { resumeId: resume._id, userId: storedUser.id || 'demo_user_123' } });
                      }}
                    >
                      Interview
                    </button>
                    <svg className={`expand-arrow ${isExpanded ? 'expand-arrow--open' : ''}`} width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="6 9 12 15 18 9"></polyline>
                    </svg>
                  </div>
                </div>

                {/* Expanded ATS detail */}
                {isExpanded && (
                  <div className="resume-card__detail animate-fade-in">
                    {/* Skills & Missing Keywords */}
                    <div className="ats-grid">
                      <div className="ats-block">
                        <h4>Skills Found</h4>
                        <div className="tag-list">
                          {(analysis?.skills || []).map((skill, i) => (
                            <span key={i} className="tag tag--skill">{skill}</span>
                          ))}
                          {(!analysis?.skills || analysis.skills.length === 0) && <span className="text-muted">No skills extracted</span>}
                        </div>
                      </div>
                      <div className="ats-block">
                        <h4>Missing Keywords</h4>
                        <div className="tag-list">
                          {(ats?.missing_keywords || []).map((kw, i) => (
                            <span key={i} className="tag tag--missing">{kw}</span>
                          ))}
                          {(!ats?.missing_keywords || ats.missing_keywords.length === 0) && <span className="text-muted">None detected</span>}
                        </div>
                      </div>
                    </div>

                    {/* Optimized Summary */}
                    {ats?.optimized_summary && (
                      <div className="ats-section">
                        <h4>Optimized Summary</h4>
                        <p className="ats-text-block">{ats.optimized_summary}</p>
                      </div>
                    )}

                    {/* Improvements */}
                    {ats?.improvements && ats.improvements.length > 0 && (
                      <div className="ats-section">
                        <h4>Recommended Improvements</h4>
                        <ul className="ats-list">
                          {ats.improvements.map((item, idx) => (
                            <li key={idx}>{item}</li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {/* Keyword Density & Formatting Feedback */}
                    <div className="ats-grid">
                      {ats?.keyword_density_feedback && (
                        <div className="ats-block ats-block--info">
                          <h4>Keyword Density Feedback</h4>
                          <p>{ats.keyword_density_feedback}</p>
                        </div>
                      )}
                      {ats?.formatting_feedback && (
                        <div className="ats-block ats-block--accent">
                          <h4>Formatting Feedback</h4>
                          <p>{ats.formatting_feedback}</p>
                        </div>
                      )}
                    </div>

                    {/* Experience & Education */}
                    {analysis?.experience && analysis.experience.length > 0 && (
                      <div className="ats-section">
                        <h4>Experience</h4>
                        <ul className="ats-list">
                          {analysis.experience.map((exp, idx) => (
                            <li key={idx}>{typeof exp === 'string' ? exp : JSON.stringify(exp)}</li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {analysis?.education && analysis.education.length > 0 && (
                      <div className="ats-section">
                        <h4>Education</h4>
                        <ul className="ats-list">
                          {analysis.education.map((edu, idx) => (
                            <li key={idx}>{typeof edu === 'string' ? edu : JSON.stringify(edu)}</li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {/* Strengths & Suggestions */}
                    <div className="ats-grid">
                      {analysis?.strengths && analysis.strengths.length > 0 && (
                        <div className="ats-block" style={{ borderColor: 'rgba(16,185,129,0.15)', background: 'rgba(16,185,129,0.04)' }}>
                          <h4 style={{ color: '#34d399' }}>Strengths</h4>
                          <ul className="ats-list">
                            {analysis.strengths.map((s, i) => <li key={i}>{s}</li>)}
                          </ul>
                        </div>
                      )}
                      {analysis?.suggestions && analysis.suggestions.length > 0 && (
                        <div className="ats-block" style={{ borderColor: 'rgba(251,191,36,0.15)', background: 'rgba(251,191,36,0.04)' }}>
                          <h4 style={{ color: '#fbbf24' }}>Suggestions</h4>
                          <ul className="ats-list">
                            {analysis.suggestions.map((s, i) => <li key={i}>{s}</li>)}
                          </ul>
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};

export default ResumesPage;
