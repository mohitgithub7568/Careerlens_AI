import React, { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { API_BASE_URL } from '../services/api';
import './DashboardPage.css';

const API_BASE = API_BASE_URL;

const DashboardPage = () => {
  const navigate = useNavigate();
  const [userName, setUserName] = useState('User');
  const [dashboardData, setDashboardData] = useState({
    resumes_count: 0,
    interviews_count: 0,
    average_score: 0,
    recent_interviews: []
  });
  
  const [loading, setLoading] = useState(true);
  const [selectedInterviewId, setSelectedInterviewId] = useState(null);
  const [interviewDetail, setInterviewDetail] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const [role, setRole] = useState('Software Engineer');
  const [insights, setInsights] = useState(null);
  const [insightsLoading, setInsightsLoading] = useState(false);
  const [insightsError, setInsightsError] = useState('');
  const [latestSessionId, setLatestSessionId] = useState(null);
  const [scoreData, setScoreData] = useState([]);


  const fetchInsights = async (sessionId, targetRole) => {
    if (!sessionId) return;
    setInsightsLoading(true);
    setInsightsError('');
    try {
      const res = await fetch(`${API_BASE}/ai-insights?session_id=${sessionId}&role=${encodeURIComponent(targetRole)}`);
      if (res.ok) {
        const data = await res.json();
        if (data.success) {
          setInsights(data);
        } else {
          setInsightsError('Could not calculate insights.');
        }
      } else {
        setInsightsError('Insights service temporarily unavailable.');
      }
    } catch (e) {
      console.error(e);
      setInsightsError('Failed to fetch AI insights.');
    } finally {
      setInsightsLoading(false);
    }
  };

  useEffect(() => {
    const fetchDashboard = async () => {
      const storedUser = JSON.parse(localStorage.getItem('careerlens_user') || '{}');
      const userId = storedUser.id || 'demo_user_123';
      setUserName(storedUser.name || 'User');
      
      try {
        const res = await fetch(`${API_BASE}/dashboard-data?user_id=${userId}`);
        if (res.ok) {
          const data = await res.json();
          if (data.success) {
            setDashboardData(data);
          }
        }

        // Fetch user's latest resume to get the session ID
        const resumeRes = await fetch(`${API_BASE}/resumes?user_id=${userId}`);
        if (resumeRes.ok) {
          const resumeData = await resumeRes.json();
          if (resumeData.success && resumeData.resumes && resumeData.resumes.length > 0) {
            const latestResume = resumeData.resumes[0];
            const fileUrl = latestResume.fileUrl || '';
            const stem = fileUrl.split('/').pop().replace('.pdf', '');
            if (stem) {
              setLatestSessionId(stem);
              fetchInsights(stem, 'Software Engineer');
            }
          }
        }

        // Fetch score progression for the chart
        try {
          const scoreRes = await fetch(`${API_BASE}/score-progression?user_id=${userId}`);
          if (scoreRes.ok) {
            const scoreJson = await scoreRes.json();
            if (scoreJson.success && scoreJson.points) {
              setScoreData(scoreJson.points);
            }
          }
        } catch (scoreErr) {
          console.warn('Score progression fetch failed:', scoreErr);
        }

      } catch (err) {
        console.error("Dashboard fetch failed:", err);
      } finally {
        setLoading(false);
      }
    };
    fetchDashboard();
  }, []);

  const openInterviewDetail = async (id) => {
    setSelectedInterviewId(id);
    setDetailLoading(true);
    setInterviewDetail(null);
    try {
      const res = await fetch(`${API_BASE}/interview/${id}`);
      if (res.ok) {
        const data = await res.json();
        setInterviewDetail(data);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setDetailLoading(false);
    }
  };

  const closeDetail = () => {
    setSelectedInterviewId(null);
    setInterviewDetail(null);
  };

  if (selectedInterviewId) {
    return (
      <div className="dashboard-page animate-fade-in" style={{ paddingBottom: '3rem' }}>
        <button className="btn btn-secondary" onClick={closeDetail} style={{ marginBottom: '1.5rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="19" y1="12" x2="5" y2="12"></line><polyline points="12 19 5 12 12 5"></polyline></svg>
          Back to Dashboard
        </button>

        {detailLoading ? (
           <div style={{ textAlign: 'center', padding: '4rem' }}>
             <span className="spinner" style={{ width: '40px', height: '40px', borderWidth: '4px', borderTopColor: 'var(--color-brand-accent)' }}></span>
             <p style={{ marginTop: '1rem', color: 'var(--color-text-secondary)' }}>Loading interview details...</p>
           </div>
        ) : interviewDetail ? (
           <div className="card" style={{ padding: '2rem' }}>
             <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '2rem', borderBottom: '1px solid var(--color-border)', paddingBottom: '1.5rem' }}>
                <div>
                  <h2 style={{ fontSize: '1.8rem', margin: 0, color: 'var(--color-text-primary)' }}>{interviewDetail.interview?.role || 'Interview Details'}</h2>
                  <div style={{ marginTop: '0.5rem', display: 'flex', gap: '1rem' }}>
                    <span style={{ color: 'var(--color-text-secondary)' }}>Status: <span style={{ color: '#10b981', fontWeight: '500' }}>Completed</span></span>
                  </div>
                </div>
                {interviewDetail.evaluation?.overall_score != null && (
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontSize: '2.5rem', fontWeight: 'bold', color: 'var(--color-brand-accent)', lineHeight: 1 }}>{interviewDetail.evaluation.overall_score}%</div>
                    <div style={{ fontSize: '0.9rem', color: 'var(--color-text-secondary)' }}>Overall Score</div>
                  </div>
                )}
             </div>

             <h3 style={{ marginBottom: '1.5rem', fontSize: '1.2rem', color: 'var(--color-text-primary)' }}>Q&A and Improvements</h3>
             
             {interviewDetail.answers && interviewDetail.answers.length > 0 ? (
               <div style={{ display: 'grid', gap: '2rem' }}>
                 {interviewDetail.answers.map((ans, idx) => {
                    // Match with evaluation feedback if available
                    let feedback = null;
                    if (interviewDetail.evaluation?.question_wise_feedback) {
                       feedback = interviewDetail.evaluation.question_wise_feedback.find(f => 
                          f.question && ans.question && (f.question.includes(ans.question.substring(0, 20)) || ans.question.includes(f.question.substring(0, 20)))
                       ) || interviewDetail.evaluation.question_wise_feedback[idx];
                    }

                    return (
                      <div key={idx} style={{ background: 'rgba(255,255,255,0.02)', padding: '1.5rem', borderRadius: '12px', border: '1px solid rgba(255,255,255,0.05)' }}>
                         <div style={{ display: 'flex', gap: '1rem', marginBottom: '1rem' }}>
                           <div style={{ minWidth: '28px', height: '28px', borderRadius: '50%', background: 'var(--gradient-primary)', color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 'bold', fontSize: '0.9rem' }}>Q{ans.questionNumber}</div>
                           <p style={{ margin: 0, fontWeight: '500', fontSize: '1.05rem', color: 'var(--color-text-primary)', lineHeight: 1.5 }}>{ans.question}</p>
                         </div>
                         <div style={{ marginLeft: '45px', marginBottom: '1.5rem', padding: '1rem', background: 'rgba(0,0,0,0.2)', borderRadius: '8px', color: 'var(--color-text-secondary)', fontSize: '0.95rem', lineHeight: 1.6 }}>
                           <strong style={{ color: 'var(--color-text-primary)' }}>Your Answer: </strong> {ans.answer}
                         </div>
                         
                         {feedback && (
                           <div style={{ marginLeft: '45px', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.5rem' }}>
                             {feedback.improvements && feedback.improvements.length > 0 && (
                               <div style={{ background: 'rgba(59, 130, 246, 0.05)', padding: '1rem', borderRadius: '8px', border: '1px solid rgba(59, 130, 246, 0.1)' }}>
                                 <h4 style={{ color: '#60a5fa', marginBottom: '0.5rem', fontSize: '0.9rem', display: 'flex', alignItems: 'center', gap: '6px' }}>
                                   <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"></polyline></svg>
                                   Improvements
                                 </h4>
                                 <ul style={{ paddingLeft: '1rem', margin: 0, fontSize: '0.85rem', color: 'var(--color-text-secondary)' }}>
                                   {feedback.improvements.map((imp, i) => <li key={i} style={{ marginBottom: '4px' }}>{imp}</li>)}
                                 </ul>
                               </div>
                             )}
                             {feedback.mistakes && feedback.mistakes.length > 0 && (
                               <div style={{ background: 'rgba(239, 68, 68, 0.05)', padding: '1rem', borderRadius: '8px', border: '1px solid rgba(239, 68, 68, 0.1)' }}>
                                 <h4 style={{ color: '#f87171', marginBottom: '0.5rem', fontSize: '0.9rem', display: 'flex', alignItems: 'center', gap: '6px' }}>
                                   <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg>
                                   Mistakes
                                 </h4>
                                 <ul style={{ paddingLeft: '1rem', margin: 0, fontSize: '0.85rem', color: 'var(--color-text-secondary)' }}>
                                   {feedback.mistakes.map((mis, i) => <li key={i} style={{ marginBottom: '4px' }}>{mis}</li>)}
                                 </ul>
                               </div>
                             )}
                           </div>
                         )}
                      </div>
                    )
                 })}
               </div>
             ) : (
                <p style={{ color: 'var(--color-text-secondary)' }}>No answers recorded for this interview.</p>
             )}
           </div>
        ) : (
           <p style={{ color: 'var(--color-text-secondary)', textAlign: 'center' }}>Failed to load details.</p>
        )}
      </div>
    );
  }

  return (
    <div className="dashboard-page animate-fade-in">
      <div className="dashboard-header">
        <h1 className="dashboard-title">
          Welcome back, <span className="text-gradient">{userName}</span>
        </h1>
        <p className="dashboard-subtitle">
          Keep pushing forward — every interview makes you sharper.
        </p>
      </div>

      {loading ? (
         <div style={{ display: 'flex', justifyContent: 'center', padding: '4rem 0' }}>
            <span className="spinner" style={{ width: '30px', height: '30px' }}></span>
         </div>
      ) : (
        <>
          <div className="dashboard-stats">
            <div className="stat-card">
              <div className="stat-card__content">
                <p className="stat-label">Total Interviews</p>
                <h3 className="stat-number">{dashboardData.interviews_count}</h3>
              </div>
              <div className="stat-icon icon-purple">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"></path><path d="M19 10v2a7 7 0 0 1-14 0v-2"></path><line x1="12" y1="19" x2="12" y2="23"></line><line x1="8" y1="23" x2="16" y2="23"></line></svg>
              </div>
            </div>

            <div className="stat-card">
              <div className="stat-card__content">
                <p className="stat-label">Resumes Uploaded</p>
                <h3 className="stat-number">{dashboardData.resumes_count}</h3>
              </div>
              <div className="stat-icon icon-pink">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line><polyline points="10 9 9 9 8 9"></polyline></svg>
              </div>
            </div>

            <div className="stat-card">
              <div className="stat-card__content">
                <p className="stat-label">Average Score</p>
                <h3 className="stat-number">{dashboardData.average_score != null ? `${dashboardData.average_score}%` : 'N/A'}</h3>
              </div>
              <div className="stat-icon icon-blue">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"></polyline></svg>
              </div>
            </div>
          </div>

          <div className="dashboard-actions">
            <button className="btn btn-primary" onClick={() => navigate('/resumes')}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="mr-2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="17 8 12 3 7 8"></polyline><line x1="12" y1="3" x2="12" y2="15"></line></svg>
              <span style={{ marginLeft: '8px' }}>Upload Resume</span>
            </button>
            <button className="btn btn-primary" onClick={() => navigate('/resumes')} style={{ background: 'var(--gradient-accent)' }}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="mr-2"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>
              <span style={{ marginLeft: '8px' }}>Start Interview</span>
            </button>
            <button className="btn btn-secondary" onClick={() => navigate('/jobs')} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="7" width="20" height="14" rx="2" ry="2"></rect><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"></path></svg>
              <span>Find Jobs</span>
            </button>
          </div>

          {/* Score Progression Chart */}
          {scoreData.length > 1 && (() => {
            const W = 600, H = 160, PAD = { t: 16, r: 16, b: 36, l: 44 };
            const chartW = W - PAD.l - PAD.r;
            const chartH = H - PAD.t - PAD.b;
            const maxScore = Math.max(100, ...scoreData.map(p => p.score));
            const xs = scoreData.map((_, i) => PAD.l + (i / (scoreData.length - 1)) * chartW);
            const ys = scoreData.map(p => PAD.t + chartH - (p.score / maxScore) * chartH);
            const lineD = xs.map((x, i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${ys[i].toFixed(1)}`).join(' ');
            const areaD = `${lineD} L${xs[xs.length-1].toFixed(1)},${(PAD.t+chartH).toFixed(1)} L${xs[0].toFixed(1)},${(PAD.t+chartH).toFixed(1)} Z`;
            const yTicks = [0, 25, 50, 75, 100];
            return (
              <div className="card animate-fade-in-up" style={{ marginTop: '2rem', padding: '1.5rem 2rem', background: 'rgba(30,30,46,0.6)', border: '1px solid rgba(255,255,255,0.08)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem' }}>
                  <div>
                    <h3 style={{ margin: 0, fontSize: '1.15rem', color: 'var(--color-text-primary)', fontWeight: 700 }}>📈 Score Progression</h3>
                    <p style={{ margin: '4px 0 0', fontSize: '0.85rem', color: 'var(--color-text-secondary)' }}>Your interview scores over time</p>
                  </div>
                  <div style={{ display: 'flex', gap: '1.5rem' }}>
                    <div style={{ textAlign: 'right' }}>
                      <div style={{ fontSize: '1.4rem', fontWeight: 800, color: '#34d399' }}>{scoreData[scoreData.length - 1]?.score}%</div>
                      <div style={{ fontSize: '0.75rem', color: 'var(--color-text-secondary)' }}>Latest</div>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <div style={{ fontSize: '1.4rem', fontWeight: 800, color: '#818cf8' }}>{Math.round(scoreData.reduce((a,b) => a + b.score, 0) / scoreData.length)}%</div>
                      <div style={{ fontSize: '0.75rem', color: 'var(--color-text-secondary)' }}>Average</div>
                    </div>
                  </div>
                </div>
                <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ overflow: 'visible', display: 'block' }}>
                  <defs>
                    <linearGradient id="scoreGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#818cf8" stopOpacity="0.35" />
                      <stop offset="100%" stopColor="#818cf8" stopOpacity="0" />
                    </linearGradient>
                  </defs>
                  {/* Y-axis grid lines */}
                  {yTicks.map(t => {
                    const y = PAD.t + chartH - (t / 100) * chartH;
                    return (
                      <g key={t}>
                        <line x1={PAD.l} y1={y} x2={PAD.l + chartW} y2={y} stroke="rgba(255,255,255,0.05)" strokeDasharray="4 4" />
                        <text x={PAD.l - 8} y={y + 4} textAnchor="end" fontSize="10" fill="rgba(255,255,255,0.3)">{t}</text>
                      </g>
                    );
                  })}
                  {/* Area fill */}
                  <path d={areaD} fill="url(#scoreGrad)" />
                  {/* Main line */}
                  <path d={lineD} fill="none" stroke="#818cf8" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
                  {/* Data points */}
                  {xs.map((x, i) => (
                    <g key={i}>
                      <circle cx={x} cy={ys[i]} r="5" fill="#0f1124" stroke="#818cf8" strokeWidth="2.5" />
                      <title>{scoreData[i].role}: {scoreData[i].score}%</title>
                      {/* X-axis labels */}
                      <text x={x} y={H - 2} textAnchor="middle" fontSize="10" fill="rgba(255,255,255,0.35)">{scoreData[i].date}</text>
                    </g>
                  ))}
                </svg>
              </div>
            );
          })()}


          {latestSessionId && (
            <div className="card animate-fade-in-up" style={{ marginTop: '2rem', padding: '2rem', background: 'rgba(30, 30, 46, 0.6)', border: '1px solid rgba(255,255,255,0.08)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem', borderBottom: '1px solid rgba(255,255,255,0.1)', paddingBottom: '1.5rem', marginBottom: '1.5rem' }}>
                <div>
                  <h3 style={{ margin: 0, fontSize: '1.4rem', color: 'var(--color-text-primary)' }}>🤖 AI Resume & Portfolio Insights</h3>
                  <p style={{ margin: '4px 0 0 0', fontSize: '0.9rem', color: 'var(--color-text-secondary)' }}>Powered by multi-agent parallel LangGraph evaluation</p>
                </div>
                <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                  <input 
                    type="text" 
                    className="input-field" 
                    value={role} 
                    onChange={(e) => setRole(e.target.value)} 
                    style={{ margin: 0, padding: '0.4rem 0.8rem', fontSize: '0.9rem', width: '200px' }}
                    placeholder="Software Engineer"
                  />
                  <button 
                    className="btn btn-secondary" 
                    onClick={() => fetchInsights(latestSessionId, role)} 
                    disabled={insightsLoading}
                    style={{ padding: '0.45rem 1rem', fontSize: '0.9rem' }}
                  >
                    {insightsLoading ? 'Analyzing...' : 'Re-Analyze'}
                  </button>
                </div>
              </div>

              {insightsLoading ? (
                <div style={{ padding: '3rem', textAlign: 'center' }}>
                  <span className="spinner" style={{ width: '32px', height: '32px', borderTopColor: 'var(--color-brand-accent)', display: 'inline-block' }}></span>
                  <p style={{ marginTop: '1rem', color: 'var(--color-text-secondary)', fontSize: '0.95rem' }}>
                    Running multi-agent analysis (ATS scoring, skills gap detection, project portfolio analysis)...
                  </p>
                </div>
              ) : insightsError ? (
                <div style={{ color: '#ef4444', padding: '1rem 0' }}>{insightsError}</div>
              ) : insights ? (
                <div>
                  {/* Scores Grid */}
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1.5rem', marginBottom: '2rem' }}>
                    <div style={{ textAlign: 'center', background: 'rgba(255,255,255,0.02)', padding: '1.5rem', borderRadius: '12px', border: '1px solid rgba(255,255,255,0.04)' }}>
                      <div style={{ fontSize: '2.2rem', fontWeight: 'bold', color: '#818cf8' }}>{insights.ats_score}%</div>
                      <div style={{ fontSize: '0.85rem', color: 'var(--color-text-secondary)', marginTop: '4px' }}>ATS Match Score</div>
                    </div>
                    <div style={{ textAlign: 'center', background: 'rgba(255,255,255,0.02)', padding: '1.5rem', borderRadius: '12px', border: '1px solid rgba(255,255,255,0.04)' }}>
                      <div style={{ fontSize: '2.2rem', fontWeight: 'bold', color: '#34d399' }}>{insights.skill_match_score}%</div>
                      <div style={{ fontSize: '0.85rem', color: 'var(--color-text-secondary)', marginTop: '4px' }}>Skill Compatibility</div>
                    </div>
                    <div style={{ textAlign: 'center', background: 'rgba(255,255,255,0.02)', padding: '1.5rem', borderRadius: '12px', border: '1px solid rgba(255,255,255,0.04)' }}>
                      <div style={{ fontSize: '2.2rem', fontWeight: 'bold', color: '#fb7185' }}>{insights.portfolio_score}%</div>
                      <div style={{ fontSize: '0.85rem', color: 'var(--color-text-secondary)', marginTop: '4px' }}>Portfolio Quality</div>
                    </div>
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '2rem', flexWrap: 'wrap' }}>
                    {/* Skills Gaps */}
                    <div>
                      <h4 style={{ color: 'var(--color-text-primary)', marginBottom: '1rem', borderBottom: '1px solid rgba(255,255,255,0.05)', paddingBottom: '0.5rem' }}>🧠 Skills Gap Analysis</h4>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.8rem' }}>
                        {insights.skills_analysis?.missing_critical_skills?.length > 0 ? (
                          <div>
                            <span style={{ fontSize: '0.85rem', color: '#f87171', fontWeight: '600' }}>CRITICAL MISSING:</span>
                            <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginTop: '6px' }}>
                              {insights.skills_analysis.missing_critical_skills.map((s, i) => (
                                <span key={i} style={{ padding: '3px 8px', borderRadius: '6px', background: 'rgba(239,68,68,0.1)', color: '#ef4444', fontSize: '0.8rem' }}>{s}</span>
                              ))}
                            </div>
                          </div>
                        ) : (
                          <div style={{ fontSize: '0.9rem', color: '#34d399' }}>✓ All critical technical skills found in resume!</div>
                        )}
                        {insights.skills_analysis?.skills_to_learn_next?.length > 0 && (
                          <div style={{ marginTop: '0.5rem' }}>
                            <span style={{ fontSize: '0.85rem', color: '#fbbf24', fontWeight: '600' }}>RECOMMENDED TO LEARN:</span>
                            <ul style={{ margin: '6px 0 0 0', paddingLeft: '1.2rem', fontSize: '0.85rem', color: 'var(--color-text-secondary)', lineHeight: 1.5 }}>
                              {insights.skills_analysis.skills_to_learn_next.map((s, i) => <li key={i}>{s}</li>)}
                            </ul>
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Portfolio Improvement */}
                    <div>
                      <h4 style={{ color: 'var(--color-text-primary)', marginBottom: '1rem', borderBottom: '1px solid rgba(255,255,255,0.05)', paddingBottom: '0.5rem' }}>📁 Projects & Portfolio Suggestions</h4>
                      {insights.projects_analysis?.portfolio_improvement_projects?.length > 0 || insights.feedback?.project_suggestions?.length > 0 ? (
                        <ul style={{ margin: 0, paddingLeft: '1.2rem', fontSize: '0.85rem', color: 'var(--color-text-secondary)', lineHeight: 1.5 }}>
                          {(insights.projects_analysis?.portfolio_improvement_projects || insights.feedback?.project_suggestions).slice(0, 3).map((p, i) => (
                            <li key={i} style={{ marginBottom: '8px' }}>{p}</li>
                          ))}
                        </ul>
                      ) : (
                        <p style={{ margin: 0, fontSize: '0.9rem', color: 'var(--color-text-secondary)' }}>No project recommendations generated.</p>
                      )}
                    </div>
                  </div>
                </div>
              ) : (
                <div style={{ padding: '1rem 0', color: 'var(--color-text-secondary)', fontSize: '0.9rem', textAlign: 'center' }}>
                  No insights evaluated yet. Click Re-Analyze to trigger.
                </div>
              )}
            </div>
          )}

          <div className="recent-list-container card" style={{ marginTop: '2rem' }}>
            <div className="recent-list-header">
              <h3>Recent Interviews</h3>
              <Link to="/interviews" onClick={(e) => { e.preventDefault(); navigate('/resumes') }} className="view-all-link">View all 
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="5" y1="12" x2="19" y2="12"></line><polyline points="12 5 19 12 12 19"></polyline></svg>
              </Link>
            </div>
            
            <div className="recent-items">
              {dashboardData.recent_interviews.length === 0 ? (
                 <p style={{ color: 'var(--color-text-secondary)', padding: '1rem 0' }}>No recent interviews yet.</p>
              ) : (
                dashboardData.recent_interviews.map(iv => (
                  <div key={iv.id} className="recent-item" onClick={() => openInterviewDetail(iv.id)} style={{ cursor: 'pointer' }}>
                    <div className="recent-item__info">
                      <h4 className="item-title">{iv.role}</h4>
                      <p className="item-date">{iv.date}</p>
                    </div>
                    {iv.score != null ? (
                       <div className="recent-item__score text-accent">{iv.score}%</div>
                    ) : (
                       <div className="recent-item__score" style={{ color: 'var(--color-text-secondary)', fontSize: '0.85rem' }}>View →</div>
                    )}
                    <svg className="item-arrow" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="5" y1="12" x2="19" y2="12"></line><polyline points="12 5 19 12 12 19"></polyline></svg>
                  </div>
                ))
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
};

export default DashboardPage;
